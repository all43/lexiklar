/**
 * Vite dev server middleware — serves word data, examples, and Wiktionary
 * raw lookup as JSON API endpoints under /api/*.
 */
import type { Plugin } from "vite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { lookupWiktionary } from "../../../scripts/lib/wiktionary-lookup.js";
import { computeConjugation } from "../../../src/utils/verb-forms.js";
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
  return flags;
}

/** List word files, optionally filtered by POS and search query. */
function handleWordList(req: IncomingMessage, res: ServerResponse) {
  const params = parseQuery(req.url!);
  const pos = params.get("pos");
  const q = params.get("q")?.toLowerCase() || "";
  const limit = Math.min(parseInt(params.get("limit") || "100"), 500);
  const offset = parseInt(params.get("offset") || "0");
  const withFlags = params.get("flags") === "true";

  const dirs = pos ? [pos] : POS_DIRS;
  const results: WordListItem[] = [];

  for (const dir of dirs) {
    const dirPath = join(WORDS_DIR, dir);
    if (!existsSync(dirPath)) continue;

    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".json")) continue;
      const word = file.replace(/\.json$/, "");
      if (q && !word.toLowerCase().includes(q)) continue;
      results.push({ pos: dir, file, word });
    }
  }

  results.sort((a, b) => a.word.localeCompare(b.word, "de"));

  const page = results.slice(offset, offset + limit);

  // Enrich page items with flags + gloss preview (only for the visible page)
  if (withFlags) {
    for (const item of page) {
      try {
        const data = JSON.parse(readFileSync(join(WORDS_DIR, item.pos, item.file), "utf-8"));
        item.gloss_en = data.senses?.[0]?.gloss_en || undefined;
        item.zipf = data.zipf;
        item.flags = getWordFlags(data);
      } catch { /* skip unreadable */ }
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
        if (path === "/api/words") return handleWordList(req, res);
        if (path === "/api/lookup") return handleLookup(req, res);

        // /api/words/:pos/:file
        const wordMatch = path.match(/^\/api\/words\/([^/]+)\/(.+)$/);
        if (wordMatch) return handleWordDetail(res, wordMatch[1], wordMatch[2]);

        json(res, { error: "not found" }, 404);
      });
    },
  };
}
