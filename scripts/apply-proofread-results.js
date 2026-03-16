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
 *   ]
 * }
 *
 * Usage:
 *   node scripts/apply-proofread-results.js
 *   node scripts/apply-proofread-results.js --results data/proofread-results.json
 *   node scripts/apply-proofread-results.js --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { loadExamplesByIds, annotationsHash, patchExamples } from "./lib/examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const resultsIdx = args.indexOf("--results");
const RESULTS_FILE = resultsIdx !== -1
  ? args[resultsIdx + 1]
  : join(ROOT, "data", "proofread-results.json");

if (!existsSync(RESULTS_FILE)) {
  console.error(`Results file not found: ${RESULTS_FILE}`);
  process.exit(1);
}

const results = JSON.parse(readFileSync(RESULTS_FILE, "utf-8"));
const verified = results.verified || [];
const translationOk = results.translation_ok || [];
const wordGlossesOk = results.word_glosses_ok || [];
const issues = results.issues || [];

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
