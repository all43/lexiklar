/**
 * Extract golden test fixtures from proofread examples.
 *
 * Runs the resolver on all examples with `_proofread.annotations`,
 * builds a minimal word lookup for the annotations they reference,
 * and writes both to a fixture file for use in snapshot regression tests.
 *
 * Usage:
 *   npx tsx scripts/extract-text-linked-fixtures.ts [--sample N] [--matching-only]
 *
 * --sample N: write only N randomly selected fixtures (for checked-in test fixtures)
 * --matching-only: (legacy, now a no-op — all fixtures are resolver-computed)
 * Without --sample: writes all fixtures to text-linked-snapshot.json (gitignored).
 */

import { writeFileSync, readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import { annotateExampleText, type WordLookupEntry } from "./lib/text-linked.js";
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

// Parse flags
const sampleArg = process.argv.indexOf("--sample");
const sampleSize = sampleArg !== -1 ? parseInt(process.argv[sampleArg + 1], 10) : null;

// Load all examples
console.log("Loading examples...");
const examples = loadExamples();

// Collect proofread examples with annotations
const candidates: Array<{ id: string; text: string; annotations: Annotation[] }> = [];
const neededKeys = new Set<string>();

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.annotations?.length) continue;

  candidates.push({ id, text: ex.text, annotations: ex.annotations });

  for (const ann of ex.annotations) {
    neededKeys.add(`${ann.lemma}|${ann.pos}`);
  }
}

console.log(`Found ${candidates.length} proofread examples with annotations.`);

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

// Build live lookup for resolver
const liveLookup = new Map<string, WordLookupEntry[]>();
for (const [key, entries] of Object.entries(lookup)) {
  liveLookup.set(
    key,
    entries.map((e) => ({
      posDir: e.posDir,
      file: e.file,
      senses: e.senses.map((s) => ({
        gloss: s.gloss,
        gloss_en: s.gloss_en,
        tags: [],
        example_ids: [],
        synonyms: [],
        antonyms: [],
        ...(s.synonyms_en ? { synonyms_en: s.synonyms_en } : {}),
      })),
    })),
  );
}

// Run resolver on all proofread examples to compute expected output
console.log("Computing resolver output for all proofread examples...");
const fixtures: Fixture[] = [];
for (const c of candidates) {
  const result = annotateExampleText(c.text, c.annotations, liveLookup);
  if (result && result !== c.text) {
    fixtures.push({
      id: c.id,
      text: c.text,
      annotations: c.annotations,
      expected: result,
    });
  }
}
console.log(`${fixtures.length}/${candidates.length} examples produced text_linked output.`);

let outputFixtures = fixtures;

if (sampleSize && sampleSize < outputFixtures.length) {
  // Seeded shuffle for reproducibility
  const shuffled = [...outputFixtures];
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
  total_proofread: candidates.length,
  fixture_count: outputFixtures.length,
  fixtures: outputFixtures,
  lookup: filteredLookup,
};

const outPath = sampleSize
  ? join(ROOT, "tests", "fixtures", "text-linked-golden.json")
  : join(ROOT, "tests", "fixtures", "text-linked-snapshot.json");

writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${outputFixtures.length} fixtures to ${relative(ROOT, outPath)}`);
const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(1);
console.log(`File size: ~${sizeMB} MB`);
