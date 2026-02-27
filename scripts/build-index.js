import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { stripReferences } from "./lib/references.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const DB_PATH = join(DATA_DIR, "index.db");
const EXAMPLES_FILE = join(DATA_DIR, "examples.json");

function findJsonFiles() {
  const results = [];
  for (const dir of ["nouns", "verbs", "adjectives"]) {
    const fullDir = join(DATA_DIR, "words", dir);
    if (!existsSync(fullDir)) continue;
    for (const file of readdirSync(fullDir)) {
      if (file.endsWith(".json")) {
        results.push(join(fullDir, file));
      }
    }
  }
  return results;
}

// ============================================================
// Cross-reference resolution for examples
// ============================================================

/**
 * Build a lookup from "lemma|pos" → [{posDir, file, senses}].
 * Handles homonyms (multiple entries per key).
 */
function buildWordLookup(files) {
  const lookup = new Map();

  for (const filePath of files) {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const relPath = relative(DATA_DIR, filePath);
    const parts = relPath.split("/");
    const posDir = parts[1];
    const file = parts[2].replace(".json", "");
    const key = `${data.word}|${data.pos}`;

    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push({
      posDir,
      file,
      senses: data.senses || [],
    });
  }

  return lookup;
}

/**
 * Resolve an annotation to a word file path + optional sense number.
 * Returns {posDir, file, senseNumber} or null.
 */
function resolveWordFile(lemma, pos, glossHint, lookup) {
  const key = `${lemma}|${pos}`;
  const entries = lookup.get(key);
  if (!entries || entries.length === 0) return null;

  // Single match — no disambiguation needed
  let entry = entries[0];
  let senseNumber = null;

  if (glossHint) {
    const hintLower = glossHint.toLowerCase();

    // Try to find the right entry (for homonyms) and the right sense
    for (const candidate of entries) {
      for (let i = 0; i < candidate.senses.length; i++) {
        const gloss = candidate.senses[i].gloss;
        if (gloss && gloss.toLowerCase().includes(hintLower)) {
          entry = candidate;
          senseNumber = i + 1; // 1-based
          break;
        }
      }
      if (senseNumber) break;
    }
  }

  return { posDir: entry.posDir, file: entry.file, senseNumber };
}

/**
 * Find a form in text using word-boundary-aware matching.
 * Returns the start index or -1.
 */
function findFormInText(text, form, startAfter) {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?<![\\wäöüÄÖÜß])${escaped}(?![\\wäöüÄÖÜß])`,
    "u",
  );
  const slice = text.slice(startAfter);
  const match = slice.match(re);
  return match ? startAfter + match.index : -1;
}

/**
 * Convert annotations into [[display|path]] reference tokens.
 * Returns the linked text, or null if no links were generated.
 */
function annotateExampleText(text, annotations, lookup) {
  if (!annotations || annotations.length === 0) return null;

  const matches = [];

  for (const ann of annotations) {
    const target = resolveWordFile(ann.lemma, ann.pos, ann.gloss_hint, lookup);
    if (!target) continue;

    const idx = findFormInText(text, ann.form, 0);
    if (idx === -1) continue;

    let token = `[[${ann.form}|${target.posDir}/${target.file}`;
    if (target.senseNumber) token += `#${target.senseNumber}`;
    token += "]]";

    matches.push({
      start: idx,
      end: idx + ann.form.length,
      token,
    });
  }

  if (matches.length === 0) return null;

  // Sort by position, remove overlaps
  matches.sort((a, b) => a.start - b.start);
  const filtered = [matches[0]];
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].start >= filtered[filtered.length - 1].end) {
      filtered.push(matches[i]);
    }
  }

  // Build result string
  let result = "";
  let pos = 0;
  for (const m of filtered) {
    result += text.slice(pos, m.start) + m.token;
    pos = m.end;
  }
  result += text.slice(pos);

  return result;
}

// ============================================================
// Main
// ============================================================

function main() {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE search_index (
      id              INTEGER PRIMARY KEY,
      lemma           TEXT NOT NULL,
      pos             TEXT NOT NULL,
      gender          TEXT,
      frequency       INTEGER,
      gender_rule_id  TEXT,
      is_exception    INTEGER,
      file_path       TEXT NOT NULL,
      gloss_en        TEXT
    );
    CREATE INDEX idx_lemma       ON search_index(lemma);
    CREATE INDEX idx_frequency   ON search_index(frequency);
    CREATE INDEX idx_gender      ON search_index(gender);
    CREATE INDEX idx_gender_rule ON search_index(gender_rule_id);
  `);

  const insert = db.prepare(`
    INSERT INTO search_index (lemma, pos, gender, frequency, gender_rule_id, is_exception, file_path, gloss_en)
    VALUES (@lemma, @pos, @gender, @frequency, @gender_rule_id, @is_exception, @file_path, @gloss_en)
  `);

  const files = findJsonFiles();
  const entries = [];

  // Manifest for app-side search (JSON, no sql.js dependency needed)
  const manifest = [];

  for (const filePath of files) {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const relPath = relative(DATA_DIR, filePath);
    // relPath is like "words/nouns/Tisch.json"
    const parts = relPath.split("/"); // ["words", "nouns", "Tisch.json"]
    const posDir = parts[1];          // "nouns" | "verbs" | "adjectives"
    const file   = parts[2].replace(".json", "");

    // Collect all English translations across senses
    const glossEn = (data.senses || [])
      .map((s) => s.gloss_en)
      .filter(Boolean);

    entries.push({
      lemma: data.word,
      pos: data.pos.toUpperCase(),
      gender: data.gender || null,
      frequency: data.frequency || null,
      gender_rule_id: data.gender_rule?.rule_id || null,
      is_exception: data.gender_rule?.is_exception ? 1 : 0,
      file_path: relPath,
      gloss_en: glossEn.join(", ") || null,
    });

    manifest.push({
      lemma: data.word,
      pos: data.pos.toUpperCase(),
      gender: data.gender || null,
      posDir,
      file,
      glossEn,
    });
  }

  // Sort manifest by frequency (lower rank = more common) then alphabetically
  manifest.sort((a, b) => {
    const fa = entries.find((e) => e.lemma === a.lemma)?.frequency ?? Infinity;
    const fb = entries.find((e) => e.lemma === b.lemma)?.frequency ?? Infinity;
    if (fa !== fb) return fa - fb;
    return a.lemma.localeCompare(b.lemma, "de");
  });

  const insertAll = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertAll(entries);

  db.close();
  console.log(`Built index.db with ${entries.length} entries.`);

  // Write search manifest
  const manifestPath = join(DATA_DIR, "search-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(`Wrote search-manifest.json with ${manifest.length} entries.`);

  // Phase 3: Generate text_linked in examples from annotations
  if (existsSync(EXAMPLES_FILE)) {
    const examples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));
    const lookup = buildWordLookup(files);
    let linkedCount = 0;

    for (const [id, ex] of Object.entries(examples)) {
      // One-time migration: move manual refs from text to text_linked
      if (ex.text.includes("[[") && !ex.text_linked) {
        ex.text_linked = ex.text;
        ex.text = stripReferences(ex.text);
      }

      if (!ex.annotations || ex.annotations.length === 0) {
        delete ex.text_linked;
        continue;
      }

      const textLinked = annotateExampleText(ex.text, ex.annotations, lookup);
      if (textLinked && textLinked !== ex.text) {
        ex.text_linked = textLinked;
        linkedCount++;
      } else {
        delete ex.text_linked;
      }
    }

    // Write back sorted by key
    const sorted = {};
    for (const key of Object.keys(examples).sort()) {
      sorted[key] = examples[key];
    }
    writeFileSync(EXAMPLES_FILE, JSON.stringify(sorted, null, 2));
    console.log(`Linked ${linkedCount} examples with cross-references.`);
  }
}

main();
