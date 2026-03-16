/**
 * Clean up annotation noise in examples.json:
 *
 * 1. Remove annotations where lemma is an English word/phrase
 *    (no German chars + contains space, or is a known English-only word)
 * 2. Remove annotations where lemma is not in the SQLite index at all
 *    (word unknown to our B2 dictionary — annotation is meaningless to learner)
 * 3. Null out gloss_hint where it doesn't match any sense gloss of the word
 *    (prevents bad disambiguation)
 * 4. Remove punctuation-only annotations
 *
 * Dry run: node scripts/clean-annotations.js --dry-run
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { loadExamples, saveExamples } from "./lib/examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

// ── Load DB ──────────────────────────────────────────────────────────────────
const dbPath = join(ROOT, "data", "lexiklar.db");
const db = new Database(dbPath, { readonly: true });

// Build lemma → senses map from DB
// Also store as a Set for fast "is this word known?" lookup
console.log("Loading word index from SQLite...");
const wordMap = new Map(); // lemma (lowercase) → [{ gloss, gloss_en }]

const rows = db.prepare("SELECT lemma, data FROM words").all();
for (const row of rows) {
  const word = JSON.parse(row.data);
  const lemmaKey = row.lemma.toLowerCase();
  const senses = (word.senses || []).map((s) => s.gloss || "");
  if (!wordMap.has(lemmaKey)) wordMap.set(lemmaKey, []);
  wordMap.get(lemmaKey).push(...senses);
}
db.close();
console.log(`Loaded ${wordMap.size} lemmas.`);

// ── English detection ─────────────────────────────────────────────────────────
const DE_CHARS = /[äöüÄÖÜß]/;

// English pronouns/articles that look nothing like German words
const ENGLISH_ONLY = new Set([
  "he", "she", "they", "we", "you", "i",
  "the", "of the", "to the", "at the", "in the", "from the",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "shall",
  "his", "her", "their", "our", "your", "its", "my",
  "him", "them", "us",
]);

function isEnglishLemma(lemma) {
  if (!lemma) return false;
  if (DE_CHARS.test(lemma)) return false;           // Has German chars → definitely German
  if (lemma.includes(" ")) return true;             // Multi-word phrase → English translation leaked
  if (ENGLISH_ONLY.has(lemma.toLowerCase())) return true;
  return false;
}

function isPunctuation(form) {
  return /^[^\wäöüÄÖÜß]+$/.test(form);
}

// ── Process ──────────────────────────────────────────────────────────────────
console.log("Loading examples...");
const examples = loadExamples();

let stats = {
  total: 0,
  removedEnglish: 0,
  removedUnknown: 0,
  removedPunct: 0,
  nulledGlossHint: 0,
  examplesModified: 0,
};

for (const [id, ex] of Object.entries(examples)) {
  if (!ex.annotations?.length) continue;

  const before = JSON.stringify(ex.annotations);
  const cleaned = [];

  for (const ann of ex.annotations) {
    stats.total++;
    const form = ann.form || "";
    const lemma = ann.lemma || "";

    // 1. Remove punctuation
    if (isPunctuation(form)) {
      stats.removedPunct++;
      continue;
    }

    // 2. Remove English lemmas
    if (isEnglishLemma(lemma)) {
      stats.removedEnglish++;
      continue;
    }

    // 3. Remove if lemma not in our word index
    if (!wordMap.has(lemma.toLowerCase())) {
      stats.removedUnknown++;
      continue;
    }

    // 4. Null out gloss_hint if it doesn't match any sense
    let outAnn = ann;
    if (ann.gloss_hint) {
      const senses = wordMap.get(lemma.toLowerCase()) || [];
      const hint = ann.gloss_hint.toLowerCase();
      const matches = senses.some((g) => g.toLowerCase().includes(hint));
      if (!matches) {
        outAnn = { ...ann, gloss_hint: null };
        stats.nulledGlossHint++;
      }
    }

    cleaned.push(outAnn);
  }

  if (JSON.stringify(cleaned) !== before) {
    stats.examplesModified++;
    if (!DRY_RUN) {
      ex.annotations = cleaned;
    }
  }
}

console.log("\n── Results ─────────────────────────────────────────────");
console.log(`Total annotations scanned:    ${stats.total.toLocaleString()}`);
console.log(`Removed (punctuation):        ${stats.removedPunct.toLocaleString()}`);
console.log(`Removed (English lemma):      ${stats.removedEnglish.toLocaleString()}`);
console.log(`Removed (not in B2 index):    ${stats.removedUnknown.toLocaleString()}`);
console.log(`Nulled gloss_hint (no match): ${stats.nulledGlossHint.toLocaleString()}`);
console.log(`Examples modified:            ${stats.examplesModified.toLocaleString()}`);

if (DRY_RUN) {
  console.log("\nDry run — no changes written.");
} else {
  console.log("\nWriting examples...");
  saveExamples(examples);
  console.log("Done.");
}
