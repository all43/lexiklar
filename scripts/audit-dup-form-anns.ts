/**
 * Audit examples that have multiple annotations sharing the same `form` field.
 *
 * This is a known weak spot in the resolver: `findFormInText` always starts at
 * index 0, so multiple annotations with the same form all collapse onto the
 * first occurrence and the overlap-dedup drops the extras.
 *
 * Categories surfaced here:
 *   1. Same form, all-content POS (noun/verb/adj), DIFFERENT lemma|pos|hint
 *      → highest-value targets: legitimate multi-sense or homonym occurrences
 *        whose links are silently dropped today.
 *   2. Same form annotated once but appearing ≥2 times in text → potentially
 *      missing annotations (LLM only annotated unique forms).
 *
 * Outputs spot-check samples grouped by sub-pattern so a human can judge
 * whether the duplicate annotation is legitimate (real recurrence) or noise
 * (LLM hallucinated a second occurrence that doesn't exist).
 */

import { writeFileSync } from "fs";
import { loadExamples } from "./lib/examples.js";

const examples = loadExamples();

const CONTENT_POS = new Set(["noun", "verb", "adjective"]);

function countOccurrences(text: string, form: string): number {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\wäöüÄÖÜß])${escaped}(?![\\wäöüÄÖÜß])`, "gu");
  return (text.match(re) || []).length;
}

interface DupCase {
  id: string;
  text: string;
  text_linked: string | null;
  dupForm: string;
  occurrencesInText: number;
  anns: Array<{ form: string; lemma: string; pos: string; gloss_hint: string | null }>;
  /** sub-pattern this case belongs to (for grouping) */
  pattern: string;
}

function classify(anns: DupCase["anns"], occurrences: number): string {
  const sigs = new Set(anns.map(a => `${a.lemma}|${a.pos}|${a.gloss_hint ?? ""}`));
  const lemmas = new Set(anns.map(a => a.lemma));
  const poses = new Set(anns.map(a => a.pos));
  const hints = new Set(anns.map(a => a.gloss_hint ?? ""));

  // 1. Different lemmas entirely (true homograph between unrelated words)
  if (lemmas.size > 1) {
    return occurrences >= anns.length
      ? "different_lemma_real_recurrence"
      : "different_lemma_phantom_dup";
  }
  // 2. Same lemma, different POS (e.g. sein verb vs sein noun "knife")
  if (poses.size > 1) {
    return occurrences >= anns.length
      ? "different_pos_real_recurrence"
      : "different_pos_phantom_dup";
  }
  // 3. Same lemma+pos, different hint → multi-sense interpretation
  if (hints.size > 1) {
    return occurrences >= anns.length
      ? "same_lemma_diff_hint_real_recurrence"
      : "same_lemma_diff_hint_phantom_dup";
  }
  // 4. Identical (lemma, pos, hint) — pure duplicate
  return occurrences >= anns.length
    ? "identical_dup_real_recurrence"
    : "identical_dup_phantom_dup";
}

let totalExamples = 0;
let withDupForm = 0;
let withDupFormDifferentResolution = 0;
let withDupFormDifferentResolutionContent = 0;
let singleAnnMultiOccurrence = 0;
const cases: DupCase[] = [];

for (const [id, ex] of Object.entries(examples)) {
  if (!ex.annotations || ex.annotations.length < 2) continue;
  totalExamples++;

  const byForm = new Map<string, typeof ex.annotations>();
  for (const a of ex.annotations) {
    if (!byForm.has(a.form)) byForm.set(a.form, []);
    byForm.get(a.form)!.push(a);
  }

  let hasDup = false;
  let hasDupDiff = false;
  let hasDupDiffContent = false;

  for (const [form, anns] of byForm) {
    if (anns.length < 2) continue;
    hasDup = true;
    const sigs = new Set(anns.map(a => `${a.lemma}|${a.pos}|${a.gloss_hint ?? ""}`));
    if (sigs.size > 1) {
      hasDupDiff = true;
      const isContent = anns.every(a => CONTENT_POS.has(a.pos));
      if (isContent) {
        hasDupDiffContent = true;
        const occ = countOccurrences(ex.text, form);
        const annsCopy = anns.map(a => ({
          form: a.form,
          lemma: a.lemma,
          pos: a.pos,
          gloss_hint: a.gloss_hint ?? null,
        }));
        cases.push({
          id,
          text: ex.text,
          text_linked: ex.text_linked ?? null,
          dupForm: form,
          occurrencesInText: occ,
          anns: annsCopy,
          pattern: classify(annsCopy, occ),
        });
      }
    }
  }

  for (const [form, anns] of byForm) {
    if (anns.length === 1 && countOccurrences(ex.text, form) >= 2) {
      singleAnnMultiOccurrence++;
      break;
    }
  }

  if (hasDup) withDupForm++;
  if (hasDupDiff) withDupFormDifferentResolution++;
  if (hasDupDiffContent) withDupFormDifferentResolutionContent++;
}

// ── Headline counts ──
console.log(`Total examples (≥2 annotations): ${totalExamples}`);
console.log(`Examples with duplicate-form annotations: ${withDupForm}`);
console.log(`  ...with DIFFERENT resolution: ${withDupFormDifferentResolution}`);
console.log(`  ...DIFFERENT resolution AND all-content (noun/verb/adj): ${withDupFormDifferentResolutionContent}`);
console.log(`Examples with single ann but form appears ≥2× in text: ${singleAnnMultiOccurrence}`);

// ── Pattern breakdown ──
const patternCounts = new Map<string, number>();
for (const c of cases) patternCounts.set(c.pattern, (patternCounts.get(c.pattern) ?? 0) + 1);

console.log(`\n## Content-word duplicate-form patterns (${cases.length} total)`);
for (const [pat, n] of [...patternCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pat.padEnd(40)} ${n}`);
}

// ── Spot-check sample: 4 per pattern (deterministic) ──
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

const samples: DupCase[] = [];
const PER_PATTERN = 4;
for (const pat of patternCounts.keys()) {
  const pool = cases.filter(c => c.pattern === pat);
  samples.push(...shuffle(pool, 42).slice(0, PER_PATTERN));
}

console.log(`\n## Spot-check sample (${samples.length} cases, ${PER_PATTERN} per pattern)`);
for (const s of samples) {
  console.log(`\n  ── ${s.id}  [${s.pattern}]  form="${s.dupForm}"  occ=${s.occurrencesInText}  anns=${s.anns.length}`);
  console.log(`     text: ${s.text}`);
  console.log(`     text_linked: ${s.text_linked ?? "(none)"}`);
  for (const a of s.anns) {
    console.log(`     ann: lemma=${a.lemma} pos=${a.pos} hint=${a.gloss_hint ?? "(none)"}`);
  }
}

writeFileSync(
  "/tmp/dup-form-anns.json",
  JSON.stringify({ counts: Object.fromEntries(patternCounts), cases }, null, 2) + "\n",
);
console.log(`\nWrote ${cases.length} cases to /tmp/dup-form-anns.json`);
