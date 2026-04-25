/**
 * Fix stale gloss_hints in annotations by updating them to match the
 * target sense's current gloss_en.
 *
 * A gloss_hint is "stale" when it no longer substring-matches any sense
 * in the word file (usually because gloss_en was updated during proofreading).
 * The proofread text_linked tells us which sense was intended — we read its
 * gloss_en and set the hint to that value so the resolver can re-derive
 * the correct sense number.
 *
 * Usage:
 *   npx tsx scripts/fix-stale-gloss-hints.ts          # dry run
 *   npx tsx scripts/fix-stale-gloss-hints.ts --apply   # write changes
 */

import { readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples, patchExamples, annotationsHash } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import {
  annotateExampleText,
  resolveWordFile,
  normalizeHint,
  IRREGULAR_EN,
  type WordLookupEntry,
} from "./lib/text-linked.js";
import type { WordBase } from "../types/index.js";
import type { Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

// ── Build word lookup ──

console.log("Building word lookup...");
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
  lookup.get(key)!.push({ posDir, file, senses: data.senses || [] });
}

// ── Parse links from text_linked ──

interface ParsedLink {
  form: string;
  path: string;
  sense: number | null;
}

function parseLinks(textLinked: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  let i = 0;
  while (i < textLinked.length) {
    if (textLinked[i] !== "[" || textLinked[i + 1] !== "[") {
      i++;
      continue;
    }
    const pipeIdx = textLinked.indexOf("|", i + 2);
    if (pipeIdx === -1) { i++; continue; }
    let endIdx = -1;
    for (let j = pipeIdx + 1; j < textLinked.length - 1; j++) {
      if (textLinked[j] === "]" && textLinked[j + 1] === "]") {
        if (textLinked[j + 2] === "]") continue;
        endIdx = j;
        break;
      }
    }
    if (endIdx === -1) { i++; continue; }
    const form = textLinked.slice(i + 2, pipeIdx);
    const pathRaw = textLinked.slice(pipeIdx + 1, endIdx);
    const senseMatch = pathRaw.match(/^(.*)#(\d+)$/);
    links.push({
      form,
      path: senseMatch ? senseMatch[1] : pathRaw,
      sense: senseMatch ? parseInt(senseMatch[2], 10) : null,
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
    .replace(/ies$/, "y").replace(/ied$/, "y").replace(/ying$/, "y")
    .replace(/ing$/, "").replace(/ed$/, "").replace(/(?:es|en|s)$/, "");
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

// ── Find expected sense for a form from proofread text_linked ──

function findExpectedSense(
  textLinked: string,
  form: string,
  ann: Annotation,
): { path: string; sense: number } | null {
  const links = parseLinks(textLinked);
  // Find matching link by form — for duplicate forms, use the first with a sense#
  for (const link of links) {
    if (link.form === form && link.sense !== null) {
      return { path: link.path, sense: link.sense };
    }
  }
  return null;
}

// ── Resolve target sense's gloss_en ──

function getSenseGlossEn(
  path: string,
  senseNum: number,
): string | null {
  // path is like "verbs/erlassen" — find the entry
  for (const entries of lookup.values()) {
    for (const entry of entries) {
      if (`${entry.posDir}/${entry.file}` === path) {
        const sense = entry.senses[senseNum - 1]; // 1-based → 0-based
        if (sense?.gloss_en) return sense.gloss_en;
        if (sense?.gloss) return sense.gloss;
        return null;
      }
    }
  }
  return null;
}

// ── Main ──

console.log("Loading examples...");
const examples = loadExamples();

let scanned = 0;
let staleFound = 0;
let fixed = 0;
let nowMatches = 0;
const patches: Record<string, { annotations: Annotation[]; _proofread?: { annotations: string } }> = {};

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;
  scanned++;

  // Check if any annotation has a stale hint
  let hasStale = false;
  for (const ann of ex.annotations) {
    if (ann.gloss_hint && isStaleHint(ann)) {
      hasStale = true;
      break;
    }
  }
  if (!hasStale) continue;
  staleFound++;

  // Build patched annotations
  const patched = ex.annotations.map(ann => {
    if (!ann.gloss_hint || !isStaleHint(ann)) return ann;

    const expected = findExpectedSense(ex.text_linked!, ann.form, ann);
    if (!expected) return ann; // can't determine target sense

    const newHint = getSenseGlossEn(expected.path, expected.sense);
    if (!newHint) return ann; // no gloss_en for target sense

    if (VERBOSE) {
      console.log(`  ${id}: ${ann.form} "${ann.gloss_hint}" → "${newHint}"`);
    }
    fixed++;
    return { ...ann, gloss_hint: newHint };
  });

  // Verify the fix produces matching output
  const actual = annotateExampleText(ex.text, patched, lookup);
  if (actual === ex.text_linked) {
    nowMatches++;
  }

  // Update annotations hash for _proofread
  const newHash = annotationsHash(patched);
  patches[id] = {
    annotations: patched,
    _proofread: { annotations: newHash },
  };
}

console.log(`\nProofread examples scanned: ${scanned}`);
console.log(`  with stale hints:   ${staleFound}`);
console.log(`  hints fixed:        ${fixed}`);
console.log(`  now fully matching: ${nowMatches}  ← will become snapshot-locked`);
console.log(`  partial fix only:   ${staleFound - nowMatches}`);

if (!APPLY) {
  console.log("\nDry run — pass --apply to write changes.");
} else {
  console.log(`\nApplying ${Object.keys(patches).length} annotation patches...`);
  patchExamples(patches);
  console.log("Done.");
}
