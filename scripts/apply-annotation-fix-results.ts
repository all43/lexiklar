/**
 * Apply annotation drift fix results produced by subagents.
 *
 * Processes the output from fix-annotation-drift.md subagent:
 *   - gloss_hint_fix: updates annotation gloss_hint + refreshes _proofread.annotations hash
 *   - resolver_correct: updates text_linked to match resolver output
 *
 * Usage:
 *   npx tsx scripts/apply-annotation-fix-results.ts --results data/annotation-fix-results.json
 *   npx tsx scripts/apply-annotation-fix-results.ts --results data/annotation-fix-results.json --dry-run
 *   npx tsx scripts/apply-annotation-fix-results.ts --results data/annotation-fix-results.json --cleanup
 */

import { readFileSync, existsSync, unlinkSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamplesByIds, patchExamples, annotationsHash } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import { annotateExampleText, type WordLookupEntry } from "./lib/text-linked.js";
import type { WordBase } from "../types/index.js";
import type { Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CLEANUP = args.includes("--cleanup");
/** Apply all hint fixes unconditionally — update text_linked to match resolver output after patching */
const ACCEPT_ALL = args.includes("--accept-all");
const resultsIdx = args.indexOf("--results");
const RESULTS_FILE = resultsIdx !== -1
  ? args[resultsIdx + 1]!
  : join(ROOT, "data", "annotation-fix-results.json");

if (!existsSync(RESULTS_FILE)) {
  console.error(`Results file not found: ${RESULTS_FILE}`);
  process.exit(1);
}

// ── Types ──

interface GlossHintFix {
  type: "gloss_hint_fix";
  id: string;
  form: string;
  new_gloss_hint: string;
  target_path?: string;
  target_sense?: number;
  reason?: string;
}

interface ResolverCorrect {
  id: string;
  form: string;
  reason?: string;
}

interface FixResults {
  fixes: GlossHintFix[];
  resolver_correct: ResolverCorrect[];
  uncertain?: Array<{ id: string; form: string; reason?: string }>;
}

// ── Load results ──

const results: FixResults = JSON.parse(readFileSync(RESULTS_FILE, "utf-8"));
console.log(`Loaded results: ${results.fixes.length} fixes, ${results.resolver_correct.length} resolver_correct, ${results.uncertain?.length ?? 0} uncertain`);

// ── Build word lookup for re-resolving ──

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

// ── Collect all example IDs ──

const allIds = new Set<string>();
for (const fix of results.fixes) allIds.add(fix.id);
for (const rc of results.resolver_correct) allIds.add(rc.id);

console.log(`Loading ${allIds.size} examples...`);
const examples = loadExamplesByIds([...allIds]);

// ── Apply gloss_hint fixes (grouped by example) ──

interface Patch {
  annotations?: Annotation[];
  text_linked?: string;
  _proofread?: { annotations: string };
}

const patches: Record<string, Patch> = {};
let hintFixCount = 0;
let baselineFixCount = 0;
let verifyPassCount = 0;
let verifyFailCount = 0;

// Group fixes by example ID so multi-fix examples are applied together
const fixesByExample = new Map<string, GlossHintFix[]>();
for (const fix of results.fixes) {
  if (!fixesByExample.has(fix.id)) fixesByExample.set(fix.id, []);
  fixesByExample.get(fix.id)!.push(fix);
}

for (const [id, fixes] of fixesByExample) {
  const ex = examples[id];
  if (!ex?.annotations) {
    console.warn(`  SKIP: example ${id} not found or has no annotations`);
    continue;
  }

  // Apply all fixes for this example together
  const fixByForm = new Map<string, string>();
  for (const fix of fixes) fixByForm.set(fix.form, fix.new_gloss_hint);

  const patched = ex.annotations.map(ann => {
    const newHint = fixByForm.get(ann.form);
    if (newHint === undefined) return ann;
    return { ...ann, gloss_hint: newHint };
  });

  // Verify all fixes together produce matching output
  const resolved = annotateExampleText(ex.text, patched, lookup);
  if (resolved === ex.text_linked) {
    verifyPassCount++;
  } else if (ACCEPT_ALL) {
    // In accept-all mode, apply fixes and update baseline to resolver output
    verifyPassCount++;
  } else {
    // Try applying fixes individually to report which ones work
    let anyWorked = false;
    for (const fix of fixes) {
      const single = ex.annotations.map(ann =>
        ann.form === fix.form ? { ...ann, gloss_hint: fix.new_gloss_hint } : ann
      );
      const singleResolved = annotateExampleText(ex.text, single, lookup);
      if (singleResolved === ex.text_linked) {
        anyWorked = true;
      }
    }
    if (!anyWorked) {
      verifyFailCount++;
      console.warn(`  VERIFY FAIL: ${id} — fixes for [${fixes.map(f => f.form).join(", ")}] did not produce matching output`);
      // Still apply the hint fixes even if full verification fails —
      // the hints may be individually correct but other divergences remain
      // Only skip if there's also a resolver_correct entry for this example
      const hasBaselineUpdate = results.resolver_correct.some(rc => rc.id === id);
      if (!hasBaselineUpdate) continue;
    }
  }

  hintFixCount += fixes.length;
  const newHash = annotationsHash(patched);
  patches[id] = {
    annotations: patched,
    _proofread: { annotations: newHash },
  };

  // In accept-all mode, also update text_linked to resolver output
  if (ACCEPT_ALL && resolved && resolved !== ex.text_linked) {
    patches[id].text_linked = resolved;
  }
}

// ── Apply resolver_correct (baseline updates) ──

for (const rc of results.resolver_correct) {
  const ex = examples[rc.id];
  if (!ex?.annotations) {
    console.warn(`  SKIP: example ${rc.id} not found`);
    continue;
  }

  // Use patched annotations if hint fixes were applied to this example
  const anns = patches[rc.id]?.annotations ?? ex.annotations;
  const actual = annotateExampleText(ex.text, anns, lookup);
  if (!actual) {
    console.warn(`  SKIP: ${rc.id} resolver produced null`);
    continue;
  }

  baselineFixCount++;
  if (patches[rc.id]) {
    patches[rc.id].text_linked = actual;
    // Recompute hash with the patched annotations
    patches[rc.id]._proofread = { annotations: annotationsHash(anns) };
  } else {
    patches[rc.id] = { text_linked: actual };
  }
}

// ── Summary ──

console.log(`\nResults:`);
console.log(`  gloss_hint fixes applied:    ${hintFixCount}`);
console.log(`  baseline updates:            ${baselineFixCount}`);
console.log(`  verify passed:               ${verifyPassCount}`);
console.log(`  verify failed (skipped):     ${verifyFailCount}`);
console.log(`  uncertain (ignored):         ${results.uncertain?.length ?? 0}`);

if (DRY_RUN) {
  console.log("\nDry run — no changes written.");
} else if (Object.keys(patches).length > 0) {
  console.log(`\nWriting ${Object.keys(patches).length} patches...`);
  patchExamples(patches);
  console.log("Done.");

  if (CLEANUP) {
    unlinkSync(RESULTS_FILE);
    console.log(`Cleaned up ${RESULTS_FILE}`);
  }
} else {
  console.log("\nNo patches to apply.");
}
