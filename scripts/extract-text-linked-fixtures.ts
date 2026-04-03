/**
 * Extract golden test fixtures from proofread examples.
 *
 * Collects all examples with `_proofread.annotations` + `text_linked`,
 * builds a minimal word lookup for the annotations they reference,
 * and writes both to a fixture file for use in tests and drift analysis.
 *
 * Usage:
 *   npx tsx scripts/extract-text-linked-fixtures.ts [--sample N]
 *
 * --sample N: write only N randomly selected fixtures (for checked-in test fixtures)
 * Without --sample: writes all fixtures (for drift analysis)
 */

import { writeFileSync, readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import type { Annotation } from "../types/example.js";
import type { WordBase, Sense } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

interface FixtureSense {
  gloss: string;
  gloss_en: string | null;
  synonyms_en?: string[];
}

interface FixtureLookupEntry {
  posDir: string;
  file: string;
  senses: FixtureSense[];
}

interface Fixture {
  id: string;
  text: string;
  annotations: Annotation[];
  expected: string;
}

interface FixtureFile {
  generated_at: string;
  total_proofread: number;
  fixture_count: number;
  fixtures: Fixture[];
  lookup: Record<string, FixtureLookupEntry[]>;
}

// Parse --sample flag
const sampleArg = process.argv.indexOf("--sample");
const sampleSize = sampleArg !== -1 ? parseInt(process.argv[sampleArg + 1], 10) : null;

// Load all examples
console.log("Loading examples...");
const examples = loadExamples();

// Collect proofread fixtures
const fixtures: Fixture[] = [];
const neededKeys = new Set<string>();

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;

  fixtures.push({
    id,
    text: ex.text,
    annotations: ex.annotations,
    expected: ex.text_linked,
  });

  for (const ann of ex.annotations) {
    neededKeys.add(`${ann.lemma}|${ann.pos}`);
  }
}

console.log(`Found ${fixtures.length} proofread examples with text_linked.`);

// Build minimal lookup from word files
console.log("Building word lookup for referenced annotations...");
const files = findWordFilePaths();
const lookup: Record<string, FixtureLookupEntry[]> = {};

for (const filePath of files) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
  const key = `${data.word}|${data.pos}`;
  if (!neededKeys.has(key)) continue;

  const relPath = relative(DATA_DIR, filePath);
  const parts = relPath.split("/");
  const posDir = parts[1];
  const file = parts[2].replace(".json", "");

  if (!lookup[key]) lookup[key] = [];
  lookup[key].push({
    posDir,
    file,
    senses: data.senses.map((s: Sense) => ({
      gloss: s.gloss,
      gloss_en: s.gloss_en,
      ...(s.synonyms_en ? { synonyms_en: s.synonyms_en } : {}),
    })),
  });
}

console.log(`Lookup covers ${Object.keys(lookup).length} lemma|pos keys.`);

// Check how many annotation keys are missing from the lookup
const missingKeys = new Set<string>();
for (const key of neededKeys) {
  if (!lookup[key]) missingKeys.add(key);
}
if (missingKeys.size > 0) {
  console.log(`Warning: ${missingKeys.size} annotation keys not found in word files.`);
}

// Sample if requested
let outputFixtures = fixtures;
if (sampleSize && sampleSize < fixtures.length) {
  // Seeded shuffle for reproducibility
  const shuffled = [...fixtures];
  let seed = 42;
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  outputFixtures = shuffled.slice(0, sampleSize);
  console.log(`Sampled ${sampleSize} fixtures for output.`);
}

// Filter lookup to only include keys needed by the output fixtures
const outputKeys = new Set<string>();
for (const f of outputFixtures) {
  for (const ann of f.annotations) {
    outputKeys.add(`${ann.lemma}|${ann.pos}`);
  }
}
const filteredLookup: Record<string, FixtureLookupEntry[]> = {};
for (const key of outputKeys) {
  if (lookup[key]) filteredLookup[key] = lookup[key];
}
console.log(`Filtered lookup to ${Object.keys(filteredLookup).length} keys for output fixtures.`);

// Build output
const output: FixtureFile = {
  generated_at: new Date().toISOString().slice(0, 10),
  total_proofread: fixtures.length,
  fixture_count: outputFixtures.length,
  fixtures: outputFixtures,
  lookup: filteredLookup,
};

const outPath = sampleSize
  ? join(ROOT, "tests", "fixtures", "text-linked-golden.json")
  : join(ROOT, "tests", "fixtures", "text-linked-all.json");

writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${outputFixtures.length} fixtures to ${relative(ROOT, outPath)}`);
const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(1);
console.log(`File size: ~${sizeMB} MB`);
