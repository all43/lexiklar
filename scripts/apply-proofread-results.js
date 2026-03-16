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
 *     {"type": "word_field_fix", "word": "nouns/Foo", "field": "plural_form", "value": "..."}
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CLEANUP = args.includes("--cleanup");
const resultsIdx = args.indexOf("--results");
const RESULTS_FILE = resultsIdx !== -1
  ? args[resultsIdx + 1]
  : join(ROOT, "data", "proofread-results.json");

if (!existsSync(RESULTS_FILE)) {
  console.error(`Results file not found: ${RESULTS_FILE}`);
  process.exit(1);
}

const results = JSON.parse(readFileSync(RESULTS_FILE, "utf-8"));
const verified = Array.isArray(results.verified) ? results.verified : [];
const translationOk = Array.isArray(results.translation_ok) ? results.translation_ok : [];
const wordGlossesOk = Array.isArray(results.word_glosses_ok) ? results.word_glosses_ok : [];
const issues = Array.isArray(results.issues) ? results.issues : [];

console.log(`Results: ${verified.length} fully verified, ${translationOk.length} translation-only, ${wordGlossesOk.length} word glosses, ${issues.length} issues`);

// ── Example patches ───────────────────────────────────────────────────────────

const allIds = [...new Set([...verified, ...translationOk])];
const examplesById = allIds.length > 0 ? loadExamplesByIds(allIds) : {};

const patches = {};

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

// ── Word-level gloss flags ────────────────────────────────────────────────────

function exampleIdsHash(data) {
  const ids = [];
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
  let data;
  try { data = JSON.parse(readFileSync(filePath, "utf-8")); } catch { continue; }

  const allSensesHaveGlossEn = (data.senses || []).every((s) => s.gloss_en);
  const allSensesHaveGlossEnFull = (data.senses || []).every((s) => s.gloss_en_full);

  const proofread = { ...(data._proofread || {}) };
  if (allSensesHaveGlossEn) proofread.gloss_en = true;
  if (allSensesHaveGlossEnFull) proofread.gloss_en_full = true;

  if (!DRY_RUN) {
    writeFileSync(filePath, JSON.stringify({ ...data, _proofread: proofread }, null, 2) + "\n");
  }
  wordsMark++;
}
console.log(`  ${DRY_RUN ? "[dry] " : ""}Marked glosses on ${wordsMark} word files`);

// ── Gloss fixes ───────────────────────────────────────────────────────────────
// Issues with type "gloss_fix" carry { word, sense, field, value } and are
// applied directly to the word file's senses array.
// field defaults to "gloss_en". sense is 0-based index.

const glossFixes = (results.fixes || []).filter((f) => f.type === "gloss_fix");
let glossFixMark = 0;
for (const fix of glossFixes) {
  if (!fix.word || fix.sense == null || !fix.value) continue;
  const filePath = join(WORDS_DIR, `${fix.word}.json`);
  if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${fix.word}`); continue; }
  let data;
  try { data = JSON.parse(readFileSync(filePath, "utf-8")); } catch { continue; }
  const field = fix.field || "gloss_en";
  if (!data.senses || data.senses.length <= fix.sense) { console.warn(`  Warning: no sense ${fix.sense} in ${fix.word}`); continue; }
  const old = data.senses[fix.sense][field];
  data.senses[fix.sense][field] = fix.value;
  if (!DRY_RUN) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ${DRY_RUN ? "[dry] " : ""}Gloss fix ${fix.word} sense ${fix.sense} ${field}: ${JSON.stringify(old)} → ${JSON.stringify(fix.value)}`);
  glossFixMark++;
}
if (glossFixMark > 0) console.log(`  Applied ${glossFixMark} gloss fixes`);

// ── Translation fixes ─────────────────────────────────────────────────────────
// issues with type "translation_fix" carry { id, value } and patch the example's translation field.

const translationFixes = (results.fixes || []).filter((f) => f.type === "translation_fix");
if (translationFixes.length > 0) {
  const tFixIds = translationFixes.map((f) => f.id);
  const tFixExamples = loadExamplesByIds(tFixIds);
  const tPatches = {};
  for (const fix of translationFixes) {
    if (!fix.id || fix.value === undefined) continue;
    if (!tFixExamples[fix.id]) { console.warn(`  Warning: example not found: ${fix.id}`); continue; }
    tPatches[fix.id] = { translation: fix.value };
    console.log(`  ${DRY_RUN ? "[dry] " : ""}Translation fix ${fix.id}: ${JSON.stringify(fix.value).slice(0, 60)}`);
  }
  if (!DRY_RUN && Object.keys(tPatches).length > 0) patchExamples(tPatches);
  console.log(`  Applied ${Object.keys(tPatches).length} translation fixes`);
}

// ── Annotation fixes ──────────────────────────────────────────────────────────
// fixes with type "annotation_replace" carry { id, annotations } and replace the full annotations array.
// fixes with type "annotation_update" carry { id, form, updates } and patch a specific annotation.
// fixes with type "annotation_remove" carry { id, form } and remove a matching annotation.
// fixes with type "word_field_fix" carry { word, field, value } and patch a top-level word field.

const annotationFixes = (results.fixes || []).filter((f) =>
  ["annotation_replace", "annotation_update", "annotation_remove", "word_field_fix"].includes(f.type)
);
if (annotationFixes.length > 0) {
  const annIds = [...new Set(annotationFixes.filter((f) => f.id).map((f) => f.id))];
  const annExamples = annIds.length > 0 ? loadExamplesByIds(annIds) : {};
  const annPatches = {};

  for (const fix of annotationFixes) {
    if (fix.type === "word_field_fix") {
      if (!fix.word || !fix.field) continue;
      const filePath = join(WORDS_DIR, `${fix.word}.json`);
      if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${fix.word}`); continue; }
      let data;
      try { data = JSON.parse(readFileSync(filePath, "utf-8")); } catch { continue; }
      const old = data[fix.field];
      data[fix.field] = fix.value;
      if (!DRY_RUN) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      console.log(`  ${DRY_RUN ? "[dry] " : ""}Word field fix ${fix.word} ${fix.field}: ${JSON.stringify(old)} → ${JSON.stringify(fix.value)}`);
      continue;
    }

    if (!fix.id) continue;
    const ex = annExamples[fix.id];
    if (!ex) { console.warn(`  Warning: example not found: ${fix.id}`); continue; }

    if (!annPatches[fix.id]) annPatches[fix.id] = {};

    if (fix.type === "annotation_replace") {
      annPatches[fix.id].annotations = fix.annotations;
    } else if (fix.type === "annotation_update") {
      const existing = ex.annotations || [];
      const updated = existing.map((a) =>
        a.form === fix.form ? { ...a, ...fix.updates } : a
      );
      annPatches[fix.id].annotations = updated;
      // merge with any prior replace in same patch
      if (annPatches[fix.id].annotations) {
        // already set above
      }
    } else if (fix.type === "annotation_remove") {
      const existing = (annPatches[fix.id].annotations || ex.annotations || []);
      annPatches[fix.id].annotations = existing.filter((a) => a.form !== fix.form);
    }
    console.log(`  ${DRY_RUN ? "[dry] " : ""}Annotation fix ${fix.type} ${fix.id} form=${fix.form || "(replace)"}`);
  }

  if (!DRY_RUN && Object.keys(annPatches).length > 0) patchExamples(annPatches);
}

// ── Grammar overrides ─────────────────────────────────────────────────────────
// Issues with type "grammar_override" carry { word, field, value } and are
// applied as _overrides so they survive re-transform.
// Nested fields use dot notation: "principal_parts.past_participle"

const grammarOverrides = (results.issues || []).filter((i) => i.type === "grammar_override");
let overridesMark = 0;
for (const issue of grammarOverrides) {
  if (!issue.word || !issue.field || issue.value === undefined) continue;
  const filePath = join(WORDS_DIR, `${issue.word}.json`);
  if (!existsSync(filePath)) { console.warn(`  Warning: word file not found: ${issue.word}`); continue; }
  let data;
  try { data = JSON.parse(readFileSync(filePath, "utf-8")); } catch { continue; }

  // Apply override to the live field
  const parts = issue.field.split(".");
  if (parts.length === 1) {
    data[parts[0]] = issue.value;
  } else if (parts.length === 2) {
    if (data[parts[0]] && typeof data[parts[0]] === "object") {
      data[parts[0]][parts[1]] = issue.value;
    }
  }

  // Persist in _overrides so re-transform re-applies it
  const overrides = { ...(data._overrides || {}) };
  if (parts.length === 1) {
    overrides[parts[0]] = issue.value;
  } else if (parts.length === 2) {
    overrides[parts[0]] = { ...(overrides[parts[0]] || {}), [parts[1]]: issue.value };
  }
  data._overrides = overrides;

  if (!DRY_RUN) {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  }
  console.log(`  ${DRY_RUN ? "[dry] " : ""}Override ${issue.word} ${issue.field} = ${JSON.stringify(issue.value)}`);
  overridesMark++;
}
if (overridesMark > 0) console.log(`  ${DRY_RUN ? "[dry] " : ""}Applied ${overridesMark} grammar overrides`);

// ── Print issues summary ──────────────────────────────────────────────────────

if (issues.length > 0) {
  console.log(`\n  Issues logged (${issues.length}) — not marked, need attention:`);
  for (const issue of issues) {
    if (issue.id) {
      const ex = examplesById[issue.id] || {};
      const preview = (ex.text || "").slice(0, 60);
      console.log(`    [${issue.type}] ${issue.id}  "${preview}"`);
    } else if (issue.word) {
      console.log(`    [${issue.type}] ${issue.word} sense ${issue.sense ?? "?"}`);
    }
    if (issue.detail) console.log(`      → ${issue.detail}`);
  }
}

console.log(`\nDone.${DRY_RUN ? " (dry run)" : ""}`);

// ── Cleanup ───────────────────────────────────────────────────────────────────
// Delete the results file if --cleanup is set and there are no unresolved issues.

if (CLEANUP && !DRY_RUN) {
  if (issues.length === 0) {
    unlinkSync(RESULTS_FILE);
    console.log(`  Deleted ${RESULTS_FILE}`);
  } else {
    console.log(`  Skipped cleanup — ${issues.length} issue(s) still need attention.`);
  }
}
