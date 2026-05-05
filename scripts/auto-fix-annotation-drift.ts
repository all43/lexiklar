/**
 * Programmatically fix annotation drift where the correct action is clear.
 *
 * Handles cases that don't need LLM judgment:
 *
 * 1. RESOLVER_CORRECT — gloss_hint matches resolver's sense, not proofread's:
 *    The hint was written for the sense the resolver found. The proofread baseline
 *    just has a stale/wrong sense number. Update text_linked to resolver output.
 *
 * 2. PROOFREAD_EXTRA_STALE — resolver adds links for words added since proofreading:
 *    The resolver's output is strictly more complete. Update baseline.
 *
 * 3. HINT_FIXABLE — hint doesn't match any sense but the proofread sense's gloss_en
 *    would be an unambiguous hint. Set gloss_hint to the target sense's gloss_en.
 *
 * Reports remaining cases that need LLM review.
 *
 * Usage:
 *   npx tsx scripts/auto-fix-annotation-drift.ts              # dry run
 *   npx tsx scripts/auto-fix-annotation-drift.ts --apply       # write changes
 *   npx tsx scripts/auto-fix-annotation-drift.ts --verbose     # show each decision
 */

import { readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples, patchExamples, annotationsHash } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import {
  annotateExampleText,
  normalizeHint,
  IRREGULAR_EN,
  type WordLookupEntry,
} from "./lib/text-linked.js";
import type { WordBase, Sense } from "../types/index.js";
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

interface SenseInfo {
  gloss: string;
  gloss_en: string | null;
  synonyms_en?: string[] | null;
}

const sensesByPath = new Map<string, SenseInfo[]>();

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

  sensesByPath.set(path, (data.senses || []).map(s => ({
    gloss: s.gloss || "",
    gloss_en: s.gloss_en ?? null,
    synonyms_en: s.synonyms_en ?? null,
  })));
}

// ── Hint matching helpers (mirrors resolver logic) ──

function hintMatchesSense(hint: string, sense: SenseInfo): boolean {
  const hintLower = normalizeHint(hint);
  const hintStem = hintLower
    .replace(/ies$/, "y").replace(/ied$/, "y").replace(/ying$/, "y")
    .replace(/ing$/, "").replace(/ed$/, "").replace(/(?:es|en|s)$/, "");
  const useStem = hintStem.length >= 4 && hintStem !== hintLower;
  const irregBase = IRREGULAR_EN[hintLower] ?? null;

  function matches(text: string): boolean {
    const t = text.toLowerCase();
    if (t.includes(hintLower)) return true;
    if (useStem && t.includes(hintStem)) return true;
    if (irregBase && t.includes(irregBase)) return true;
    return false;
  }

  if (sense.gloss && matches(sense.gloss)) return true;
  if (sense.gloss_en && matches(sense.gloss_en)) return true;
  if (sense.synonyms_en) {
    for (const syn of sense.synonyms_en) {
      if (matches(syn)) return true;
    }
  }
  return false;
}

// ── Parse links from text_linked ──

interface ParsedLink {
  form: string;
  path: string;
  sense: number | null;
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

// ── Main analysis ──

console.log("Loading examples...");
const examples = loadExamples();

// Build set of valid paths for stale detection
const validPaths = new Set<string>();
for (const entries of lookup.values()) {
  for (const e of entries) validPaths.add(`${e.posDir}/${e.file}`);
}

interface Patch {
  annotations?: Annotation[];
  text_linked?: string;
  _proofread?: { annotations: string };
}

const patches: Record<string, Patch> = {};

let scanned = 0;
let alreadyMatched = 0;
let autoResolverCorrect = 0;
let autoProofreadStale = 0;
let autoHintFixed = 0;
let needsLlm = 0;
let totalDivergentLinks = 0;
let autoFixedLinks = 0;

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;
  scanned++;

  const actual = annotateExampleText(ex.text, ex.annotations, lookup);
  if (actual === null || actual === ex.text_linked) {
    if (actual === ex.text_linked) alreadyMatched++;
    continue;
  }

  const expected = parseAndDelink(ex.text_linked);
  const got = parseAndDelink(actual);

  const expByPos = new Map<number, ParsedLink>();
  for (const l of expected.links) expByPos.set(l.delinkedPos, l);
  const gotByPos = new Map<number, ParsedLink>();
  for (const l of got.links) gotByPos.set(l.delinkedPos, l);

  // Check if ALL divergences in this example can be auto-resolved
  let allAutoResolvable = true;
  let hasAnyDivergence = false;
  const hintFixes: Array<{ form: string; newHint: string }> = [];
  let hasResolverCorrectLink = false;

  // Check extra links (proofread_extra_stale)
  for (const [form, actLink] of gotByPos) {
    if (expByPos.has(actLink.delinkedPos)) continue;
    // Extra link in resolver output — check if it's a valid new word
    if (validPaths.has(actLink.path)) {
      hasAnyDivergence = true;
      hasResolverCorrectLink = true;
      // Stale proofread — resolver is correct
    } else {
      hasAnyDivergence = true;
      allAutoResolvable = false;
    }
  }

  // Check missing links
  for (const [pos, expLink] of expByPos) {
    if (!gotByPos.has(pos)) {
      hasAnyDivergence = true;
      allAutoResolvable = false; // missing links need investigation
    }
  }

  // Check divergent links (wrong_sense / wrong_path)
  for (const [pos, expLink] of expByPos) {
    const gotLink = gotByPos.get(pos);
    if (!gotLink) continue;
    if (expLink.path === gotLink.path && expLink.sense === gotLink.sense) continue;

    hasAnyDivergence = true;
    totalDivergentLinks++;

    const ann = ex.annotations!.find(a => a.form === expLink.form);
    if (!ann) { allAutoResolvable = false; continue; }

    if (expLink.path === gotLink.path) {
      // wrong_sense — same file, different sense
      const senses = sensesByPath.get(expLink.path);
      if (!senses || senses.length <= 1) continue; // single-sense, skip

      if (ann.gloss_hint) {
        const expSense = expLink.sense ? senses[expLink.sense - 1] : null;
        const actSense = gotLink.sense ? senses[gotLink.sense - 1] : null;

        const hintMatchesExp = expSense && hintMatchesSense(ann.gloss_hint, expSense);
        const hintMatchesAct = actSense && hintMatchesSense(ann.gloss_hint, actSense);

        if (hintMatchesAct && !hintMatchesExp) {
          // Hint was written for the resolver's sense → resolver correct
          hasResolverCorrectLink = true;
          autoFixedLinks++;
          if (VERBOSE) console.log(`  AUTO resolver_correct: ${id} "${ann.form}" hint="${ann.gloss_hint}" matches actual #${gotLink.sense}, not expected #${expLink.sense}`);
        } else if (hintMatchesExp && !hintMatchesAct) {
          // Hint matches expected but resolver picked wrong sense
          // This shouldn't happen (resolver should have matched) — needs investigation
          allAutoResolvable = false;
          if (VERBOSE) console.log(`  NEEDS LLM: ${id} "${ann.form}" hint="${ann.gloss_hint}" matches expected #${expLink.sense} but resolver got #${gotLink.sense}`);
        } else if (hintMatchesExp && hintMatchesAct) {
          // Hint matches both — ambiguous
          allAutoResolvable = false;
          if (VERBOSE) console.log(`  NEEDS LLM: ${id} "${ann.form}" hint="${ann.gloss_hint}" matches BOTH senses`);
        } else {
          // Hint matches neither — stale hint, try auto-fix
          if (expLink.sense && expSense?.gloss_en) {
            // Would the expected sense's gloss_en work as a unique hint?
            const otherSensesMatch = senses.some((s, i) =>
              i !== (expLink.sense! - 1) && hintMatchesSense(expSense.gloss_en!, s)
            );
            if (!otherSensesMatch) {
              hintFixes.push({ form: ann.form, newHint: expSense.gloss_en });
              autoFixedLinks++;
              if (VERBOSE) console.log(`  AUTO hint_fix: ${id} "${ann.form}" "${ann.gloss_hint}" → "${expSense.gloss_en}"`);
            } else {
              allAutoResolvable = false;
            }
          } else {
            allAutoResolvable = false;
          }
        }
      } else {
        // No hint — need to add one
        if (expLink.sense) {
          const expSense = senses[expLink.sense - 1];
          if (expSense?.gloss_en) {
            const otherSensesMatch = senses.some((s, i) =>
              i !== (expLink.sense! - 1) && hintMatchesSense(expSense.gloss_en!, s)
            );
            if (!otherSensesMatch) {
              hintFixes.push({ form: ann.form, newHint: expSense.gloss_en });
              autoFixedLinks++;
              if (VERBOSE) console.log(`  AUTO hint_add: ${id} "${ann.form}" null → "${expSense.gloss_en}"`);
            } else {
              allAutoResolvable = false;
            }
          } else {
            allAutoResolvable = false;
          }
        } else {
          allAutoResolvable = false;
        }
      }
    } else {
      // wrong_path — different file
      if (ann.gloss_hint) {
        // Check if hint matches actual file's senses but not expected file's
        const expSenses = sensesByPath.get(expLink.path) || [];
        const actSenses = sensesByPath.get(gotLink.path) || [];
        const hintMatchesExpFile = expSenses.some(s => hintMatchesSense(ann.gloss_hint!, s));
        const hintMatchesActFile = actSenses.some(s => hintMatchesSense(ann.gloss_hint!, s));

        if (hintMatchesActFile && !hintMatchesExpFile) {
          hasResolverCorrectLink = true;
          autoFixedLinks++;
          if (VERBOSE) console.log(`  AUTO resolver_correct: ${id} "${ann.form}" hint="${ann.gloss_hint}" matches actual path ${gotLink.path}, not expected ${expLink.path}`);
        } else {
          allAutoResolvable = false;
          if (VERBOSE) console.log(`  NEEDS LLM: ${id} "${ann.form}" wrong_path hint="${ann.gloss_hint}" exp=${expLink.path} act=${gotLink.path}`);
        }
      } else {
        allAutoResolvable = false;
      }
    }
  }

  if (!hasAnyDivergence) continue;

  if (allAutoResolvable) {
    // Apply hint fixes
    let patched = ex.annotations!;
    if (hintFixes.length > 0) {
      const fixMap = new Map(hintFixes.map(f => [f.form, f.newHint]));
      patched = ex.annotations!.map(ann => {
        const newHint = fixMap.get(ann.form);
        if (newHint === undefined) return ann;
        return { ...ann, gloss_hint: newHint };
      });
      autoHintFixed += hintFixes.length;
    }

    // Re-resolve with patched annotations
    const resolved = annotateExampleText(ex.text, patched, lookup);
    if (resolved) {
      if (hintFixes.length > 0) {
        patches[id] = {
          annotations: patched,
          text_linked: resolved,
          _proofread: { annotations: annotationsHash(patched) },
        };
      } else {
        patches[id] = { text_linked: resolved };
      }

      if (hasResolverCorrectLink && hintFixes.length === 0) autoResolverCorrect++;
      else if (hasResolverCorrectLink) autoResolverCorrect++;
      if (hintFixes.length > 0) {} // already counted
    }
  } else {
    needsLlm++;
  }
}

const totalPatched = Object.keys(patches).length;

console.log(`\nProofread examples: ${scanned}`);
console.log(`  already matched:         ${alreadyMatched}`);
console.log(`  auto-fixed (total):      ${totalPatched}`);
console.log(`    resolver correct:      auto-accepted where hint matches resolver's sense`);
console.log(`    hint fixes:            ${autoHintFixed} annotations updated`);
console.log(`  needs LLM review:        ${needsLlm}`);
console.log(`  auto-fixed links:        ${autoFixedLinks} / ${totalDivergentLinks}`);

if (!APPLY) {
  console.log("\nDry run — pass --apply to write changes.");

  // Verify: how many would now match?
  let wouldMatch = 0;
  for (const [id, patch] of Object.entries(patches)) {
    const ex = examples[id];
    const anns = patch.annotations ?? ex.annotations!;
    const resolved = annotateExampleText(ex.text, anns, lookup);
    if (resolved && patch.text_linked === resolved) wouldMatch++;
  }
  console.log(`  would produce matching:  ${wouldMatch} / ${totalPatched}`);
  console.log(`  projected match rate:    ${((alreadyMatched + wouldMatch) / scanned * 100).toFixed(1)}%`);
} else {
  console.log(`\nApplying ${totalPatched} patches...`);
  patchExamples(patches);
  console.log("Done.");
}
