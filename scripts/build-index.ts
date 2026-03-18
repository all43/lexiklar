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
import { loadExamples, saveExamples } from "./lib/examples.js";
import { computeConjugation, computeAllForms } from "../src/utils/verb-forms.js";
import type {
  Word,
  WordBase,
  NounWord,
  VerbWord,
  Sense,
  VerbEndingsFile,
  ConjugationTable,
  CaseForms,
} from "../types/index.js";
import type { Example, ExampleMap, Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
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

interface WordLookupEntry {
  posDir: string;
  file: string;
  senses: Sense[];
}

interface ResolvedTarget {
  posDir: string;
  file: string;
  senseNumber: number | null;
}

interface TextMatch {
  start: number;
  end: number;
  token: string;
}

interface Relation {
  file: string;
  type: string;
}

interface WordInsertParams {
  lemma: string;
  lemma_folded: string;
  pos: string;
  gender: string | null;
  frequency: number | null;
  plural_dominant: number | null;
  plural_form: string | null;
  file: string;
  gloss_en: string | null;
  data: string;
  hash: string;
}

interface WordFormInsertParams {
  form: string;
  word_id: number | bigint;
}

interface ExampleInsertParams {
  id: string;
  data: string;
  hash: string;
}

interface MetaInsertParams {
  key: string;
  value: string;
}

interface MetaRow {
  value: string;
}

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

function findJsonFiles(): string[] {
  const results: string[] = [];
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
function computeVersionHash(files: string[]): string {
  const hash = createHash("sha256");
  // Include build script's mtime so logic changes invalidate the cache
  const scriptStat = statSync(new URL(import.meta.url).pathname);
  hash.update("build-index.js:" + String(scriptStat.mtimeMs));
  // Include source files and rule files that affect indexed forms.
  // Any change to these should invalidate the cached DB.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const trackedSources = [
    "src/utils/verb-forms.js",          // verb conjugation + word_forms generation
    "data/rules/verb-endings.json",      // verb ending tables used by computeAllForms
    "data/rules/noun-gender.json",       // noun gender rules (affects noun data)
    "data/rules/adj-endings.json",       // adjective ending tables
  ];
  for (const src of trackedSources) {
    const p = join(root, src);
    if (existsSync(p)) hash.update(src + ":" + String(statSync(p).mtimeMs));
  }
  for (const f of files.sort()) {
    const stat = statSync(f);
    hash.update(f + ":" + String(stat.mtimeMs));
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

/**
 * Resolve an annotation to a word file path + optional sense number.
 * Returns {posDir, file, senseNumber} or null.
 */
function resolveWordFile(
  lemma: string,
  pos: string,
  glossHint: string | null,
  lookup: Map<string, WordLookupEntry[]>,
): ResolvedTarget | null {
  const key = `${lemma}|${pos}`;
  const entries = lookup.get(key);
  if (!entries || entries.length === 0) return null;

  // Single match — no disambiguation needed
  let entry = entries[0];
  let senseNumber: number | null = null;

  if (glossHint) {
    const hintLower = glossHint.toLowerCase();
    // Crude English stem: strip common inflectional suffixes for fuzzy matching.
    // Only strip suffixes that leave a stem of at least 4 chars to avoid
    // false positives ("time"→"tim" matching "moment", "free"→"fre" matching "freelance").
    const hintStem = hintLower
      .replace(/ies$/, "y")       // "families" → "family"
      .replace(/ied$/, "y")       // "carried" → "carry"
      .replace(/ying$/, "y")      // not common but safe
      .replace(/ing$/, "")        // "running" → "runn" (close enough for substring)
      .replace(/ed$/, "")         // "voted" → "vot"
      .replace(/(?:es|en|s)$/, ""); // plurals: "consequences" → "consequenc"
    // Note: single -e is NOT stripped — too aggressive for short words (time→tim, base→bas)
    const useStem = hintStem.length >= 4 && hintStem !== hintLower;

    // Try German gloss first, then gloss_en fallback (LLMs often produce English hints).
    // Each pass: exact substring → stem fallback.
    for (const pass of ["gloss", "gloss_en"] as const) {
      // Exact substring match
      for (const candidate of entries) {
        for (let i = 0; i < candidate.senses.length; i++) {
          const gloss = candidate.senses[i][pass];
          if (gloss && gloss.toLowerCase().includes(hintLower)) {
            entry = candidate;
            senseNumber = i + 1; // 1-based
            break;
          }
        }
        if (senseNumber) break;
      }
      if (senseNumber) break;

      // Stem fallback: "consequences" matches "consequence", "voted" matches "vote"
      if (useStem) {
        for (const candidate of entries) {
          for (let i = 0; i < candidate.senses.length; i++) {
            const gloss = candidate.senses[i][pass];
            if (gloss && gloss.toLowerCase().includes(hintStem)) {
              entry = candidate;
              senseNumber = i + 1;
              break;
            }
          }
          if (senseNumber) break;
        }
        if (senseNumber) break;
      }
    }

    // Word-level fallback: check if any word in the hint appears in any gloss.
    // Only used for homonym file resolution — no sense number assigned (too imprecise).
    if (!senseNumber && entries.length > 1) {
      const hintWords = hintLower.split(/\s+/).filter(w => w.length >= 3);
      if (hintWords.length > 0) {
        let wordMatch: WordLookupEntry | null = null;
        for (const pass of ["gloss", "gloss_en"] as const) {
          for (const candidate of entries) {
            for (const sense of candidate.senses) {
              const gloss = sense[pass];
              if (!gloss) continue;
              const glossLower = gloss.toLowerCase();
              if (hintWords.some(w => glossLower.includes(w))) {
                wordMatch = candidate;
                break;
              }
            }
            if (wordMatch) break;
          }
          if (wordMatch) break;
        }
        if (wordMatch) entry = wordMatch;
        // No senseNumber — word-level match is too imprecise for sense disambiguation
      }
    }
  }

  return { posDir: entry.posDir, file: entry.file, senseNumber };
}

/**
 * Find a form in text using word-boundary-aware matching.
 * Returns the start index or -1.
 */
function findFormInText(text: string, form: string, startAfter: number): number {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?<![\\wäöüÄÖÜß])${escaped}(?![\\wäöüÄÖÜß])`,
    "u",
  );
  const slice = text.slice(startAfter);
  const match = slice.match(re);
  return match && match.index != null ? startAfter + match.index : -1;
}

/**
 * Convert annotations into [[display|path]] reference tokens.
 * Returns the linked text, or null if no links were generated.
 */
function annotateExampleText(
  text: string,
  annotations: Annotation[],
  lookup: Map<string, WordLookupEntry[]>,
): string | null {
  if (!annotations || annotations.length === 0) return null;

  const matches: TextMatch[] = [];

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
  const filtered: TextMatch[] = [matches[0]];
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
    INSERT INTO words (lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en, data, hash)
    VALUES (@lemma, @lemma_folded, @pos, @gender, @frequency, @plural_dominant, @plural_form, @file, @gloss_en, @data, @hash)
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

  const files = findJsonFiles();

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
        const targets =
          lemmaMap.get(partLemma) ||
          lemmaMap.get(partLemma.toLowerCase()) ||
          [];
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
  const ranked = allWordData
    .filter((e) => e.data.zipf != null)
    .sort((a, b) => (b.data.zipf ?? 0) - (a.data.zipf ?? 0));
  const frequencyRank = new Map<string, number>();
  for (let i = 0; i < ranked.length; i++) {
    frequencyRank.set(ranked[i].fileKey, i + 1);
  }

  // --------------------------------------------------------
  // Phase 1d: Insert word files → words + word_forms tables
  // --------------------------------------------------------

  let wordCount = 0;
  let wordFormCount = 0;
  let enTermCount = 0;

  const insertWords = db.transaction(() => {
    for (const entry of allWordData) {
      const { data, fileKey } = entry;

      // Collect English glosses as JSON array
      const glossEn = (data.senses || [])
        .map((s: Sense) => s.gloss_en)
        .filter(Boolean);

      // Build the runtime word object — only fields the app needs for display.
      // Strip computation inputs (stems, past_participle) and internal metadata (_meta).
      const enriched: Record<string, unknown> = { ...data };
      delete enriched._meta;
      delete enriched._derived;
      delete enriched._hyponyms;
      delete enriched._gender_counterpart;
      delete enriched._antonyms;
      delete enriched._synonyms;
      delete enriched.compound_source;
      delete enriched.compound_verified;

      // Inject oscillating flag computed in Phase 1b
      if (isVerbWord(data) && data._oscillating) enriched.oscillating_verb = true;
      delete enriched._oscillating;

      if (isVerbWord(data) && verbEndings) {
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

      const dataJson = JSON.stringify(enriched);
      const pluralDominant = (data as Record<string, unknown>).plural_dominant as boolean | undefined;
      const pluralForm = (data as Record<string, unknown>).plural_form as string | undefined;
      const result = insertWord.run({
        lemma: data.word,
        lemma_folded: foldUmlauts(data.word),
        pos: data.pos.toUpperCase(),
        gender: (data as Record<string, unknown>).gender as string | null ?? null,
        frequency: frequencyRank.get(fileKey) ?? null,
        plural_dominant: pluralDominant ? 1 : null,
        plural_form: pluralDominant ? (pluralForm ?? null) : null,
        file: fileKey,
        gloss_en: glossEn.length ? JSON.stringify(glossEn) : null,
        data: dataJson,
        hash: contentHash(dataJson),
      });
      wordCount++;

      const wordId = result.lastInsertRowid;

      // Pre-compute verb forms for search
      if (isVerbWord(data) && verbEndings) {
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

      // Skip recomputation for proofread examples — their text_linked was verified
      if (ex._proofread?.annotations && ex.text_linked) {
        linkedCount++;
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

    // Write back (keeps shards as source of truth)
    saveExamples(examples);
    console.log(`Linked ${linkedCount} examples with cross-references.`);
    if (refCount > 0) {
      console.log(`Linked ${refCount} expressions to phrase cards.`);
    }

    // Insert examples into SQLite
    const insertExamples = db.transaction(() => {
      for (const [id, ex] of Object.entries(examples)) {
        const exData = JSON.stringify(ex);
        insertExample.run({ id, data: exData, hash: contentHash(exData) });
      }
    });
    insertExamples();
    console.log(`Inserted ${Object.keys(examples).length} examples.`);
  }

  // --------------------------------------------------------
  // Phase 5: Version hash
  // --------------------------------------------------------

  const version = computeVersionHash(files);
  const builtAt = new Date().toISOString().slice(0, 10);
  insertMeta.run({ key: "version", value: version });
  insertMeta.run({ key: "built_at", value: builtAt });

  // Switch from WAL to DELETE journal mode for read-only runtime use
  db.pragma("journal_mode = DELETE");
  db.close();

  // Read version back from the DB (single source of truth) and write version files
  const dbReadOnly = new Database(DB_PATH, { readonly: true });
  const row = dbReadOnly.prepare("SELECT value FROM meta WHERE key = 'version'").get() as MetaRow;
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
