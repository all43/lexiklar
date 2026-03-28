/**
 * Generate proofread batch word lists for subagent processing.
 *
 * Finds unproofread word files (missing _proofread.gloss_en), sorts by zipf
 * descending, splits into batches of 30, and outputs each batch's word list
 * with check_examples (unproofread example IDs).
 *
 * Usage:
 *   npx tsx scripts/proofread-batches.ts --start-batch 170 --count 10
 *   npx tsx scripts/proofread-batches.ts --start-batch 170 --count 5 --skip 300
 *   npx tsx scripts/proofread-batches.ts --start-batch 170 --count 1 --out /tmp/batch_b170.txt
 *
 * Options:
 *   --start-batch <N>   First batch number (required)
 *   --count <N>         Number of batches to generate (default: 10)
 *   --skip <N>          Skip first N unproofread words (default: 0)
 *   --batch-size <N>    Words per batch (default: 30)
 *   --out <dir>         Write batch files to dir (default: stdout)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");
const EXAMPLES_DIR = join(ROOT, "data", "examples");

// Parse args
const args = process.argv.slice(2);
function getArg(name: string, defaultVal?: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultVal;
  return args[idx + 1];
}

const startBatch = parseInt(getArg("--start-batch") || "");
if (isNaN(startBatch)) {
  console.error("--start-batch <N> is required");
  process.exit(1);
}
const count = parseInt(getArg("--count", "10")!);
const skip = parseInt(getArg("--skip", "0")!);
const batchSize = parseInt(getArg("--batch-size", "30")!);
const outDir = getArg("--out");

// 1. Find unproofread words
interface WordEntry {
  zipf: number;
  path: string; // e.g. "nouns/Tisch"
}

const unproofread: WordEntry[] = [];
for (const posDir of ["nouns", "verbs", "adjectives"]) {
  const dir = join(WORDS_DIR, posDir);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    const pr = data._proofread || {};
    if (!pr.gloss_en) {
      const basename = file.replace(/\.json$/, "");
      unproofread.push({
        zipf: data.zipf || 0,
        path: `${posDir}/${basename}`,
      });
    }
  }
}

unproofread.sort((a, b) => b.zipf - a.zipf);
console.error(`Total unproofread: ${unproofread.length}`);

const selected = unproofread.slice(skip, skip + count * batchSize);
console.error(`Selected ${selected.length} words (skip=${skip}, ${count} batches of ${batchSize})`);

// 2. Cache example shards
const shardCache: Record<string, Record<string, any>> = {};
function getShard(prefix: string): Record<string, any> {
  if (!shardCache[prefix]) {
    const file = join(EXAMPLES_DIR, prefix + ".json");
    shardCache[prefix] = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf-8"))
      : {};
  }
  return shardCache[prefix];
}

// 3. Generate batch output
for (let batchIdx = 0; batchIdx < count; batchIdx++) {
  const start = batchIdx * batchSize;
  const end = start + batchSize;
  const batch = selected.slice(start, end);
  if (batch.length === 0) break;

  const batchNum = startBatch + batchIdx;
  const lines: string[] = [];

  for (let i = 0; i < batch.length; i++) {
    const { path } = batch[i];
    const [posDir, word] = path.split("/");
    const filePath = join(WORDS_DIR, posDir, word + ".json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));

    // Collect all example IDs
    const allIds: string[] = [];
    for (const sense of data.senses || []) {
      for (const eid of sense.example_ids || []) {
        allIds.push(eid);
      }
    }

    // Find unproofread examples
    const unproofreadIds: string[] = [];
    for (const eid of allIds) {
      const shard = getShard(eid.slice(0, 2));
      const ex = shard[eid];
      if (!ex) continue;
      const pr = ex._proofread || {};
      if (!(pr.translation && pr.annotations)) {
        unproofreadIds.push(eid);
      }
    }

    if (unproofreadIds.length > 0) {
      lines.push(`${i + 1}. \`${path}\` — check_examples: ${unproofreadIds.join(", ")}`);
    } else {
      lines.push(`${i + 1}. \`${path}\` (glosses/grammar only)`);
    }
  }

  if (outDir) {
    const outFile = join(outDir, `batch_b${batchNum}.txt`);
    writeFileSync(outFile, lines.join("\n") + "\n");
    console.error(`Wrote ${outFile} (${batch.length} words)`);
  } else {
    console.log(`=== BATCH b${batchNum} ===`);
    for (const line of lines) console.log(line);
    console.log();
  }
}
