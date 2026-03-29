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
 *   npx tsx scripts/proofread-batches.ts --check-refs --word-list words.txt
 *
 * Options:
 *   --start-batch <N>   First batch number (required, except with --check-refs)
 *   --count <N>         Number of batches to generate (default: 10)
 *   --skip <N>          Skip first N unproofread words (default: 0)
 *   --batch-size <N>    Words per batch (default: 30)
 *   --out <dir>         Write batch files to dir (default: stdout)
 *   --check-refs        Include referenced examples (annotations mentioning this word)
 *   --word-list <file>  Use specific word list instead of auto-finding unproofread words
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

const checkRefs = args.includes("--check-refs");
const wordListFile = getArg("--word-list");
const startBatch = parseInt(getArg("--start-batch") || "");
if (isNaN(startBatch) && !checkRefs) {
  console.error("--start-batch <N> is required (unless using --check-refs)");
  process.exit(1);
}
const count = parseInt(getArg("--count", "10")!);
const skip = parseInt(getArg("--skip", "0")!);
const batchSize = parseInt(getArg("--batch-size", "30")!);
const outDir = getArg("--out");

// 1. Find unproofread words
interface WordEntry {
  zipf: number;
  path: string;
  refsOnly?: boolean; // true = glosses already proofread, only check ref examples
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
    } else if (checkRefs && !pr.examples_ref) {
      // Glosses done, but ref examples not yet checked
      const basename = file.replace(/\.json$/, "");
      unproofread.push({
        zipf: data.zipf || 0,
        path: `${posDir}/${basename}`,
        refsOnly: true,
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

// 3. Build reverse index: lemma → [example IDs] (only when --check-refs)
// Scans all shards once to find examples with annotations referencing each word.
let refIndex: Map<string, string[]> | null = null;
if (checkRefs) {
  console.error("Building annotation reference index (scanning all shards)...");
  refIndex = new Map();
  const shardFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const sf of shardFiles) {
    const shard = JSON.parse(readFileSync(join(EXAMPLES_DIR, sf), "utf-8"));
    for (const [id, ex] of Object.entries(shard) as [string, any][]) {
      if (!ex.annotations) continue;
      const seen = new Set<string>();
      for (const ann of ex.annotations) {
        if (ann.lemma && !seen.has(ann.lemma)) {
          seen.add(ann.lemma);
          if (!refIndex.has(ann.lemma)) refIndex.set(ann.lemma, []);
          refIndex.get(ann.lemma)!.push(id);
        }
      }
    }
  }
  console.error(`Reference index: ${refIndex.size} lemmas, ${[...refIndex.values()].reduce((s, v) => s + v.length, 0)} references`);
}

// 4. Generate batch output
for (let batchIdx = 0; batchIdx < count; batchIdx++) {
  const start = batchIdx * batchSize;
  const end = start + batchSize;
  const batch = selected.slice(start, end);
  if (batch.length === 0) break;

  const batchNum = isNaN(startBatch) ? batchIdx + 1 : startBatch + batchIdx;
  const lines: string[] = [];

  for (let i = 0; i < batch.length; i++) {
    const { path } = batch[i];
    const [posDir, word] = path.split("/");
    const filePath = join(WORDS_DIR, posDir, word + ".json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));

    // Collect all owned example IDs
    const allIds: string[] = [];
    for (const sense of data.senses || []) {
      for (const eid of sense.example_ids || []) {
        allIds.push(eid);
      }
    }
    const ownedSet = new Set(allIds);

    // Find unproofread owned examples
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

    // Find unproofread referenced examples (not owned)
    const refIds: string[] = [];
    if (checkRefs && refIndex) {
      const lemma = data.word;
      const refs = refIndex.get(lemma) || [];
      for (const eid of refs) {
        if (ownedSet.has(eid)) continue; // skip owned — already covered above
        const shard = getShard(eid.slice(0, 2));
        const ex = shard[eid];
        if (!ex) continue;
        const pr = ex._proofread || {};
        if (pr.translation && pr.annotations) continue; // already proofread
        refIds.push(eid);
      }
    }

    const parts: string[] = [`${i + 1}. \`${path}\``];
    if (batch[i].refsOnly) {
      // Glosses already proofread — only check referenced examples
      if (refIds.length > 0) {
        parts.push(`(refs only) check_ref_examples: ${refIds.join(", ")}`);
      } else {
        continue; // nothing to check, skip this word
      }
    } else {
      if (unproofreadIds.length > 0) {
        parts.push(`check_examples: ${unproofreadIds.join(", ")}`);
      }
      if (refIds.length > 0) {
        parts.push(`check_ref_examples: ${refIds.join(", ")}`);
      }
      if (unproofreadIds.length === 0 && refIds.length === 0) {
        parts.push("(glosses/grammar only)");
      }
    }
    lines.push(parts.join(" — "));
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
