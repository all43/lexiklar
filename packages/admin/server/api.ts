/**
 * Vite dev server middleware — serves word data, examples, and Wiktionary
 * raw lookup as JSON API endpoints under /api/*.
 */
import type { Plugin } from "vite";
import { existsSync } from "fs";
import { join, resolve } from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { lookupWiktionary, lookupWiktionaryBatch } from "../../../scripts/lib/wiktionary-lookup.js";
import { computeConjugation } from "../../../src/utils/verb-forms.js";
import { callLLM, extractJSON, PROVIDER_DEFAULTS, getApiKey } from "../../../scripts/lib/llm.js";
import { createHumanProofreadFlag, createAgentProofreadFlag } from "../../../scripts/lib/proofread.js";
import { WORD_SYSTEM_PROMPT, SYSTEM_PROMPT_FULL, PHRASE_SYSTEM_PROMPT, TOPIC_WORDS_SYSTEM_PROMPT, TOPIC_WORDS_SCHEMA, WORD_TOPICS_SYSTEM_PROMPT, WORD_TOPICS_SCHEMA } from "../../../scripts/lib/prompts.js";
import { loadAllCorpora, lookupFPM, toZipf, combineZipf, type FPMMap } from "../../../scripts/lib/corpus.js";
import type { VerbEndingsFile } from "../../../types/word.js";
import Database from "better-sqlite3";
import type { DataStore } from "./data-store.js";
import { LocalDataStore } from "./local-data-store.js";

const ROOT = resolve(__dirname, "../../..");
const PROOFREAD_RESULTS_DIR = join(ROOT, "data", "proofread-results");

const store: DataStore = new LocalDataStore();

let verbEndings: VerbEndingsFile | null = null;
async function getVerbEndings(): Promise<VerbEndingsFile | null> {
  if (verbEndings) return verbEndings;
  if (!(await store.fileExists("data/rules/verb-endings.json"))) return null;
  verbEndings = JSON.parse(await store.readFile("data/rules/verb-endings.json"));
  return verbEndings;
}

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

async function getWordIndex(): Promise<WordListItem[]> {
  if (wordIndexCache && Date.now() - wordIndexCache.ts < 60_000) {
    return wordIndexCache.items;
  }
  const items: WordListItem[] = [];
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    for (const file of files) {
      const word = file.replace(/\.json$/, "");
      const item: WordListItem = { pos: dir, file, word };
      try {
        const data = await store.readWord(dir, word);
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
async function handleWordList(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const pos = params.get("pos");
  const q = params.get("q")?.toLowerCase() || "";
  const limit = Math.min(parseInt(params.get("limit") || "100"), 500);
  const offset = parseInt(params.get("offset") || "0");
  const filter = params.get("filter");
  const sort = params.get("sort") || "alpha";

  const allItems = await getWordIndex();
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
async function handleStats(res: ServerResponse) {
  if (statsCache && Date.now() - statsCache.ts < 30_000) {
    return json(res, statsCache.data);
  }

  const stats = {
    total: 0, proofread_gloss: 0, proofread_full: 0, proofread_syn: 0,
    has_overrides: 0, missing_gloss_en: 0, total_examples: 0,
    by_pos: {} as Record<string, number>,
  };

  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    let posCount = 0;

    for (const file of files) {
      posCount++;
      stats.total++;
      try {
        const data = await store.readWord(dir, file.replace(/\.json$/, ""));
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
async function handleWordDetail(res: ServerResponse, pos: string, file: string) {
  const lemma = file.endsWith(".json") ? file.replace(/\.json$/, "") : file;
  if (!(await store.wordExists(pos, lemma))) return json(res, { error: "not found" }, 404);

  const word = await store.readWord(pos, lemma);

  if (word.pos === "verb" && !word.conjugation && word.stems && word.conjugation_class !== "irregular") {
    const endings = await getVerbEndings();
    if (endings) {
      word.conjugation = computeConjugation(word, endings);
    }
  }

  const exampleIds: string[] = [];
  for (const sense of word.senses || []) {
    for (const id of sense.example_ids || []) exampleIds.push(id);
  }

  const examples: Record<string, unknown> = {};
  const prefixes = new Set(exampleIds.map((id: string) => id.slice(0, 2)));
  for (const prefix of prefixes) {
    const shard = await store.readExampleShard(prefix);
    for (const id of exampleIds) {
      if (shard[id]) examples[id] = shard[id];
    }
  }

  let exProofread = 0;
  let exTotal = 0;
  for (const ex of Object.values(examples) as any[]) {
    if (ex.translation) {
      exTotal++;
      if (ex._proofread?.translation) exProofread++;
    }
  }

  json(res, { word, examples, exampleStats: { total: exTotal, proofread: exProofread, unproofread: exTotal - exProofread } });
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
async function handlePosSummary(res: ServerResponse) {
  const counts: { pos: string; count: number }[] = [];
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    counts.push({ pos: dir, count: files.length });
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
  const lemma = file.endsWith(".json") ? file.replace(/\.json$/, "") : file;
  if (!(await store.wordExists(pos, lemma))) return json(res, { error: "not found" }, 404);

  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const word = await store.readWord(pos, lemma);

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
    const proofreadUpdates = body._proofread;
    const merged = { ...(word._proofread || {}) };

    // Handle human verification via source + login
    if (body._proofreadSource && body._proofreadField) {
      const field = body._proofreadField;
      const flag = body._proofreadSource === "human"
        ? createHumanProofreadFlag(body._proofreadLogin || "unknown")
        : createAgentProofreadFlag("manual", undefined);
      merged[field] = flag;
    } else {
      // Merge proofread updates directly (backward compat)
      for (const [k, v] of Object.entries(proofreadUpdates)) {
        if (v === null || v === undefined) delete merged[k];
        else merged[k] = v;
      }
    }

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

  await store.writeWord(pos, lemma, word);
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

/** GET /api/search-words?q=...&exact=1 — quick word search for linking. */
async function handleSearchWords(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const q = params.get("q")?.toLowerCase() || "";
  const exact = params.get("exact") === "1";
  const limit = Math.min(parseInt(params.get("limit") || "20"), 50);
  if (!q || q.length < 2) return json(res, []);

  const allItems = await getWordIndex();
  const results: { pos: string; word: string; gloss_en?: string }[] = [];
  for (const item of allItems) {
    const match = exact ? item.word.toLowerCase() === q : item.word.toLowerCase().includes(q);
    if (match) {
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

/** POST /api/add-word — run transform + enrich for a single word from Wiktionary. */
async function handleAddWord(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const word = typeof body.word === "string" ? body.word.trim() : "";
  if (!word) return json(res, { error: "missing word" }, 400);

  if (!(await store.fileExists("data/raw/de-extract.jsonl"))) {
    return json(res, { error: "Wiktionary dump not found at data/raw/de-extract.jsonl" }, 500);
  }

  let whitelisted = false;
  try {
    const wl = await store.readWhitelist();
    const alreadyListed = wl.words.some((e: any) => e.word === word);
    if (!alreadyListed) {
      wl.words.push({ word, domain: "user-reported", reason: "added via admin" });
      await store.writeWhitelist(wl);
      whitelisted = true;
    }
  } catch (err: any) {
    return json(res, { error: `Failed to update whitelist: ${err.message}` }, 500);
  }

  try {
    await store.runPipeline([
      { script: "transform", args: ["--words", word] },
      { script: "enrich-frequency", args: ["--words", word] },
    ]);
  } catch (err: any) {
    return json(res, { error: err.message || "Script failed" }, 500);
  }

  wordIndexCache = null;
  const items = await getWordIndex();
  const match = items.find(i => i.word.toLowerCase() === word.toLowerCase());
  json(res, { ok: true, file: match ? match.pos + "/" + match.word : null, whitelisted });
}

const wiktCheckCache = new Map<string, unknown>();

/** GET /api/wikt-check?word=... — check pipeline presence + Wiktionary entries for a word. */
async function handleWiktCheck(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const word = params.get("word");
  if (!word) return json(res, { error: "missing ?word=" }, 400);

  const cacheKey = word.toLowerCase();
  if (wiktCheckCache.has(cacheKey)) {
    const cached = wiktCheckCache.get(cacheKey) as any;
    const allItems = await getWordIndex();
    const match = allItems.find(i => i.word.toLowerCase() === cacheKey);
    return json(res, { ...cached, inPipeline: !!match, file: match ? match.pos + "/" + match.word : null });
  }

  const wiktRaw = lookupWiktionary(word, { exact: true, limit: 5 });
  const wiktEntries = (wiktRaw as any[]).map((e: any) => ({
    pos: e.pos,
    tags: e.tags || [],
    glosses: (e.senses || []).flatMap((s: any) => s.glosses || []).slice(0, 3),
  }));

  const allItems = await getWordIndex();
  const match = allItems.find(i => i.word.toLowerCase() === cacheKey);

  const result = {
    inPipeline: !!match,
    file: match ? match.pos + "/" + match.word : null,
    wiktEntries,
  };
  wiktCheckCache.set(cacheKey, { wiktEntries });
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
    const parsed = extractJSON(result.content) as any;
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
  const allItems = await getWordIndex();
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
    const parsed = extractJSON(result.content) as any;
    const topics = parsed?.topics ?? [];
    json(res, { topics, cached: !!result._cached });
  } catch (err: any) {
    json(res, { error: err.message || "LLM call failed" }, 500);
  }
}

let batchAddRunning = false;

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
    const wl = await store.readWhitelist();
    const existing = new Set(wl.words.map((e: any) => e.word));
    let added = 0;
    for (const entry of entries) {
      if (!existing.has(entry.word)) {
        wl.words.push({ word: entry.word, domain: entry.domain || "topic-explorer", reason: entry.reason || "added via topic explorer" });
        added++;
      }
    }
    if (added > 0) await store.writeWhitelist(wl);
    sendEvent("progress", { stage: "whitelist", status: "done", added });

    // 2. Transform + Enrich
    const wordList = entries.map(e => e.word).join(",");
    await store.runPipeline(
      [
        { script: "transform", args: ["--words", wordList], timeoutMs: 180_000 },
        { script: "enrich-frequency", args: ["--words", wordList], timeoutMs: 180_000 },
      ],
      (p) => sendEvent("progress", p),
    );

    // 3. Translate
    sendEvent("progress", { stage: "translate-glosses", status: "running" });
    wordIndexCache = null;
    const freshIndex = await getWordIndex();
    const wordPaths = entries
      .map(e => {
        const match = freshIndex.find(i => i.word.toLowerCase() === e.word.toLowerCase());
        return match ? `${match.pos}/${match.word}` : null;
      })
      .filter(Boolean);

    if (wordPaths.length > 0) {
      const tmpFile = await store.writeTempFile("batch", wordPaths.join("\n") + "\n");
      try {
        await store.runPipeline([
          { script: "translate-glosses", args: ["--word-list", tmpFile, "--provider", provider], timeoutMs: 180_000 },
        ]);
      } finally {
        await store.deleteTempFile(tmpFile);
      }
    }
    sendEvent("progress", { stage: "translate-glosses", status: "done" });

    // 4. Result
    wordIndexCache = null;
    const finalIndex = await getWordIndex();
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

async function handleUncommittedWords(res: ServerResponse) {
  try {
    const status = await store.getStatus(["data/words/", "config/word-whitelist.json"]);
    const words: { word: string; file: string }[] = [];
    for (const line of status.split("\n")) {
      const match = line.match(/^\s*[AM?]+\s+data\/words\/([^/]+\/(.+))\.json$/);
      if (match) words.push({ word: match[2], file: match[1] });
    }
    const whitelistDirty = status.includes("word-whitelist.json");
    json(res, { words, whitelistDirty });
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
}

async function handleCommitWords(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  let words: string[] = Array.isArray(body.words) ? body.words : [];
  const topic: string = body.topic || "topic explorer";

  try {
    if (!words.length) {
      const status = await store.getStatus(["data/words/"]);
      for (const line of status.split("\n")) {
        const match = line.match(/^\s*[AM?]+\s+data\/words\/[^/]+\/(.+)\.json$/);
        if (match) words.push(match[1]);
      }
    }
    if (!words.length) return json(res, { error: "no changes to commit" }, 400);

    const filesToAdd = ["config/word-whitelist.json"];
    for (const word of words) {
      filesToAdd.push(`data/words/*/${word}.json`);
    }
    filesToAdd.push("data/examples/*.json");

    const msg = `feat(data): add ${words.length} words from topic "${topic}"`;
    const { hash } = await store.addAndCommit(filesToAdd, msg);

    json(res, { ok: true, commit: hash, message: msg });
  } catch (err: any) {
    json(res, { error: err.message || "git commit failed" }, 500);
  }
}

// ── Proofread endpoints ─────────────────────────────────────────────────────

interface SenseInfo { gloss_en: string; gloss: string }
interface ExOwner { word: string; pos: string; senseIdx: number; zipf: number }

interface ExampleQueueItem {
  id: string;
  text: string;
  translation: string;
  annotations: any[];
  owner: ExOwner;
  senseContext: { form: string; lemma: string; gloss_hint: string | null; senses: string }[];
  _flagged?: { date: string; reason?: string | null };
}

let sensesIndexCache: { map: Map<string, SenseInfo[]>; ts: number } | null = null;

async function getSensesIndex(): Promise<Map<string, SenseInfo[]>> {
  if (sensesIndexCache && Date.now() - sensesIndexCache.ts < 120_000) return sensesIndexCache.map;
  const map = new Map<string, SenseInfo[]>();
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    for (const file of files) {
      try {
        const data = await store.readWord(dir, file.replace(/\.json$/, ""));
        const key = (data.word as string).toLowerCase();
        const senses: SenseInfo[] = (data.senses || []).map((s: any) => ({
          gloss_en: s.gloss_en || "",
          gloss: s.gloss || "",
        }));
        if (map.has(key)) map.get(key)!.push(...senses);
        else map.set(key, senses);
      } catch { /* skip */ }
    }
  }
  sensesIndexCache = { map, ts: Date.now() };
  return map;
}

interface ExampleQueueCache {
  items: ExampleQueueItem[];
  ts: number;
  totalExamples: number;
  totalProofread: number;
}

let exampleQueueCache: ExampleQueueCache | null = null;

async function getExampleQueue(): Promise<ExampleQueueCache> {
  if (exampleQueueCache && Date.now() - exampleQueueCache.ts < 120_000) return exampleQueueCache;

  const ownerMap = new Map<string, ExOwner>();
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    for (const file of files) {
      try {
        const data = await store.readWord(dir, file.replace(/\.json$/, ""));
        const word = data.word as string;
        const zipf = (data.zipf as number) ?? 0;
        for (let si = 0; si < (data.senses || []).length; si++) {
          for (const id of data.senses[si].example_ids || []) {
            if (!ownerMap.has(id)) ownerMap.set(id, { word, pos: dir, senseIdx: si, zipf });
          }
        }
      } catch { /* skip */ }
    }
  }

  const sensesIndex = await getSensesIndex();

  const items: ExampleQueueItem[] = [];
  let totalExamples = 0;
  let totalProofread = 0;

  const shardFiles = await store.listExampleShards();
  for (const shardFile of shardFiles) {
    const prefix = shardFile.replace(/\.json$/, "");
    let shard: Record<string, any>;
    try { shard = await store.readExampleShard(prefix); }
    catch { continue; }

    for (const [id, ex] of Object.entries(shard)) {
      if (!ex.translation) continue;
      if (ex.type === "expression" || ex.type === "proverb") continue;
      totalExamples++;
      if (ex._proofread?.translation) { totalProofread++; continue; }

      const owner = ownerMap.get(id);
      if (!owner) continue;

      const annotations: any[] = ex.annotations || [];
      const senseContext: ExampleQueueItem["senseContext"] = [];
      for (const ann of annotations) {
        if (!ann.lemma) continue;
        const senses = sensesIndex.get((ann.lemma as string).toLowerCase());
        if (!senses || senses.length < 2) continue;
        const senseList = senses.map((s, i) => `${i + 1}: ${s.gloss_en || s.gloss}`).join(" | ");
        senseContext.push({
          form: ann.form,
          lemma: ann.lemma,
          gloss_hint: ann.gloss_hint || null,
          senses: senseList,
        });
      }

      items.push({
        id,
        text: ex.text,
        translation: ex.translation,
        annotations,
        owner,
        senseContext,
      });
    }
  }

  items.sort((a, b) => b.owner.zipf - a.owner.zipf);

  exampleQueueCache = { items, ts: Date.now(), totalExamples, totalProofread };
  return exampleQueueCache;
}

interface WordQueueItem {
  word: string;
  pos: string;
  zipf: number;
  gloss_en: string | null;
  gloss_en_full: string | null;
  senseCount: number;
  proofreadGloss: boolean;
  exampleStats: { total: number; proofread: number; unproofread: number };
}

let wordQueueCache: { items: WordQueueItem[]; ts: number } | null = null;

async function getWordQueue(): Promise<WordQueueItem[]> {
  if (wordQueueCache && Date.now() - wordQueueCache.ts < 120_000) return wordQueueCache.items;

  const items: WordQueueItem[] = [];

  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    for (const file of files) {
      try {
        const data = await store.readWord(dir, file.replace(/\.json$/, ""));
        const exIds: string[] = [];
        for (const s of data.senses || []) {
          for (const id of s.example_ids || []) exIds.push(id);
        }
        items.push({
          word: data.word || file.replace(/\.json$/, ""),
          pos: dir,
          zipf: data.zipf ?? 0,
          gloss_en: data.senses?.[0]?.gloss_en || null,
          gloss_en_full: data.senses?.[0]?.gloss_en_full || null,
          senseCount: (data.senses || []).length,
          proofreadGloss: !!data._proofread?.gloss_en,
          exampleStats: { total: 0, proofread: 0, unproofread: 0 },
          _exIds: exIds,
        } as any);
      } catch { /* skip */ }
    }
  }

  const idToItem = new Map<string, WordQueueItem>();
  for (const item of items) {
    for (const id of (item as any)._exIds) idToItem.set(id, item);
  }
  const shardFiles = await store.listExampleShards();
  for (const shardFile of shardFiles) {
    const prefix = shardFile.replace(/\.json$/, "");
    let shard: Record<string, any>;
    try { shard = await store.readExampleShard(prefix); }
    catch { continue; }
    for (const [id, ex] of Object.entries(shard)) {
      if (!ex.translation) continue;
      const item = idToItem.get(id);
      if (!item) continue;
      item.exampleStats.total++;
      if (ex._proofread?.translation) item.exampleStats.proofread++;
      else item.exampleStats.unproofread++;
    }
  }

  for (const item of items) delete (item as any)._exIds;

  items.sort((a, b) => b.zipf - a.zipf);
  wordQueueCache = { items, ts: Date.now() };
  return items;
}

async function handleWordQueue(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const limit = Math.min(parseInt(params.get("limit") || "50"), 200);
  const offset = parseInt(params.get("offset") || "0");
  const posParam = params.get("pos") || null;
  const posSet = posParam ? new Set(posParam.split(",").map(s => s.trim()).filter(Boolean)) : null;
  const wordFilter = params.get("word")?.toLowerCase() || null;
  const filter = params.get("filter") || null;

  let items = await getWordQueue();
  if (posSet) items = items.filter(i => posSet.has(i.pos));
  if (wordFilter) items = items.filter(i => i.word.toLowerCase().includes(wordFilter));
  if (filter === "unproofread_gloss") items = items.filter(i => !i.proofreadGloss);
  if (filter === "unproofread_examples") items = items.filter(i => i.exampleStats.unproofread > 0);

  const page = items.slice(offset, offset + limit);
  json(res, { total: items.length, offset, items: page });
}

async function handleProofreadStats(res: ServerResponse) {
  const wordIdx = await getWordIndex();
  const proofreadGloss = wordIdx.filter(w => w.flags?.includes("proofread")).length;
  const unproofreadGloss = wordIdx.filter(w => w.flags?.includes("unproofread")).length;

  const eq = await getExampleQueue();

  const wq = await getWordQueue();
  const proofreadWithUnproofreadEx = wq.filter(w => w.proofreadGloss && w.exampleStats.unproofread > 0).length;

  let pendingResults = 0;
  if (existsSync(PROOFREAD_RESULTS_DIR)) {
    const { readdirSync } = await import("fs");
    pendingResults = readdirSync(PROOFREAD_RESULTS_DIR).filter(f => f.endsWith(".json")).length;
  }

  json(res, {
    examples: { total: eq.totalExamples, proofread: eq.totalProofread, unproofread: eq.items.length },
    words: { total: wordIdx.length, proofread_gloss: proofreadGloss, unproofread_gloss: unproofreadGloss, proofread_with_unproofread_ex: proofreadWithUnproofreadEx },
    pendingResults,
  });
}

let flaggedQueueCache: { items: ExampleQueueItem[]; ts: number } | null = null;

async function getFlaggedQueue(): Promise<ExampleQueueItem[]> {
  if (flaggedQueueCache && Date.now() - flaggedQueueCache.ts < 120_000) return flaggedQueueCache.items;

  const ownerMap = new Map<string, ExOwner>();
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    for (const file of files) {
      try {
        const data = await store.readWord(dir, file.replace(/\.json$/, ""));
        const word = data.word as string;
        const zipf = (data.zipf as number) ?? 0;
        for (let si = 0; si < (data.senses || []).length; si++) {
          for (const id of data.senses[si].example_ids || []) {
            if (!ownerMap.has(id)) ownerMap.set(id, { word, pos: dir, senseIdx: si, zipf });
          }
        }
      } catch { /* skip */ }
    }
  }

  const sensesIndex = await getSensesIndex();
  const items: ExampleQueueItem[] = [];

  const shardFiles = await store.listExampleShards();
  for (const shardFile of shardFiles) {
    const prefix = shardFile.replace(/\.json$/, "");
    let shard: Record<string, any>;
    try { shard = await store.readExampleShard(prefix); }
    catch { continue; }
    for (const [id, ex] of Object.entries(shard)) {
      if (!ex._flagged) continue;
      const owner = ownerMap.get(id);
      if (!owner) continue;
      const annotations: any[] = ex.annotations || [];
      const senseContext: ExampleQueueItem["senseContext"] = [];
      for (const ann of annotations) {
        if (!ann.lemma) continue;
        const senses = sensesIndex.get((ann.lemma as string).toLowerCase());
        if (!senses || senses.length < 2) continue;
        senseContext.push({ form: ann.form, lemma: ann.lemma, gloss_hint: ann.gloss_hint || null, senses: senses.map((s, i) => `${i + 1}: ${s.gloss_en || s.gloss}`).join(" | ") });
      }
      items.push({ id, text: ex.text, translation: ex.translation, annotations, owner, senseContext, _flagged: ex._flagged });
    }
  }

  items.sort((a, b) => b.owner.zipf - a.owner.zipf);
  flaggedQueueCache = { items, ts: Date.now() };
  return items;
}

async function handleExampleQueue(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const limit = Math.min(parseInt(params.get("limit") || "20"), 100);
  const offset = parseInt(params.get("offset") || "0");
  const posParam = params.get("pos") || null;
  const posSet = posParam ? new Set(posParam.split(",").map(s => s.trim()).filter(Boolean)) : null;
  const wordFilter = params.get("word")?.toLowerCase() || null;
  const filterParam = params.get("filter") || null;

  let filtered: ExampleQueueItem[];

  if (filterParam === "flagged") {
    filtered = await getFlaggedQueue();
  } else {
    const eq = await getExampleQueue();
    filtered = eq.items;
  }

  if (posSet) filtered = filtered.filter(i => posSet.has(i.owner.pos));
  if (wordFilter) filtered = filtered.filter(i => i.owner.word.toLowerCase().includes(wordFilter));

  const page = filtered.slice(offset, offset + limit);
  json(res, { total: filtered.length, offset, items: page });
}

async function handleExamplePatch(req: IncomingMessage, res: ServerResponse, exId: string) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const prefix = exId.slice(0, 2);
  const shard = await store.readExampleShard(prefix);
  if (!shard[exId]) return json(res, { error: "Example not found" }, 404);

  const ex = shard[exId];

  if (body.action === "verify") {
    const source = body.source || "agent";
    const flag = source === "human"
      ? createHumanProofreadFlag(body.login || "unknown")
      : createAgentProofreadFlag("manual", undefined);
    ex._proofread = { ...(ex._proofread || {}), translation: flag };
  } else if (body.action === "flag") {
    ex._flagged = { date: new Date().toISOString(), reason: body.reason || null };
  } else if (body.action === "unflag") {
    delete ex._flagged;
  } else if (body.action === "update") {
    if (typeof body.translation === "string") ex.translation = body.translation;
    if (Array.isArray(body.annotations)) ex.annotations = body.annotations;
    const source = body.source || "human";
    const flag = source === "human"
      ? createHumanProofreadFlag(body.login || "unknown")
      : createAgentProofreadFlag("manual", undefined);
    ex._proofread = { ...(ex._proofread || {}), translation: flag };
    delete ex._flagged;
  } else {
    return json(res, { error: "Unsupported action" }, 400);
  }

  await store.writeExampleShard(prefix, shard);

  if (body.action === "verify" || body.action === "update") {
    if (exampleQueueCache) {
      const idx = exampleQueueCache.items.findIndex(i => i.id === exId);
      if (idx !== -1) {
        exampleQueueCache.items.splice(idx, 1);
        exampleQueueCache.totalProofread++;
      }
    }
  }

  if (body.action === "flag" || body.action === "unflag" || body.action === "update") {
    flaggedQueueCache = null;
  }

  json(res, { ok: true });
}

const POS_SINGULAR_TO_DIR: Record<string, string> = {
  noun: "nouns", verb: "verbs", adjective: "adjectives", adverb: "adverbs",
  preposition: "prepositions", conjunction: "conjunctions", determiner: "determiners",
  pronoun: "pronouns", phrase: "phrases", abbreviation: "abbreviations",
  interjection: "interjections", particle: "particles", numeral: "numerals",
  name: "names", postposition: "postpositions",
};

async function handleAnnotationSenses(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readBody(req); }
  catch { return json(res, { error: "Invalid JSON body" }, 400); }

  const words: { lemma: string; pos: string }[] = body.words;
  if (!Array.isArray(words)) return json(res, { error: "words must be an array" }, 400);

  const results: Record<string, { files: { file: string; senses: { idx: number; gloss: string; gloss_en: string | null }[] }[] }> = {};

  for (const { lemma, pos } of words) {
    const dir = POS_SINGULAR_TO_DIR[pos] || pos;
    const key = `${pos}/${lemma}`;
    if (results[key]) continue;

    const dirFiles = await store.listWordFiles(dir);
    if (!dirFiles.length) { results[key] = { files: [] }; continue; }

    const matchingFiles: string[] = [];
    for (const f of dirFiles) {
      try {
        const data = await store.readWord(dir, f.replace(/\.json$/, ""));
        if (data.word === lemma) matchingFiles.push(f);
      } catch { /* skip */ }
    }

    const files: { file: string; senses: { idx: number; gloss: string; gloss_en: string | null }[] }[] = [];
    for (const f of matchingFiles) {
      try {
        const data = await store.readWord(dir, f.replace(/\.json$/, ""));
        const senses = (data.senses || []).map((s: any, i: number) => ({
          idx: i,
          gloss: s.gloss || "",
          gloss_en: s.gloss_en || null,
        }));
        files.push({ file: f, senses });
      } catch { /* skip */ }
    }

    results[key] = { files };
  }

  json(res, { results });
}

export function adminApiPlugin(): Plugin {
  return {
    name: "admin-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/")) return next();

        const path = url.split("?")[0];

        if (path === "/api/pos") { handlePosSummary(res); return; }
        if (path === "/api/stats") { handleStats(res); return; }
        if (path === "/api/words" && req.method === "GET") { handleWordList(req, res); return; }
        if (path === "/api/lookup") return handleLookup(req, res);
        if (path === "/api/reports") { handleReports(res); return; }
        if (path === "/api/translate" && req.method === "POST") { handleTranslate(req, res); return; }
        if (path === "/api/providers") return handleProviders(res);
        if (path === "/api/search-words") { handleSearchWords(req, res); return; }
        if (path === "/api/db-search") return handleDbSearch(req, res);
        if (path === "/api/wikt-check") { handleWiktCheck(req, res); return; }
        if (path === "/api/add-word" && req.method === "POST") { handleAddWord(req, res); return; }
        if (path === "/api/topic-words" && req.method === "POST") { handleTopicWords(req, res); return; }
        if (path === "/api/batch-wikt-check" && req.method === "POST") { handleBatchWiktCheck(req, res); return; }
        if (path === "/api/word-topics" && req.method === "POST") { handleWordTopics(req, res); return; }
        if (path === "/api/batch-add-words" && req.method === "POST") { handleBatchAdd(req, res); return; }
        if (path === "/api/uncommitted-words") { handleUncommittedWords(res); return; }
        if (path === "/api/commit-words" && req.method === "POST") { handleCommitWords(req, res); return; }

        // Proofread endpoints
        if (path === "/api/proofread/stats") { handleProofreadStats(res); return; }
        if (path === "/api/proofread/word-queue") { handleWordQueue(req, res); return; }
        if (path === "/api/proofread/example-queue") { handleExampleQueue(req, res); return; }
        const exPatchMatch = path.match(/^\/api\/proofread\/examples\/([a-f0-9]+)$/);
        if (exPatchMatch && req.method === "PATCH") { handleExamplePatch(req, res, exPatchMatch[1]); return; }
        if (path === "/api/annotation-senses" && req.method === "POST") { handleAnnotationSenses(req, res); return; }

        // /api/words/:pos/:file
        const wordMatch = path.match(/^\/api\/words\/([^/]+)\/(.+)$/);
        if (wordMatch) {
          if (req.method === "PATCH") { handleWordPatch(req, res, wordMatch[1], wordMatch[2]); return; }
          handleWordDetail(res, wordMatch[1], wordMatch[2]);
          return;
        }

        json(res, { error: "not found" }, 404);
      });
    },
  };
}
