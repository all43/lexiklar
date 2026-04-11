/**
 * Analyze drift between proofread text_linked and what the resolver produces.
 *
 * Runs ALL proofread examples (not just the sample) and categorizes divergences.
 *
 * Usage:
 *   npx tsx scripts/check-text-linked-drift.ts [--verbose] [--json]
 *
 * --verbose: show each divergence with expected/actual
 * --json: output machine-readable JSON to stdout
 */

import { readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import {
  annotateExampleText,
  resolveWordFile,
  normalizeHint,
  IRREGULAR_EN,
  type WordLookupEntry,
} from "./lib/text-linked.js";
import type { WordBase, Sense } from "../types/index.js";
import type { Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const verbose = process.argv.includes("--verbose");
const jsonOutput = process.argv.includes("--json");

// ── Build word lookup ──

if (!jsonOutput) console.log("Building word lookup...");
const files = findWordFilePaths();
const lookup = new Map<string, WordLookupEntry[]>();

for (const filePath of files) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
  const relPath = relative(DATA_DIR, filePath);
  const parts = relPath.split("/");
  const posDir = parts[1];
  const file = parts[2].replace(".json", "");
  const key = `${data.word}|${data.pos}`;

  if (!lookup.has(key)) lookup.set(key, []);
  lookup.get(key)!.push({
    posDir,
    file,
    senses: data.senses || [],
  });
}

// ── Load examples ──

if (!jsonOutput) console.log("Loading examples...");
const examples = loadExamples();

// ── Parse links from text_linked ──

interface ParsedLink {
  form: string;
  path: string;
  sense: number | null;
  fullMatch: string;
}

/**
 * Walks `[[form|path#sense]]` tokens character-by-character so paths
 * containing `]` (e.g. `pronouns/das_[1]`) are parsed correctly. The naive
 * `/\[\[([^|]+)\|([^\]#]+)(?:#(\d+))?\]\]/g` regex misparses those because
 * `[^\]]` stops at the first `]`. A simple "first `]]`" scan also fails:
 * `[[das|pronouns/das_[1]]]` contains `]]]`, so the first `]]` is mid-path.
 * Real link closer is the first `]]` whose following char is NOT `]`.
 */
function parseLinks(textLinked: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  let i = 0;
  while (i < textLinked.length) {
    if (textLinked[i] !== "[" || textLinked[i + 1] !== "[") {
      i++;
      continue;
    }
    const pipeIdx = textLinked.indexOf("|", i + 2);
    if (pipeIdx === -1) {
      i++;
      continue;
    }
    let endIdx = -1;
    for (let j = pipeIdx + 1; j < textLinked.length - 1; j++) {
      if (textLinked[j] === "]" && textLinked[j + 1] === "]") {
        // Skip if followed by another `]` — that means we're inside `]]]`,
        // which is path-end `]` plus the actual closing `]]`.
        if (textLinked[j + 2] === "]") continue;
        endIdx = j;
        break;
      }
    }
    if (endIdx === -1) {
      i++;
      continue;
    }
    const form = textLinked.slice(i + 2, pipeIdx);
    const pathRaw = textLinked.slice(pipeIdx + 1, endIdx);
    const senseMatch = pathRaw.match(/^(.*)#(\d+)$/);
    const path = senseMatch ? senseMatch[1] : pathRaw;
    const sense = senseMatch ? parseInt(senseMatch[2], 10) : null;
    links.push({
      form,
      path,
      sense,
      fullMatch: textLinked.slice(i, endIdx + 2),
    });
    i = endIdx + 2;
  }
  return links;
}

// ── Check if a gloss_hint is stale ──

function isStaleHint(ann: Annotation): boolean {
  if (!ann.gloss_hint) return false;
  const entries = lookup.get(`${ann.lemma}|${ann.pos}`);
  if (!entries) return false;

  const hintLower = normalizeHint(ann.gloss_hint);
  const hintStem = hintLower
    .replace(/ies$/, "y")
    .replace(/ied$/, "y")
    .replace(/ying$/, "y")
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/(?:es|en|s)$/, "");
  const useStem = hintStem.length >= 4 && hintStem !== hintLower;
  const irregBase = IRREGULAR_EN[hintLower] ?? null;

  for (const entry of entries) {
    for (const sense of entry.senses) {
      for (const field of ["gloss", "gloss_en"] as const) {
        const gloss = sense[field];
        if (!gloss) continue;
        const g = gloss.toLowerCase();
        if (g.includes(hintLower)) return false;
        if (useStem && g.includes(hintStem)) return false;
        if (irregBase && g.includes(irregBase)) return false;
      }
      if (sense.synonyms_en) {
        for (const syn of sense.synonyms_en) {
          const s = syn.toLowerCase();
          if (s.includes(hintLower)) return false;
          if (useStem && s.includes(hintStem)) return false;
          if (irregBase && s.includes(irregBase)) return false;
        }
      }
    }
  }
  return true;
}

// ── Categorize divergence ──

// Build set of all valid file paths for stale-proofread detection
const validPaths = new Set<string>();
for (const entries of lookup.values()) {
  for (const e of entries) validPaths.add(`${e.posDir}/${e.file}`);
}

type Category =
  | "no_output"
  | "missing_link"
  | "extra_link"
  | "wrong_sense"
  | "wrong_path"
  | "stale_hint"
  | "annotation_not_in_lookup"
  | "text_difference"
  | "proofread_path_stale"
  | "proofread_extra_stale";

interface Divergence {
  id: string;
  categories: Category[];
  expected: string;
  actual: string | null;
  details: string[];
}

function categorizeDivergence(
  id: string,
  expected: string,
  actual: string | null,
  annotations: Annotation[],
): Divergence {
  const categories: Category[] = [];
  const details: string[] = [];

  if (!actual) {
    categories.push("no_output");
    details.push("resolver produced null");
    return { id, categories, expected, actual, details };
  }

  const expLinks = parseLinks(expected);
  const actLinks = parseLinks(actual);

  // Build form→link maps
  const expByForm = new Map<string, ParsedLink>();
  for (const l of expLinks) expByForm.set(l.form, l);
  const actByForm = new Map<string, ParsedLink>();
  for (const l of actLinks) actByForm.set(l.form, l);

  // Check missing links (in expected but not actual)
  for (const [form, expLink] of expByForm) {
    if (!actByForm.has(form)) {
      // Check if this is because annotation is not in lookup
      const ann = annotations.find(a => a.form === form);
      if (ann && !lookup.has(`${ann.lemma}|${ann.pos}`)) {
        categories.push("annotation_not_in_lookup");
        details.push(`${form}: annotation lemma "${ann.lemma}|${ann.pos}" not in word files`);
      } else {
        categories.push("missing_link");
        details.push(`${form}: expected ${expLink.fullMatch}, actual: not linked`);
      }
    }
  }

  // Check extra links (in actual but not expected)
  for (const [form, actLink] of actByForm) {
    if (!expByForm.has(form)) {
      // New word added since proofreading — resolver is likely correct
      if (validPaths.has(actLink.path)) {
        categories.push("proofread_extra_stale");
        details.push(`${form}: new word file ${actLink.path} added since proofreading → resolver link is likely correct`);
      } else {
        categories.push("extra_link");
        details.push(`${form}: unexpected link ${actLink.fullMatch}`);
      }
    }
  }

  // Check links present in both
  for (const [form, expLink] of expByForm) {
    const actLink = actByForm.get(form);
    if (!actLink) continue;

    if (expLink.path !== actLink.path) {
      // Check if proofread path no longer exists (file renamed/removed)
      if (!validPaths.has(expLink.path) && validPaths.has(actLink.path)) {
        categories.push("proofread_path_stale");
        details.push(`${form}: proofread path ${expLink.path} no longer exists → resolver path ${actLink.path} is likely correct`);
      } else {
        categories.push("wrong_path");
        details.push(`${form}: expected path ${expLink.path}, got ${actLink.path}`);
      }
    } else if (expLink.sense !== actLink.sense) {
      // Check if this is due to a stale gloss_hint
      const ann = annotations.find(a => a.form === form);
      if (ann && ann.gloss_hint && isStaleHint(ann)) {
        categories.push("stale_hint");
        details.push(`${form}: stale hint "${ann.gloss_hint}" → expected #${expLink.sense}, got #${actLink.sense ?? "none"}`);
      } else {
        categories.push("wrong_sense");
        details.push(`${form}: expected #${expLink.sense ?? "none"}, got #${actLink.sense ?? "none"}`);
      }
    }
  }

  // If no specific category found but strings differ
  if (categories.length === 0 && expected !== actual) {
    categories.push("text_difference");
    details.push("text differs but all links match (whitespace/punctuation?)");
  }

  return { id, categories, expected, actual, details };
}

// ── Main analysis ──

let matched = 0;
let total = 0;
const divergences: Divergence[] = [];

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;
  total++;

  const actual = annotateExampleText(ex.text, ex.annotations, lookup);

  if (actual === ex.text_linked) {
    matched++;
    continue;
  }

  divergences.push(categorizeDivergence(id, ex.text_linked, actual, ex.annotations));
}

// ── Output ──

if (jsonOutput) {
  // Machine-readable output
  const catCounts: Record<string, number> = {};
  for (const d of divergences) {
    for (const cat of d.categories) {
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
  }
  console.log(JSON.stringify({
    total,
    matched,
    diverged: divergences.length,
    match_rate: (matched / total * 100).toFixed(1) + "%",
    categories: catCounts,
    divergences: verbose ? divergences : divergences.slice(0, 20),
  }, null, 2));
} else {
  console.log(`\nResults: ${matched}/${total} matched (${(matched / total * 100).toFixed(1)}%)`);
  console.log(`Diverged: ${divergences.length}\n`);

  // Category summary
  const catCounts = new Map<string, number>();
  for (const d of divergences) {
    for (const cat of d.categories) {
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
  }
  console.log("Category breakdown (one divergence can have multiple categories):");
  for (const [cat, count] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(25)} ${count}`);
  }

  if (verbose) {
    console.log("\nAll divergences:");
    for (const d of divergences) {
      console.log(`\n  [${d.categories.join(", ")}] ${d.id}`);
      for (const detail of d.details) {
        console.log(`    ${detail}`);
      }
      console.log(`    expected: ${d.expected.slice(0, 150)}`);
      console.log(`    actual:   ${(d.actual ?? "null").slice(0, 150)}`);
    }
  } else {
    console.log("\nFirst 10 divergences (use --verbose for all):");
    for (const d of divergences.slice(0, 10)) {
      console.log(`\n  [${d.categories.join(", ")}] ${d.id}`);
      for (const detail of d.details) {
        console.log(`    ${detail}`);
      }
    }
  }
}
