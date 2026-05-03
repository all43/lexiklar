/**
 * Fix gloss_hints that resolve to the wrong sense or wrong homonym file.
 *
 * Unlike fix-stale-gloss-hints (which fixes hints matching NO sense),
 * this script fixes hints that resolve — just to the WRONG target.
 * The proofread text_linked tells us which file+sense was intended.
 *
 * Handles three sub-patterns:
 *   - wrong_sense: expected #N, got #none — hint missing or too vague
 *   - wrong_sense: expected #N, got #M   — hint matches wrong sense
 *   - wrong_path:  expected posDir/fileA, got posDir/fileB — wrong homonym
 *
 * For each, sets gloss_hint to the target sense's gloss_en so the resolver
 * re-derives the correct file+sense number.
 *
 * Usage:
 *   npx tsx scripts/fix-wrong-sense-hints.ts          # dry run
 *   npx tsx scripts/fix-wrong-sense-hints.ts --apply   # write changes
 */

import { readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples, patchExamples, annotationsHash } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import {
  annotateExampleText,
  type WordLookupEntry,
} from "./lib/text-linked.js";
import type { WordBase } from "../types/index.js";
import type { Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const INCLUDE_WRONG_PATH = process.argv.includes("--include-wrong-path");
/** Only fix annotations where gloss_hint is currently null (safest — no existing data overwritten) */
const SAFE_ONLY = process.argv.includes("--safe-only");

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
  /** Position in the de-linked text */
  delinkedPos: number;
}

function parseAndDelink(textLinked: string): { delinked: string; links: ParsedLink[] } {
  let out = "";
  const links: ParsedLink[] = [];
  let i = 0;
  while (i < textLinked.length) {
    if (textLinked[i] === "[" && textLinked[i + 1] === "[") {
      const pipeIdx = textLinked.indexOf("|", i + 2);
      if (pipeIdx === -1) { out += textLinked[i]; i++; continue; }
      let endIdx = -1;
      for (let j = pipeIdx + 1; j < textLinked.length - 1; j++) {
        if (textLinked[j] === "]" && textLinked[j + 1] === "]") {
          if (textLinked[j + 2] === "]") continue;
          endIdx = j;
          break;
        }
      }
      if (endIdx === -1) { out += textLinked[i]; i++; continue; }
      const form = textLinked.slice(i + 2, pipeIdx);
      const pathRaw = textLinked.slice(pipeIdx + 1, endIdx);
      const senseMatch = pathRaw.match(/^(.*)#(\d+)$/);
      links.push({
        form,
        path: senseMatch ? senseMatch[1] : pathRaw,
        sense: senseMatch ? parseInt(senseMatch[2], 10) : null,
        delinkedPos: out.length,
      });
      out += form;
      i = endIdx + 2;
    } else {
      out += textLinked[i];
      i++;
    }
  }
  return { delinked: out, links };
}

// ── Resolve target sense's gloss_en from path ──

function getSenseCount(path: string): number {
  for (const entries of lookup.values()) {
    for (const entry of entries) {
      if (`${entry.posDir}/${entry.file}` === path) return entry.senses.length;
    }
  }
  return 0;
}

function getSenseGlossEn(path: string, senseNum: number): string | null {
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
let wrongSenseLinks = 0;
let hintsFixed = 0;
let examplesPatched = 0;
let nowMatches = 0;
let partialFix = 0;
const patches: Record<string, { annotations: Annotation[]; _proofread?: { annotations: string } }> = {};

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;
  scanned++;

  // Compute actual text_linked
  const actual = annotateExampleText(ex.text, ex.annotations, lookup);
  if (actual === null || actual === ex.text_linked) continue;

  // Parse both expected and actual
  const expected = parseAndDelink(ex.text_linked);
  const got = parseAndDelink(actual);

  // Build position-keyed maps
  const expByPos = new Map<number, ParsedLink>();
  for (const l of expected.links) expByPos.set(l.delinkedPos, l);
  const gotByPos = new Map<number, ParsedLink>();
  for (const l of got.links) gotByPos.set(l.delinkedPos, l);

  // Find wrong-sense and wrong-path links
  const fixNeeded: Array<{
    form: string;
    expectedPath: string;
    expectedSense: number;
    gotPath: string;
    gotSense: number | null;
    delinkedPos: number;
    category: "wrong_sense" | "wrong_path";
  }> = [];

  for (const [pos, expLink] of expByPos) {
    const gotLink = gotByPos.get(pos);
    if (!gotLink) continue; // missing_link — not our problem

    if (expLink.path === gotLink.path) {
      // Same path — check sense
      if (expLink.sense === gotLink.sense) continue; // already matches
      if (expLink.sense === null) continue; // expected no sense — skip

      // Skip single-sense words: resolver correctly omits #1, proofread is overly specific
      if (getSenseCount(expLink.path) === 1) continue;

      fixNeeded.push({
        form: expLink.form,
        expectedPath: expLink.path,
        expectedSense: expLink.sense,
        gotPath: gotLink.path,
        gotSense: gotLink.sense,
        delinkedPos: pos,
        category: "wrong_sense",
      });
    } else if (INCLUDE_WRONG_PATH) {
      // Different path — wrong homonym file
      // Use sense from expected, default to #1 if none specified
      const targetSense = expLink.sense ?? 1;
      fixNeeded.push({
        form: expLink.form,
        expectedPath: expLink.path,
        expectedSense: targetSense,
        gotPath: gotLink.path,
        gotSense: gotLink.sense,
        delinkedPos: pos,
        category: "wrong_path",
      });
    }
  }

  if (fixNeeded.length === 0) continue;
  wrongSenseLinks += fixNeeded.length;

  // Build patched annotations — match by form, consume fixes to handle duplicates
  const fixesByForm = new Map<string, typeof fixNeeded>();
  for (const f of fixNeeded) {
    if (!fixesByForm.has(f.form)) fixesByForm.set(f.form, []);
    fixesByForm.get(f.form)!.push(f);
  }

  const patched = ex.annotations.map(ann => {
    const fixes = fixesByForm.get(ann.form);
    if (!fixes || fixes.length === 0) return ann;

    // Consume first fix for this form (handles duplicate forms in order)
    const fix = fixes.shift()!;

    // In safe-only mode, skip if gloss_hint already exists
    if (SAFE_ONLY && ann.gloss_hint) return ann;

    const newHint = getSenseGlossEn(fix.expectedPath, fix.expectedSense);
    if (!newHint) return ann;

    if (VERBOSE) {
      const arrow = fix.category === "wrong_path"
        ? `path ${fix.gotPath} → ${fix.expectedPath}#${fix.expectedSense}`
        : `sense #${fix.gotSense ?? "none"} → #${fix.expectedSense}`;
      console.log(`  ${id}: ${ann.form} [${fix.category}] hint "${ann.gloss_hint ?? "(none)"}" → "${newHint}" (${arrow})`);
    }
    hintsFixed++;
    return { ...ann, gloss_hint: newHint };
  });

  // Check if any annotation actually changed
  const changed = patched.some((p, i) => p !== ex.annotations![i]);
  if (!changed) continue;

  examplesPatched++;

  // Verify the fix produces matching output
  const fixed = annotateExampleText(ex.text, patched, lookup);
  if (fixed === ex.text_linked) {
    nowMatches++;
  } else {
    partialFix++;
    if (VERBOSE) {
      console.log(`    ⚠ partial: expected ${ex.text_linked.slice(0, 120)}`);
      console.log(`               got      ${(fixed ?? "null").slice(0, 120)}`);
    }
  }

  // Update annotations hash for _proofread
  const newHash = annotationsHash(patched);
  patches[id] = {
    annotations: patched,
    _proofread: { annotations: newHash },
  };
}

console.log(`\nProofread examples scanned: ${scanned}`);
console.log(`  wrong-sense links found: ${wrongSenseLinks}`);
console.log(`  hints fixed:             ${hintsFixed}`);
console.log(`  examples patched:        ${examplesPatched}`);
console.log(`  now fully matching:      ${nowMatches}  ← will become snapshot-locked`);
console.log(`  partial fix only:        ${partialFix}`);

if (!APPLY) {
  console.log("\nDry run — pass --apply to write changes.");
} else {
  console.log(`\nApplying ${Object.keys(patches).length} annotation patches...`);
  patchExamples(patches);
  console.log("Done.");
}
