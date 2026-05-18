/**
 * Vite dev server middleware — serves word data, examples, and Wiktionary
 * raw lookup as JSON API endpoints under /api/*.
 */
import type { Plugin } from "vite";
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { tmpdir } from "os";
import type { IncomingMessage, ServerResponse } from "http";
import { lookupWiktionary, lookupWiktionaryBatch } from "../../../scripts/lib/wiktionary-lookup.js";
import { computeConjugation } from "../../../src/utils/verb-forms.js";
import { callLLM, extractJSON, PROVIDER_DEFAULTS, getApiKey } from "../../../scripts/lib/llm.js";
import { WORD_SYSTEM_PROMPT, SYSTEM_PROMPT_FULL, PHRASE_SYSTEM_PROMPT, TOPIC_WORDS_SYSTEM_PROMPT, TOPIC_WORDS_SCHEMA, WORD_TOPICS_SYSTEM_PROMPT, WORD_TOPICS_SCHEMA } from "../../../scripts/lib/prompts.js";
import { loadAllCorpora, lookupFPM, toZipf, combineZipf, type FPMMap } from "../../../scripts/lib/corpus.js";
import type { VerbEndingsFile } from "../../../types/word.js";
import Database from "better-sqlite3";

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
  inDb?: boolean;
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

  const qLow = q.toLowerCase();
  results = [...results].sort((a, b) => {
    if (q) {
      const tier = (w: string) => {
        const wl = w.toLowerCase();
        if (wl === qLow) return 0;
        if (wl.startsWith(qLow)) return 1;
        return 2;
      };
      const tierDiff = tier(a.word) - tier(b.word);
      if (tierDiff !== 0) return tierDiff;
    }
    if (sort === "zipf") return (b.zipf ?? 0) - (a.zipf ?? 0);
    if (sort === "zipf-asc") return (a.zipf ?? 0) - (b.zipf ?? 0);
    return a.word.localeCompare(b.word, "de");
  });

  const page = results.slice(offset, offset + limit);

  const dbFiles = getDbFileSet();
  if (dbFiles) {
    for (const item of page) {
      item.inDb = dbFiles.has(item.pos + "/" + item.word);
    }
  }

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
    const merged = { ...(word._proofread || {}), ...body._proofread };
    for (const k of Object.keys(merged)) { if (!merged[k]) delete merged[k]; }
    if (Object.keys(merged).length) word._proofread = merged;
    else delete word._proofread;
  }

  if ("_overrides" in body && typeof body._overrides === "object") {
    if (Object.keys(body._overrides).length) {
      word._overrides = body._overrides;
    } else {
      delete word._overrides;
    }
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
    const translation = result.content?.trim() || "";
    json(res, { translation, cached: !!result._cached });
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

const DB_PATH = join(ROOT, "data", "lexiklar.db");
let appDb: InstanceType<typeof Database> | null = null;

function getAppDb(): InstanceType<typeof Database> | null {
  if (appDb) return appDb;
  if (!existsSync(DB_PATH)) return null;
  appDb = new Database(DB_PATH, { readonly: true });
  return appDb;
}

let dbFileSetCache: Set<string> | null = null;
function getDbFileSet(): Set<string> | null {
  if (dbFileSetCache) return dbFileSetCache;
  const db = getAppDb();
  if (!db) return null;
  const rows = db.prepare("SELECT file FROM words").all() as { file: string }[];
  dbFileSetCache = new Set(rows.map(r => r.file));
  return dbFileSetCache;
}

function foldUmlauts(s: string): string {
  return s.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
}

interface DbSearchResult {
  lemma: string;
  pos: string;
  gender: string | null;
  frequency: number | null;
  pluralForm: string | null;
  file: string;
  glossEn: string[];
  formMatch?: true;
}

const TSX_BIN = resolve(ROOT, "node_modules/.bin/tsx");

function runScript(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(TSX_BIN, [script, ...args], { cwd: ROOT, env: { ...process.env } });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error("Timeout after 60s")); }, 60_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `exited with code ${code}`));
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

/** POST /api/add-word — run transform + enrich for a single word from Wiktionary. */
async function handleAddWord(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const word = typeof body.word === "string" ? body.word.trim() : "";
  if (!word) return json(res, { error: "missing word" }, 400);

  const WIKT_DUMP = join(ROOT, "data", "raw", "de-extract.jsonl");
  if (!existsSync(WIKT_DUMP)) {
    return json(res, { error: "Wiktionary dump not found at data/raw/de-extract.jsonl" }, 500);
  }

  // Add to whitelist before transform so frequency filter won't drop it
  const WHITELIST_PATH = join(ROOT, "config", "word-whitelist.json");
  let whitelisted = false;
  try {
    const wl = JSON.parse(readFileSync(WHITELIST_PATH, "utf-8"));
    const alreadyListed = wl.words.some((e: any) => e.word === word);
    if (!alreadyListed) {
      wl.words.push({ word, domain: "user-reported", reason: "added via admin" });
      writeFileSync(WHITELIST_PATH, JSON.stringify(wl, null, 2) + "\n", "utf-8");
      whitelisted = true;
    }
  } catch (err: any) {
    return json(res, { error: `Failed to update whitelist: ${err.message}` }, 500);
  }

  try {
    await runScript(resolve(ROOT, "scripts/transform.ts"), ["--words", word]);
    await runScript(resolve(ROOT, "scripts/enrich-frequency.ts"), ["--words", word]);
  } catch (err: any) {
    return json(res, { error: err.message || "Script failed" }, 500);
  }

  wordIndexCache = null;
  const items = getWordIndex();
  const match = items.find(i => i.word.toLowerCase() === word.toLowerCase());
  json(res, { ok: true, file: match ? match.pos + "/" + match.word : null, whitelisted });
}

const wiktCheckCache = new Map<string, unknown>();

/** GET /api/wikt-check?word=... — check pipeline presence + Wiktionary entries for a word. */
function handleWiktCheck(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const word = params.get("word");
  if (!word) return json(res, { error: "missing ?word=" }, 400);

  const cacheKey = word.toLowerCase();
  if (wiktCheckCache.has(cacheKey)) {
    // Pipeline presence may have changed (word added), so re-check inPipeline but use cached wiktEntries
    const cached = wiktCheckCache.get(cacheKey) as any;
    const allItems = getWordIndex();
    const match = allItems.find(i => i.word.toLowerCase() === cacheKey);
    return json(res, { ...cached, inPipeline: !!match, file: match ? match.pos + "/" + match.word : null });
  }

  const wiktRaw = lookupWiktionary(word, { exact: true, limit: 5 });
  const wiktEntries = (wiktRaw as any[]).map((e: any) => ({
    pos: e.pos,
    tags: e.tags || [],
    glosses: (e.senses || []).flatMap((s: any) => s.glosses || []).slice(0, 3),
  }));

  const allItems = getWordIndex();
  const match = allItems.find(i => i.word.toLowerCase() === cacheKey);

  const result = {
    inPipeline: !!match,
    file: match ? match.pos + "/" + match.word : null,
    wiktEntries,
  };
  wiktCheckCache.set(cacheKey, { wiktEntries }); // cache only the static part
  json(res, result);
}

/** GET /api/db-search?q=... — search the compiled app SQLite DB (preview app search UX). */
function handleDbSearch(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const q = params.get("q") || "";
  if (!q) return json(res, { results: [] });

  const db = getAppDb();
  if (!db) return json(res, { error: "App DB not found at data/lexiklar.db" }, 404);

  const qFolded = foldUmlauts(q);

  const lemmaRows = db.prepare(`
    SELECT lemma, pos, gender, frequency, plural_form, file, gloss_en
    FROM words
    WHERE lemma LIKE ? COLLATE NOCASE OR lemma_folded LIKE ?
    ORDER BY
      CASE WHEN lower(lemma) = lower(?) OR lemma_folded = ? THEN 0 ELSE 1 END,
      LENGTH(lemma),
      CASE WHEN frequency IS NULL THEN 999999 ELSE frequency END
    LIMIT 50
  `).all(q + "%", qFolded + "%", q, qFolded) as Record<string, unknown>[];

  const formRows = db.prepare(`
    SELECT w.lemma, w.pos, w.gender, w.frequency, w.plural_form, w.file, w.gloss_en
    FROM word_forms wf JOIN words w ON w.id = wf.word_id
    WHERE wf.form = ? COLLATE NOCASE
    ORDER BY CASE WHEN w.frequency IS NULL THEN 999999 ELSE w.frequency END
    LIMIT 20
  `).all(q.toLowerCase()) as Record<string, unknown>[];

  const seen = new Set<string>();
  const results: DbSearchResult[] = [];

  for (const row of lemmaRows) {
    const file = row.file as string;
    seen.add(file);
    results.push({
      lemma: row.lemma as string,
      pos: row.pos as string,
      gender: (row.gender as string) || null,
      frequency: (row.frequency as number) ?? null,
      pluralForm: (row.plural_form as string) || null,
      file,
      glossEn: row.gloss_en ? JSON.parse(row.gloss_en as string) : [],
    });
  }

  for (const row of formRows) {
    const file = row.file as string;
    if (seen.has(file)) continue;
    results.push({
      lemma: row.lemma as string,
      pos: row.pos as string,
      gender: (row.gender as string) || null,
      frequency: (row.frequency as number) ?? null,
      pluralForm: (row.plural_form as string) || null,
      file,
      glossEn: row.gloss_en ? JSON.parse(row.gloss_en as string) : [],
      formMatch: true,
    });
  }

  json(res, { results });
}

// ── Topic Explorer endpoints ────────────────────────────────────────────────

let corpusMaps: [FPMMap, FPMMap, FPMMap, FPMMap] | null = null;
let corpusLoading: Promise<void> | null = null;

async function ensureCorpusMaps() {
  if (corpusMaps) return;
  if (corpusLoading) { await corpusLoading; return; }
  corpusLoading = (async () => { corpusMaps = await loadAllCorpora(); })();
  await corpusLoading;
}

function computeWordZipf(word: string): number | null {
  if (!corpusMaps) return null;
  const [news, wiki, subtlex, osub] = corpusMaps;
  const scores = [
    toZipf(lookupFPM(news, word)),
    toZipf(lookupFPM(wiki, word)),
    toZipf(lookupFPM(subtlex, word)),
    toZipf(lookupFPM(osub, word)),
  ];
  return combineZipf(scores);
}

async function handleTopicWords(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return json(res, { error: "missing topic" }, 400);

  const count = body.count || 40;
  const provider = body.provider || "openai";
  const model = body.model || undefined;

  try {
    const result = await callLLM(TOPIC_WORDS_SYSTEM_PROMPT, `Topic: "${topic}". Generate approximately ${count} words.`, {
      provider,
      model,
      maxTokens: 2048,
      temperature: 0.4,
      jsonSchema: TOPIC_WORDS_SCHEMA as any,
    });
    const parsed = extractJSON(result.content);
    const words = parsed?.words ?? [];
    json(res, { words, cached: !!result._cached });
  } catch (err: any) {
    json(res, { error: err.message || "LLM call failed" }, 500);
  }
}

async function handleBatchWiktCheck(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const words: string[] = Array.isArray(body.words) ? body.words : [];
  if (!words.length) return json(res, { results: [] });

  await ensureCorpusMaps();
  const allItems = getWordIndex();
  const itemMap = new Map(allItems.map(i => [i.word.toLowerCase(), i]));

  const wordsToLookup = words.filter(w => !itemMap.has(w.toLowerCase()));
  const wiktBatch = lookupWiktionaryBatch(wordsToLookup, { lang: "de", limit: 5 });

  const results = words.map(word => {
    const item = itemMap.get(word.toLowerCase());
    if (item) {
      return { word, status: "in-app" as const, file: item.pos + "/" + item.word, zipf: item.zipf ?? null };
    }

    const wiktEntries = wiktBatch.get(word) ?? [];
    if (wiktEntries.length > 0) {
      const wiktPos = [...new Set(wiktEntries.map((e: any) => e.pos as string))];
      const zipf = computeWordZipf(word);
      return { word, status: "in-wiktionary" as const, zipf: zipf ? Math.round(zipf * 100) / 100 : null, wiktPos };
    }

    return { word, status: "not-found" as const, zipf: null as number | null };
  });

  json(res, { results });
}

async function handleWordTopics(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const word = typeof body.word === "string" ? body.word.trim() : "";
  if (!word) return json(res, { error: "missing word" }, 400);

  const provider = body.provider || "openai";
  const model = body.model || undefined;

  const parts = [word];
  if (body.pos) parts.push(`(${body.pos})`);
  if (body.gloss_en) parts.push(`— ${body.gloss_en}`);
  const userMsg = `Word: ${parts.join(" ")}`;

  try {
    const result = await callLLM(WORD_TOPICS_SYSTEM_PROMPT, userMsg, {
      provider,
      model,
      maxTokens: 256,
      temperature: 0.3,
      jsonSchema: WORD_TOPICS_SCHEMA as any,
    });
    const parsed = extractJSON(result.content);
    const topics = parsed?.topics ?? [];
    json(res, { topics, cached: !!result._cached });
  } catch (err: any) {
    json(res, { error: err.message || "LLM call failed" }, 500);
  }
}

let batchAddRunning = false;

function runScriptLong(script: string, args: string[], timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(TSX_BIN, [script, ...args], { cwd: ROOT, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`Timeout after ${timeoutMs / 1000}s`)); }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `exited with code ${code}`));
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function handleBatchAdd(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { res.writeHead(400); res.end("Invalid JSON body"); return; }

  const entries: { word: string; domain?: string; reason?: string }[] = Array.isArray(body.words) ? body.words : [];
  if (!entries.length) { res.writeHead(400); res.end("No words provided"); return; }
  if (batchAddRunning) { json(res, { error: "A batch add is already in progress" }, 409); return; }

  const provider = body.provider || "openai";

  batchAddRunning = true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  function sendEvent(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    // 1. Whitelist
    sendEvent("progress", { stage: "whitelist", status: "running" });
    const WHITELIST_PATH = join(ROOT, "config", "word-whitelist.json");
    const wl = JSON.parse(readFileSync(WHITELIST_PATH, "utf-8"));
    const existing = new Set(wl.words.map((e: any) => e.word));
    let added = 0;
    for (const entry of entries) {
      if (!existing.has(entry.word)) {
        wl.words.push({ word: entry.word, domain: entry.domain || "topic-explorer", reason: entry.reason || "added via topic explorer" });
        added++;
      }
    }
    if (added > 0) writeFileSync(WHITELIST_PATH, JSON.stringify(wl, null, 2) + "\n", "utf-8");
    sendEvent("progress", { stage: "whitelist", status: "done", added });

    // 2. Transform
    const wordList = entries.map(e => e.word).join(",");
    sendEvent("progress", { stage: "transform", status: "running" });
    await runScriptLong(resolve(ROOT, "scripts/transform.ts"), ["--words", wordList]);
    sendEvent("progress", { stage: "transform", status: "done" });

    // 3. Enrich
    sendEvent("progress", { stage: "enrich", status: "running" });
    await runScriptLong(resolve(ROOT, "scripts/enrich-frequency.ts"), ["--words", wordList]);
    sendEvent("progress", { stage: "enrich", status: "done" });

    // 4. Translate
    sendEvent("progress", { stage: "translate", status: "running" });
    wordIndexCache = null;
    const freshIndex = getWordIndex();
    const wordPaths = entries
      .map(e => {
        const match = freshIndex.find(i => i.word.toLowerCase() === e.word.toLowerCase());
        return match ? `${match.pos}/${match.word}` : null;
      })
      .filter(Boolean);

    if (wordPaths.length > 0) {
      const tmpFile = join(tmpdir(), `lexiklar-batch-${Date.now()}.txt`);
      writeFileSync(tmpFile, wordPaths.join("\n") + "\n", "utf-8");
      try {
        await runScriptLong(resolve(ROOT, "scripts/translate-glosses.ts"), ["--word-list", tmpFile, "--provider", provider]);
      } finally {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }
    sendEvent("progress", { stage: "translate", status: "done" });

    // 5. Result
    wordIndexCache = null;
    const finalIndex = getWordIndex();
    const results = entries.map(e => {
      const match = finalIndex.find(i => i.word.toLowerCase() === e.word.toLowerCase());
      return { word: e.word, file: match ? match.pos + "/" + match.word : null };
    });
    const addedWords = results.filter(r => r.file);
    const failedWords = results.filter(r => !r.file);

    sendEvent("done", { added: addedWords, failed: failedWords });
  } catch (err: any) {
    sendEvent("error", { message: err.message || "Batch add failed" });
  } finally {
    batchAddRunning = false;
    res.end();
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
        if (path === "/api/db-search") return handleDbSearch(req, res);
        if (path === "/api/wikt-check") return handleWiktCheck(req, res);
        if (path === "/api/add-word" && req.method === "POST") { handleAddWord(req, res); return; }
        if (path === "/api/topic-words" && req.method === "POST") { handleTopicWords(req, res); return; }
        if (path === "/api/batch-wikt-check" && req.method === "POST") { handleBatchWiktCheck(req, res); return; }
        if (path === "/api/word-topics" && req.method === "POST") { handleWordTopics(req, res); return; }
        if (path === "/api/batch-add-words" && req.method === "POST") { handleBatchAdd(req, res); return; }

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
