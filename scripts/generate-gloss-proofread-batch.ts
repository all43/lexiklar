/**
 * Generate lean gloss_en proofreading batches.
 *
 * Two modes:
 *   --single   Single-sense words (compact format: one de/en/en_full per word)
 *   (default)  Multi-sense words (sense array with disambiguation)
 *
 * Only includes words where gloss_en is not yet proofread.
 * Output is minimal: word, POS, and glosses only.
 *
 * Usage:
 *   npx tsx scripts/generate-gloss-proofread-batch.ts [--batch-size N] [--batch N] [--single]
 *
 * --batch-size N: words per batch (default: 100 multi, 250 single)
 * --batch N: generate only batch N (1-based), default: all
 * --single: generate single-sense batches instead of multi-sense
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { findWordFilePaths } from "./lib/words.js";
import type { WordBase } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const singleMode = process.argv.includes("--single");
const defaultBatchSize = singleMode ? 250 : 100;
const batchSizeIdx = process.argv.indexOf("--batch-size");
const batchSize = batchSizeIdx !== -1 ? parseInt(process.argv[batchSizeIdx + 1], 10) : defaultBatchSize;
const batchIdx = process.argv.indexOf("--batch");
const onlyBatch = batchIdx !== -1 ? parseInt(process.argv[batchIdx + 1], 10) : null;

const OUT_DIR = join(ROOT, "data", singleMode ? "gloss-proofread-single" : "gloss-proofread-batches");

interface SenseEntry {
  n: number;
  de: string;
  en: string | null;
  en_full: string | null;
}

interface MultiEntry {
  file: string;
  word: string;
  pos: string;
  zipf: number;
  senses: SenseEntry[];
}

interface SingleEntry {
  file: string;
  word: string;
  pos: string;
  zipf: number;
  de: string;
  en: string | null;
  en_full: string | null;
}

// Collect eligible words
console.log(`Scanning word files (${singleMode ? "single" : "multi"}-sense mode)...`);
const files = findWordFilePaths();
const multiEntries: MultiEntry[] = [];
const singleEntries: SingleEntry[] = [];

for (const filePath of files) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase & { _proofread?: { gloss_en?: boolean } };

  // Skip already proofread
  if (data._proofread?.gloss_en) continue;

  // Skip if no gloss_en at all (needs translation first, not proofreading)
  if (!data.senses || !data.senses.some(s => s.gloss_en)) continue;

  const relPath = relative(join(DATA_DIR, "words"), filePath).replace(".json", "");
  const zipf = (data as any).zipf ?? 0;

  if (data.senses.length === 1 && singleMode) {
    const s = data.senses[0];
    singleEntries.push({
      file: relPath,
      word: data.word,
      pos: data.pos,
      zipf,
      de: s.gloss,
      en: s.gloss_en,
      en_full: s.gloss_en_full ?? null,
    });
  } else if (data.senses.length >= 2 && !singleMode) {
    multiEntries.push({
      file: relPath,
      word: data.word,
      pos: data.pos,
      zipf,
      senses: data.senses.map((s, i) => ({
        n: i + 1,
        de: s.gloss,
        en: s.gloss_en,
        en_full: s.gloss_en_full ?? null,
      })),
    });
  }
}

const entries = singleMode ? singleEntries : multiEntries;

// Sort by frequency (most common words first)
entries.sort((a, b) => b.zipf - a.zipf);

const totalBatches = Math.ceil(entries.length / batchSize);
console.log(`${entries.length} words eligible, ${totalBatches} batches of ${batchSize}`);

// Generate batches
mkdirSync(OUT_DIR, { recursive: true });

const startBatch = onlyBatch ? onlyBatch : 1;
const endBatch = onlyBatch ? onlyBatch : totalBatches;

for (let b = startBatch; b <= endBatch; b++) {
  const start = (b - 1) * batchSize;
  const end = Math.min(start + batchSize, entries.length);

  let batch: any[];
  if (singleMode) {
    batch = (entries as SingleEntry[]).slice(start, end).map(({ zipf, en_full, ...rest }) =>
      en_full ? { ...rest, en_full } : rest
    );
  } else {
    batch = (entries as MultiEntry[]).slice(start, end).map(({ zipf, ...rest }) => ({
      ...rest,
      senses: rest.senses.map(({ en_full, ...s }) =>
        en_full ? { ...s, en_full } : s
      ),
    }));
  }

  const outPath = join(OUT_DIR, `batch-${String(b).padStart(3, "0")}.json`);
  writeFileSync(outPath, JSON.stringify(batch, null, 2) + "\n");

  if (b <= 3 || b === endBatch) {
    const senseCount = singleMode ? batch.length : batch.reduce((s: number, w: any) => s + w.senses.length, 0);
    console.log(`  batch-${String(b).padStart(3, "0")}.json: ${batch.length} words, ${senseCount} senses`);
  } else if (b === 4) {
    console.log("  ...");
  }
}

console.log(`\nBatches written to ${relative(ROOT, OUT_DIR)}/`);
