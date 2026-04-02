/**
 * Generate compact batch files for remaining unproofread glosses (excluding phrases).
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { iterWordFiles } from "./lib/words.js";

const OUT_DIR = join("/Users/evgeniimalikov/projects/lexiklar", "data", "multi-sense-batches");
const BATCH_SIZE = 100;
const SKIP_POS = new Set(["phrases"]);

interface BatchEntry {
  word: string;
  pos: string;
  file: string;
  senses: { gloss: string; gloss_en: string | null; gloss_en_full: string | null }[];
}

const entries: BatchEntry[] = [];

for (const e of iterWordFiles()) {
  if (SKIP_POS.has(e.posDir)) continue;
  const d = e.data as any;
  if (!d.senses?.length) continue;
  if (!d.senses.some((s: any) => s.gloss_en)) continue;
  if (d._proofread?.gloss_en) continue;

  entries.push({
    word: d.word,
    pos: d.pos,
    file: e.fileKey,
    senses: d.senses.map((s: any) => ({
      gloss: s.gloss,
      gloss_en: s.gloss_en ?? null,
      gloss_en_full: s.gloss_en_full ?? null,
    })),
  });
}

entries.sort((a, b) => a.word.localeCompare(b.word, "de"));

const batchCount = Math.ceil(entries.length / BATCH_SIZE);
for (let i = 0; i < batchCount; i++) {
  const batch = entries.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
  const name = `r${String(i + 1).padStart(3, "0")}`;
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(batch, null, 2) + "\n");
  console.log(`${name}: ${batch.length} entries`);
}
console.log(`\nTotal: ${entries.length} entries in ${batchCount} batches`);
