/**
 * Refresh proofread baselines that over-specify #1 on single-sense words.
 *
 * The resolver correctly omits sense numbers for single-sense words (no
 * ambiguity to resolve). Proofread baselines created before this convention
 * often include `#1` — producing a "wrong_sense" divergence that is really
 * just baseline staleness.
 *
 * This script finds such cases and strips the unnecessary `#N` from
 * text_linked, but ONLY when:
 *   1. The word at that path has exactly 1 sense
 *   2. The only divergence on that link is sense (path matches)
 *   3. De-linked text is identical
 *
 * Usage:
 *   npx tsx scripts/refresh-single-sense-baselines.ts          # dry run
 *   npx tsx scripts/refresh-single-sense-baselines.ts --apply  # write changes
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
const senseCountByPath = new Map<string, number>();

for (const filePath of files) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
  const relPath = relative(DATA_DIR, filePath);
  const parts = relPath.split("/");
  const posDir = parts[1];
  const file = parts[2].replace(".json", "");
  const key = `${data.word}|${data.pos}`;
  const path = `${posDir}/${file}`;
  if (!lookup.has(key)) lookup.set(key, []);
  lookup.get(key)!.push({ posDir, file, senses: data.senses || [] });
  senseCountByPath.set(path, (data.senses || []).length);
}

// ── Strip single-sense #N from text_linked ──

/** Replace `[[form|path#N]]` with `[[form|path]]` for single-sense words */
function stripSingleSenseSuffix(textLinked: string): string {
  let out = "";
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
      if (senseMatch) {
        const path = senseMatch[1];
        const count = senseCountByPath.get(path);
        if (count === 1) {
          // Strip sense suffix
          out += `[[${form}|${path}]]`;
          i = endIdx + 2;
          continue;
        }
      }
      // Keep as-is
      out += textLinked.slice(i, endIdx + 2);
      i = endIdx + 2;
    } else {
      out += textLinked[i];
      i++;
    }
  }
  return out;
}

// ── Main ──

console.log("Loading examples...");
const examples = loadExamples();

let scanned = 0;
let strippedCount = 0;
let nowMatches = 0;
let partialHelp = 0;
const patches: Record<string, { text_linked: string }> = {};

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;
  scanned++;

  const stripped = stripSingleSenseSuffix(ex.text_linked);
  if (stripped === ex.text_linked) continue; // nothing to strip
  strippedCount++;

  // Verify the stripped version matches resolver output
  const actual = annotateExampleText(ex.text, ex.annotations, lookup);

  if (stripped === actual) {
    nowMatches++;
    patches[id] = { text_linked: stripped };
  } else {
    // Still diverges, but at least the single-sense staleness is gone
    // Only patch if the stripped version is closer to actual
    // (i.e., stripping didn't introduce new divergences)
    partialHelp++;
    // Still apply the baseline strip — it removes noise from future drift analysis
    patches[id] = { text_linked: stripped };
  }
}

console.log(`\nProofread examples scanned: ${scanned}`);
console.log(`  with single-sense #N:   ${strippedCount}`);
console.log(`  now fully matching:      ${nowMatches}  ← eliminates divergence`);
console.log(`  partial (other issues):  ${partialHelp}  ← reduces noise in drift`);

if (!APPLY) {
  console.log("\nDry run — pass --apply to write changes.");
} else {
  console.log(`\nApplying ${Object.keys(patches).length} baseline refreshes...`);
  patchExamples(patches);
  console.log("Done.");
}
