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
 * Usage: node scripts/build-index.ts
 */

import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { stripReferences } from "./lib/references.js";
import { POS_DIRS } from "./lib/pos.js";
import { loadExamples, saveExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import { computeSenseOrder } from "./lib/sense-ordering.js";
import {
  resolveWordFile,
  annotateExampleText,
  type WordLookupEntry,
} from "./lib/text-linked.js";
import { computeConjugation, computeAllForms } from "../src/utils/verb-forms.js";
import { stripOuterQuotes, stripEllipsisMarkers } from "../src/utils/text.js";
import type {
  Word,
  WordBase,
  NounWord,
  VerbWord,
  AdjectiveWord,
  Sense,
  VerbEndingsFile,
  ConjugationTable,
  CaseForms,
} from "../types/index.js";
import type { Example, ExampleMap, Annotation } from "../types/example.js";
import type { MetaRow, WordRow, ExampleRow as ExampleRowSchema } from "./lib/db-schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

/**
 * Sense tags preserved in the DB blob. Keys are source tag names (from Wiktionary);
 * values are the canonical names stored in the DB (normalises e.g. "South-German").
 * Everything else is stripped — it was only needed at build time (sense ordering) or
 * is never read by the app at all.
 */
const DISPLAY_TAGS = new Map<string, string>([
  // Register / style
  ["colloquial",   "colloquial"],
  ["figurative",   "figurative"],
  ["outdated",     "outdated"],
  ["archaic",      "archaic"],
  ["derogatory",   "derogatory"],
  ["literary",     "literary"],
  ["rare",         "rare"],
  ["historical",   "historical"],
  ["humorous",     "humorous"],
  ["gehoben",      "gehoben"],
  ["impolite",     "impolite"],
  ["jargon",       "jargon"],
  ["vulgar",       "vulgar"],
  ["formal",       "formal"],
  ["poetic",       "poetic"],
  ["slang",        "slang"],
  ["casual",       "casual"],
  // Dialect / region
  ["Austrian German",        "Austrian German"],
  ["Swiss Standard German",  "Swiss Standard German"],
  ["regional",               "regional"],
  ["South-German",           "South German"],  // normalise hyphen variant
  ["South German",           "South German"],
  ["North German",           "North German"],
  ["Bavarian",               "Bavarian"],
  ["Swabian",                "Swabian"],
  // Domain / subject
  ["physics",    "physics"],
  ["geography",  "geography"],
  ["geometry",   "geometry"],
  ["finance",    "finance"],
  ["law",        "law"],
  ["military",   "military"],
  // Grammar (kept in DB; shown only when user enables the setting)
  ["transitive",   "transitive"],
  ["intransitive", "intransitive"],
  ["reflexive",    "reflexive"],
  ["impersonal",   "impersonal"],
]);
const DB_PATH = join(DATA_DIR, "lexiklar.db");
const VERB_ENDINGS_FILE = join(DATA_DIR, "rules", "verb-endings.json");

// ============================================================
// Interfaces for internal data structures
// ============================================================

interface WordEntry {
  filePath: string;
  data: Word & Record<string, unknown>;
  posDir: string;
  file: string;
  fileKey: string;
}

interface Relation {
  file: string;
  type: string;
}

type WordInsertParams = Omit<WordRow, "id">;

interface WordFormInsertParams {
  form: string;
  word_id: number | bigint;
}

type ExampleInsertParams = ExampleRowSchema;

type MetaInsertParams = MetaRow;

type MetaQueryRow = Pick<MetaRow, "value">;

// ============================================================
// English reverse-lookup term extraction
// ============================================================

const EN_STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "for", "with",
  "by", "from", "or", "and", "is", "are", "be", "was", "were",
  "has", "have", "had", "do", "does", "did", "not", "no", "but",
  "if", "that", "this", "it", "its", "into", "as", "up", "out",
  "so", "than", "very", "own", "can", "will", "each", "which",
  "one", "something", "someone", "oneself",
]);

/**
 * Extract English search terms from all senses of a word.
 *
 * Sources (in priority order):
 *   1. gloss_en — phrase + individual tokens (short, 1-4 words, all relevant)
 *   2. synonyms_en — phrase + individual tokens (curated, all relevant)
 *
 * gloss_en_full is NOT tokenized — its individual words are too noisy
 * (e.g. "furniture", "drawers" for Schrank). The full descriptions are
 * already useful via the gloss_en tokens they share with the short form.
 */
function extractEnTerms(senses: Sense[]): Set<string> {
  const terms = new Set<string>();

  for (const sense of senses) {
    // 1. gloss_en — store as full phrase + tokenize into words
    if (sense.gloss_en) {
      const phrase = sense.gloss_en.toLowerCase().trim();
      if (phrase.length >= 2) terms.add(phrase);
      tokenizeInto(phrase, terms);
    }

    // 2. synonyms_en — store each as phrase + tokenize
    if (sense.synonyms_en) {
      for (const syn of sense.synonyms_en) {
        const phrase = syn.toLowerCase().trim();
        if (phrase.length >= 2) terms.add(phrase);
        tokenizeInto(phrase, terms);
      }
    }
  }

  return terms;
}

/**
 * Tokenize text into individual words and add to the set.
 * Strips parentheticals, filters stopwords and short tokens.
 */
function tokenizeInto(text: string, terms: Set<string>): void {
  // Strip parenthetical qualifiers like "(into state)", "(verb)"
  const stripped = text.replace(/\([^)]*\)/g, "");
  const words = stripped.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (w.length >= 2 && !EN_STOPWORDS.has(w)) {
      terms.add(w);
    }
  }
}

// ============================================================
// Utility functions
// ============================================================

/**
 * Compute a short content hash (first 16 hex chars of SHA-256).
 * Used for row-level diffing in the OTA patch system.
 */
function contentHash(str: string): string {
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

// findJsonFiles is now provided by lib/words.ts as findWordFilePaths()

/**
 * Compute a content-deterministic version hash from row-level hashes in the DB.
 * Two builds of identical data always produce the same version hash, regardless
 * of runner, timing, or file mtimes. Must be called after all data is inserted.
 */
function computeVersionHash(db: Database.Database): string {
  const hash = createHash("sha256");
  for (const row of db.prepare("SELECT file, hash FROM words ORDER BY file").all()) {
    const r = row as { file: string; hash: string };
    hash.update(r.file + ":" + r.hash);
  }
  for (const row of db.prepare("SELECT id, hash FROM examples ORDER BY id").all()) {
    const r = row as { id: string; hash: string };
    hash.update(r.id + ":" + r.hash);
  }
  // Include all word_forms so any change to search indexing invalidates the cache
  for (const row of db.prepare("SELECT w.file, wf.form FROM word_forms wf JOIN words w ON w.id = wf.word_id ORDER BY w.file, wf.form").all()) {
    const r = row as { file: string; form: string };
    hash.update(r.file + ":" + r.form);
  }
  // Include indexed columns not covered by the data blob hash (e.g. plural_form, superlative)
  for (const row of db.prepare("SELECT file, COALESCE(plural_form,''), COALESCE(acc_form,''), COALESCE(superlative,'') FROM words ORDER BY file").all() as string[][]) {
    hash.update(Object.values(row).join(":"));
  }
  // Include schema version so column additions (e.g. superlative) invalidate the cache
  const cols = (db.prepare("PRAGMA table_info(words)").all() as { name: string }[]).map(r => r.name).join(",");
  hash.update("schema:" + cols);
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
function foldUmlauts(str: string): string {
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
function buildWordLookup(files: string[]): Map<string, WordLookupEntry[]> {
  const lookup = new Map<string, WordLookupEntry[]>();

  for (const filePath of files) {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
    const relPath = relative(DATA_DIR, filePath);
    const parts = relPath.split("/");
    const posDir = parts[1];
    const file = parts[2].replace(".json", "");
    const key = `${data.word}|${data.pos}`;

    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key)!.push({
      posDir,
      file,
      senses: data.senses || [],
    });
  }

  return lookup;
}

// resolveWordFile, annotateExampleText, findFormInText, normalizeHint, IRREGULAR_EN
// extracted to scripts/lib/text-linked.ts

// ============================================================
// Type guard helpers
// ============================================================

function isVerbWord(data: Word & Record<string, unknown>): data is VerbWord & Record<string, unknown> {
  return data.pos === "verb";
}

function isNounLike(data: Word & Record<string, unknown>): data is (NounWord & Record<string, unknown>) {
  return data.pos === "noun" || data.pos === "proper noun";
}

// ============================================================
// Main
// ============================================================

function main(): void {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  // Load verb endings for pre-computing conjugation tables
  const verbEndings: VerbEndingsFile | null = existsSync(VERB_ENDINGS_FILE)
    ? JSON.parse(readFileSync(VERB_ENDINGS_FILE, "utf-8")) as VerbEndingsFile
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
      acc_form        TEXT,
      superlative     TEXT,
      comparative     TEXT,
      file            TEXT NOT NULL UNIQUE,
      gloss_en        TEXT,
      data            TEXT NOT NULL,
      hash            TEXT NOT NULL
    );

    CREATE TABLE examples (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      hash TEXT NOT NULL
    );

    CREATE TABLE word_forms (
      form    TEXT NOT NULL,
      word_id INTEGER NOT NULL REFERENCES words(id),
      PRIMARY KEY (form, word_id)
    );

    CREATE TABLE en_terms (
      term    TEXT NOT NULL,
      word_id INTEGER NOT NULL REFERENCES words(id),
      PRIMARY KEY (term, word_id)
    );

    CREATE TABLE meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insertWord = db.prepare<WordInsertParams>(`
    INSERT INTO words (lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, acc_form, superlative, comparative, file, gloss_en, data, hash)
    VALUES (@lemma, @lemma_folded, @pos, @gender, @frequency, @plural_dominant, @plural_form, @acc_form, @superlative, @comparative, @file, @gloss_en, @data, @hash)
  `);

  const insertWordForm = db.prepare<WordFormInsertParams>(`
    INSERT OR IGNORE INTO word_forms (form, word_id)
    VALUES (@form, @word_id)
  `);

  const insertEnTerm = db.prepare<WordFormInsertParams>(`
    INSERT OR IGNORE INTO en_terms (term, word_id)
    VALUES (@form, @word_id)
  `);

  const insertExample = db.prepare<ExampleInsertParams>(`
    INSERT OR IGNORE INTO examples (id, data, hash) VALUES (@id, @data, @hash)
  `);

  const insertMeta = db.prepare<MetaInsertParams>(`
    INSERT INTO meta (key, value) VALUES (@key, @value)
  `);

  const files = findWordFilePaths();

  // --------------------------------------------------------
  // Phase 1a: Load all word data for relationship resolution
  // --------------------------------------------------------

  const allWordData: WordEntry[] = [];
  for (const filePath of files) {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as Word & Record<string, unknown>;
    const relPath = relative(DATA_DIR, filePath);
    const parts = relPath.split("/"); // ["words", "nouns", "Tisch.json"]
    const posDir = parts[1];
    const file = parts[2].replace(".json", "");
    const fileKey = `${posDir}/${file}`;
    allWordData.push({ filePath, data, posDir, file, fileKey });
  }

  // --------------------------------------------------------
  // Phase 1b.0: Collect form_examples from inflected-form stubs
  // Stubs are entries where base_lemma is set AND differs from word
  // (e.g. die/dem/des → der, eine/einen/… → ein, ihrer → ihr).
  // Their examples are promoted to the base form's data blob under form_examples.
  // --------------------------------------------------------

  // Map "posDir/word" → fileKey for base forms (base_lemma absent or self-referential)
  const baseKeyByWord = new Map<string, string>();
  for (const { data: bd, posDir: bPos, fileKey: bKey } of allWordData) {
    const bbl = (bd as Record<string, unknown>).base_lemma as string | undefined;
    if (!bbl || bbl === bd.word) {
      const mapKey = `${bPos}/${bd.word}`;
      // Self-referential (explicit base form) takes priority over entries with no base_lemma
      if (bbl === bd.word || !baseKeyByWord.has(mapKey)) {
        baseKeyByWord.set(mapKey, bKey);
      }
    }
  }

  // Group stub examples by base fileKey → [{ form, example_ids }]
  const stubFormExamplesMap = new Map<string, Array<{ form: string; example_ids: string[] }>>();
  for (const { data: sd, posDir: sPos } of allWordData) {
    const sbl = (sd as Record<string, unknown>).base_lemma as string | undefined;
    if (!sbl || sbl === sd.word) continue;
    const baseFileKey = baseKeyByWord.get(`${sPos}/${sbl}`);
    if (!baseFileKey) continue;
    const ids = (sd.senses || []).flatMap((s: Sense) => (s.example_ids || []) as string[]);
    if (ids.length === 0) continue;
    if (!stubFormExamplesMap.has(baseFileKey)) stubFormExamplesMap.set(baseFileKey, []);
    stubFormExamplesMap.get(baseFileKey)!.push({ form: sd.word, example_ids: ids });
  }

  // --------------------------------------------------------
  // Phase 1b: Resolve cross-POS relationships
  // --------------------------------------------------------

  // Build stem → files lookup for same_stem detection
  const stemMap = new Map<string, WordEntry[]>();
  // Build lemma → files lookup for derived/hyponyms resolution
  const lemmaMap = new Map<string, WordEntry[]>();

  for (const entry of allWordData) {
    const stem = entry.data.word.toLowerCase();
    if (!stemMap.has(stem)) stemMap.set(stem, []);
    stemMap.get(stem)!.push(entry);

    const lemma = entry.data.word;
    if (!lemmaMap.has(lemma)) lemmaMap.set(lemma, []);
    lemmaMap.get(lemma)!.push(entry);
  }

  // Resolve relationships per word
  const relatedMap = new Map<string, Relation[]>(); // fileKey → [{file, type}]
  let relCount = 0;

  for (const entry of allWordData) {
    const rels: Relation[] = [];
    const seenFiles = new Set<string>();
    seenFiles.add(entry.fileKey); // skip self

    // 1. same_stem: all words with matching word.toLowerCase()
    const stem = entry.data.word.toLowerCase();
    const stemSiblings = stemMap.get(stem) || [];
    for (const sibling of stemSiblings) {
      if (seenFiles.has(sibling.fileKey)) continue;
      seenFiles.add(sibling.fileKey);
      rels.push({ file: sibling.fileKey, type: "same_stem" });
    }

    // oscillating_verb: verb has same_stem sibling with opposite separable value
    if (isVerbWord(entry.data) && entry.data.separable != null) {
      const hasOpposite = stemSiblings.some(
        (s) =>
          isVerbWord(s.data) &&
          s.data.separable != null &&
          s.data.separable !== (entry.data as VerbWord).separable,
      );
      if (hasOpposite) entry.data._oscillating = true;
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
          const reverseRels = relatedMap.get(target.fileKey)!;
          if (!reverseRels.some((r) => r.file === entry.fileKey)) {
            reverseRels.push({ file: entry.fileKey, type: "derived_from" });
          }
        }
      }
    }

    // 3a. gender pair: _gender_counterpart → feminine_form / masculine_form (bidirectional)
    const genderCounterpart = entry.data._gender_counterpart as string | undefined;
    if (genderCounterpart && entry.data.pos === "noun") {
      const targets = lemmaMap.get(genderCounterpart) || [];
      for (const target of targets) {
        if (seenFiles.has(target.fileKey)) continue;
        if (target.data.pos !== "noun") continue;
        seenFiles.add(target.fileKey);
        const nounData = entry.data as NounWord & Record<string, unknown>;
        const type = nounData.gender === "M" ? "feminine_form" : "masculine_form";
        rels.push({ file: target.fileKey, type });
        // Add reverse link (counterpart may lack _gender_counterpart if skipped during regeneration)
        const reverseType = type === "feminine_form" ? "masculine_form" : "feminine_form";
        if (!relatedMap.has(target.fileKey)) relatedMap.set(target.fileKey, []);
        const reverseRels = relatedMap.get(target.fileKey)!;
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
          const reverseRels = relatedMap.get(target.fileKey)!;
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
        const reverseRels = relatedMap.get(target.fileKey)!;
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
        const reverseRels = relatedMap.get(target.fileKey)!;
        if (!reverseRels.some((r) => r.file === entry.fileKey && r.type === "synonym")) {
          reverseRels.push({ file: entry.fileKey, type: "synonym" });
        }
      }
    }

    // 3e. compound_parts: verified compound noun parts → compound_part / compound_of (bidirectional)
    const compoundParts = entry.data.compound_parts as string[] | undefined;
    const compoundVerified = entry.data.compound_verified as boolean | undefined;
    if (compoundParts && compoundVerified) {
      for (const partLemma of compoundParts) {
        const targets = (
          lemmaMap.get(partLemma) ||
          lemmaMap.get(partLemma.toLowerCase()) ||
          []
        ).slice().sort((a, b) => {
          const zipfDiff = (b.data.zipf ?? 0) - (a.data.zipf ?? 0);
          if (zipfDiff !== 0) return zipfDiff;
          // Tie-break: more senses = more general word, put first
          return (b.data.senses?.length ?? 0) - (a.data.senses?.length ?? 0);
        });
        for (const target of targets) {
          if (seenFiles.has(target.fileKey)) continue;
          seenFiles.add(target.fileKey);
          rels.push({ file: target.fileKey, type: "compound_part" });
          // Reverse: component word → compound_of → this compound word
          if (!relatedMap.has(target.fileKey))
            relatedMap.set(target.fileKey, []);
          const reverseRels = relatedMap.get(target.fileKey)!;
          if (!reverseRels.some((r) => r.file === entry.fileKey)) {
            reverseRels.push({ file: entry.fileKey, type: "compound_of" });
          }
        }
      }
    }

    if (rels.length) {
      if (!relatedMap.has(entry.fileKey)) relatedMap.set(entry.fileKey, []);
      relatedMap.get(entry.fileKey)!.push(...rels);
    }
  }

  // Dedup relatedMap entries (reverse links may duplicate same_stem links)
  for (const [fileKey, rels] of relatedMap) {
    const seen = new Set<string>();
    const deduped: Relation[] = [];
    for (const rel of rels) {
      const key = `${rel.file}|${rel.type}`;
      if (seen.has(key)) continue;
      // If same file already has same_stem, skip derived_from/base_verb for that file
      const sameFileStemEntry = deduped.find(
        (r) => r.file === rel.file && r.type === "same_stem",
      );
      if (
        sameFileStemEntry &&
        (rel.type === "derived_from" || rel.type === "derived" || rel.type === "base_verb" || rel.type === "compound" || rel.type === "compound_part" || rel.type === "compound_of")
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
  // Phase 1c: Compute frequency rank from Zipf scores
  // --------------------------------------------------------

  // Sort by zipf descending, assign rank 1..N (null zipf → no rank)
  // Use _overrides.zipf if set (allows manual ranking corrections without re-running enrich step)
  const effectiveZipf = (e: { data: Record<string, unknown> }) =>
    ((e.data._overrides as Record<string, unknown> | undefined)?.zipf as number | undefined)
    ?? (e.data.zipf as number | undefined)
    ?? null;
  const ranked = allWordData
    .filter((e) => effectiveZipf(e) != null)
    .sort((a, b) =>
      (effectiveZipf(b) ?? 0) - (effectiveZipf(a) ?? 0)
      || (b.data.senses?.length ?? 0) - (a.data.senses?.length ?? 0)
    );
  const frequencyRank = new Map<string, number>();
  for (let i = 0; i < ranked.length; i++) {
    frequencyRank.set(ranked[i].fileKey, i + 1);
  }

  // --------------------------------------------------------
  // Phase 1d: Insert word files → words + word_forms tables
  // --------------------------------------------------------

  // Sense ordering: done at build time via computeSenseOrder() from lib/sense-ordering.ts.
  // Rules: _overrides.sense_order / _overrides.first_sense per word, Strategy C for nouns, identity for rest.
  // Source files are never modified — only the DB blob gets reordered senses.

  // Store remap for text_linked remapping in Phase 3: fileKey → (oldSenseNum → newSenseNum), 1-indexed
  const senseRemaps = new Map<string, Map<number, number>>();

  let wordCount = 0;
  let wordFormCount = 0;
  let enTermCount = 0;

  const insertWords = db.transaction(() => {
    for (const entry of allWordData) {
      const { data, fileKey } = entry;

      // Skip inflected-form stubs — they are merged into the base form's data blob
      const entryBaseLemma = (data as Record<string, unknown>).base_lemma as string | undefined;
      if (entryBaseLemma && entryBaseLemma !== data.word) continue;

      // Compute sense display order (rules in lib/sense-ordering.ts, per-word overrides in _overrides)
      const senseOrder = computeSenseOrder(data.senses || [], data.pos, data._overrides);
      const isReordered = senseOrder.some((v, i) => v !== i);

      // Build remap: old 1-indexed → new 1-indexed (for text_linked #N references)
      if (isReordered && data.senses.length > 1) {
        const remap = new Map<number, number>();
        for (let newIdx = 0; newIdx < senseOrder.length; newIdx++) {
          const oldIdx = senseOrder[newIdx];
          if (oldIdx !== newIdx) remap.set(oldIdx + 1, newIdx + 1);
        }
        if (remap.size > 0) senseRemaps.set(fileKey, remap);
      }

      // Build gloss_en from display order
      const glossEn = senseOrder
        .map((i) => (data.senses || [])[i]?.gloss_en)
        .filter(Boolean);

      // Build the runtime word object — only fields the app needs for display.
      // Strip computation inputs (stems, past_participle) and internal metadata (_meta).
      const enriched: Record<string, unknown> = { ...data };
      delete enriched._meta;
      delete enriched._proofread;
      // Promote false_friend_en from _overrides to top-level before stripping
      if (data._overrides?.false_friend_en) {
        enriched.false_friend_en = data._overrides.false_friend_en;
      }
      // Promote confusable_pairs from _overrides to top-level before stripping.
      // other_note is not stored in source files — resolved here from the counterpart's this_note.
      if (data._overrides?.confusable_pairs) {
        const cp = data._overrides.confusable_pairs;
        enriched.confusable_pairs = {
          this_note: cp.this_note,
          pairs: cp.pairs.map((pair) => {
            const candidates = lemmaMap.get(pair.other) ?? [];
            // For homonyms, prefer the counterpart that has a reverse confusable pair
            // pointing back to this word — pairs are always symmetric.
            const counterpart =
              candidates.find((c) =>
                c.data._overrides?.confusable_pairs?.pairs.some(
                  (p) => p.other === data.word,
                ),
              ) ?? candidates[0];
            const other_note = counterpart?.data._overrides?.confusable_pairs?.this_note ?? "";
            return { en_word: pair.en_word, other: pair.other, other_note };
          }),
        };
      }
      // Promote antonym from _overrides to top-level before stripping
      if (data._overrides?.antonym) {
        enriched.antonym = data._overrides.antonym;
      }
      delete enriched._overrides;
      delete enriched._derived;
      delete enriched._hyponyms;
      delete enriched._gender_counterpart;
      delete enriched._antonyms;
      delete enriched._synonyms;
      delete enriched.compound_source;
      delete enriched.compound_verified;
      delete enriched.zipf;
      // Strip LLM model attribution from top level and senses
      delete enriched.gloss_en_model;
      delete enriched.gloss_en_full_model;
      delete enriched.synonyms_en_model;
      delete enriched.etymology_number;
      delete enriched.umlaut_in_comparison;
      if (Array.isArray(enriched.sounds)) {
        for (const s of enriched.sounds as Record<string, unknown>[]) {
          delete s.tags;
        }
      }
      if (Array.isArray(enriched.senses)) {
        for (const s of enriched.senses as Record<string, unknown>[]) {
          delete s.gloss_en_model;
          delete s.gloss_en_full_model;
          delete s.synonyms_en_model;
          // Keep only display tags; normalise canonical names (e.g. "South-German" → "South German").
          if (Array.isArray(s.tags)) {
            const kept = [...new Set(
              (s.tags as string[]).map(t => DISPLAY_TAGS.get(t)).filter((t): t is string => t !== undefined)
            )];
            if (kept.length > 0) s.tags = kept; else delete s.tags;
          }
        }
      }

      // Inject oscillating flag computed in Phase 1b
      if (isVerbWord(data) && data._oscillating) enriched.oscillating_verb = true;
      delete enriched._oscillating;

      if (isVerbWord(data) && verbEndings) {
        if (data.conjugation_class !== "irregular" && data.stems) {
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

      // Reorder senses in DB blob to display order (source files untouched)
      if (isReordered && Array.isArray(enriched.senses)) {
        enriched.senses = senseOrder.map((i) => (enriched.senses as unknown[])[i]);
      }

      // Remap and selectively strip [[#N]] references in German gloss fields.
      //
      // Step 1 — Remap: if senses were reordered for display, update [[#N]] numbers to match
      //   the new display positions (same logic as remapTextLinked for examples).
      //
      // Step 2 — Strip: only strip the "under [[#N]] described …" phrase when N equals the
      //   immediately preceding sense (N = i for a sense at 0-based position i+1). These are
      //   sub-sense definitions like "[7a] the [7]-described strip, wound on a spool". All
      //   other cross-references (e.g. [7] references [2] for comparison) are kept as-is;
      //   GlossText.vue renders them as clickable inline_ref links.
      if (Array.isArray(enriched.senses)) {
        const remapForGloss = senseRemaps.get(fileKey);
        const senses = enriched.senses as Record<string, unknown>[];
        for (let i = 0; i < senses.length; i++) {
          const s = senses[i];
          if (typeof s.gloss !== "string" || !s.gloss.includes("[[#")) continue;
          let g = s.gloss;

          // Step 1: remap numbers after sense reordering
          if (remapForGloss) {
            g = g.replace(/\[\[#(\d+)\]\]/g, (match, n) => {
              const newN = remapForGloss.get(parseInt(n, 10));
              return newN != null ? `[[#${newN}]]` : match;
            });
          }

          // Step 2: strip phrases that reference the immediately preceding sense only
          if (i > 0) {
            const prevN = String(i); // 1-indexed position of the preceding sense
            const token = `\\[\\[#${prevN}\\]\\]`;
            if (g.includes(`[[#${prevN}]]`)) {
              g = g.replace(new RegExp(`ein dem unter ${token} beschriebenen? \\S+[-/\\w]* ähnelnder,?\\s*`, "g"), "");
              g = g.replace(new RegExp(`^(?:der|die|das) unter ${token} beschriebene[nm]? \\S+[-/\\w]* `, "g"), "");
              g = g.replace(new RegExp(` unter ${token} beschriebene[nm]?`, "g"), "");
              g = g.replace(new RegExp(token, "g"), ""); // strip any orphan prevN tokens
              g = g.replace(/ {2,}/g, " ").trim();
            }
          }

          s.gloss = g;
        }
      }

      // Inject form_examples collected from stub forms (e.g. eine, einer, … → ein)
      const stubFEs = stubFormExamplesMap.get(fileKey);
      if (stubFEs?.length) enriched.form_examples = stubFEs;

      const dataJson = JSON.stringify(enriched);
      const pluralDominant = (data as Record<string, unknown>).plural_dominant as boolean | undefined;
      const pluralForm = (data as Record<string, unknown>).plural_form as string | undefined;
      // Store accusative singular only when it differs from the lemma (n-declension and
      // adjective-derived nouns). Used by search to detect "den Mensch"-style mismatches.
      const accSingular = isNounLike(data)
        ? ((data as NounWord).case_forms?.singular?.acc ?? null)
        : null;
      const accForm = accSingular && accSingular !== data.word ? accSingular : null;
      const superlative = data.pos === "adjective"
        ? (data as Record<string, unknown>).superlative as string | undefined ?? null
        : null;
      const comparative = data.pos === "adjective"
        ? (data as Record<string, unknown>).comparative as string | undefined ?? null
        : null;
      const result = insertWord.run({
        lemma: data.word,
        lemma_folded: foldUmlauts(data.word),
        pos: data.pos.toUpperCase(),
        gender: (data as Record<string, unknown>).gender as string | null ?? null,
        frequency: frequencyRank.get(fileKey) ?? null,
        plural_dominant: pluralDominant ? 1 : null,
        plural_form: pluralForm ?? null,
        acc_form: accForm,
        superlative,
        comparative,
        file: fileKey,
        gloss_en: glossEn.length ? JSON.stringify(glossEn) : null,
        data: dataJson,
        hash: contentHash(dataJson),
      });
      wordCount++;

      const wordId = result.lastInsertRowid;

      // Pre-compute verb forms for search
      if (isVerbWord(data) && verbEndings && (data.conjugation_class === "irregular" || data.stems)) {
        const verbForInput = data.conjugation_class === "irregular"
          ? data
          : { ...data, conjugation: enriched.conjugation as ConjugationTable };
        const forms = computeAllForms(verbForInput, verbEndings);
        for (const form of forms) {
          // Skip infinitive — already matched by lemma search
          if (form === data.word.toLowerCase()) continue;
          insertWordForm.run({ form, word_id: wordId });
          wordFormCount++;
        }
      }

      // Pre-compute noun case forms for search (plural, genitive, dative, etc.)
      if (isNounLike(data) && (data as NounWord).case_forms) {
        const caseForms = (data as NounWord).case_forms;
        const lemmaLower = data.word.toLowerCase();
        const seenForms = new Set<string>();
        for (const number of Object.values(caseForms) as CaseForms[keyof CaseForms][]) {
          if (number == null) continue;
          for (const form of Object.values(number)) {
            if (form == null) continue;
            const lower = (form as string).toLowerCase();
            if (lower === lemmaLower) continue; // skip nom sg (matched by lemma search)
            if (seenForms.has(lower)) continue;
            seenForms.add(lower);
            insertWordForm.run({ form: lower, word_id: wordId });
            wordFormCount++;
          }
        }
        // Also index alternative case forms
        const caseFormsAlt = (data as NounWord).case_forms_alt;
        if (caseFormsAlt) {
          for (const numKey of ["singular", "plural"] as const) {
            const altNum = caseFormsAlt[numKey];
            if (!altNum) continue;
            for (const forms of Object.values(altNum)) {
              for (const form of forms) {
                const lower = form.toLowerCase();
                if (lower === lemmaLower || seenForms.has(lower)) continue;
                seenForms.add(lower);
                insertWordForm.run({ form: lower, word_id: wordId });
                wordFormCount++;
              }
            }
          }
        }
      }

      // Pre-compute adjective comparison forms for search (comparative + superlative stem)
      if (data.pos === "adjective") {
        const adj = data as AdjectiveWord;
        if (adj.comparative) {
          const comp = adj.comparative.toLowerCase();
          if (comp !== data.word.toLowerCase()) {
            insertWordForm.run({ form: comp, word_id: wordId });
            wordFormCount++;
          }
        }
        if (adj.superlative) {
          // Superlative stored as "am X" — strip prefix to index the stem only.
          // Full "am X" form is handled at search time via superlative column.
          const supStem = adj.superlative.startsWith("am ")
            ? adj.superlative.slice(3).trim().toLowerCase()
            : adj.superlative.toLowerCase();
          if (supStem.length >= 4 && supStem !== data.word.toLowerCase()) {
            insertWordForm.run({ form: supStem, word_id: wordId });
            wordFormCount++;
          }
        }
      }

      // Extract English reverse-lookup terms from glosses + synonyms_en
      const enTerms = extractEnTerms(data.senses || []);
      for (const term of enTerms) {
        insertEnTerm.run({ form: term, word_id: wordId });
        enTermCount++;
      }

    }
  });

  insertWords();

  // --------------------------------------------------------
  // Phase 1.5: Index determiner/possessive paradigm forms in word_forms
  // Stubs are removed from words table, so we index all paradigm cells here
  // so that "die", "dem", "eine", "einer", etc. find their base form.
  // --------------------------------------------------------

  const DETERMINER_RULES_FILE = join(DATA_DIR, "rules", "determiner-declensions.json");
  if (existsSync(DETERMINER_RULES_FILE)) {
    interface ParadigmRow {
      lemma: string;
      forms: Record<string, Record<string, string> | null>;
      alt_forms?: string[];
    }
    const detRules = JSON.parse(readFileSync(DETERMINER_RULES_FILE, "utf-8")) as { paradigms: ParadigmRow[] };
    const selectWordId = db.prepare<[string], { id: number }>(`SELECT id FROM words WHERE file = ?`);

    const insertParadigmForms = db.transaction(() => {
      for (const paradigm of detRules.paradigms) {
        // Use baseKeyByWord to look up the correct posDir-qualified fileKey.
        // Determiners live in "determiners/", possessive pronouns in "pronouns/".
        // This avoids collisions with e.g. adjectives/ein.json (numeral "ein").
        const baseFileKey =
          baseKeyByWord.get(`determiners/${paradigm.lemma}`) ??
          baseKeyByWord.get(`pronouns/${paradigm.lemma}`);
        if (!baseFileKey) continue;

        const row = selectWordId.get(baseFileKey);
        if (!row) continue;
        const wordId = row.id;

        const lemmaLower = paradigm.lemma.toLowerCase();
        const seenForms = new Set<string>([lemmaLower]);

        // Index all cells from paradigm.forms
        for (const genderForms of Object.values(paradigm.forms)) {
          if (!genderForms) continue;
          for (const form of Object.values(genderForms)) {
            const lower = form.toLowerCase();
            if (seenForms.has(lower)) continue;
            seenForms.add(lower);
            insertWordForm.run({ form: lower, word_id: wordId });
            wordFormCount++;
          }
        }

        // Also index contracted alt_forms (e.g. unsren, unsrem for unser)
        if (paradigm.alt_forms) {
          for (const form of paradigm.alt_forms) {
            const lower = form.toLowerCase();
            if (seenForms.has(lower)) continue;
            seenForms.add(lower);
            insertWordForm.run({ form: lower, word_id: wordId });
            wordFormCount++;
          }
        }
      }
    });
    insertParadigmForms();
  }

  console.log(`Inserted ${wordCount} words, ${wordFormCount} word forms, ${enTermCount} English terms.`);

  // --------------------------------------------------------
  // Phase 2: Create indexes (after bulk insert for speed)
  // --------------------------------------------------------

  db.exec(`
    CREATE INDEX idx_words_lemma        ON words(lemma COLLATE NOCASE);
    CREATE INDEX idx_words_lemma_folded ON words(lemma_folded);
    CREATE INDEX idx_words_freq         ON words(frequency);
    CREATE INDEX idx_word_forms         ON word_forms(form);
    CREATE INDEX idx_en_terms           ON en_terms(term);
  `);

  // --------------------------------------------------------
  // Phase 3: Process examples → cross-reference linking + examples table
  // --------------------------------------------------------

  const examples: ExampleMap = loadExamples();
  if (Object.keys(examples).length > 0) {
    const lookup = buildWordLookup(files);
    let linkedCount = 0;
    let staleRecomputed = 0;

    // Build set of valid file paths for staleness detection
    const validPaths = new Set<string>();
    for (const entries of lookup.values()) {
      for (const e of entries) validPaths.add(`${e.posDir}/${e.file}`);
    }

    // Check if proofread text_linked references paths that no longer exist
    const linkPathRe = /\[\[[^|]+\|([^\]#]+)(?:#\d+)?\]\]/g;
    function hasStaleLinks(textLinked: string): boolean {
      let m;
      linkPathRe.lastIndex = 0;
      while ((m = linkPathRe.exec(textLinked))) {
        if (!validPaths.has(m[1])) return true;
      }
      return false;
    }

    for (const [, ex] of Object.entries(examples)) {
      // One-time migration: move manual refs from text to text_linked
      if (ex.text.includes("[[") && !ex.text_linked) {
        ex.text_linked = ex.text;
        ex.text = stripReferences(ex.text);
      }

      if (!ex.annotations || ex.annotations.length === 0) {
        delete ex.text_linked;
        continue;
      }

      // Skip recomputation for proofread examples — unless text_linked has stale paths
      if (ex._proofread?.annotations && ex.text_linked && !hasStaleLinks(ex.text_linked)) {
        linkedCount++;
        continue;
      }
      if (ex._proofread?.annotations && ex.text_linked) {
        staleRecomputed++;
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
    const phraseLookup = new Map<string, string>();
    if (existsSync(phraseDir)) {
      for (const file of readdirSync(phraseDir)) {
        if (!file.endsWith(".json")) continue;
        const phraseData = JSON.parse(
          readFileSync(join(phraseDir, file), "utf-8"),
        ) as WordBase;
        phraseLookup.set(phraseData.word, `phrases/${file.replace(".json", "")}`);
      }
    }

    let refCount = 0;
    // Collect expression IDs per phrase file for back-linking
    const phraseExprIds = new Map<string, string[]>();
    for (const [id, ex] of Object.entries(examples)) {
      if (ex.type !== "expression" && ex.type !== "proverb") continue;
      const phraseRef = phraseLookup.get(ex.text);
      if (phraseRef) {
        ex.ref = phraseRef;
        refCount++;
        const list = phraseExprIds.get(phraseRef) ?? [];
        list.push(id);
        phraseExprIds.set(phraseRef, list);
      } else {
        delete ex.ref;
      }
    }

    // Back-link: add expression example IDs to phrase word files
    let phraseLinked = 0;
    for (const [ref, exIds] of phraseExprIds) {
      const filePath = join(DATA_DIR, "words", ref + ".json");
      if (!existsSync(filePath)) continue;
      const phraseData = JSON.parse(readFileSync(filePath, "utf-8"));
      if (!phraseData.senses?.length) continue;
      const origIds = phraseData.senses[0].example_ids ?? [];
      const merged = new Set(origIds);
      for (const id of exIds) merged.add(id);
      if (merged.size !== origIds.length || exIds.some((id) => !origIds.includes(id))) {
        phraseData.senses[0].example_ids = [...merged];
        writeFileSync(filePath, JSON.stringify(phraseData, null, 2) + "\n");
        phraseLinked++;
      }
    }

    // Write back (keeps shards as source of truth)
    saveExamples(examples);
    console.log(`Linked ${linkedCount} examples with cross-references.`);
    if (staleRecomputed > 0) {
      console.log(`Recomputed ${staleRecomputed} proofread examples with stale paths.`);
    }
    if (refCount > 0) {
      console.log(`Linked ${refCount} expressions to phrase cards (${phraseLinked} phrase files updated).`);
    }

    // Insert examples into SQLite — strip build-only fields, remap sense numbers
    const exampleStripKeys = ["lemmas", "annotations", "translation_model", "_proofread", "source"];
    // Remap [[form|path#N]] sense numbers in text_linked to match reordered DB senses
    const senseRefRe = /\[\[([^|]+)\|([^\]#]+)#(\d+)\]\]/g;
    function remapTextLinked(textLinked: string): string {
      return textLinked.replace(senseRefRe, (match, form, path, numStr) => {
        const remap = senseRemaps.get(path);
        if (!remap) return match;
        const oldNum = parseInt(numStr, 10);
        const newNum = remap.get(oldNum);
        if (newNum === undefined) return match;
        return `[[${form}|${path}#${newNum}]]`;
      });
    }
    let remappedCount = 0;
    const insertExamples = db.transaction(() => {
      for (const [id, ex] of Object.entries(examples)) {
        const stripped: Record<string, unknown> = { ...ex };
        for (const k of exampleStripKeys) delete stripped[k];
        // Remap sense numbers in DB copy only (shard files untouched)
        if (stripped.text_linked && senseRemaps.size > 0) {
          const remapped = remapTextLinked(stripped.text_linked as string);
          if (remapped !== stripped.text_linked) {
            stripped.text_linked = remapped;
            remappedCount++;
          }
        }
        // Strip outer quotation marks and ellipsis markers at index time
        if (typeof stripped.text === "string") stripped.text = stripEllipsisMarkers(stripOuterQuotes(stripped.text));
        if (typeof stripped.text_linked === "string") stripped.text_linked = stripEllipsisMarkers(stripOuterQuotes(stripped.text_linked));
        if (typeof stripped.translation === "string") stripped.translation = stripEllipsisMarkers(stripOuterQuotes(stripped.translation));
        const exData = JSON.stringify(stripped);
        insertExample.run({ id, data: exData, hash: contentHash(exData) });
      }
    });
    insertExamples();
    console.log(`Inserted ${Object.keys(examples).length} examples (${remappedCount} sense refs remapped).`);
  }

  // --------------------------------------------------------
  // Phase 5: Version hash
  // --------------------------------------------------------

  const version = computeVersionHash(db);
  const builtAt = new Date().toISOString();
  insertMeta.run({ key: "version", value: version });
  insertMeta.run({ key: "built_at", value: builtAt });
  insertMeta.run({ key: "schema_version", value: "4" }); // bump when adding/removing columns

  // Switch from WAL to DELETE journal mode for read-only runtime use
  db.pragma("journal_mode = DELETE");
  db.close();

  // Read version back from the DB (single source of truth) and write version files
  const dbReadOnly = new Database(DB_PATH, { readonly: true });
  const row = dbReadOnly.prepare("SELECT value FROM meta WHERE key = 'version'").get() as MetaQueryRow;
  const dbVersion = row.value;
  dbReadOnly.close();

  writeFileSync(join(DATA_DIR, "db-version.txt"), dbVersion);

  // Copy DB + version to public/data/ for dev server
  const PUBLIC_DATA = join(ROOT, "public", "data");
  if (existsSync(PUBLIC_DATA)) {
    copyFileSync(DB_PATH, join(PUBLIC_DATA, "lexiklar.db"));
    writeFileSync(join(PUBLIC_DATA, "db-version.txt"), dbVersion);
    console.log(`Copied DB + version to public/data/`);
  }

  console.log(`Database version: ${dbVersion} (built ${builtAt})`);

  console.log(`Built ${DB_PATH} successfully.`);
}

main();
