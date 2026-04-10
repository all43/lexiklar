/**
 * Generate context-rich batches of drift divergences for sonnet agents to investigate.
 *
 * Goal: figure out the ROOT CAUSE of the 18.4% divergence rate. Are these
 * examples where senses got reordered after proofreading? Word files renamed?
 * gloss_hints that never made sense? Bad annotations?
 *
 * For each sample divergence, dump:
 *   - example: id, text, annotations, expected text_linked, actual text_linked
 *   - For every annotation: the current word file (lemma|pos lookup) with all senses
 *     listed (gloss, gloss_en, synonyms_en) so the agent can see what gloss_hint
 *     COULD have unambiguously identified the expected sense.
 *
 * Output: data/drift-investigation-batches/d{NN}.json
 *
 * Usage:
 *   npx tsx scripts/generate-drift-investigation-batches.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import type { WordBase } from "../types/index.js";
import type { Annotation, Example } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const OUT_DIR = join(DATA_DIR, "drift-investigation-batches");

// ── Load drift data ──

interface Divergence {
  id: string;
  categories: string[];
  expected: string;
  actual: string | null;
  details: string[];
}

interface DriftReport {
  total: number;
  matched: number;
  diverged: number;
  match_rate: string;
  categories: Record<string, number>;
  divergences: Divergence[];
}

const drift = JSON.parse(readFileSync("/tmp/drift-full.json", "utf-8")) as DriftReport;

// ── Build word lookup keyed by lemma|pos with all senses ──

interface SenseSummary {
  index_1based: number;
  gloss: string;
  gloss_en: string | null;
  synonyms_en?: string[] | null;
}

interface WordFileSummary {
  path: string; // posDir/file
  senses: SenseSummary[];
}

const lookup = new Map<string, WordFileSummary[]>();
const pathToFile = new Map<string, WordFileSummary>();

for (const filePath of findWordFilePaths()) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
  const relPath = relative(DATA_DIR, filePath);
  const parts = relPath.split("/");
  const posDir = parts[1];
  const file = parts[2].replace(".json", "");
  const path = `${posDir}/${file}`;
  const key = `${data.word}|${data.pos}`;

  const summary: WordFileSummary = {
    path,
    senses: (data.senses || []).map((s, i) => ({
      index_1based: i + 1,
      gloss: s.gloss || "",
      gloss_en: s.gloss_en ?? null,
      synonyms_en: s.synonyms_en ?? null,
    })),
  };

  if (!lookup.has(key)) lookup.set(key, []);
  lookup.get(key)!.push(summary);
  pathToFile.set(path, summary);
}

// ── Load examples ──

const examples = loadExamples();

// ── Stratified sample ──

const samplesPerCategory: Record<string, number> = {
  wrong_sense: 50,
  wrong_path: 40,
  missing_link: 35,
  stale_hint: 25,
  proofread_extra_stale: 20,
  annotation_not_in_lookup: 22, // all of them
  no_output: 1, // all of them
};

// Group divergences by primary category (first one in list)
const byCategory = new Map<string, Divergence[]>();
for (const d of drift.divergences) {
  const primary = d.categories[0];
  if (!byCategory.has(primary)) byCategory.set(primary, []);
  byCategory.get(primary)!.push(d);
}

// Seeded shuffle (deterministic)
function shuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const sampled: Divergence[] = [];
for (const [cat, count] of Object.entries(samplesPerCategory)) {
  const pool = byCategory.get(cat) || [];
  const shuffled = shuffle(pool, 42);
  sampled.push(...shuffled.slice(0, Math.min(count, shuffled.length)));
}

console.log(`Sampled ${sampled.length} divergences for investigation`);

// ── Build context for each sample ──

interface InvestigationCase {
  id: string;
  category: string[];
  drift_details: string[];
  text: string;
  expected_text_linked: string;
  actual_text_linked: string | null;
  annotations: Annotation[];
  /** For every (lemma|pos) referenced in annotations, the current state of word files.
   * Multiple entries = homonyms. Use this to see what gloss_hint could disambiguate. */
  word_files_for_annotations: Record<string, WordFileSummary[]>;
  /** The actual word files at the expected and actual link paths,
   * so the agent can see them side-by-side without doing a lookup. */
  expected_link_files: Record<string, WordFileSummary | null>;
  actual_link_files: Record<string, WordFileSummary | null>;
}

function parseLinks(textLinked: string): Array<{ form: string; path: string; sense: number | null }> {
  const links: Array<{ form: string; path: string; sense: number | null }> = [];
  const re = /\[\[([^|]+)\|([^\]#]+)(?:#(\d+))?\]\]/g;
  let m;
  while ((m = re.exec(textLinked))) {
    links.push({
      form: m[1],
      path: m[2],
      sense: m[3] ? parseInt(m[3], 10) : null,
    });
  }
  return links;
}

const cases: InvestigationCase[] = [];
for (const d of sampled) {
  const ex = examples[d.id] as Example | undefined;
  if (!ex || !ex.annotations) continue;

  const wordFilesForAnnotations: Record<string, WordFileSummary[]> = {};
  for (const ann of ex.annotations) {
    const key = `${ann.lemma}|${ann.pos}`;
    if (wordFilesForAnnotations[key]) continue;
    wordFilesForAnnotations[key] = lookup.get(key) || [];
  }

  const expectedLinkFiles: Record<string, WordFileSummary | null> = {};
  for (const link of parseLinks(d.expected)) {
    if (expectedLinkFiles[link.path]) continue;
    expectedLinkFiles[link.path] = pathToFile.get(link.path) || null;
  }

  const actualLinkFiles: Record<string, WordFileSummary | null> = {};
  if (d.actual) {
    for (const link of parseLinks(d.actual)) {
      if (actualLinkFiles[link.path]) continue;
      actualLinkFiles[link.path] = pathToFile.get(link.path) || null;
    }
  }

  cases.push({
    id: d.id,
    category: d.categories,
    drift_details: d.details,
    text: ex.text,
    expected_text_linked: d.expected,
    actual_text_linked: d.actual,
    annotations: ex.annotations,
    word_files_for_annotations: wordFilesForAnnotations,
    expected_link_files: expectedLinkFiles,
    actual_link_files: actualLinkFiles,
  });
}

// ── Split into batches of ~50 ──

const BATCH_SIZE = 50;
mkdirSync(OUT_DIR, { recursive: true });

let batchNum = 1;
for (let i = 0; i < cases.length; i += BATCH_SIZE) {
  const batch = cases.slice(i, i + BATCH_SIZE);
  const filename = `d${String(batchNum).padStart(2, "0")}.json`;
  writeFileSync(
    join(OUT_DIR, filename),
    JSON.stringify({ cases: batch }, null, 2) + "\n",
  );
  console.log(`  ${filename}: ${batch.length} cases`);
  batchNum++;
}

console.log(`\nWrote ${batchNum - 1} batches to ${OUT_DIR}`);
