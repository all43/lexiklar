/**
 * Generate English search synonyms (synonyms_en) for word senses.
 *
 * For each word, sends all senses with gloss_en + gloss_en_full to an LLM
 * and asks for additional English search terms a user might type.
 *
 * Multi-sense words get their own call (to avoid cross-sense overlap).
 * Single-sense words are batched for efficiency.
 *
 * Usage:
 *   npx tsx scripts/generate-synonyms-en.ts                          # default: OpenAI GPT-4.1-mini
 *   npx tsx scripts/generate-synonyms-en.ts --provider anthropic     # Claude Haiku 4.5
 *   npx tsx scripts/generate-synonyms-en.ts --top 3000               # only top N by frequency
 *   npx tsx scripts/generate-synonyms-en.ts --dry-run                # preview without API calls
 *   npx tsx scripts/generate-synonyms-en.ts --batch-size 15          # words per batch (single-sense)
 *   npx tsx scripts/generate-synonyms-en.ts --concurrency 3          # parallel API calls
 *   npx tsx scripts/generate-synonyms-en.ts --reset                  # clear existing synonyms_en, regenerate
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { POS_DIRS } from "./lib/pos.js";
import {
  callLLM,
  extractJSON,
  retryWithBackoff,
  parseProviderArgs,
  getApiKey,
  isLocalProvider,
  getDefaultModel,
} from "./lib/llm.js";
import type { Word, Sense } from "../types/index.js";
import type { LLMProvider } from "../types/llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESET = args.includes("--reset");
const { provider: PROVIDER, model: MODEL_OVERRIDE } = parseProviderArgs(args) as {
  provider: LLMProvider;
  model: string | null;
};
const MODEL_LABEL = `${PROVIDER}/${MODEL_OVERRIDE ?? getDefaultModel(PROVIDER)}`;

const topIdx = args.indexOf("--top");
const TOP_N = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : 0; // 0 = all

const batchIdx = args.indexOf("--batch-size");
const BATCH_SIZE = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : 15;

const concIdx = args.indexOf("--concurrency");
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 1;

const limitIdx = args.indexOf("--limit");
const JOB_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

// ============================================================
// Types
// ============================================================

interface WordJob {
  filePath: string;
  word: string;
  pos: string;
  senses: SenseInfo[];
}

interface SenseInfo {
  idx: number;
  gloss_en: string;
  gloss_en_full: string | null;
}

// ============================================================
// Collect words needing synonyms
// ============================================================

function collectJobs(): WordJob[] {
  const jobs: WordJob[] = [];

  for (const posDir of POS_DIRS) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(dir, file);
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as Word & Record<string, unknown>;

      // Only process words that have at least one sense with gloss_en
      const senses: SenseInfo[] = [];
      for (let i = 0; i < (data.senses || []).length; i++) {
        const s = data.senses[i];
        if (!s.gloss_en) continue;

        // Skip if already has synonyms_en (unless --reset)
        if (s.synonyms_en?.length && !RESET) continue;

        senses.push({
          idx: i,
          gloss_en: s.gloss_en,
          gloss_en_full: s.gloss_en_full ?? null,
        });
      }

      if (senses.length === 0) continue;

      // If --top, filter by zipf rank
      if (TOP_N > 0) {
        const zipf = data.zipf as number | undefined;
        if (!zipf) continue; // skip words without frequency data
      }

      jobs.push({ filePath, word: data.word, pos: data.pos, senses });
    }
  }

  // Sort by frequency (highest zipf first) for --top filtering
  if (TOP_N > 0) {
    jobs.sort((a, b) => {
      const za = JSON.parse(readFileSync(a.filePath, "utf-8")).zipf ?? 0;
      const zb = JSON.parse(readFileSync(b.filePath, "utf-8")).zipf ?? 0;
      return zb - za;
    });
    return jobs.slice(0, TOP_N);
  }

  return jobs;
}

// ============================================================
// LLM prompts
// ============================================================

const SYSTEM_PROMPT = `You generate English search synonyms for a German dictionary's reverse-lookup index.

For each word sense, suggest 1-5 additional English words or short phrases that a user might type to find this German word. These are search terms, not definitions.

Rules:
- Only common, natural English search terms
- Do NOT include the gloss_en value itself (already indexed)
- Do NOT include words from the full gloss description (already indexed)
- Do NOT repeat a term across different senses of the SAME word
- Prefer terms where this German word is the best or most natural translation
- Return empty array [] if the existing translations already cover the most natural search terms
- Return valid JSON`;

function buildMultiSensePrompt(job: WordJob): string {
  const senses = job.senses.map((s) => {
    let line = `  ${s.idx + 1}. "${s.gloss_en}"`;
    if (s.gloss_en_full) line += ` — ${s.gloss_en_full}`;
    return line;
  }).join("\n");
  return `${job.word} (${job.pos}):\n${senses}\n\nReturn: { "${job.word}": { "1": ["term1"], "2": [] } }`;
}

function buildBatchPrompt(jobs: WordJob[]): string {
  const lines = jobs.map((j) => {
    const s = j.senses[0];
    let line = `${j.word} (${j.pos}): "${s.gloss_en}"`;
    if (s.gloss_en_full) line += ` — ${s.gloss_en_full}`;
    return line;
  }).join("\n");
  return `${lines}\n\nReturn: { "word": ["term1", "term2"], ... }`;
}

// ============================================================
// LLM calling + response parsing
// ============================================================

async function callForSynonyms(prompt: string): Promise<Record<string, Record<string, string[]> | string[]>> {
  const result = await retryWithBackoff(() =>
    callLLM(SYSTEM_PROMPT, prompt, {
      provider: PROVIDER,
      model: MODEL_OVERRIDE ?? undefined,
      maxTokens: 2048,
      temperature: 0.2,
      jsonMode: true,
    }),
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    parsed = extractJSON(result.content);
  }

  if (!parsed || typeof parsed !== "object") return {};
  return parsed as Record<string, Record<string, string[]> | string[]>;
}

// ============================================================
// Write results back to word files
// ============================================================

function applyResults(job: WordJob, synonyms: string[][] | null): number {
  if (!synonyms) return 0;

  const data = JSON.parse(readFileSync(job.filePath, "utf-8")) as Word & Record<string, unknown>;
  let changed = 0;

  for (let i = 0; i < job.senses.length; i++) {
    const senseIdx = job.senses[i].idx;
    const terms = synonyms[i];
    if (!terms || terms.length === 0) {
      // Clear if resetting
      if (RESET && data.senses[senseIdx].synonyms_en?.length) {
        delete data.senses[senseIdx].synonyms_en;
        changed++;
      }
      continue;
    }

    // Filter: only lowercase English terms, max 60 chars
    const clean = terms
      .filter((t) => typeof t === "string" && t.length >= 2 && t.length <= 60)
      .map((t) => t.toLowerCase().trim());

    if (clean.length > 0) {
      data.senses[senseIdx].synonyms_en = clean;
      changed++;
    }
  }

  if (changed > 0) {
    writeFileSync(job.filePath, JSON.stringify(data, null, 2) + "\n");
  }
  return changed;
}

// ============================================================
// Process multi-sense words (one API call each)
// ============================================================

async function processMultiSense(job: WordJob): Promise<number> {
  const prompt = buildMultiSensePrompt(job);
  const result = await callForSynonyms(prompt);

  // Parse: { "word": { "1": [...], "2": [...] } }
  const wordResult = result[job.word];
  if (!wordResult || Array.isArray(wordResult)) return 0;

  const synonyms: string[][] = job.senses.map((s) => {
    const key = String(s.idx + 1);
    const terms = wordResult[key];
    return Array.isArray(terms) ? terms : [];
  });

  return applyResults(job, synonyms);
}

// ============================================================
// Process single-sense batch
// ============================================================

async function processBatch(jobs: WordJob[]): Promise<number> {
  const prompt = buildBatchPrompt(jobs);
  const result = await callForSynonyms(prompt);

  let changed = 0;
  for (const job of jobs) {
    const terms = result[job.word];
    if (Array.isArray(terms)) {
      changed += applyResults(job, [terms]);
    }
  }
  return changed;
}

// ============================================================
// Concurrency pool
// ============================================================

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log(`Collecting words needing synonyms_en...`);
  let jobs = collectJobs();

  if (JOB_LIMIT > 0) jobs = jobs.slice(0, JOB_LIMIT);

  const multiSense = jobs.filter((j) => j.senses.length > 1);
  const singleSense = jobs.filter((j) => j.senses.length === 1);

  console.log(`Found ${jobs.length} words (${multiSense.length} multi-sense, ${singleSense.length} single-sense)`);
  console.log(`Model: ${MODEL_LABEL}, batch size: ${BATCH_SIZE}, concurrency: ${CONCURRENCY}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: no API calls.");
    console.log("Sample multi-sense:");
    for (const j of multiSense.slice(0, 5)) {
      console.log(`  ${j.word} (${j.pos}): ${j.senses.map((s) => s.gloss_en).join(" / ")}`);
    }
    console.log("Sample single-sense:");
    for (const j of singleSense.slice(0, 10)) {
      console.log(`  ${j.word} (${j.pos}): ${j.senses[0].gloss_en}`);
    }
    return;
  }

  // Check API key
  if (!isLocalProvider(PROVIDER)) {
    const key = getApiKey(PROVIDER);
    if (!key) {
      console.log(`No API key for ${PROVIDER}. Exiting gracefully (pipeline-safe).`);
      process.exit(0);
    }
  }

  let totalChanged = 0;

  // Process multi-sense words individually
  if (multiSense.length > 0) {
    console.log(`\nProcessing ${multiSense.length} multi-sense words...`);
    let done = 0;
    await runPool(multiSense, CONCURRENCY, async (job) => {
      const changed = await processMultiSense(job);
      totalChanged += changed;
      done++;
      if (done % 50 === 0 || done === multiSense.length) {
        console.log(`  ${done}/${multiSense.length} done (${totalChanged} senses updated)`);
      }
    });
  }

  // Process single-sense words in batches
  if (singleSense.length > 0) {
    console.log(`\nProcessing ${singleSense.length} single-sense words in batches of ${BATCH_SIZE}...`);
    const batches: WordJob[][] = [];
    for (let i = 0; i < singleSense.length; i += BATCH_SIZE) {
      batches.push(singleSense.slice(i, i + BATCH_SIZE));
    }

    let done = 0;
    await runPool(batches, CONCURRENCY, async (batch) => {
      const changed = await processBatch(batch);
      totalChanged += changed;
      done++;
      if (done % 10 === 0 || done === batches.length) {
        console.log(`  Batch ${done}/${batches.length} (${totalChanged} senses updated)`);
      }
    });
  }

  console.log(`\nDone. Updated ${totalChanged} senses across ${jobs.length} words.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
