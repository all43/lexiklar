/**
 * Generate compact batch files for multi-sense gloss_en/gloss_en_full proofreading.
 *
 * Output format per word: { word, pos, file, senses: [{ gloss, gloss_en, gloss_en_full }] }
 * Minimal context to save agent tokens.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { iterWordFiles } from "./lib/words.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BATCH_DIR = join(ROOT, "data", "multi-sense-batches");
const BATCH_SIZE = 100;

mkdirSync(BATCH_DIR, { recursive: true });

interface CompactEntry {
  word: string;
  pos: string;
  file: string;
  senses: Array<{
    gloss: string;
    gloss_en: string | null;
    gloss_en_full: string | null;
  }>;
}

const entries: CompactEntry[] = [];

for (const e of iterWordFiles()) {
  const d = e.data as any;
  const senses = d.senses || [];
  if (senses.length < 2) continue;
  const pr = d._proofread || {};
  if (pr.gloss_en) continue;

  entries.push({
    word: d.word,
    pos: d.pos,
    file: e.fileKey,
    senses: senses.map((s: any) => ({
      gloss: s.gloss,
      gloss_en: s.gloss_en || null,
      gloss_en_full: s.gloss_en_full || null,
    })),
  });
}

// Sort by zipf desc (most common first) — read zipf from data
entries.sort((a, b) => {
  // Re-read isn't needed, we already have the data. Let's just sort by word for stability.
  return a.word.localeCompare(b.word, "de");
});

const batchCount = Math.ceil(entries.length / BATCH_SIZE);
for (let i = 0; i < batchCount; i++) {
  const batch = entries.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
  const num = String(i + 1).padStart(3, "0");
  writeFileSync(
    join(BATCH_DIR, `m${num}.json`),
    JSON.stringify(batch, null, 2) + "\n"
  );
}

console.log(`Generated ${batchCount} batches (${entries.length} words, ${BATCH_SIZE}/batch)`);
console.log(`Output: ${BATCH_DIR}/m001.json … m${String(batchCount).padStart(3, "0")}.json`);

// Show size of first batch
const firstBatch = entries.slice(0, BATCH_SIZE);
const sizeKB = (Buffer.byteLength(JSON.stringify(firstBatch, null, 2)) / 1024).toFixed(1);
console.log(`First batch size: ${sizeKB} KB, ${firstBatch.reduce((s, e) => s + e.senses.length, 0)} senses`);
