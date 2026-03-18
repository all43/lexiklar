/**
 * Benchmark corpus weights by comparing against LLM-generated reference scores.
 *
 * 1. Selects ~500 words stratified by POS and frequency band
 * 2. Asks a powerful LLM to score each word (1-7 Zipf-like scale) for learner frequency
 * 3. Computes Spearman correlation of each corpus and weight combo vs LLM reference
 * 4. Grid-searches optimal corpus weights
 *
 * Usage:
 *   npx tsx scripts/benchmark-frequency.ts                          # default
 *   npx tsx scripts/benchmark-frequency.ts --count 200              # fewer words
 *   npx tsx scripts/benchmark-frequency.ts --provider anthropic     # default
 *   npx tsx scripts/benchmark-frequency.ts --model claude-sonnet-4-5-20251001
 *   npx tsx scripts/benchmark-frequency.ts --dry-run                # show selection, skip LLM
 *   npx tsx scripts/benchmark-frequency.ts --seed 42                # reproducible
 *   npx tsx scripts/benchmark-frequency.ts --batch-size 50          # words per LLM call
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { POS_DIRS } from "./lib/pos.js";
import {
  loadAllCorpora,
  toZipf,
  lookupFPM,
  combineZipf,
  CORPUS_WEIGHTS,
  type FPMMap,
} from "./lib/corpus.js";
import {
  callLLM,
  extractJSON,
  retryWithBackoff,
  parseProviderArgs,
  getApiKey,
} from "./lib/llm.js";
import type { LLMProvider } from "../types/llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const REPORTS_DIR = join(ROOT, "reports");
const CACHE_DIR = join(DATA_DIR, "raw", "llm-cache");

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const { provider: PROVIDER, model: MODEL_OVERRIDE } = parseProviderArgs(args) as {
  provider: LLMProvider;
  model: string | null;
};
// Default to a strong model for reference scoring
const MODEL = MODEL_OVERRIDE ?? "claude-sonnet-4-5-20251001";

const countIdx = args.indexOf("--count");
const WORD_COUNT = countIdx >= 0 ? parseInt(args[countIdx + 1], 10) : 500;

const seedIdx = args.indexOf("--seed");
const SEED = seedIdx >= 0 ? parseInt(args[seedIdx + 1], 10) : 42;

const batchIdx = args.indexOf("--batch-size");
const BATCH_SIZE = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : 50;

// ============================================================
// Types
// ============================================================

interface BenchmarkWord {
  word: string;
  pos: string;
  gloss_en: string | null;
  zipf_news: number | null;
  zipf_wiki: number | null;
  zipf_subtlex: number | null;
  zipf_osub: number | null;
  zipf_combined: number | null;
  llm_score: number | null;
}

interface CorpusWeights {
  news: number;
  wiki: number;
  subtlex: number;
  osub: number;
}

// ============================================================
// Deterministic pseudo-random (mulberry32)
// ============================================================

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Word selection — stratified by POS and frequency band
// ============================================================

function selectWords(
  corpora: [FPMMap, FPMMap, FPMMap, FPMMap],
  count: number,
  seed: number,
): BenchmarkWord[] {
  const [newsMap, wikiMap, subtlexMap, osubMap] = corpora;
  const rand = mulberry32(seed);

  // Skip POS categories that don't make sense for frequency benchmarking
  const SKIP_POS = new Set(["phrases", "names", "abbreviations"]);

  // Load all words with their per-corpus Zipf values
  interface RawWord {
    word: string;
    pos: string;
    gloss_en: string | null;
    zipfNews: number | null;
    zipfWiki: number | null;
    zipfSubtlex: number | null;
    zipfOsub: number | null;
    zipfCombined: number | null;
  }

  const allWords: RawWord[] = [];
  const seen = new Set<string>(); // deduplicate by word string

  for (const dir of POS_DIRS) {
    if (SKIP_POS.has(dir)) continue;
    const fullDir = join(DATA_DIR, "words", dir);
    if (!existsSync(fullDir)) continue;

    for (const file of readdirSync(fullDir)) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(readFileSync(join(fullDir, file), "utf-8"));
      const word = data.word as string;

      // Deduplicate homonyms — keep first occurrence
      if (seen.has(word)) continue;
      seen.add(word);

      // Skip feminine -in suffix derivatives — they flood the rare band
      // and all corpora agree they're rare (no discriminative signal)
      if (word.endsWith("in") && dir === "nouns" && word.length > 5) {
        const base = word.slice(0, -2);
        if (seen.has(base) || /[A-ZÄÖÜ]/.test(word[0])) {
          // Check if it's likely a feminine derivative
          const glossLower = (data.senses?.[0]?.gloss_en as string ?? "").toLowerCase();
          if (glossLower.includes("female") || glossLower.includes("woman")) continue;
        }
      }

      const zN = toZipf(lookupFPM(newsMap, word));
      const zW = toZipf(lookupFPM(wikiMap, word));
      const zS = toZipf(lookupFPM(subtlexMap, word));
      const zO = toZipf(lookupFPM(osubMap, word));
      const combined = combineZipf([zN, zW, zS, zO]);

      // Skip words not in any corpus
      if (combined === null) continue;

      const firstGloss =
        (data.senses?.[0]?.gloss_en as string | null) ?? null;

      allWords.push({
        word,
        pos: dir,
        gloss_en: firstGloss,
        zipfNews: zN,
        zipfWiki: zW,
        zipfSubtlex: zS,
        zipfOsub: zO,
        zipfCombined: combined,
      });
    }
  }

  // Stratified sampling: by POS, then by Zipf band within each POS
  // Oversample 3-5 range where corpus disagreements are most impactful
  const ZIPF_BANDS: [number, number, number][] = [
    [0, 2, 1],    // rare — low weight, corpora mostly agree
    [2, 3, 1],    // uncommon
    [3, 4, 2],    // moderate — 2x weight, where everyday vs news diverges
    [4, 5, 2],    // common — 2x weight, key learner vocabulary
    [5, 8, 1],    // very common — corpora mostly agree
  ];

  // Group by POS
  const byPos = new Map<string, RawWord[]>();
  for (const w of allWords) {
    if (!byPos.has(w.pos)) byPos.set(w.pos, []);
    byPos.get(w.pos)!.push(w);
  }

  // Allocate proportionally to POS size, min 5 per POS
  const totalAvail = allWords.length;
  const allocations = new Map<string, number>();
  let allocated = 0;
  for (const [pos, words] of byPos) {
    const share = Math.max(5, Math.round((words.length / totalAvail) * count));
    allocations.set(pos, share);
    allocated += share;
  }
  // Scale back if over-allocated
  if (allocated > count) {
    const scale = count / allocated;
    for (const [pos, share] of allocations) {
      allocations.set(pos, Math.max(3, Math.round(share * scale)));
    }
  }

  const selected: BenchmarkWord[] = [];

  for (const [pos, words] of byPos) {
    const posAlloc = allocations.get(pos)!;
    const totalBandWeight = ZIPF_BANDS.reduce((s, b) => s + b[2], 0);
    const basePerBand = Math.max(1, Math.floor(posAlloc / totalBandWeight));

    for (const [lo, hi, bandWeight] of ZIPF_BANDS) {
      const perBand = basePerBand * bandWeight;
      const band = words.filter(
        (w) => w.zipfCombined! >= lo && w.zipfCombined! < hi,
      );
      // Shuffle deterministically
      band.sort((a, b) => {
        const ha = hashStr(a.word + SEED);
        const hb = hashStr(b.word + SEED);
        return ha - hb;
      });
      const pick = band.slice(0, perBand);
      for (const w of pick) {
        selected.push({
          word: w.word,
          pos: w.pos,
          gloss_en: w.gloss_en,
          zipf_news: w.zipfNews,
          zipf_wiki: w.zipfWiki,
          zipf_subtlex: w.zipfSubtlex,
          zipf_osub: w.zipfOsub,
          zipf_combined: w.zipfCombined,
          llm_score: null,
        });
      }
    }
  }

  // Trim to exact count
  return selected.slice(0, count);
}

function hashStr(s: string): number {
  return parseInt(createHash("md5").update(s).digest("hex").slice(0, 8), 16);
}

// ============================================================
// LLM scoring
// ============================================================

const SYSTEM_PROMPT = `You are a German language pedagogy expert. Rate each word on a 1.0–7.0 scale for how frequently a B2-level learner of German would encounter it across ALL contexts: textbooks, news, conversations, media, daily life, signs, forms.

Scale anchors:
  7.0 = grammatical essentials (der, und, sein, ich, nicht)
  6.0 = very common content words (Haus, gehen, gut, Mann, Zeit)
  5.0 = common B1-B2 words (Hoffnung, erinnern, Zeitung, Angst)
  4.0 = B2-level vocabulary (Abschnitt, behaupten, Genehmigung)
  3.0 = uncommon but known (Abstellgleis, Eisbär)
  2.0 = rare or specialized
  1.0 = extremely rare

For homonyms (e.g. "Bank" = bench + bank), rate the combined frequency of all meanings.
Use one decimal place (e.g. 5.3, not 5 or 5.27).

Return a JSON array: [{"word": "...", "score": 5.3}, ...]
Preserve input order. Include every word from the input.`;

async function scoreBatch(
  words: BenchmarkWord[],
): Promise<Map<string, number>> {
  const input = words.map((w) => ({
    word: w.word,
    pos: w.pos,
    gloss_en: w.gloss_en,
  }));

  const result = await retryWithBackoff(() =>
    callLLM(SYSTEM_PROMPT, JSON.stringify(input), {
      provider: PROVIDER,
      model: MODEL,
      maxTokens: 4000,
      temperature: 0.1,
      jsonMode: true,
    }),
  );

  const raw = result.content;

  // Try multiple parsing strategies
  let items: Array<{ word: string; score: number }> = [];

  function extractArray(obj: unknown): Array<{ word: string; score: number }> | null {
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === "object") {
      // Check any key that holds an array (handles "result", "words", "scores", etc.)
      for (const val of Object.values(obj as Record<string, unknown>)) {
        if (Array.isArray(val)) return val;
      }
      // Single item with word+score
      if ((obj as Record<string, unknown>).word) return [obj as { word: string; score: number }];
    }
    return null;
  }

  try {
    const obj = JSON.parse(raw);
    items = extractArray(obj) ?? [];
  } catch {
    const parsed = extractJSON(raw);
    items = extractArray(parsed) ?? [];
    if (items.length === 0) {
      console.error("\n  Parse failed. Raw:", raw.slice(0, 300));
    }
  }

  const scores = new Map<string, number>();
  for (const item of items) {
    if (item.word && typeof item.score === "number") {
      scores.set(item.word, Math.max(1, Math.min(7, item.score)));
    }
  }

  if (scores.size === 0 && items.length === 0) {
    console.error("\n  No items parsed. Raw response:", raw.slice(0, 300));
  }

  return scores;
}

// ============================================================
// Statistics
// ============================================================

function spearmanRho(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  const n = x.length;
  const rankX = computeRanks(x);
  const rankY = computeRanks(y);
  return pearsonR(rankX, rankY);
}

function computeRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2; // 1-based average rank for ties
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    dx2 = 0,
    dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// ============================================================
// Grid search
// ============================================================

interface GridResult {
  weights: CorpusWeights;
  rho: number;
}

function gridSearch(words: BenchmarkWord[]): GridResult[] {
  const steps = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0];
  const results: GridResult[] = [];

  // Pre-extract LLM scores and per-corpus Zipf arrays
  const withScores = words.filter((w) => w.llm_score !== null);
  const llmScores = withScores.map((w) => w.llm_score!);

  for (const news of steps) {
    for (const wiki of steps) {
      for (const subtlex of steps) {
        for (const osub of steps) {
          if (news === 0 && wiki === 0 && subtlex === 0 && osub === 0) continue;
          const weights = { news, wiki, subtlex, osub };

          const combined: number[] = [];
          const llmFiltered: number[] = [];

          for (let i = 0; i < withScores.length; i++) {
            const w = withScores[i];
            const c = combineZipf(
              [w.zipf_news, w.zipf_wiki, w.zipf_subtlex, w.zipf_osub],
              weights,
            );
            if (c !== null) {
              combined.push(c);
              llmFiltered.push(llmScores[i]);
            }
          }

          if (combined.length < 10) continue;
          const rho = spearmanRho(combined, llmFiltered);
          results.push({ weights, rho });
        }
      }
    }
  }

  results.sort((a, b) => b.rho - a.rho);
  return results;
}

// ============================================================
// Report
// ============================================================

function generateReport(
  words: BenchmarkWord[],
  gridResults: GridResult[],
): string {
  const lines: string[] = [];
  const withScores = words.filter((w) => w.llm_score !== null);

  lines.push("# Frequency Benchmark Report");
  lines.push("");
  lines.push(`- **Model**: ${PROVIDER}/${MODEL}`);
  lines.push(`- **Words**: ${words.length} selected, ${withScores.length} scored`);
  lines.push(`- **Seed**: ${SEED}`);
  lines.push(`- **Date**: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  // POS distribution
  const posCounts = new Map<string, number>();
  for (const w of words) posCounts.set(w.pos, (posCounts.get(w.pos) ?? 0) + 1);
  lines.push("## Word Selection by POS");
  lines.push("");
  lines.push("| POS | Count |");
  lines.push("|-----|-------|");
  for (const [pos, count] of [...posCounts].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${pos} | ${count} |`);
  }
  lines.push("");

  // Corpus coverage
  const corpusNames = ["News", "Wiki", "SUBTLEX", "OSub"];
  const getZipf = [
    (w: BenchmarkWord) => w.zipf_news,
    (w: BenchmarkWord) => w.zipf_wiki,
    (w: BenchmarkWord) => w.zipf_subtlex,
    (w: BenchmarkWord) => w.zipf_osub,
  ];
  lines.push("## Corpus Coverage");
  lines.push("");
  lines.push("| Corpus | Words Found | Coverage |");
  lines.push("|--------|-------------|----------|");
  for (let c = 0; c < 4; c++) {
    const found = withScores.filter((w) => getZipf[c](w) !== null).length;
    lines.push(
      `| ${corpusNames[c]} | ${found}/${withScores.length} | ${((found / withScores.length) * 100).toFixed(1)}% |`,
    );
  }
  lines.push("");

  // Per-corpus correlation
  lines.push("## Per-Corpus Correlation with LLM Reference");
  lines.push("");
  lines.push("| Corpus | Spearman ρ | Pearson r | N |");
  lines.push("|--------|-----------|-----------|---|");
  for (let c = 0; c < 4; c++) {
    const pairs = withScores
      .filter((w) => getZipf[c](w) !== null)
      .map((w) => ({ corpus: getZipf[c](w)!, llm: w.llm_score! }));
    if (pairs.length < 3) {
      lines.push(`| ${corpusNames[c]} | — | — | ${pairs.length} |`);
      continue;
    }
    const rho = spearmanRho(
      pairs.map((p) => p.corpus),
      pairs.map((p) => p.llm),
    );
    const r = pearsonR(
      pairs.map((p) => p.corpus),
      pairs.map((p) => p.llm),
    );
    lines.push(
      `| ${corpusNames[c]} | ${rho.toFixed(4)} | ${r.toFixed(4)} | ${pairs.length} |`,
    );
  }
  lines.push("");

  // Current weights
  const currentCombined: number[] = [];
  const currentLlm: number[] = [];
  for (const w of withScores) {
    const c = combineZipf(
      [w.zipf_news, w.zipf_wiki, w.zipf_subtlex, w.zipf_osub],
      CORPUS_WEIGHTS,
    );
    if (c !== null) {
      currentCombined.push(c);
      currentLlm.push(w.llm_score!);
    }
  }
  const currentRho = spearmanRho(currentCombined, currentLlm);
  lines.push("## Current Production Weights");
  lines.push("");
  lines.push(
    `| news=${CORPUS_WEIGHTS.news} | wiki=${CORPUS_WEIGHTS.wiki} | subtlex=${CORPUS_WEIGHTS.subtlex} | osub=${CORPUS_WEIGHTS.osub} | **ρ = ${currentRho.toFixed(4)}** |`,
  );
  lines.push("");

  // Grid search top 10
  lines.push("## Grid Search — Top 10 Weight Combinations");
  lines.push("");
  lines.push("| # | News | Wiki | SUBTLEX | OSub | Spearman ρ |");
  lines.push("|---|------|------|---------|------|-----------|");
  for (let i = 0; i < Math.min(10, gridResults.length); i++) {
    const r = gridResults[i];
    lines.push(
      `| ${i + 1} | ${r.weights.news} | ${r.weights.wiki} | ${r.weights.subtlex} | ${r.weights.osub} | ${r.rho.toFixed(4)} |`,
    );
  }
  lines.push("");

  // Biggest outliers
  lines.push("## Outliers (LLM score vs current combined Zipf, |Δ| > 1.5)");
  lines.push("");
  lines.push("| Word | POS | LLM | Combined | Δ | News | Wiki | SUBTLEX | OSub |");
  lines.push("|------|-----|-----|----------|---|------|------|---------|------|");
  const outliers = withScores
    .filter((w) => w.zipf_combined !== null)
    .map((w) => ({ ...w, delta: w.llm_score! - w.zipf_combined! }))
    .filter((w) => Math.abs(w.delta) > 1.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 30);
  for (const w of outliers) {
    lines.push(
      `| ${w.word} | ${w.pos} | ${w.llm_score!.toFixed(1)} | ${w.zipf_combined!.toFixed(2)} | ${w.delta > 0 ? "+" : ""}${w.delta.toFixed(1)} | ${w.zipf_news?.toFixed(2) ?? "—"} | ${w.zipf_wiki?.toFixed(2) ?? "—"} | ${w.zipf_subtlex?.toFixed(2) ?? "—"} | ${w.zipf_osub?.toFixed(2) ?? "—"} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log(`Loading corpora...`);
  const corpora = await loadAllCorpora();

  console.log(`\nSelecting ${WORD_COUNT} words (seed=${SEED})...`);
  const words = selectWords(corpora, WORD_COUNT, SEED);

  // Print POS distribution
  const posCounts = new Map<string, number>();
  for (const w of words) posCounts.set(w.pos, (posCounts.get(w.pos) ?? 0) + 1);
  console.log("POS distribution:");
  for (const [pos, count] of [...posCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pos}: ${count}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: skipping LLM scoring.");
    // Dump full word list as JSON for external scoring
    const dumpPath = join(DATA_DIR, "raw", "benchmark-words.json");
    const dump = words.map((w) => ({
      word: w.word,
      pos: w.pos,
      gloss_en: w.gloss_en,
      zipf_combined: w.zipf_combined ? +w.zipf_combined.toFixed(2) : null,
    }));
    writeFileSync(dumpPath, JSON.stringify(dump, null, 2) + "\n");
    console.log(`Wrote ${words.length} words to ${dumpPath}`);
    return;
  }

  // Try loading pre-generated reference scores first
  const refPath = join(DATA_DIR, "raw", "llm-reference-scores.json");
  let scored = 0;

  if (existsSync(refPath)) {
    console.log(`\nLoading reference scores from ${refPath}...`);
    const ref = JSON.parse(readFileSync(refPath, "utf-8")) as {
      model: string;
      scores: Array<{ word: string; score: number }>;
    };
    const scoreMap = new Map(ref.scores.map((s) => [s.word, s.score]));
    for (const w of words) {
      const score = scoreMap.get(w.word);
      if (score !== undefined) {
        w.llm_score = score;
        scored++;
      }
    }
    console.log(`Loaded ${scored}/${words.length} scores (model: ${ref.model})`);
  } else {
    // Fall back to LLM API scoring
    const apiKey = getApiKey(PROVIDER);
    if (!apiKey) {
      console.error(`No API key for ${PROVIDER} and no reference file at ${refPath}.`);
      process.exit(1);
    }

    console.log(
      `\nScoring ${words.length} words with ${PROVIDER}/${MODEL} (batch=${BATCH_SIZE})...`,
    );
    for (let i = 0; i < words.length; i += BATCH_SIZE) {
      const batch = words.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(words.length / BATCH_SIZE);
      process.stdout.write(`  Batch ${batchNum}/${totalBatches}...`);

      const scores = await scoreBatch(batch);
      for (const w of batch) {
        const score = scores.get(w.word);
        if (score !== undefined) {
          w.llm_score = score;
          scored++;
        }
      }
      console.log(` ${scores.size}/${batch.length} scored`);
    }
  }
  console.log(`\nTotal scored: ${scored}/${words.length}`);

  // Corpus coverage
  const withScores = words.filter((w) => w.llm_score !== null);
  console.log("\nCorpus coverage:");
  const checks = [
    ["News", (w: BenchmarkWord) => w.zipf_news],
    ["Wiki", (w: BenchmarkWord) => w.zipf_wiki],
    ["SUBTLEX", (w: BenchmarkWord) => w.zipf_subtlex],
    ["OSub", (w: BenchmarkWord) => w.zipf_osub],
  ] as const;
  for (const [name, fn] of checks) {
    const found = withScores.filter((w) => fn(w) !== null).length;
    console.log(
      `  ${name}: ${found}/${withScores.length} (${((found / withScores.length) * 100).toFixed(1)}%)`,
    );
  }

  // Per-corpus correlation
  console.log("\nPer-corpus Spearman ρ vs LLM reference:");
  for (const [name, fn] of checks) {
    const pairs = withScores.filter((w) => fn(w) !== null);
    if (pairs.length < 3) continue;
    const rho = spearmanRho(
      pairs.map((w) => fn(w)!),
      pairs.map((w) => w.llm_score!),
    );
    console.log(`  ${name}: ρ=${rho.toFixed(4)} (n=${pairs.length})`);
  }

  // Grid search
  console.log("\nGrid searching optimal weights (6,561 combinations)...");
  const gridResults = gridSearch(words);

  // Current weights performance
  const currentPairs = withScores.filter((w) => w.zipf_combined !== null);
  const currentRho = spearmanRho(
    currentPairs.map((w) => w.zipf_combined!),
    currentPairs.map((w) => w.llm_score!),
  );
  console.log(`\nCurrent weights: ρ=${currentRho.toFixed(4)}`);
  console.log(
    `  news=${CORPUS_WEIGHTS.news} wiki=${CORPUS_WEIGHTS.wiki} subtlex=${CORPUS_WEIGHTS.subtlex} osub=${CORPUS_WEIGHTS.osub}`,
  );

  console.log("\nTop 10 weight combinations:");
  for (let i = 0; i < Math.min(10, gridResults.length); i++) {
    const r = gridResults[i];
    console.log(
      `  ${i + 1}. ρ=${r.rho.toFixed(4)}  news=${r.weights.news} wiki=${r.weights.wiki} subtlex=${r.weights.subtlex} osub=${r.weights.osub}`,
    );
  }

  // Write report
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = join(REPORTS_DIR, `benchmark-frequency-${ts}.md`);
  const report = generateReport(words, gridResults);
  writeFileSync(reportPath, report);
  console.log(`\nReport written to ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
