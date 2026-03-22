/**
 * Apply proofreading results written by the review subagent.
 *
 * Reads data/proofread-results.json and writes _proofread flags into
 * example shard files and word files.
 *
 * Results format:
 * {
 *   "verified": ["id1", "id2"],        // translation + annotations both correct
 *   "translation_ok": ["id3"],         // only translation verified (annotation issues)
 *   "word_glosses_ok": ["nouns/Tisch"] // gloss_en + gloss_en_full verified for this word
 *   "issues": [
 *     {"id": "id4", "type": "translation"|"annotation", "detail": "..."},
 *     {"word": "nouns/Tisch", "type": "gloss", "sense": 0, "detail": "..."}
 *   ],
 *   "fixes": [
 *     {"type": "gloss_fix", "word": "nouns/Tisch", "sense": 0, "field": "gloss_en", "value": "..."},
 *     {"type": "translation_fix", "id": "exId", "value": "new translation"},
 *     {"type": "annotation_replace", "id": "exId", "annotations": [...]},
 *     {"type": "annotation_update", "id": "exId", "form": "word", "updates": {"lemma": "..."}},
 *     {"type": "annotation_remove", "id": "exId", "form": "word"},
 *     {"type": "word_field_fix", "word": "nouns/Foo", "field": "plural_form", "value": "..."},
 *     {"type": "synonyms_en_fix", "word": "nouns/Foo", "sense": 0, "value": ["synonym1", "synonym2"]}
 *   ]
 * }
 *
 * Usage:
 *   node scripts/apply-proofread-results.js
 *   node scripts/apply-proofread-results.js --results data/proofread-results.json
 *   node scripts/apply-proofread-results.js --dry-run
 *   node scripts/apply-proofread-results.js --cleanup   # delete results file after apply if no issues
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { loadExamplesByIds, annotationsHash, patchExamples } from "./lib/examples.js";
import type { ExamplePatch } from "./lib/examples.js";
import type { Annotation, Example } from "../types/example.js";
import type { Word, Sense } from "../types/word.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CLEANUP = args.includes("--cleanup");
const resultsIdx = args.indexOf("--results");
const RESULTS_FILE = resultsIdx !== -1
  ? args[resultsIdx + 1]!
  : join(ROOT, "data", "proofread-results.json");
const modelIdx = args.indexOf("--model");
const MODEL = modelIdx !== -1 ? args[modelIdx + 1]! : "claude-sonnet-4-6";

if (!existsSync(RESULTS_FILE)) {
  console.error(`Results file not found: ${RESULTS_FILE}`);
  process.exit(1);
}

// -- Result types -------------------------------------------------------------

interface ProofreadIssue {
  id?: string;
  word?: string;
  type: string;
  sense?: number;
  field?: string;
  value?: unknown;
  detail?: string;
}

interface GlossFix {
  type: "gloss_fix";
  word: string;
  sense: number;
  field?: string;
  value: string;
  model?: string;
}

interface TranslationFix {
  type: "translation_fix";
  id: string;
  value: string;
  model?: string;
}

interface AnnotationReplaceFix {
  type: "annotation_replace";
  id: string;
  annotations: Annotation[];
  form?: string;
}

interface AnnotationUpdateFix {
  type: "annotation_update";
  id: string;
  form: string;
  updates: Partial<Annotation>;
}

interface AnnotationRemoveFix {
  type: "annotation_remove";
  id: string;
  form: string;
}

interface WordFieldFix {
  type: "word_field_fix";
  word: string;
  field: string;
  value: unknown;
  id?: never;
  form?: never;
}

interface SynonymsEnFix {
  type: "synonyms_en_fix";
  word: string;
  sense: number;
  value: string[];
  detail?: string;
}

type Fix =
  | GlossFix
  | TranslationFix
  | AnnotationReplaceFix
  | AnnotationUpdateFix
  | AnnotationRemoveFix
  | WordFieldFix
  | SynonymsEnFix;

interface GrammarOverride {
  type: "grammar_override";
  word: string;
  field: string;
  value: unknown;
}

interface ProofreadResults {
  verified?: string[];
  translation_ok?: string[];
  word_glosses_ok?: string[];
  issues?: ProofreadIssue[];
  fixes?: Fix[];
}

const results: ProofreadResults = JSON.parse(readFileSync(RESULTS_FILE, "utf-8")) as ProofreadResults;
const verified = Array.isArray(results.verified) ? results.verified : [];
const translationOk = Array.isArray(results.translation_ok) ? results.translation_ok : [];
const wordGlossesOk = Array.isArray(results.word_glosses_ok) ? results.word_glosses_ok : [];
const issues = Array.isArray(results.issues) ? results.issues : [];

console.log(`Results: ${verified.length} fully verified, ${translationOk.length} translation-only, ${wordGlossesOk.length} word glosses, ${issues.length} issues`);

// -- Example patches ----------------------------------------------------------

const allIds = [...new Set([...verified, ...translationOk])];
const examplesById = allIds.length > 0 ? loadExamplesByIds(allIds) : {};

const patches: Record<string, ExamplePatch> = {};

for (const id of verified) {
  const ex = examplesById[id];
  if (!ex) { console.warn(`  Warning: example ${id} not found`); continue; }
  patches[id] = {
    _proofread: {
      translation: true,
      ...(ex.annotations ? { annotations: annotationsHash(ex.annotations) } : {}),
    },
  };
}

for (const id of translationOk) {
  if (patches[id]) continue; // already in verified
  patches[id] = { _proofread: { translation: true } };
}

if (!DRY_RUN && Object.keys(patches).length > 0) {
  patchExamples(patches);
}
console.log(`  ${DRY_RUN ? "[dry] " : ""}Patched ${Object.keys(patches).length} examples`);

// -- Word-level gloss flags ---------------------------------------------------

function exampleIdsHash(data: Word): string {
  const ids: string[] = [];
  for (const sense of data.senses || []) {
    for (const id of sense.example_ids || []) ids.push(id);
  }
  for (const id of data.expression_ids || []) ids.push(id);
  ids.sort();
  return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 8);
}

let wordsMark = 0;
for (const relPath of wordGlossesOk) {
  const filePath = join(WORDS_DIR, `${relPath}.json`);
  if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${relPath}`); continue; }
  let data: Word;
  try { data = JSON.parse(readFileSync(filePath, "utf-8")) as Word; } catch { continue; }

  const translatableSenses = (data.senses || []).filter((s: Sense) => s.gloss);
  const allSensesHaveGlossEn = translatableSenses.every((s: Sense) => s.gloss_en);
  const allSensesHaveGlossEnFull = translatableSenses.every((s: Sense) => s.gloss_en_full);
  const sensesWithSynonymsEn = translatableSenses.filter((s: Sense) => s.synonyms_en?.length);
  const allSynonymsEnProofread = sensesWithSynonymsEn.length > 0;

  const proofread = { ...(data._proofread || {}) };
  if (allSensesHaveGlossEn) proofread.gloss_en = true;
  if (allSensesHaveGlossEnFull) proofread.gloss_en_full = true;
  if (allSynonymsEnProofread) proofread.synonyms_en = true;

  if (!DRY_RUN) {
    writeFileSync(filePath, JSON.stringify({ ...data, _proofread: proofread }, null, 2) + "\n");
  }
  wordsMark++;
}
console.log(`  ${DRY_RUN ? "[dry] " : ""}Marked glosses on ${wordsMark} word files`);

// -- Gloss fixes --------------------------------------------------------------
// Issues with type "gloss_fix" carry { word, sense, field, value } and are
// applied directly to the word file's senses array.
// field defaults to "gloss_en". sense is 0-based index.

const glossFixes = (results.fixes || []).filter((f): f is GlossFix => f.type === "gloss_fix");
let glossFixMark = 0;
for (const fix of glossFixes) {
  if (!fix.word || fix.sense == null || !fix.value) continue;
  const filePath = join(WORDS_DIR, `${fix.word}.json`);
  if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${fix.word}`); continue; }
  let data: Word;
  try { data = JSON.parse(readFileSync(filePath, "utf-8")) as Word; } catch { continue; }
  const field = fix.field || "gloss_en";
  if (!data.senses || data.senses.length <= fix.sense) { console.warn(`  Warning: no sense ${fix.sense} in ${fix.word}`); continue; }
  const sense = data.senses[fix.sense] as unknown as Record<string, unknown>;
  const old = sense[field];
  sense[field] = fix.value;
  sense[field + "_model"] = fix.model || MODEL;
  if (!DRY_RUN) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ${DRY_RUN ? "[dry] " : ""}Gloss fix ${fix.word} sense ${fix.sense} ${field}: ${JSON.stringify(old)} \u2192 ${JSON.stringify(fix.value)}`);
  glossFixMark++;
}
if (glossFixMark > 0) console.log(`  Applied ${glossFixMark} gloss fixes`);

// -- Synonyms-EN fixes --------------------------------------------------------
// Issues with type "synonyms_en_fix" carry { word, sense, value } and replace
// the synonyms_en array on the specified sense.

const synonymsEnFixes = (results.fixes || []).filter((f): f is SynonymsEnFix => f.type === "synonyms_en_fix");
let synonymsEnFixMark = 0;
for (const fix of synonymsEnFixes) {
  if (!fix.word || fix.sense == null || !fix.value) continue;
  const filePath = join(WORDS_DIR, `${fix.word}.json`);
  if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${fix.word}`); continue; }
  let data: Word;
  try { data = JSON.parse(readFileSync(filePath, "utf-8")) as Word; } catch { continue; }
  if (!data.senses || data.senses.length <= fix.sense) { console.warn(`  Warning: no sense ${fix.sense} in ${fix.word}`); continue; }
  const sense = data.senses[fix.sense] as unknown as Record<string, unknown>;
  const old = sense.synonyms_en;
  sense.synonyms_en = fix.value;
  if (!DRY_RUN) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ${DRY_RUN ? "[dry] " : ""}Synonyms-EN fix ${fix.word} sense ${fix.sense}: ${JSON.stringify(old)} → ${JSON.stringify(fix.value)}`);
  synonymsEnFixMark++;
}
if (synonymsEnFixMark > 0) console.log(`  Applied ${synonymsEnFixMark} synonyms_en fixes`);

// -- Translation fixes --------------------------------------------------------
// issues with type "translation_fix" carry { id, value } and patch the example's translation field.

const translationFixes = (results.fixes || []).filter((f): f is TranslationFix => f.type === "translation_fix");
if (translationFixes.length > 0) {
  const tFixIds = translationFixes.map((f) => f.id);
  const tFixExamples = loadExamplesByIds(tFixIds);
  const tPatches: Record<string, ExamplePatch> = {};
  for (const fix of translationFixes) {
    if (!fix.id || fix.value === undefined) continue;
    if (!tFixExamples[fix.id]) { console.warn(`  Warning: example not found: ${fix.id}`); continue; }
    tPatches[fix.id] = { translation: fix.value, translation_model: fix.model || MODEL };
    console.log(`  ${DRY_RUN ? "[dry] " : ""}Translation fix ${fix.id}: ${JSON.stringify(fix.value).slice(0, 60)}`);
  }
  if (!DRY_RUN && Object.keys(tPatches).length > 0) patchExamples(tPatches);
  console.log(`  Applied ${Object.keys(tPatches).length} translation fixes`);
}

// -- Annotation fixes ---------------------------------------------------------
// fixes with type "annotation_replace" carry { id, annotations } and replace the full annotations array.
// fixes with type "annotation_update" carry { id, form, updates } and patch a specific annotation.
// fixes with type "annotation_remove" carry { id, form } and remove a matching annotation.
// fixes with type "word_field_fix" carry { word, field, value } and patch a top-level word field.

type AnnotationFixType = AnnotationReplaceFix | AnnotationUpdateFix | AnnotationRemoveFix | WordFieldFix;

const annotationFixes = (results.fixes || []).filter(
  (f): f is AnnotationFixType =>
    ["annotation_replace", "annotation_update", "annotation_remove", "word_field_fix"].includes(f.type)
);
if (annotationFixes.length > 0) {
  const annIds = [...new Set(annotationFixes.filter((f): f is AnnotationReplaceFix | AnnotationUpdateFix | AnnotationRemoveFix => !!f.id).map((f) => f.id))];
  const annExamples = annIds.length > 0 ? loadExamplesByIds(annIds) : {};
  const annPatches: Record<string, ExamplePatch> = {};

  for (const fix of annotationFixes) {
    if (fix.type === "word_field_fix") {
      if (!fix.word || !fix.field) continue;
      const filePath = join(WORDS_DIR, `${fix.word}.json`);
      if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${fix.word}`); continue; }
      let data: Record<string, unknown>;
      try { data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>; } catch { continue; }
      const old = data[fix.field];
      data[fix.field] = fix.value;
      if (!DRY_RUN) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      console.log(`  ${DRY_RUN ? "[dry] " : ""}Word field fix ${fix.word} ${fix.field}: ${JSON.stringify(old)} \u2192 ${JSON.stringify(fix.value)}`);
      continue;
    }

    if (!fix.id) continue;
    const ex = annExamples[fix.id];
    if (!ex) { console.warn(`  Warning: example not found: ${fix.id}`); continue; }

    if (!annPatches[fix.id]) annPatches[fix.id] = {};

    if (fix.type === "annotation_replace") {
      annPatches[fix.id].annotations = fix.annotations;
    } else if (fix.type === "annotation_update") {
      const existing: Annotation[] = ex.annotations || [];
      const updated = existing.map((a) =>
        a.form === fix.form ? { ...a, ...fix.updates } : a
      );
      annPatches[fix.id].annotations = updated;
    } else if (fix.type === "annotation_remove") {
      const existing: Annotation[] = (annPatches[fix.id].annotations as Annotation[] | undefined) || ex.annotations || [];
      annPatches[fix.id].annotations = existing.filter((a) => a.form !== fix.form);
    }
    console.log(`  ${DRY_RUN ? "[dry] " : ""}Annotation fix ${fix.type} ${fix.id} form=${fix.form || "(replace)"}`);
  }

  if (!DRY_RUN && Object.keys(annPatches).length > 0) patchExamples(annPatches);
}

// -- Grammar overrides --------------------------------------------------------
// Issues with type "grammar_override" carry { word, field, value } and are
// applied as _overrides so they survive re-transform.
// Nested fields use dot notation: "principal_parts.past_participle"

const grammarOverrides = (results.issues || []).filter(
  (i): i is ProofreadIssue & GrammarOverride => i.type === "grammar_override"
);
let overridesMark = 0;
for (const issue of grammarOverrides) {
  if (!issue.word || !issue.field || issue.value === undefined) continue;
  const filePath = join(WORDS_DIR, `${issue.word}.json`);
  if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${issue.word}`); continue; }
  let data: Record<string, unknown>;
  try { data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>; } catch { continue; }

  // Apply override to the live field
  const parts = issue.field.split(".");
  if (parts.length === 1) {
    data[parts[0]] = issue.value;
  } else if (parts.length === 2) {
    const parent = data[parts[0]];
    if (parent && typeof parent === "object") {
      (parent as Record<string, unknown>)[parts[1]] = issue.value;
    }
  }

  // Persist in _overrides so re-transform re-applies it
  const overrides = { ...((data._overrides as Record<string, unknown>) || {}) };
  if (parts.length === 1) {
    overrides[parts[0]] = issue.value;
  } else if (parts.length === 2) {
    overrides[parts[0]] = { ...((overrides[parts[0]] as Record<string, unknown>) || {}), [parts[1]]: issue.value };
  }
  data._overrides = overrides;

  if (!DRY_RUN) {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  }
  console.log(`  ${DRY_RUN ? "[dry] " : ""}Override ${issue.word} ${issue.field} = ${JSON.stringify(issue.value)}`);
  overridesMark++;
}
if (overridesMark > 0) console.log(`  ${DRY_RUN ? "[dry] " : ""}Applied ${overridesMark} grammar overrides`);

// -- Print issues summary -----------------------------------------------------

if (issues.length > 0) {
  console.log(`\n  Issues logged (${issues.length}) \u2014 not marked, need attention:`);
  for (const issue of issues) {
    if (issue.id) {
      const ex = examplesById[issue.id] || {} as Partial<Example>;
      const preview = ((ex as Example).text || "").slice(0, 60);
      console.log(`    [${issue.type}] ${issue.id}  "${preview}"`);
    } else if (issue.word) {
      console.log(`    [${issue.type}] ${issue.word} sense ${issue.sense ?? "?"}`);
    }
    if (issue.detail) console.log(`      \u2192 ${issue.detail}`);
  }
}

console.log(`\nDone.${DRY_RUN ? " (dry run)" : ""}`);

// -- Cleanup ------------------------------------------------------------------
// Delete the results file if --cleanup is set and there are no unresolved issues.

if (CLEANUP && !DRY_RUN) {
  if (issues.length === 0) {
    unlinkSync(RESULTS_FILE);
    console.log(`  Deleted ${RESULTS_FILE}`);
  } else {
    console.log(`  Skipped cleanup \u2014 ${issues.length} issue(s) still need attention.`);
  }
}
