/**
 * Refresh proofread `text_linked` baselines for ADDITIVE-ONLY divergences.
 *
 * A divergence is "additive only" when the resolver produces a text_linked
 * that contains every link from the proofread baseline (same form/path/sense,
 * in order) plus zero or more extras, AND the de-linked source text is
 * identical. These are cases where the proofread baseline is stale — usually
 * because the resolver was improved (e.g. cursor advance for duplicate forms,
 * or a new homonym word file added since the example was proofread).
 *
 * For these cases the resolver is provably correct: every link in the
 * baseline survives, and the new links are pure additions. The script
 * overwrites `text_linked` in-place. The annotations are unchanged so
 * `_proofread.annotations` hash stays valid.
 *
 * Other divergence categories (wrong_sense, wrong_path, missing_link,
 * stale_hint) are NOT touched — they need genuine annotation fixes.
 *
 * Usage:
 *   npx tsx scripts/refresh-text-linked-baselines.ts          # dry run
 *   npx tsx scripts/refresh-text-linked-baselines.ts --apply  # write changes
 */

import { readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples, patchExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import { annotateExampleText, type WordLookupEntry } from "./lib/text-linked.js";
import type { WordBase } from "../types/index.js";

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

// ── Robust link parser (handles `]` inside paths like `pronouns/das_[1]`) ──

interface ParsedLink {
  form: string;
  path: string;
  sense: number | null;
  /** Position in the de-linked source text */
  delinkedPos: number;
}

function parseAndDelink(textLinked: string): { delinked: string; links: ParsedLink[] } {
  let out = "";
  const links: ParsedLink[] = [];
  let i = 0;
  while (i < textLinked.length) {
    if (textLinked[i] === "[" && textLinked[i + 1] === "[") {
      // Find the matching `]]` — search forward and require we end on `]]`
      // Form ends at the first `|`; path runs to the closing `]]`.
      const pipeIdx = textLinked.indexOf("|", i + 2);
      if (pipeIdx === -1) {
        out += textLinked[i];
        i++;
        continue;
      }
      // Find closing ]]. Paths can themselves end with `]` (e.g.
      // `pronouns/das_[1]`), producing `]]]` — the real link closer is
      // the first `]]` whose following char is NOT `]`.
      let endIdx = -1;
      for (let j = pipeIdx + 1; j < textLinked.length - 1; j++) {
        if (textLinked[j] === "]" && textLinked[j + 1] === "]") {
          if (textLinked[j + 2] === "]") continue;
          endIdx = j;
          break;
        }
      }
      if (endIdx === -1) {
        out += textLinked[i];
        i++;
        continue;
      }
      const form = textLinked.slice(i + 2, pipeIdx);
      const pathRaw = textLinked.slice(pipeIdx + 1, endIdx);
      // Split path/sense on the LAST `#` followed only by digits
      const senseMatch = pathRaw.match(/^(.*)#(\d+)$/);
      const path = senseMatch ? senseMatch[1] : pathRaw;
      const sense = senseMatch ? parseInt(senseMatch[2], 10) : null;
      links.push({ form, path, sense, delinkedPos: out.length });
      out += form;
      i = endIdx + 2;
    } else {
      out += textLinked[i];
      i++;
    }
  }
  return { delinked: out, links };
}

/**
 * Returns true if every link in `expected` is preserved in `actual` (same
 * form/path/sense in the same delinked-text positions), and the underlying
 * source text is identical. `actual` may contain additional links.
 */
function isAdditiveOnly(expected: string, actual: string): boolean {
  const e = parseAndDelink(expected);
  const a = parseAndDelink(actual);
  if (e.delinked !== a.delinked) return false;

  // Walk both link lists in order; every expected link must appear in actual
  // at the same delinked position with same form/path/sense.
  const aByPos = new Map<number, ParsedLink>();
  for (const al of a.links) aByPos.set(al.delinkedPos, al);

  for (const el of e.links) {
    const al = aByPos.get(el.delinkedPos);
    if (!al) return false;
    if (al.form !== el.form || al.path !== el.path || al.sense !== el.sense) return false;
  }
  return true;
}

// ── Walk proofread examples ──

console.log("Loading examples...");
const examples = loadExamples();

let total = 0;
let additive = 0;
let alreadyMatch = 0;
let nonAdditive = 0;
const patches: Record<string, { text_linked: string }> = {};

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;
  total++;

  const actual = annotateExampleText(ex.text, ex.annotations, lookup);
  if (actual === null) {
    nonAdditive++;
    continue;
  }
  if (actual === ex.text_linked) {
    alreadyMatch++;
    continue;
  }
  if (isAdditiveOnly(ex.text_linked, actual)) {
    additive++;
    patches[id] = { text_linked: actual };
    if (VERBOSE && additive <= 5) {
      console.log(`\n  ${id}`);
      console.log(`    expected: ${ex.text_linked.slice(0, 200)}`);
      console.log(`    actual:   ${actual.slice(0, 200)}`);
    }
  } else {
    nonAdditive++;
  }
}

console.log(`\nProofread examples scanned: ${total}`);
console.log(`  already matching:    ${alreadyMatch}`);
console.log(`  additive-only:       ${additive}  ← will be refreshed`);
console.log(`  non-additive (skip): ${nonAdditive}`);

if (!APPLY) {
  console.log("\nDry run — pass --apply to write changes.");
} else {
  console.log(`\nApplying ${additive} baseline refreshes...`);
  patchExamples(patches);
  console.log("Done.");
}
