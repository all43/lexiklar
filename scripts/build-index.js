/**
 * Build the production SQLite database (lexiklar.db) from JSON word files.
 *
 * Packs ALL data needed by the app into a single database:
 *   - words table: full word JSON with pre-computed conjugation + search columns
 *   - examples table: individual examples (not the entire examples.json)
 *   - word_forms table: pre-computed inflected forms for search (verbs + nouns)
 *   - meta table: version hash for OPFS cache invalidation
 *
 * Also resolves cross-references in examples (text_linked) and writes
 * the updated examples.json back to disk.
 *
 * Usage: node scripts/build-index.js
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  existsSync,
} from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { stripReferences } from "./lib/references.js";
import { POS_DIRS } from "./lib/pos.js";
import { computeConjugation, computeAllForms } from "../src/utils/verb-forms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const DB_PATH = join(DATA_DIR, "lexiklar.db");
const EXAMPLES_FILE = join(DATA_DIR, "examples.json");
const VERB_ENDINGS_FILE = join(DATA_DIR, "rules", "verb-endings.json");

function findJsonFiles() {
  const results = [];
  for (const dir of POS_DIRS) {
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

/**
 * Compute a version hash from all word file paths + their modification times.
 * Used by the app to detect when the OPFS database is stale.
 */
function computeVersionHash(files) {
  const hash = createHash("sha256");
  // Include build script's mtime so logic changes invalidate the cache
  const scriptStat = statSync(new URL(import.meta.url).pathname);
  hash.update("build-index.js:" + scriptStat.mtimeMs);
  for (const f of files.sort()) {
    const stat = statSync(f);
    hash.update(f + ":" + stat.mtimeMs);
  }
  return hash.digest("hex").slice(0, 16);
}

// ============================================================
// Cross-reference resolution for examples
// ============================================================

/**
 * Fold umlauts for accent-insensitive search.
 * ä→a, ö→o, ü→u, ß→ss (lowercase).
 * Stored in lemma_folded column so queries without umlauts still match.
 */
function foldUmlauts(str) {
  return str
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

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

  // Load verb endings for pre-computing conjugation tables
  const verbEndings = existsSync(VERB_ENDINGS_FILE)
    ? JSON.parse(readFileSync(VERB_ENDINGS_FILE, "utf-8"))
    : null;

  const db = new Database(DB_PATH);

  // Enable WAL mode for faster writes during build, then switch back before close
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE words (
      id              INTEGER PRIMARY KEY,
      lemma           TEXT NOT NULL,
      lemma_folded    TEXT NOT NULL,
      pos             TEXT NOT NULL,
      gender          TEXT,
      frequency       INTEGER,
      plural_dominant INTEGER,
      plural_form     TEXT,
      file            TEXT NOT NULL UNIQUE,
      gloss_en        TEXT,
      data            TEXT NOT NULL
    );

    CREATE TABLE examples (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE word_forms (
      form    TEXT NOT NULL,
      word_id INTEGER NOT NULL REFERENCES words(id),
      PRIMARY KEY (form, word_id)
    );

    CREATE TABLE meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insertWord = db.prepare(`
    INSERT INTO words (lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en, data)
    VALUES (@lemma, @lemma_folded, @pos, @gender, @frequency, @plural_dominant, @plural_form, @file, @gloss_en, @data)
  `);

  const insertWordForm = db.prepare(`
    INSERT OR IGNORE INTO word_forms (form, word_id)
    VALUES (@form, @word_id)
  `);

  const insertExample = db.prepare(`
    INSERT OR IGNORE INTO examples (id, data) VALUES (@id, @data)
  `);

  const insertMeta = db.prepare(`
    INSERT INTO meta (key, value) VALUES (@key, @value)
  `);

  const files = findJsonFiles();

  // --------------------------------------------------------
  // Phase 1a: Load all word data for relationship resolution
  // --------------------------------------------------------

  const allWordData = [];
  for (const filePath of files) {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const relPath = relative(DATA_DIR, filePath);
    const parts = relPath.split("/"); // ["words", "nouns", "Tisch.json"]
    const posDir = parts[1];
    const file = parts[2].replace(".json", "");
    const fileKey = `${posDir}/${file}`;
    allWordData.push({ filePath, data, posDir, file, fileKey });
  }

  // --------------------------------------------------------
  // Phase 1b: Resolve cross-POS relationships
  // --------------------------------------------------------

  // Build stem → files lookup for same_stem detection
  const stemMap = new Map();
  // Build lemma → files lookup for derived/hyponyms resolution
  const lemmaMap = new Map();

  for (const entry of allWordData) {
    const stem = entry.data.word.toLowerCase();
    if (!stemMap.has(stem)) stemMap.set(stem, []);
    stemMap.get(stem).push(entry);

    const lemma = entry.data.word;
    if (!lemmaMap.has(lemma)) lemmaMap.set(lemma, []);
    lemmaMap.get(lemma).push(entry);
  }

  // Resolve relationships per word
  const relatedMap = new Map(); // fileKey → [{file, type}]
  let relCount = 0;

  for (const entry of allWordData) {
    const rels = [];
    const seenFiles = new Set();
    seenFiles.add(entry.fileKey); // skip self

    // 1. same_stem: all words with matching word.toLowerCase()
    const stem = entry.data.word.toLowerCase();
    const stemSiblings = stemMap.get(stem) || [];
    for (const sibling of stemSiblings) {
      if (seenFiles.has(sibling.fileKey)) continue;
      seenFiles.add(sibling.fileKey);
      rels.push({ file: sibling.fileKey, type: "same_stem" });
    }

    // 2. derived: Wiktionary _derived field → derived/derived_from (bidirectional)
    if (entry.data._derived) {
      for (const derivedWord of entry.data._derived) {
        const targets = lemmaMap.get(derivedWord) || [];
        for (const target of targets) {
          if (seenFiles.has(target.fileKey)) continue;
          seenFiles.add(target.fileKey);
          rels.push({ file: target.fileKey, type: "derived" });
          // Add reverse link: derived_from
          if (!relatedMap.has(target.fileKey)) relatedMap.set(target.fileKey, []);
          const reverseRels = relatedMap.get(target.fileKey);
          if (!reverseRels.some((r) => r.file === entry.fileKey)) {
            reverseRels.push({ file: entry.fileKey, type: "derived_from" });
          }
        }
      }
    }

    // 3a. gender pair: _gender_counterpart → feminine_form / masculine_form (bidirectional)
    if (entry.data._gender_counterpart && entry.data.pos === "noun") {
      const counterpartWord = entry.data._gender_counterpart;
      const targets = lemmaMap.get(counterpartWord) || [];
      for (const target of targets) {
        if (seenFiles.has(target.fileKey)) continue;
        if (target.data.pos !== "noun") continue;
        seenFiles.add(target.fileKey);
        const type = entry.data.gender === "M" ? "feminine_form" : "masculine_form";
        rels.push({ file: target.fileKey, type });
        // Add reverse link (counterpart may lack _gender_counterpart if skipped during regeneration)
        const reverseType = type === "feminine_form" ? "masculine_form" : "feminine_form";
        if (!relatedMap.has(target.fileKey)) relatedMap.set(target.fileKey, []);
        const reverseRels = relatedMap.get(target.fileKey);
        if (!reverseRels.some((r) => r.file === entry.fileKey)) {
          reverseRels.push({ file: entry.fileKey, type: reverseType });
        }
      }
    }

    // 3b. compound: Wiktionary _hyponyms field (verbs) → compound/base_verb (bidirectional)
    if (entry.data._hyponyms && entry.data.pos === "verb") {
      for (const hypoWord of entry.data._hyponyms) {
        // Look for the hyponym as a verb (lowercase)
        const targets = lemmaMap.get(hypoWord) || lemmaMap.get(hypoWord.toLowerCase()) || [];
        for (const target of targets) {
          if (seenFiles.has(target.fileKey)) continue;
          if (target.data.pos !== "verb") continue; // only verb→verb
          seenFiles.add(target.fileKey);
          rels.push({ file: target.fileKey, type: "compound" });
          // Add reverse link: base_verb
          if (!relatedMap.has(target.fileKey)) relatedMap.set(target.fileKey, []);
          const reverseRels = relatedMap.get(target.fileKey);
          if (!reverseRels.some((r) => r.file === entry.fileKey)) {
            reverseRels.push({ file: entry.fileKey, type: "base_verb" });
          }
        }
      }
    }

    // 3c. antonyms: _antonyms → antonym (bidirectional, any POS)
    for (const antWord of entry.data._antonyms || []) {
      const targets = lemmaMap.get(antWord) || lemmaMap.get(antWord.toLowerCase()) || [];
      for (const target of targets) {
        if (seenFiles.has(target.fileKey)) continue;
        seenFiles.add(target.fileKey);
        rels.push({ file: target.fileKey, type: "antonym" });
        if (!relatedMap.has(target.fileKey)) relatedMap.set(target.fileKey, []);
        const reverseRels = relatedMap.get(target.fileKey);
        if (!reverseRels.some((r) => r.file === entry.fileKey && r.type === "antonym")) {
          reverseRels.push({ file: entry.fileKey, type: "antonym" });
        }
      }
    }

    // 3d. synonyms: _synonyms → synonym (bidirectional, any POS)
    for (const synWord of entry.data._synonyms || []) {
      const targets = lemmaMap.get(synWord) || lemmaMap.get(synWord.toLowerCase()) || [];
      for (const target of targets) {
        if (seenFiles.has(target.fileKey)) continue;
        seenFiles.add(target.fileKey);
        rels.push({ file: target.fileKey, type: "synonym" });
        if (!relatedMap.has(target.fileKey)) relatedMap.set(target.fileKey, []);
        const reverseRels = relatedMap.get(target.fileKey);
        if (!reverseRels.some((r) => r.file === entry.fileKey && r.type === "synonym")) {
          reverseRels.push({ file: entry.fileKey, type: "synonym" });
        }
      }
    }

    if (rels.length) {
      if (!relatedMap.has(entry.fileKey)) relatedMap.set(entry.fileKey, []);
      relatedMap.get(entry.fileKey).push(...rels);
    }
  }

  // Dedup relatedMap entries (reverse links may duplicate same_stem links)
  for (const [fileKey, rels] of relatedMap) {
    const seen = new Set();
    const deduped = [];
    for (const rel of rels) {
      const key = `${rel.file}|${rel.type}`;
      if (seen.has(key)) continue;
      // If same file already has same_stem, skip derived_from/base_verb for that file
      const sameFileStemEntry = deduped.find(
        (r) => r.file === rel.file && r.type === "same_stem",
      );
      if (
        sameFileStemEntry &&
        (rel.type === "derived_from" || rel.type === "derived" || rel.type === "base_verb" || rel.type === "compound")
      ) {
        continue;
      }
      seen.add(key);
      deduped.push(rel);
    }
    relatedMap.set(fileKey, deduped);
    relCount += deduped.length;
  }

  console.log(
    `Resolved ${relCount} relationships across ${relatedMap.size} words.`,
  );

  // --------------------------------------------------------
  // Phase 1c: Insert word files → words + word_forms tables
  // --------------------------------------------------------

  let wordCount = 0;
  let wordFormCount = 0;

  const insertWords = db.transaction(() => {
    for (const entry of allWordData) {
      const { data, fileKey } = entry;

      // Collect English glosses as JSON array
      const glossEn = (data.senses || [])
        .map((s) => s.gloss_en)
        .filter(Boolean);

      // Build the runtime word object — only fields the app needs for display.
      // Strip computation inputs (stems, past_participle) and internal metadata (_meta).
      const enriched = { ...data };
      delete enriched._meta;
      delete enriched._derived;
      delete enriched._hyponyms;
      delete enriched._gender_counterpart;
      delete enriched._antonyms;
      delete enriched._synonyms;

      if (data.pos === "verb" && verbEndings) {
        if (data.conjugation_class !== "irregular") {
          // Pre-compute conjugation table from stems + endings
          enriched.conjugation = computeConjugation(data, verbEndings);
        }
        // Strip build-time-only verb fields (now baked into conjugation)
        delete enriched.stems;
        delete enriched.past_participle;
      }

      // Inject resolved relationships into runtime data blob
      const rels = relatedMap.get(fileKey);
      if (rels && rels.length) {
        enriched.related = rels;
      }

      const result = insertWord.run({
        lemma: data.word,
        lemma_folded: foldUmlauts(data.word),
        pos: data.pos.toUpperCase(),
        gender: data.gender || null,
        frequency: data.frequency || null,
        plural_dominant: data.plural_dominant ? 1 : null,
        plural_form: data.plural_dominant ? (data.plural_form || null) : null,
        file: fileKey,
        gloss_en: glossEn.length ? JSON.stringify(glossEn) : null,
        data: JSON.stringify(enriched),
      });
      wordCount++;

      const wordId = result.lastInsertRowid;

      // Pre-compute verb forms for search
      if (data.pos === "verb" && verbEndings) {
        const forms = computeAllForms(
          data.conjugation_class === "irregular"
            ? data
            : { ...data, conjugation: enriched.conjugation },
          verbEndings,
        );
        for (const form of forms) {
          // Skip infinitive — already matched by lemma search
          if (form === data.word.toLowerCase()) continue;
          insertWordForm.run({ form, word_id: wordId });
          wordFormCount++;
        }
      }

      // Pre-compute noun case forms for search (plural, genitive, dative, etc.)
      if ((data.pos === "noun" || data.pos === "proper noun") && data.case_forms) {
        const lemmaLower = data.word.toLowerCase();
        const seenForms = new Set();
        for (const number of Object.values(data.case_forms)) {
          for (const form of Object.values(number)) {
            if (form == null) continue;
            const lower = form.toLowerCase();
            if (lower === lemmaLower) continue; // skip nom sg (matched by lemma search)
            if (seenForms.has(lower)) continue;
            seenForms.add(lower);
            insertWordForm.run({ form: lower, word_id: wordId });
            wordFormCount++;
          }
        }
      }

    }
  });

  insertWords();
  console.log(`Inserted ${wordCount} words, ${wordFormCount} word forms.`);

  // --------------------------------------------------------
  // Phase 2: Create indexes (after bulk insert for speed)
  // --------------------------------------------------------

  db.exec(`
    CREATE INDEX idx_words_lemma        ON words(lemma COLLATE NOCASE);
    CREATE INDEX idx_words_lemma_folded ON words(lemma_folded);
    CREATE INDEX idx_words_freq         ON words(frequency);
    CREATE INDEX idx_word_forms         ON word_forms(form);
  `);

  // --------------------------------------------------------
  // Phase 3: Process examples → cross-reference linking + examples table
  // --------------------------------------------------------

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

    // Phase 4: Resolve expression → phrase card links
    const phraseDir = join(DATA_DIR, "words", "phrases");
    const phraseLookup = new Map();
    if (existsSync(phraseDir)) {
      for (const file of readdirSync(phraseDir)) {
        if (!file.endsWith(".json")) continue;
        const data = JSON.parse(
          readFileSync(join(phraseDir, file), "utf-8"),
        );
        phraseLookup.set(data.word, `phrases/${file.replace(".json", "")}`);
      }
    }

    let refCount = 0;
    for (const [, ex] of Object.entries(examples)) {
      if (ex.type !== "expression" && ex.type !== "proverb") continue;
      const phraseRef = phraseLookup.get(ex.text);
      if (phraseRef) {
        ex.ref = phraseRef;
        refCount++;
      } else {
        delete ex.ref;
      }
    }

    // Write back sorted by key (keeps examples.json as source of truth)
    const sorted = {};
    for (const key of Object.keys(examples).sort()) {
      sorted[key] = examples[key];
    }
    writeFileSync(EXAMPLES_FILE, JSON.stringify(sorted, null, 2));
    console.log(`Linked ${linkedCount} examples with cross-references.`);
    if (refCount > 0) {
      console.log(`Linked ${refCount} expressions to phrase cards.`);
    }

    // Insert examples into SQLite
    const insertExamples = db.transaction(() => {
      for (const [id, ex] of Object.entries(sorted)) {
        insertExample.run({ id, data: JSON.stringify(ex) });
      }
    });
    insertExamples();
    console.log(`Inserted ${Object.keys(sorted).length} examples.`);
  }

  // --------------------------------------------------------
  // Phase 5: Version hash
  // --------------------------------------------------------

  const version = computeVersionHash(files);
  insertMeta.run({ key: "version", value: version });
  writeFileSync(join(DATA_DIR, "db-version.txt"), version);
  console.log(`Database version: ${version}`);

  // Switch from WAL to DELETE journal mode for read-only runtime use
  db.pragma("journal_mode = DELETE");
  db.close();

  console.log(`Built ${DB_PATH} successfully.`);
}

main();
