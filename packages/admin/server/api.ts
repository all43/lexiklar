/**
 * Vite dev server middleware — serves word data, examples, and Wiktionary
 * raw lookup as JSON API endpoints under /api/*.
 */
import type { Plugin } from "vite";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { lookupWiktionary } from "../../../scripts/lib/wiktionary-lookup.js";
import { computeConjugation } from "../../../src/utils/verb-forms.js";
import { callLLM, extractJSON, PROVIDER_DEFAULTS, getApiKey } from "../../../scripts/lib/llm.js";
import { WORD_SYSTEM_PROMPT, SYSTEM_PROMPT_FULL, PHRASE_SYSTEM_PROMPT } from "../../../scripts/lib/prompts.js";
import type { VerbEndingsFile } from "../../../types/word.js";

const ROOT = resolve(__dirname, "../../..");
const WORDS_DIR = join(ROOT, "data", "words");
const EXAMPLES_DIR = join(ROOT, "data", "examples");
const VERB_ENDINGS_FILE = join(ROOT, "data", "rules", "verb-endings.json");

let verbEndings: VerbEndingsFile | null = null;
function getVerbEndings(): VerbEndingsFile | null {
  if (verbEndings) return verbEndings;
  if (!existsSync(VERB_ENDINGS_FILE)) return null;
  verbEndings = JSON.parse(readFileSync(VERB_ENDINGS_FILE, "utf-8"));
  return verbEndings;
}

const POS_DIRS = [
  "abbreviations", "adjectives", "adverbs", "conjunctions", "determiners",
  "interjections", "names", "nouns", "numerals", "particles", "phrases",
  "postpositions", "prepositions", "pronouns", "verbs",
];

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

interface WordListItem {
  pos: string;
  file: string;
  word: string;
  gloss_en?: string;
  zipf?: number;
  flags?: string[];
}

function getWordFlags(data: any): string[] {
  const flags: string[] = [];
  const pr = data._proofread || {};
  if (pr.gloss_en) flags.push("proofread");
  if (data._overrides && Object.keys(data._overrides).length) flags.push("overrides");
  const hasMissing = (data.senses || []).some((s: any) => !s.gloss_en);
  if (hasMissing) flags.push("missing_en");
  if (!pr.gloss_en) flags.push("unproofread");
  if (data._meta?.source === "manual") flags.push("manual");
  return flags;
}

/** Cached enriched word index — rebuilt every 60s. */
let wordIndexCache: { items: WordListItem[]; ts: number } | null = null;

function getWordIndex(): WordListItem[] {
  if (wordIndexCache && Date.now() - wordIndexCache.ts < 60_000) {
    return wordIndexCache.items;
  }
  const items: WordListItem[] = [];
  for (const dir of POS_DIRS) {
    const dirPath = join(WORDS_DIR, dir);
    if (!existsSync(dirPath)) continue;
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".json")) continue;
      const word = file.replace(/\.json$/, "");
      const item: WordListItem = { pos: dir, file, word };
      try {
        const data = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
        item.gloss_en = data.senses?.[0]?.gloss_en || undefined;
        item.zipf = data.zipf;
        item.flags = getWordFlags(data);
      } catch { /* skip unreadable */ }
      items.push(item);
    }
  }
  wordIndexCache = { items, ts: Date.now() };
  return items;
}

/** List word files with filtering, sorting, and pagination. */
function handleWordList(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const pos = params.get("pos");
  const q = params.get("q")?.toLowerCase() || "";
  const limit = Math.min(parseInt(params.get("limit") || "100"), 500);
  const offset = parseInt(params.get("offset") || "0");
  const filter = params.get("filter");
  const sort = params.get("sort") || "alpha";

  const allItems = getWordIndex();
  let results = allItems;

  if (pos) results = results.filter(i => i.pos === pos);
  if (q) results = results.filter(i => i.word.toLowerCase().includes(q));

  if (filter) {
    const filters = new Set(filter.split(","));
    results = results.filter(i => {
      const flags = i.flags || [];
      for (const f of filters) {
        if (f === "manual") {
          if (!flags.includes("manual")) return false;
        } else if (!flags.includes(f)) return false;
      }
      return true;
    });
  }

  switch (sort) {
    case "zipf":
      results = [...results].sort((a, b) => (b.zipf ?? 0) - (a.zipf ?? 0));
      break;
    case "zipf-asc":
      results = [...results].sort((a, b) => (a.zipf ?? 0) - (b.zipf ?? 0));
      break;
    default:
      results = [...results].sort((a, b) => a.word.localeCompare(b.word, "de"));
      break;
  }

  const page = results.slice(offset, offset + limit);
  json(res, { total: results.length, offset, items: page });
}

/** Dashboard statistics — scans all word files for quality metrics. */
let statsCache: { data: any; ts: number } | null = null;
function handleStats(res: ServerResponse) {
  // Cache for 30s to avoid rescanning on every dashboard load
  if (statsCache && Date.now() - statsCache.ts < 30_000) {
    return json(res, statsCache.data);
  }

  const stats = {
    total: 0, proofread_gloss: 0, proofread_full: 0, proofread_syn: 0,
    has_overrides: 0, missing_gloss_en: 0, total_examples: 0,
    by_pos: {} as Record<string, number>,
  };

  for (const dir of POS_DIRS) {
    const dirPath = join(WORDS_DIR, dir);
    if (!existsSync(dirPath)) continue;
    let posCount = 0;

    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".json")) continue;
      posCount++;
      stats.total++;
      try {
        const data = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
        const pr = data._proofread || {};
        if (pr.gloss_en) stats.proofread_gloss++;
        if (pr.gloss_en_full) stats.proofread_full++;
        if (pr.synonyms_en) stats.proofread_syn++;
        if (data._overrides && Object.keys(data._overrides).length) stats.has_overrides++;
        for (const s of data.senses || []) {
          stats.total_examples += (s.example_ids || []).length;
          if (!s.gloss_en) { stats.missing_gloss_en++; break; }
        }
      } catch { /* skip */ }
    }
    stats.by_pos[dir] = posCount;
  }

  statsCache = { data: stats, ts: Date.now() };
  json(res, stats);
}

/** Read a single word file + resolve its examples. */
function handleWordDetail(res: ServerResponse, pos: string, file: string) {
  const filePath = join(WORDS_DIR, pos, file.endsWith(".json") ? file : file + ".json");
  if (!existsSync(filePath)) return json(res, { error: "not found" }, 404);

  const word = JSON.parse(readFileSync(filePath, "utf-8"));

  // Generate conjugation table for verbs that only have stems
  if (word.pos === "verb" && !word.conjugation && word.stems && word.conjugation_class !== "irregular") {
    const endings = getVerbEndings();
    if (endings) {
      word.conjugation = computeConjugation(word, endings);
    }
  }

  // Collect all example IDs across senses
  const exampleIds: string[] = [];
  for (const sense of word.senses || []) {
    for (const id of sense.example_ids || []) exampleIds.push(id);
  }

  // Load examples from shards
  const examples: Record<string, unknown> = {};
  const prefixes = new Set(exampleIds.map((id: string) => id.slice(0, 2)));
  for (const prefix of prefixes) {
    const shardPath = join(EXAMPLES_DIR, prefix + ".json");
    if (!existsSync(shardPath)) continue;
    const shard = JSON.parse(readFileSync(shardPath, "utf-8"));
    for (const id of exampleIds) {
      if (shard[id]) examples[id] = shard[id];
    }
  }

  json(res, { word, examples });
}

/** Look up raw Wiktionary entries via shared lookup library. */
function handleLookup(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const query = params.get("word");
  if (!query) return json(res, { error: "missing ?word=" }, 400);

  const results = lookupWiktionary(query, {
    exact: params.get("exact") === "true",
    pos: params.get("pos") || null,
    limit: Math.min(parseInt(params.get("limit") || "10"), 50),
  });

  json(res, { results });
}

/** POS summary: count of files per directory. */
function handlePosSummary(res: ServerResponse) {
  const counts: { pos: string; count: number }[] = [];
  for (const dir of POS_DIRS) {
    const dirPath = join(WORDS_DIR, dir);
    if (!existsSync(dirPath)) { counts.push({ pos: dir, count: 0 }); continue; }
    const count = readdirSync(dirPath).filter(f => f.endsWith(".json")).length;
    counts.push({ pos: dir, count });
  }
  json(res, counts);
}

/** Read JSON body from an incoming request. */
function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

/** PATCH /api/words/:pos/:file — update sense fields and _proofread. */
async function handleWordPatch(req: IncomingMessage, res: ServerResponse, pos: string, file: string) {
  const filePath = join(WORDS_DIR, pos, file.endsWith(".json") ? file : file + ".json");
  if (!existsSync(filePath)) return json(res, { error: "not found" }, 404);

  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const word = JSON.parse(readFileSync(filePath, "utf-8"));

  if (body.senses && Array.isArray(body.senses)) {
    for (const patch of body.senses) {
      const idx = patch.index;
      if (typeof idx !== "number" || !word.senses?.[idx]) continue;
      const sense = word.senses[idx];
      if ("gloss_en" in patch) sense.gloss_en = patch.gloss_en || null;
      if ("gloss_en_full" in patch) sense.gloss_en_full = patch.gloss_en_full || null;
      if ("synonyms_en" in patch) {
        sense.synonyms_en = Array.isArray(patch.synonyms_en)
          ? patch.synonyms_en.filter((s: string) => s)
          : null;
      }
    }
  }

  if ("_proofread" in body && typeof body._proofread === "object") {
    word._proofread = { ...(word._proofread || {}), ...body._proofread };
  }

  if ("_overrides" in body && typeof body._overrides === "object") {
    word._overrides = body._overrides;
  }

  writeFileSync(filePath, JSON.stringify(word, null, 2) + "\n", "utf-8");
  wordIndexCache = null;
  json(res, { ok: true });
}

/** POST /api/translate — LLM translation for a single sense. */
async function handleTranslate(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const { word, pos, gloss, mode, provider, model } = body;
  if (!word || !gloss) return json(res, { error: "Missing word or gloss" }, 400);

  const isPhrase = pos === "phrase";
  const isFull = mode === "full";
  const systemPrompt = isFull ? SYSTEM_PROMPT_FULL : isPhrase ? PHRASE_SYSTEM_PROMPT : WORD_SYSTEM_PROMPT;
  const typeClause = pos ? `, pos="${pos}"` : "";
  const userMessage = isFull
    ? `word="${word}"${typeClause}, gloss="${gloss}"`
    : isPhrase
      ? `word="${word}", phrase_type="${body.phrase_type || ""}", gloss="${gloss}"`
      : `word="${word}"${typeClause}, gloss="${gloss}"`;

  try {
    const result = await callLLM(systemPrompt, userMessage, {
      provider: provider || "anthropic",
      model: model || undefined,
      maxTokens: isFull ? 200 : 64,
      temperature: 0.2,
    });
    const translation = result.text?.trim() || "";
    json(res, { translation, model: result.model, cached: !!result._cached });
  } catch (err: any) {
    json(res, { error: err.message || "LLM call failed" }, 500);
  }
}

/** GET /api/providers — list available LLM providers with API key status. */
function handleProviders(res: ServerResponse) {
  const providers = Object.entries(PROVIDER_DEFAULTS).map(([name, config]) => ({
    name,
    model: config.model,
    hasKey: config.keyEnv ? !!getApiKey(name) : true,
  }));
  json(res, providers);
}

/** GET /api/search-words?q=... — quick word search for linking. */
function handleSearchWords(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const q = params.get("q")?.toLowerCase() || "";
  const limit = Math.min(parseInt(params.get("limit") || "20"), 50);
  if (!q || q.length < 2) return json(res, []);

  const allItems = getWordIndex();
  const results: { pos: string; word: string; gloss_en?: string }[] = [];
  for (const item of allItems) {
    if (item.word.toLowerCase().includes(q)) {
      results.push({ pos: item.pos, word: item.word, gloss_en: item.gloss_en });
      if (results.length >= limit) break;
    }
  }
  json(res, results);
}

const REPORTS_URL = "https://reports.lexiklar.app/reports";

/** Proxy reports from Cloudflare Worker (keeps ADMIN_TOKEN server-side). */
async function handleReports(res: ServerResponse) {
  const token = process.env.LEXIKLAR_ADMIN_TOKEN;
  if (!token) return json(res, { error: "LEXIKLAR_ADMIN_TOKEN not set" }, 500);

  try {
    const resp = await fetch(REPORTS_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    json(res, data, resp.status);
  } catch (err: any) {
    json(res, { error: err.message || "Failed to fetch reports" }, 502);
  }
}

export function adminApiPlugin(): Plugin {
  return {
    name: "admin-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/")) return next();

        const path = url.split("?")[0];

        if (path === "/api/pos") return handlePosSummary(res);
        if (path === "/api/stats") return handleStats(res);
        if (path === "/api/words" && req.method === "GET") return handleWordList(req, res);
        if (path === "/api/lookup") return handleLookup(req, res);
        if (path === "/api/reports") { handleReports(res); return; }
        if (path === "/api/translate" && req.method === "POST") { handleTranslate(req, res); return; }
        if (path === "/api/providers") return handleProviders(res);
        if (path === "/api/search-words") return handleSearchWords(req, res);

        // /api/words/:pos/:file
        const wordMatch = path.match(/^\/api\/words\/([^/]+)\/(.+)$/);
        if (wordMatch) {
          if (req.method === "PATCH") { handleWordPatch(req, res, wordMatch[1], wordMatch[2]); return; }
          return handleWordDetail(res, wordMatch[1], wordMatch[2]);
        }

        json(res, { error: "not found" }, 404);
      });
    },
  };
}
