/**
 * Generate a ref-proofreading batch for subagent processing.
 *
 * For each word, finds all unproofread referenced examples (not owned),
 * and outputs a compact format with the word's senses and each example's
 * text + matching annotation(s).
 *
 * Usage:
 *   npx tsx scripts/generate-ref-proofread-batch.ts Doktor Zeug Killer
 *   npx tsx scripts/generate-ref-proofread-batch.ts --file words.txt
 *   npx tsx scripts/generate-ref-proofread-batch.ts --file words.txt --max-refs 30
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Annotation, ExampleShard } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");
const EXAMPLES_DIR = join(ROOT, "data", "examples");

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const maxRefsIdx = args.indexOf("--max-refs");
const maxRefs = maxRefsIdx !== -1 ? parseInt(args[maxRefsIdx + 1]) : 50;

let words: string[] = [];
if (fileIdx !== -1) {
  words = readFileSync(args[fileIdx + 1], "utf-8").split("\n").map((w) => w.trim()).filter(Boolean);
} else {
  words = args.filter((a) => !a.startsWith("--"));
}

if (words.length === 0) {
  console.error("Usage: npx tsx scripts/generate-ref-proofread-batch.ts Word1 Word2 ...");
  process.exit(1);
}

// Find word file by lemma
function findWordFile(lemma: string): { path: string; data: Record<string, unknown> } | null {
  for (const posDir of readdirSync(WORDS_DIR)) {
    const dir = join(WORDS_DIR, posDir);
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const base = file.replace(/\.json$/, "");
        if (base === lemma || base.startsWith(lemma + "_")) {
          const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
          if (data.word === lemma) return { path: `${posDir}/${base}`, data };
        }
      }
    } catch { /* not a dir */ }
  }
  return null;
}

// Load example shard
const shardCache: Record<string, ExampleShard> = {};
function getShard(prefix: string): ExampleShard {
  if (!shardCache[prefix]) {
    const file = join(EXAMPLES_DIR, prefix + ".json");
    shardCache[prefix] = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
  }
  return shardCache[prefix];
}

// Build reverse index: scan all shards once
console.error("Scanning example shards...");
const refIndex = new Map<string, string[]>();
const shardFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();
for (const sf of shardFiles) {
  const shard = JSON.parse(readFileSync(join(EXAMPLES_DIR, sf), "utf-8"));
  for (const [id, ex] of Object.entries(shard) as [string, { annotations?: Annotation[]; _proofread?: { translation?: true; annotations?: string } }][]) {
    if (!ex.annotations) continue;
    // Skip already proofread
    const pr = ex._proofread;
    if (pr?.translation && pr?.annotations) continue;
    const seen = new Set<string>();
    for (const ann of ex.annotations) {
      if (!ann.lemma) continue;
      const keyPos = `${ann.lemma}|${ann.pos}`;
      if (!seen.has(keyPos)) {
        seen.add(keyPos);
        if (!refIndex.has(ann.lemma)) refIndex.set(ann.lemma, []);
        refIndex.get(ann.lemma)!.push(id);
      }
    }
  }
}
console.error(`Index: ${refIndex.size} lemmas`);

// Process each word
for (const lemma of words) {
  const wf = findWordFile(lemma);
  if (!wf) { console.error(`  ⚠ ${lemma}: word file not found`); continue; }

  const senses = (wf.data.senses as { gloss_en: string; tags: string[]; example_ids?: string[] }[]) || [];

  // Owned example IDs
  const ownedSet = new Set<string>();
  for (const s of senses) for (const id of s.example_ids || []) ownedSet.add(id);

  // Ref-only example IDs
  const refIds = (refIndex.get(lemma) || []).filter((id) => !ownedSet.has(id));

  if (refIds.length === 0) {
    console.error(`  ${lemma}: 0 unproofread refs, skipping`);
    continue;
  }

  const selected = refIds.slice(0, maxRefs);

  console.log(`\n### ${lemma} (${wf.path}) — ${refIds.length} unproofread refs${refIds.length > maxRefs ? `, showing first ${maxRefs}` : ""}`);
  console.log(`\nSenses:`);
  senses.forEach((s, i) => {
    console.log(`  ${i + 1}. "${s.gloss_en}" [${s.tags.join(",")}] (${s.example_ids?.length ?? 0} ex)`);
  });
  console.log(`\nReferenced examples to check:`);

  for (const id of selected) {
    const shard = getShard(id.slice(0, 2));
    const ex = shard[id] as { text: string; annotations?: Annotation[] } | undefined;
    if (!ex) continue;
    const matchingAnns = (ex.annotations || []).filter((a) => a.lemma === lemma);
    const text = ex.text.length > 120 ? ex.text.slice(0, 120) + "…" : ex.text;
    console.log(`\n${id}: "${text}"`);
    for (const ann of matchingAnns) {
      console.log(`  form="${ann.form}" pos="${ann.pos}" gloss_hint=${ann.gloss_hint ? `"${ann.gloss_hint}"` : "null"}`);
    }
  }
}
