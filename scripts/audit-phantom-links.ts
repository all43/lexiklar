/**
 * Audit "phantom links" in proofread text_linked: links whose `form` does not
 * appear in the example's `annotations` array.
 *
 * Hypothesis: these are artifacts of an older non-annotation-driven generator
 * that linked tokens independently of annotations. We want to confirm before
 * stripping them.
 *
 * Outputs:
 *   1. Distribution: how many examples have N phantom links (histogram)
 *   2. Form distribution: which forms are most commonly phantom-linked (top 30)
 *   3. POS distribution of phantom-linked target files (most should be function words)
 *   4. A random sample of 30 examples with phantom links for spot-checking
 *      — full text, proofread text_linked, annotations, list of phantom links
 *      with the current target file's first sense.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import type { WordBase } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

// ── Build path → file metadata lookup ──

interface FileMeta {
  path: string;
  posDir: string;
  word: string;
  pos: string;
  sense_count: number;
  first_sense_gloss_en: string | null;
}

const pathToFile = new Map<string, FileMeta>();
for (const filePath of findWordFilePaths()) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
  const relPath = relative(DATA_DIR, filePath);
  const parts = relPath.split("/");
  const posDir = parts[1];
  const file = parts[2].replace(".json", "");
  const path = `${posDir}/${file}`;
  pathToFile.set(path, {
    path,
    posDir,
    word: data.word,
    pos: data.pos,
    sense_count: (data.senses || []).length,
    first_sense_gloss_en: data.senses?.[0]?.gloss_en ?? null,
  });
}

// ── Scan examples ──

interface ParsedLink {
  form: string;
  path: string;
  sense: number | null;
  fullMatch: string;
}

function parseLinks(textLinked: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const re = /\[\[([^|]+)\|([^\]#]+)(?:#(\d+))?\]\]/g;
  let m;
  while ((m = re.exec(textLinked))) {
    links.push({
      form: m[1],
      path: m[2],
      sense: m[3] ? parseInt(m[3], 10) : null,
      fullMatch: m[0],
    });
  }
  return links;
}

const examples = loadExamples();

interface PhantomCase {
  id: string;
  text: string;
  text_linked: string;
  annotations: Array<{ form: string; lemma: string; pos: string }>;
  phantom_links: Array<{
    form: string;
    path: string;
    sense: number | null;
    target_exists: boolean;
    target_pos_dir: string | null;
    target_first_sense: string | null;
    target_sense_count: number | null;
  }>;
}

const phantomCases: PhantomCase[] = [];
const phantomFormCounts = new Map<string, number>();
const phantomPosDirCounts = new Map<string, number>();
const phantomCountHistogram = new Map<number, number>();
let totalProofread = 0;
let totalPhantomLinks = 0;

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations) continue;
  totalProofread++;

  const annotationForms = new Set(ex.annotations.map((a) => a.form));
  const links = parseLinks(ex.text_linked);
  const phantoms = links.filter((l) => !annotationForms.has(l.form));

  const n = phantoms.length;
  phantomCountHistogram.set(n, (phantomCountHistogram.get(n) ?? 0) + 1);

  if (n === 0) continue;
  totalPhantomLinks += n;

  for (const p of phantoms) {
    phantomFormCounts.set(p.form, (phantomFormCounts.get(p.form) ?? 0) + 1);
    const target = pathToFile.get(p.path);
    const dir = target?.posDir ?? "<missing>";
    phantomPosDirCounts.set(dir, (phantomPosDirCounts.get(dir) ?? 0) + 1);
  }

  phantomCases.push({
    id,
    text: ex.text,
    text_linked: ex.text_linked,
    annotations: ex.annotations.map((a) => ({ form: a.form, lemma: a.lemma, pos: a.pos })),
    phantom_links: phantoms.map((p) => {
      const target = pathToFile.get(p.path);
      return {
        form: p.form,
        path: p.path,
        sense: p.sense,
        target_exists: !!target,
        target_pos_dir: target?.posDir ?? null,
        target_first_sense: target?.first_sense_gloss_en ?? null,
        target_sense_count: target?.sense_count ?? null,
      };
    }),
  });
}

// ── Report ──

console.log(`Proofread examples scanned: ${totalProofread}`);
console.log(`Examples with phantom links: ${phantomCases.length} (${((phantomCases.length / totalProofread) * 100).toFixed(1)}%)`);
console.log(`Total phantom links: ${totalPhantomLinks}`);

console.log("\n## Histogram: phantom links per example");
const sortedHistogram = [...phantomCountHistogram.entries()].sort((a, b) => a[0] - b[0]);
for (const [n, count] of sortedHistogram.slice(0, 25)) {
  console.log(`  ${String(n).padStart(3)} phantom links: ${count} examples`);
}

console.log("\n## Top 30 most common phantom forms");
const sortedForms = [...phantomFormCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [form, count] of sortedForms) {
  console.log(`  ${form.padEnd(20)} ${count}`);
}

console.log("\n## POS dir distribution of phantom link targets");
const sortedPosDirs = [...phantomPosDirCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [dir, count] of sortedPosDirs) {
  console.log(`  ${dir.padEnd(20)} ${count}`);
}

// ── Sample for spot-check ──

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

const sample = shuffle(phantomCases, 42).slice(0, 30);
writeFileSync("/tmp/phantom-spotcheck.json", JSON.stringify({ sample }, null, 2) + "\n");
console.log(`\nWrote 30-case spot-check sample to /tmp/phantom-spotcheck.json`);

// ── Categorize by phantom-link density ──
const densityBuckets = {
  light: phantomCases.filter((c) => c.phantom_links.length <= 2).length,
  medium: phantomCases.filter((c) => c.phantom_links.length >= 3 && c.phantom_links.length <= 6).length,
  heavy: phantomCases.filter((c) => c.phantom_links.length >= 7).length,
};
console.log("\n## Density buckets");
console.log(`  light (1-2):  ${densityBuckets.light}`);
console.log(`  medium (3-6): ${densityBuckets.medium}`);
console.log(`  heavy (7+):   ${densityBuckets.heavy}`);
