/**
 * Shared corpus loading utilities for frequency scoring.
 * Used by enrich-frequency.ts and benchmark-frequency.ts.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const RAW_DIR = join(ROOT, "data", "raw");

// ── File paths ────────────────────────────────────────────────
export const LEIPZIG_NEWS_WORDS = join(RAW_DIR, "leipzig-words.txt");
export const LEIPZIG_WIKI_WORDS = join(RAW_DIR, "leipzig-wiki-words.txt");
export const SUBTLEX_FILE = join(RAW_DIR, "subtlex-de.xlsx");
export const OPENSUBTITLES_FILE = join(RAW_DIR, "opensubtitles-words.txt");

// ── Types ─────────────────────────────────────────────────────
export type FPMMap = Map<string, number>;

interface LeipzigEntry {
  word: string;
  count: number;
}

interface OpenSubEntry {
  word: string;
  count: number;
}

// ── Corpus weights ────────────────────────────────────────────
// Benchmarked against 448-word reference set (Spearman ρ grid search).
// Wiki consistently needs down-weighting (academic/technical bias).
// Equal weights baseline: ρ=0.8707, optimized: ρ=0.8766.
export const CORPUS_WEIGHTS = {
  news:    1.0,
  wiki:    0.5,
  subtlex: 0.8,
  osub:    0.8,
};

// ── Loaders ───────────────────────────────────────────────────

export function loadLeipzigFPM(filePath: string, label: string): FPMMap {
  if (!existsSync(filePath)) return new Map();
  const content = readFileSync(filePath, "utf-8");
  const entries: LeipzigEntry[] = content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      return { word: parts[1], count: parseInt(parts[2], 10) };
    })
    .filter((e): e is LeipzigEntry => e !== null);

  const total = entries.reduce((s, e) => s + e.count, 0);
  const map: FPMMap = new Map();
  for (const e of entries) {
    if (!map.has(e.word)) {
      map.set(e.word, (e.count / total) * 1_000_000);
    }
  }
  console.log(
    `Loaded ${map.size.toLocaleString()} words from ${label} (${(total / 1e6).toFixed(1)}M tokens).`,
  );
  return map;
}

export function loadOpensubtitlesFPM(): FPMMap {
  if (!existsSync(OPENSUBTITLES_FILE)) return new Map();
  const lines = readFileSync(OPENSUBTITLES_FILE, "utf-8")
    .split("\n")
    .filter(Boolean);
  let total = 0;
  const entries: OpenSubEntry[] = lines
    .map((line) => {
      const idx = line.lastIndexOf(" ");
      if (idx === -1) return null;
      const count = parseInt(line.slice(idx + 1), 10);
      total += count;
      return { word: line.slice(0, idx), count };
    })
    .filter((e): e is OpenSubEntry => e !== null);

  const map: FPMMap = new Map();
  for (const e of entries) {
    if (!map.has(e.word)) map.set(e.word, (e.count / total) * 1_000_000);
  }
  console.log(
    `Loaded ${map.size.toLocaleString()} words from OpenSubtitles (${(total / 1e6).toFixed(1)}M tokens).`,
  );
  return map;
}

export async function loadSubtlexFPM(): Promise<FPMMap> {
  if (!existsSync(SUBTLEX_FILE)) return new Map();

  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  let XLSX: {
    readFile: (path: string) => {
      Sheets: Record<string, unknown>;
      SheetNames: string[];
    };
    utils: {
      sheet_to_json: (ws: unknown, opts: { header: number }) => unknown[][];
    };
  };
  try {
    XLSX = require("xlsx") as typeof XLSX;
  } catch {
    console.warn("  xlsx package not found. Run: npm install xlsx --save-dev");
    return new Map();
  }

  const wb = XLSX.readFile(SUBTLEX_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

  const map: FPMMap = new Map();
  for (const row of rows.slice(1)) {
    const word = row[0];
    const fpm = row[4]; // SUBTLEX column = freq per million
    if (typeof word === "string" && typeof fpm === "number" && fpm > 0) {
      if (!map.has(word)) map.set(word, fpm);
    }
  }
  console.log(`Loaded ${map.size.toLocaleString()} words from SUBTLEX-DE.`);
  return map;
}

// ── Helpers ───────────────────────────────────────────────────

/** Zipf scale: log10(FPM) + 3. Ranges ~1 (very rare) to ~7 (very common). */
export function toZipf(fpm: number | null): number | null {
  return fpm !== null && fpm > 0 ? Math.log10(fpm) + 3 : null;
}

/** Look up a word in a corpus FPM map.
 *  Tries: original → lowercase → title-case → segment-aware title-case (for hyphenated compounds). */
export function lookupFPM(map: FPMMap, word: string): number | null {
  return (
    map.get(word) ??
    map.get(word.toLowerCase()) ??
    map.get(word[0].toUpperCase() + word.slice(1).toLowerCase()) ??
    (word.includes("-")
      ? map.get(
          word
            .split("-")
            .map((p, i) =>
              i === 0
                ? (p[0]?.toUpperCase() ?? "") + p.slice(1).toLowerCase()
                : (p[0]?.toUpperCase() ?? "") + p.slice(1)
            )
            .join("-")
        ) ?? null
      : null)
  );
}

/**
 * Compute combined Zipf as weighted mean of corpus values.
 * Values order: [news, wiki, subtlex, osub].
 *
 * Missing corpora are penalized: instead of skipping, they contribute
 * a floor value (MISSING_FLOOR) at half the corpus weight. This prevents
 * words that only appear in news/wiki from scoring higher than everyday
 * words that appear in all corpora (e.g. Weltcup vs Tasse).
 */
const MISSING_FLOOR = 1.0;
const MISSING_WEIGHT_RATIO = 0.5;

export function combineZipf(
  values: (number | null)[],
  weights = CORPUS_WEIGHTS,
): number | null {
  const w = [weights.news, weights.wiki, weights.subtlex, weights.osub];
  let weightedSum = 0;
  let totalWeight = 0;
  let anyPresent = false;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) {
      weightedSum += values[i]! * w[i];
      totalWeight += w[i];
      anyPresent = true;
    } else {
      // Penalize missing corpus: contribute floor at reduced weight
      const penaltyWeight = w[i] * MISSING_WEIGHT_RATIO;
      weightedSum += MISSING_FLOOR * penaltyWeight;
      totalWeight += penaltyWeight;
    }
  }
  if (!anyPresent) return null;
  return weightedSum / totalWeight;
}

/** Load all four corpora. Returns [news, wiki, subtlex, osub] FPM maps. */
export async function loadAllCorpora(): Promise<
  [FPMMap, FPMMap, FPMMap, FPMMap]
> {
  const newsMap = loadLeipzigFPM(LEIPZIG_NEWS_WORDS, "Leipzig news");
  const wikiMap = loadLeipzigFPM(LEIPZIG_WIKI_WORDS, "Leipzig Wikipedia");
  const subtlexMap = await loadSubtlexFPM();
  const osubMap = loadOpensubtitlesFPM();
  return [newsMap, wikiMap, subtlexMap, osubMap];
}
