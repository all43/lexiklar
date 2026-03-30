import {
  createReadStream,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
} from "fs";
import { createInterface } from "readline";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import type {
  Sense,
  Sound,
  WordMeta,
  WordBase,
  NounWord,
  VerbWord,
  AdjectiveWord,
  GenderRule,
  CaseRow,
  CaseForms,
  ConjugationTable,
  VerbStems,
  FullDeclension,
  GenderedCaseRows,
  NounGenderRules,
  NounGenderRuleEntry,
  AdjEndingsTable,
  VerbEndingsFile,
  ProofreadFlags,
  WordOverrides,
  PrincipalParts,
  Example,
  ExampleMap,
} from "../types/index.js";

import type { PosKey } from "./lib/pos.js";
import { POS_CONFIG, SUPPORTED_POS } from "./lib/pos.js";
import { loadExamples, saveExamples } from "./lib/examples.js";
import { mergeSenses, mergeHomonymGroup } from "./lib/merge.js";
import type { OrphanEntry } from "./lib/merge.js";
import { computeConjugation } from "../src/utils/verb-forms.js";
import {
  extractVerbConjugation,
  extractVerbMeta,
  extractPresentStem,
  classifyVerb,
  extractStems,
  validateConjugation,
} from "./lib/verb-extract.js";

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const ROOT: string = join(__dirname, "..");
const RAW_FILE: string = join(ROOT, "data", "raw", "de-extract.jsonl");
const DATA_DIR: string = join(ROOT, "data");
const WORDS_DIR: string = join(DATA_DIR, "words");

const RULES_DIR: string = join(DATA_DIR, "rules");
const STATE_FILE: string = join(ROOT, "data", "raw", ".import-state.json");
const SEED_FILE: string = join(ROOT, "config", "seed-words.json");

// ============================================================
// Wiktionary JSONL entry types
// ============================================================

interface WiktionaryForm {
  form: string;
  tags?: string[];
  source?: string;
  pronouns?: string[];
  sense_index?: string;
}

interface WiktionarySenseExample {
  text: string;
  english?: string;
  translation?: string;
}

interface WiktionaryRelation {
  word: string;
}

interface WiktionarySense {
  glosses?: string[];
  tags?: string[];
  examples?: WiktionarySenseExample[];
  form_of?: WiktionaryRelation[];
  alt_of?: WiktionaryRelation[];
  sense_index?: string;
  synonyms?: WiktionaryRelation[];
  antonyms?: WiktionaryRelation[];
}

interface WiktionarySound {
  ipa?: string;
  tags?: string[];
}

interface WiktionaryExpression {
  word: string;
  note?: string;
}

interface WiktionaryEntry {
  word: string;
  lang_code: string;
  pos: string;
  pos_title?: string;
  tags?: string[];
  forms?: WiktionaryForm[];
  senses?: WiktionarySense[];
  sounds?: WiktionarySound[];
  etymology_number?: number;
  etymology_texts?: string[];
  categories?: string[];
  notes?: string[];
  expressions?: WiktionaryExpression[];
  proverbs?: WiktionaryExpression[];
  derived?: WiktionaryRelation[];
  hyponyms?: WiktionaryRelation[];
  antonyms?: WiktionaryRelation[];
  synonyms?: WiktionaryRelation[];
}

// ============================================================
// Internal types
// ============================================================

interface ImportState {
  entries: Record<string, { hash: string; file: string }>;
}

interface SeedConfig {
  words: Array<{ word: string }>;
}

interface WhitelistConfig {
  words: Array<{ word: string }>;
}

interface GroupEntry {
  offset: number;
  length: number;
  hash: string;
  stateKey: string;
}

interface CompoundBufferEntry {
  offset: number;
  length: number;
  pos: string;
}

interface CompoundResult {
  parts: string[];
  source: "wiktionary" | "algorithmic";
  verified: boolean;
}

interface AdjRegularityResult {
  regular: boolean;
  stem: string | null;
}

interface AdjComparison {
  comparative: string | null;
  superlative: string | null;
  umlaut_in_comparison: boolean;
}

/** Mutable word data used during transform before final write. */
interface TransformOutput {
  word: string;
  pos: string;
  etymology_number: number | null;
  senses: Sense[];
  sounds: Sound[];
  // Noun fields
  gender?: string | null;
  article?: string | null;
  plural_form?: string | null;
  gender_rule?: GenderRule | null;
  case_forms?: CaseForms;
  is_plural_only?: true;
  plural_only_note?: string;
  is_singular_only?: true;
  // Verb fields
  auxiliary?: string | null;
  separable?: boolean;
  prefix?: string | null;
  reflexive?: string;
  conjugation_class?: string | null;
  stems?: VerbStems;
  past_participle?: string | null;
  conjugation?: ConjugationTable | ReturnType<typeof extractVerbConjugation>;
  principal_parts?: PrincipalParts;
  // Adjective fields
  is_indeclinable?: boolean;
  comparative?: string | null;
  superlative?: string | null;
  umlaut_in_comparison?: boolean;
  declension_stem?: string | null;
  declension_regular?: boolean;
  declension?: FullDeclension;
  // Phrase fields
  phrase_type?: string;
  // Enrichment fields
  zipf?: number;
  plural_dominant?: boolean;
  // Compound fields
  compound_parts?: string[];
  compound_source?: string;
  compound_verified?: boolean;
  // Expression and relation fields
  expression_ids?: string[];
  _derived?: string[];
  _hyponyms?: string[];
  _antonyms?: string[];
  _synonyms?: string[];
  _gender_counterpart?: string;
  // Meta
  _meta?: WordMeta;
  _proofread?: ProofreadFlags;
  _overrides?: WordOverrides;
  /** LLM translations that could not be matched to any new sense by gloss text. Saved so they
   *  can be remapped manually or by a future tool. Survives re-transform. */
  _orphaned_translations?: Array<{
    gloss: string;
    gloss_en?: string | null;
    gloss_en_model?: string | null;
    gloss_en_full?: string | null;
    gloss_en_full_model?: string | null;
    synonyms_en?: string[] | null;
    synonyms_en_model?: string | null;
  }>;
  [key: string]: unknown;
}

/** Mutable example used during collection (before final write). */
interface CollectedExample {
  text: string;
  translation: string | null;
  source: string;
  lemmas: string[];
  type?: "expression" | "proverb";
  note?: string | null;
  synonyms?: string[];
  annotations?: unknown[];
  text_linked?: string;
  _proofread?: unknown;
}

// ============================================================
// Load rule files
// ============================================================

// Load adjective endings rule for regularity check
const ADJ_ENDINGS: AdjEndingsTable = JSON.parse(
  readFileSync(join(RULES_DIR, "adj-endings.json"), "utf-8"),
) as AdjEndingsTable;

// Load verb endings rules for conjugation classification
const VERB_ENDINGS: VerbEndingsFile = JSON.parse(
  readFileSync(join(RULES_DIR, "verb-endings.json"), "utf-8"),
) as VerbEndingsFile;

// Load noun gender rules for rule matching
const NOUN_GENDER_RULES: NounGenderRules = JSON.parse(
  readFileSync(join(RULES_DIR, "noun-gender.json"), "utf-8"),
) as NounGenderRules;

// Only match rules at 95%+ reliability; moderate rules are stored for future use
const ACTIVE_RELIABILITY = new Set<string>(["always", "nearly_always", "high"]);

// Pre-sort suffix rules by pattern length descending for longest-match-first
const SUFFIX_RULES: NounGenderRuleEntry[] = NOUN_GENDER_RULES.rules
  .filter((r) => r.type === "suffix" && ACTIVE_RELIABILITY.has(r.reliability))
  .sort((a, b) => b.pattern.length - a.pattern.length);

const NOMINALIZED_INF_RULE: NounGenderRuleEntry | undefined = NOUN_GENDER_RULES.rules.find(
  (r) => r.type === "nominalized_infinitive",
);

// ============================================================
// Utilities
// ============================================================

function sha256(str: string): string {
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 10);
}

/**
 * Compute a short fingerprint of a word's owned example IDs (across all senses
 * + expression_ids). Used to detect when _proofread.examples_owned is stale.
 */
function exampleIdsHash(data: TransformOutput): string {
  const ids: string[] = [];
  for (const sense of data.senses || []) {
    for (const id of sense.example_ids || []) ids.push(id);
  }
  for (const id of (data.expression_ids as string[]) || []) ids.push(id);
  ids.sort();
  return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 8);
}

function loadState(): ImportState {
  if (existsSync(STATE_FILE)) {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as ImportState;
    if (!data.entries) data.entries = {};
    return data;
  }
  return { entries: {} };
}

function saveState(state: ImportState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadSeedList(): Set<string> {
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf-8")) as SeedConfig;
  return new Set(seed.words.map((w) => w.word.toLowerCase()));
}

/**
 * Build a Set of words that appear in the top `maxRank` positions of the
 * Leipzig frequency list. Used to restrict the full pipeline to B2 vocabulary.
 * Words are stored exactly as they appear in the corpus (case-sensitive).
 * `maxSubtitleRank` can be set higher than `maxRank` to capture everyday
 * spoken vocabulary that is underrepresented in news corpora.
 */
function loadFrequencyFilter(
  wordsFile: string,
  subtitleFile: string,
  maxRank: number,
  maxSubtitleRank: number | null,
  whitelist: string[] = [],
): Set<string> {
  const filter = new Set<string>();

  // Leipzig news corpus: tab-separated (id\tword\tcount), mixed case
  if (existsSync(wordsFile)) {
    const entries = readFileSync(wordsFile, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        if (parts.length < 3) return null;
        return { word: parts[1], count: parseInt(parts[2], 10) };
      })
      .filter((e): e is { word: string; count: number } => e !== null)
      .sort((a, b) => b.count - a.count);
    for (let i = 0; i < Math.min(maxRank, entries.length); i++) {
      filter.add(entries[i].word.toLowerCase());
    }
    console.log(`  Leipzig: ${filter.size} unique forms from top ${maxRank}.`);
  }

  // OpenSubtitles: space-separated (word count), pre-sorted, already lowercase
  if (subtitleFile && existsSync(subtitleFile)) {
    const sizeBefore = filter.size;
    const lines = readFileSync(subtitleFile, "utf-8").split("\n").filter(Boolean);
    const subtitleLimit = maxSubtitleRank ?? maxRank;
    for (let i = 0; i < Math.min(subtitleLimit, lines.length); i++) {
      const spaceIdx = lines[i].lastIndexOf(" ");
      if (spaceIdx !== -1) filter.add(lines[i].slice(0, spaceIdx));
    }
    console.log(
      `  OpenSubtitles: +${filter.size - sizeBefore} new forms from top ${subtitleLimit}.`,
    );
  }

  // Whitelist: force-include CEFR/curated words regardless of corpus rank
  if (whitelist.length) {
    for (const w of whitelist) filter.add(w.toLowerCase());
    console.log(`  Whitelist: ${whitelist.length} forced word(s) added.`);
  }

  console.log(
    `Frequency filter: ${filter.size} unique forms total (corpora + whitelist).`,
  );
  return filter;
}

function splitForms(entry: WiktionaryEntry): { compact: WiktionaryForm[]; sourced: WiktionaryForm[] } {
  const forms = entry.forms || [];
  return {
    compact: forms.filter((f) => !f.source),
    sourced: forms.filter((f) => !!f.source),
  };
}

// Tags that identify a declension cell rather than a gender-pair reference.
const CASE_NUMBER_TAGS = new Set<string>([
  "nominative", "accusative", "dative", "genitive", "singular", "plural",
]);

/**
 * For a noun entry, find the gender-pair form reference (e.g. feminine for
 * masculine nouns, masculine for feminine nouns) from the forms array.
 * Returns the counterpart word string, or null if none found.
 *
 * Example: Automechaniker.forms contains
 *   { form: "Automechanikerin", tags: ["feminine"], sense_index: "1" }
 * which is distinct from declension forms that carry case/number tags.
 */
function extractGenderCounterpart(entry: WiktionaryEntry): string | null {
  if (entry.pos !== "noun") return null;
  const form = (entry.forms || []).find((f) => {
    const tags = f.tags || [];
    return (
      (tags.includes("feminine") || tags.includes("masculine")) &&
      !tags.some((t) => CASE_NUMBER_TAGS.has(t))
    );
  });
  return form ? form.form : null;
}

// ============================================================
// Global examples accumulator
// ============================================================

const allExamples: Record<string, CollectedExample> = {};

function collectExample(text: string, translation: string | null, lemma: string): string | null {
  if (!text) return null;
  const id = contentHash(text);
  if (!allExamples[id]) {
    allExamples[id] = {
      text,
      translation: translation || null,
      source: "wiktionary",
      lemmas: [lemma],
    };
  } else if (!allExamples[id].lemmas.includes(lemma)) {
    allExamples[id].lemmas.push(lemma);
  }
  return id;
}

/**
 * Collect an expression or proverb into the shared examples store.
 * Uses the same allExamples object and contentHash for dedup.
 */
// Articles and short stop-words that should not be recorded as expression synonyms
// even when they appear positionally after a real expression.
const EXPRESSION_SYNONYM_STOPWORDS = new Set<string>([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
  "und", "oder", "aber", "auch", "nicht", "so", "noch", "schon",
]);

function collectExpression(
  text: string,
  type: "expression" | "proverb",
  note: string | undefined | null,
  lemma: string,
): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const id = contentHash(trimmed);
  if (!allExamples[id]) {
    allExamples[id] = {
      text: trimmed,
      type,
      note: note || null,
      synonyms: [],
      translation: null,
      source: "wiktionary",
      lemmas: [lemma],
    };
  } else {
    if (!allExamples[id].lemmas.includes(lemma)) {
      allExamples[id].lemmas.push(lemma);
    }
    // Preserve richer note if not already set
    if (note && !allExamples[id].note) {
      allExamples[id].note = note;
    }
  }
  return id;
}

/** Add a synonym word to an existing expression entry. */
function addExpressionSynonym(expressionId: string | null, word: string): void {
  if (!expressionId || !allExamples[expressionId]) return;
  const trimmed = word.trim();
  if (!trimmed || EXPRESSION_SYNONYM_STOPWORDS.has(trimmed.toLowerCase())) return;
  if (!allExamples[expressionId].synonyms) allExamples[expressionId].synonyms = [];
  if (!allExamples[expressionId].synonyms!.includes(trimmed)) {
    allExamples[expressionId].synonyms!.push(trimmed);
  }
}

/**
 * Extract expressions and proverbs from a Wiktionary entry.
 * Returns array of content-hash IDs.
 *
 * Single-word entries in the expressions array are leaked Wiktionary synonyms/glosses
 * that appear positionally right after the expression they describe. We capture them
 * as synonyms on the preceding expression rather than as standalone entries.
 */
function extractExpressions(entry: WiktionaryEntry): string[] {
  const ids: string[] = [];
  let lastExprId: string | null = null;

  for (const e of entry.expressions || []) {
    if (e.word.includes(" ")) {
      // Multi-word → real expression
      const id = collectExpression(e.word, "expression", e.note, entry.word);
      if (id) { ids.push(id); lastExprId = id; }
    } else {
      // Single word → synonym of the preceding expression
      addExpressionSynonym(lastExprId, e.word);
    }
  }

  for (const p of entry.proverbs || []) {
    const id = collectExpression(p.word, "proverb", p.note, entry.word);
    if (id) ids.push(id);
  }

  return ids;
}

/**
 * Parse Wiktionary sense_index strings → 0-based indices.
 * Handles: "1" → [0], "1a" → [0], "1, 2" → [0,1], "1–3" → [0,1,2]
 */
function parseSenseIndices(idx: string | undefined): number[] {
  if (!idx) return [];
  const parts: number[] = [];
  for (const seg of idx.split(",").map((s) => s.trim())) {
    const rangeMatch = seg.match(/^(\d+)[–-](\d+)/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      for (let i = start; i <= end; i++) parts.push(i - 1);
    } else {
      const n = parseInt(seg);
      if (!isNaN(n) && n > 0) parts.push(n - 1);
    }
  }
  return [...new Set(parts)];
}

/**
 * Remove near-duplicate proverbs/expressions from a list of expression IDs.
 *
 * Two expressions are considered duplicates when their word-level Jaccard similarity
 * (after stripping leading conjunctions) is >= JACCARD_THRESHOLD.
 *
 * This avoids false positives from comma-stripping: expressions that share only a
 * consequence clause ("da ist auch Wasser") but differ in their subject clause are
 * kept separate, while genuine variants ("wenn ... ist" vs "ist ..., dann ...") that
 * share nearly all words are merged.
 *
 * Threshold 0.82 validated against known cases:
 *   dedup  "ist die Katze aus dem Haus, ..." / "wenn die Katze aus dem Haus ist, ..." (j=1.0)
 *   dedup  "... Esel zu wohl ist, ..." / "... Esel zu wohl wird, ..." (j=0.83)
 *   keep   "Tor zur Welt" / "Tor zum Himmel" (j=0.73)
 *   keep   "wissen, wo der Frosch" / "zeigen, wo der Frosch" (j=0.75)
 *   keep   "Wo Frosche sind" / "Wo Weiden sind" (j=0.67)
 *
 * When duplicates are found, keep the one with a note (more informative), otherwise
 * keep the first.
 */
function deduplicateExpressions(ids: string[]): string[] {
  if (ids.length <= 1) return ids;

  const JACCARD_THRESHOLD = 0.82;
  const LEADING_CONJ = /^(wenn|falls|als|sobald|weil|da|ob)\s+/i;

  function wordSet(text: string): Set<string> {
    return new Set(
      text.toLowerCase().replace(LEADING_CONJ, "").split(/\W+/).filter(Boolean),
    );
  }

  function jaccard(a: Set<string>, b: Set<string>): number {
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return inter / (a.size + b.size - inter);
  }

  // Cache word sets to avoid recomputing
  const cache = new Map<string, Set<string>>();
  function getWords(id: string): Set<string> {
    if (!cache.has(id)) {
      const ex = allExamples[id];
      cache.set(id, ex ? wordSet(ex.text) : new Set());
    }
    return cache.get(id)!;
  }

  const result: string[] = [];

  outer: for (const id of ids) {
    const ex = allExamples[id];
    if (!ex) { result.push(id); continue; }

    const ws = getWords(id);
    for (let i = 0; i < result.length; i++) {
      const existingId = result[i];
      if (jaccard(ws, getWords(existingId)) >= JACCARD_THRESHOLD) {
        // Duplicate — keep the one with a note
        const existing = allExamples[existingId];
        if (!existing?.note && ex.note) result[i] = id;
        continue outer;
      }
    }
    result.push(id);
  }

  return result;
}

// ============================================================
// Shared parsers
// ============================================================

/**
 * Build a mapping from Wiktionary sense_index → our 1-based output position.
 * Only counts senses that survive the form_of/alt_of filter.
 */
function buildSenseIndexMap(rawSenses: WiktionarySense[]): Record<string, number> {
  const map: Record<string, number> = {};
  let outputIdx = 1;
  for (const s of rawSenses) {
    if (s.form_of?.length || s.alt_of?.length) continue;
    if (s.sense_index) {
      map[s.sense_index] = outputIdx;
    }
    outputIdx++;
  }
  return map;
}

/**
 * Resolve Wiktionary cross-reference markup in gloss text to our reference tokens.
 *
 * Input patterns (from kaikki/wiktextract):
 *   ^([1])                  -> superscript sense ref (~1,048 in full dataset)
 *   [N] (bare, in context)  -> unter [2], Frucht von [1], in [1], etc. (~1,200 total)
 *
 * Output tokens:
 *   [[^N]]  -- superscript reference to sense N (1-based)
 *   [[#N]]  -- inline reference to sense N (1-based)
 *
 * Unmappable refs (pointing to filtered-out senses) are stripped.
 */
function resolveGlossRefs(gloss: string, senseIndexMap: Record<string, number>): string {
  return gloss
    // ^([N]) → [[^mapped]] (superscript sense refs)
    .replace(/\s*\^\(\[(\d+)\]\)/g, (_, n: string) => {
      const mapped = senseIndexMap[n];
      return mapped != null ? ` [[^${mapped}]]` : "";
    })
    // All remaining [N] → [[#mapped]] (covers unter [N], Frucht von [N], in [N], etc.)
    .replace(/\[(\d+)\]/g, (_, n: string) => {
      const mapped = senseIndexMap[n];
      return mapped != null ? `[[#${mapped}]]` : "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

function transformSenses(entry: WiktionaryEntry): Sense[] {
  const rawSenses = entry.senses || [];
  const senseIndexMap = buildSenseIndexMap(rawSenses);

  return rawSenses
    .filter((s) => !s.form_of?.length && !s.alt_of?.length)
    .map((s) => {
      const exampleIds = [...new Set(
        (s.examples || [])
          .map((e) =>
            collectExample(
              e.text,
              e.english || e.translation || null,
              entry.word,
            ),
          )
          .filter((id): id is string => id !== null),
      )];

      // Use the most specific gloss (last in array), or first if only one
      const glosses = s.glosses || [];
      const rawGloss = glosses[glosses.length - 1] || glosses[0] || "";
      const gloss = resolveGlossRefs(rawGloss, senseIndexMap);

      return {
        gloss,
        gloss_en: null,
        tags: s.tags || [],
        example_ids: exampleIds,
        synonyms: (s.synonyms || []).map((x) => x.word).filter(Boolean),
        antonyms: (s.antonyms || []).map((x) => x.word).filter(Boolean),
      };
    })
    // Drop Wiktionary section-header artifacts (e.g. "transitiv:", "Plural 1:")
    // — they carry no definition content and clutter the sense list
    .filter((s) => !(s.gloss.trim().endsWith(":") && s.example_ids.length === 0));
}

function extractSounds(entry: WiktionaryEntry): Sound[] {
  return (entry.sounds || [])
    .filter((s): s is WiktionarySound & { ipa: string } => !!s.ipa)
    .map((s) => ({ ipa: s.ipa, tags: s.tags || [] }));
}

// ============================================================
// Noun parsing
// ============================================================

function parseGender(entry: WiktionaryEntry): "M" | "F" | "N" | null {
  const tags = entry.tags || [];
  const hasM = tags.includes("masculine");
  const hasF = tags.includes("feminine");
  const hasN = tags.includes("neuter");
  // ~989 Wiktionary nouns list both masculine and neuter (e.g. Radio, Drittel,
  // Viertel, Bonbon, Virus). Standard German overwhelmingly prefers neuter for
  // these; masculine is regional (Swiss/Austrian). Prefer N over M for dual-gender.
  if (hasM && hasN) return "N";
  if (hasF) return "F";
  if (hasM) return "M";
  if (hasN) return "N";
  return null;
}

const CASE_TAGS: Record<string, keyof CaseRow> = {
  nominative: "nom",
  accusative: "acc",
  dative: "dat",
  genitive: "gen",
};

interface NullableCaseRow {
  nom: string | null;
  acc: string | null;
  dat: string | null;
  gen: string | null;
}

interface NullableCaseForms {
  singular: NullableCaseRow;
  plural: NullableCaseRow;
}

function extractNounCaseForms(compact: WiktionaryForm[]): NullableCaseForms {
  const cases: NullableCaseForms = {
    singular: { nom: null, acc: null, dat: null, gen: null },
    plural: { nom: null, acc: null, dat: null, gen: null },
  };

  for (const f of compact) {
    const tags = new Set(f.tags || []);
    for (const [tag, key] of Object.entries(CASE_TAGS)) {
      if (!tags.has(tag)) continue;
      const num: "singular" | "plural" = tags.has("plural") ? "plural" : "singular";
      if (!cases[num][key]) {
        cases[num][key] = f.form;
      }
    }
  }

  return cases;
}

function parsePluralForm(compact: WiktionaryForm[]): string | null {
  for (const f of compact) {
    const tags = new Set(f.tags || []);
    if (tags.has("nominative") && tags.has("plural")) return f.form;
  }
  return null;
}

/**
 * Match a noun against gender rules.
 * Returns { rule_id, is_exception } or null if no rule matches.
 */
function matchNounGenderRule(word: string, gender: string | null, pluralForm: string | null): GenderRule | null {
  if (!gender) return null;

  // Step 1: Check nominalized infinitive
  // Heuristic: uppercase first letter, ends in -en/-eln/-ern, neuter, no plural
  if (
    NOMINALIZED_INF_RULE &&
    gender === "N" &&
    pluralForm === null &&
    /^[A-ZÄÖÜ]/.test(word) &&
    /(?:en|eln|ern)$/.test(word)
  ) {
    return {
      rule_id: NOMINALIZED_INF_RULE.id,
      is_exception: false,
    };
  }

  // Step 2: Suffix rules (already sorted longest-first)
  // Require at least 2 characters before the suffix to avoid false matches
  // (e.g. "Tor" for -or, "Ei" for -ei, "Mist" for -ist)
  const wordLower = word.toLowerCase();
  for (const rule of SUFFIX_RULES) {
    if (wordLower.endsWith(rule.pattern) && word.length - rule.pattern.length >= 2) {
      // Flag false suffix matches (e.g. "Frist" for -ist, "Geist" for -ist)
      // Compounds are checked by their final component (e.g. "Kündigungsfrist" ends with "Frist")
      const falseMatches = rule.false_matches;
      if (
        falseMatches &&
        falseMatches.length > 0 &&
        falseMatches.some((e) => wordLower === e.toLowerCase() || wordLower.endsWith(e.toLowerCase()))
      ) {
        return {
          rule_id: rule.id,
          is_exception: false,
          is_false_match: true,
        };
      }
      const isException = gender !== rule.predicted_gender;
      return {
        rule_id: rule.id,
        is_exception: isException,
      };
    }
  }

  // Step 3: No match
  return null;
}

function transformNoun(entry: WiktionaryEntry, posLabel: string = "noun"): TransformOutput {
  const { compact } = splitForms(entry);
  const gender = parseGender(entry);
  const caseForms = extractNounCaseForms(compact);
  const pluralForm = parsePluralForm(compact);

  // Detect plural-only nouns (Pluraletantum) from Wiktionary categories
  const isPluralOnly = (entry.categories || []).includes(
    "Pluraletantum (Deutsch)",
  );

  // Detect singular-only nouns (Singularetantum) from Wiktionary categories
  const isSingularOnly = (entry.categories || []).includes(
    "Singularetantum (Deutsch)",
  );

  if (!isPluralOnly && !caseForms.singular.nom) {
    // Only apply singular nom fallback for regular nouns
    caseForms.singular.nom = entry.word;
  }

  // Extract singular note for Pluraletantum words (free-text from Wiktionary)
  const pluralOnlyNote =
    isPluralOnly && entry.notes?.length ? entry.notes[0] : undefined;

  const articleMap: Record<string, string> = { M: "der", F: "die", N: "das" };

  return {
    word: entry.word,
    pos: posLabel,
    etymology_number: entry.etymology_number || null,
    is_plural_only: isPluralOnly || undefined,
    plural_only_note: pluralOnlyNote,
    is_singular_only: isSingularOnly || undefined,
    gender,
    article: isPluralOnly
      ? "die"
      : gender
        ? articleMap[gender]
        : null,
    plural_form: pluralForm,
    gender_rule: matchNounGenderRule(entry.word, gender, pluralForm),
    case_forms: caseForms as unknown as CaseForms,
    senses: transformSenses(entry),
    sounds: extractSounds(entry),
  };
}

function transformVerb(entry: WiktionaryEntry): TransformOutput {
  const { compact, sourced } = splitForms(entry);
  const meta = extractVerbMeta(entry, compact);
  const fullConjugation = extractVerbConjugation(
    compact, sourced, meta.separable, meta.reflexive, meta.prefix,
  );

  const { separable, prefix } = meta;
  const presentStem = extractPresentStem(entry.word, separable, prefix);
  const cls = classifyVerb(fullConjugation, presentStem, separable, prefix);
  const past_participle: string | null =
    fullConjugation.participle2 || meta.principal_parts.past_participle;

  const base: TransformOutput = {
    word: entry.word,
    pos: "verb",
    etymology_number: entry.etymology_number || null,
    auxiliary: meta.auxiliary,
    separable: meta.separable,
    prefix: meta.prefix,
    reflexive: meta.reflexive,
    senses: [],
    sounds: [],
  };

  // Irregular verbs: store full conjugation table as-is
  if (cls === "irregular") {
    return {
      ...base,
      conjugation_class: "irregular",
      conjugation: fullConjugation,
      past_participle,
      senses: transformSenses(entry),
      sounds: extractSounds(entry),
    };
  }

  // Extract stems and validate by recomputing
  const stems: VerbStems = extractStems(
    fullConjugation, cls, presentStem, separable, prefix,
  );

  const verbForValidation = {
    word: entry.word,
    conjugation_class: cls,
    stems,
    past_participle,
    separable,
    prefix,
  };

  const computed = computeConjugation(verbForValidation, VERB_ENDINGS);
  const validation = validateConjugation(computed, fullConjugation);

  if (!validation.valid) {
    console.log(
      `  ${entry.word}: validation failed (${validation.mismatch}), storing as irregular`,
    );
    return {
      ...base,
      conjugation_class: "irregular",
      conjugation: fullConjugation,
      past_participle,
      senses: transformSenses(entry),
      sounds: extractSounds(entry),
    };
  }

  return {
    ...base,
    conjugation_class: cls,
    stems,
    past_participle,
    senses: transformSenses(entry),
    sounds: extractSounds(entry),
  };
}

// ============================================================
// Adjective parsing
// ============================================================

function extractAdjComparison(compact: WiktionaryForm[], word: string): AdjComparison {
  let comparative: string | null = null;
  let superlative: string | null = null;

  for (const f of compact) {
    const tags = f.tags || [];
    if (tags.includes("comparative") && !comparative) comparative = f.form;
    if (tags.includes("superlative") && !superlative) superlative = f.form;
  }

  const umlaut_in_comparison =
    !!comparative && /[äöü]/i.test(comparative) && !/[äöü]/i.test(word);

  return { comparative, superlative, umlaut_in_comparison };
}

const ADJ_CASES: Record<string, string> = {
  nominative: "nom",
  accusative: "acc",
  dative: "dat",
  genitive: "gen",
};
const ADJ_GENDERS: Record<string, string> = { masculine: "masc", feminine: "fem", neuter: "neut" };
const ADJ_DECL_TYPES: Array<"strong" | "weak" | "mixed"> = ["strong", "weak", "mixed"];

type DeclensionDraft = Record<string, Record<string, Record<string, string>>>;

function extractAdjDeclension(sourced: WiktionaryForm[]): DeclensionDraft {
  const declension: DeclensionDraft = {
    strong: { masc: {}, fem: {}, neut: {}, plural: {} },
    weak: { masc: {}, fem: {}, neut: {}, plural: {} },
    mixed: { masc: {}, fem: {}, neut: {}, plural: {} },
  };

  for (const f of sourced) {
    const tags = new Set(f.tags || []);
    if (!tags.has("positive")) continue;

    const declType = ADJ_DECL_TYPES.find((d) => tags.has(d));
    if (!declType) continue;

    let genderKey: string | null = null;
    if (tags.has("plural")) {
      genderKey = "plural";
    } else {
      for (const [tag, key] of Object.entries(ADJ_GENDERS)) {
        if (tags.has(tag)) {
          genderKey = key;
          break;
        }
      }
    }
    if (!genderKey) continue;

    for (const [tag, key] of Object.entries(ADJ_CASES)) {
      if (tags.has(tag)) {
        if (!declension[declType][genderKey][key]) {
          declension[declType][genderKey][key] = f.form;
        }
        break;
      }
    }
  }

  return declension;
}

/**
 * Check if adjective declension is regular (all forms = stem + standard ending).
 * Infers stem from strong.masc.nom (ending "-er").
 * Returns { regular, stem }.
 */
function checkAdjRegularity(declension: DeclensionDraft): AdjRegularityResult {
  const strongMascNom = declension.strong?.masc?.nom;
  if (!strongMascNom || !strongMascNom.endsWith("er")) {
    return { regular: false, stem: null };
  }

  const stem = strongMascNom.slice(0, -2);

  for (const declType of ADJ_DECL_TYPES) {
    const endings = ADJ_ENDINGS[declType] as GenderedCaseRows;
    if (!endings) continue;
    for (const [gender, cases] of Object.entries(endings)) {
      if (gender === "description") continue;
      for (const [caseName, ending] of Object.entries(cases as Record<string, string>)) {
        const actual = declension[declType]?.[gender]?.[caseName];
        if (!actual) continue;
        if (actual !== stem + ending) {
          return { regular: false, stem };
        }
      }
    }
  }

  return { regular: true, stem };
}

function transformAdj(entry: WiktionaryEntry): TransformOutput {
  const { compact, sourced } = splitForms(entry);
  const comparison = extractAdjComparison(compact, entry.word);
  const hasSourced = sourced.length > 0;

  const result: TransformOutput = {
    word: entry.word,
    pos: "adjective",
    etymology_number: entry.etymology_number || null,
    is_indeclinable: !hasSourced,
    ...comparison,
    senses: transformSenses(entry),
    sounds: extractSounds(entry),
  };

  if (hasSourced) {
    const declension = extractAdjDeclension(sourced);
    const { regular, stem } = checkAdjRegularity(declension);

    result.declension_stem = stem;
    result.declension_regular = regular;

    if (!regular) {
      // Store full declension for irregular adjectives
      result.declension = declension as unknown as FullDeclension;
    }
  }

  return result;
}

// ============================================================
// Simple POS types (no grammar tables)
// ============================================================

/**
 * Generic transformer for POS types that have senses and sounds
 * but no declension/conjugation tables.
 * Used for: adverb, preposition, conjunction, particle, interjection,
 *           pronoun, determiner, numeral.
 */
function transformSimple(entry: WiktionaryEntry, posLabel: string): TransformOutput {
  return {
    word: entry.word,
    pos: posLabel,
    etymology_number: entry.etymology_number || null,
    senses: transformSenses(entry),
    sounds: extractSounds(entry),
  };
}

/**
 * Detect phrase subtype from Wiktionary categories.
 * Returns one of: "idiom" | "collocation" | "proverb" | "greeting" | "toponym" | null
 */
function detectPhraseType(entry: WiktionaryEntry): string | null {
  const cats = entry.categories || [];
  if (cats.includes("Sprichwort (Deutsch)"))    return "proverb";
  if (cats.includes("Grußformel (Deutsch)"))    return "greeting";
  if (cats.includes("Toponym (Deutsch)"))       return "toponym";
  if (cats.includes("Redewendung (Deutsch)"))   return "idiom";
  if (cats.includes("Wortverbindung (Deutsch)")) return "collocation";
  return null;
}

/**
 * Phrase transformer — extracts phrase_type from Wiktionary categories.
 */
function transformPhrase(entry: WiktionaryEntry): TransformOutput {
  const base = transformSimple(entry, "phrase");
  const phraseType = detectPhraseType(entry);
  if (phraseType) base.phrase_type = phraseType;
  return base;
}

// ============================================================
// File naming
// ============================================================

function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, "_");
}

function getDisambiguator(entry: WiktionaryEntry, usedDisambigs?: Set<string>): string {
  const firstSense = (entry.senses || [])[0];
  if (!firstSense?.glosses?.length)
    return String(entry.etymology_number || 1);

  const gloss = firstSense.glosses[firstSense.glosses.length - 1];
  const skip = new Set<string>([
    "the", "a", "an", "to", "of", "in", "on", "for", "und", "oder",
    "ein", "eine", "der", "die", "das", "mit", "für", "von", "aus",
  ]);
  const candidates = gloss
    .split(/[\s,;()/]+/)
    .map((w) => w.replace(/[-.:!?]+$/, ""))
    .filter((w) => w.length > 1 && !skip.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());

  // Pick the first candidate that hasn't been used yet in this group
  if (usedDisambigs) {
    const unique = candidates.find((c) => !usedDisambigs.has(c));
    if (unique) return unique;
  }

  return candidates[0] || String(entry.etymology_number || 1);
}

// ============================================================
// Compound noun splitting
// ============================================================

/** Set of known lemmas (lowercase) for algorithmic compound splitting. Built lazily. */
let knownLemmas: Set<string> | null = null;

function buildKnownLemmas(): void {
  knownLemmas = new Set<string>();
  for (const posDir of Object.values(SUPPORTED_POS)) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      // Strip .json and homonym disambiguator
      const name = f.slice(0, -5).split("_")[0];
      knownLemmas.add(name.toLowerCase());
    }
  }
}

/**
 * Parse a component description from Wiktionary etymology text.
 * e.g. "dem Substantiv Schrank" -> "Schrank"
 *      "dem Stamm des Verbs kuhlen" -> "kuhlen"
 *      "Fund" -> "Fund"
 */
function parseEtymologyComponent(text: string): string | null {
  text = text.trim();

  // "dem Stamm/Wortstamm des Verbs kühlen"
  let m = text.match(
    /(?:dem\s+)?(?:Wort)?[Ss]tamm\s+des\s+Verbs?\s+(\S+)/,
  );
  if (m) return m[1];

  // "dem Substantiv Schrank" / "den Substantiven Wort" / "Substantiv Schrank"
  m = text.match(/(?:(?:dem|den|des)\s+)?Substantiv(?:s|en)?\s+(\S+)/);
  if (m) return m[1];

  // "dem Adjektiv schnell"
  m = text.match(/(?:dem|des)\s+Adjektiv(?:s)?\s+(\S+)/);
  if (m) return m[1];

  // "dem Verb kühlen"
  m = text.match(/(?:dem|des)\s+Verb(?:s|um)?\s+(\S+)/);
  if (m) return m[1];

  // "der Präposition unter" / "dem Adverb sehr" / "der Interjektion buh"
  m = text.match(
    /(?:der|dem|des)\s+(?:Präposition|Adverb|Interjektion|Partikel|Konjunktion)\s+(\S+)/,
  );
  if (m) return m[1];

  // "dem Nomen Schlamm"
  m = text.match(/(?:dem|des)\s+Nomen(?:s)?\s+(\S+)/);
  if (m) return m[1];

  // "dem Zahlwort drei"
  m = text.match(/(?:dem|des)\s+Zahlwort(?:s)?\s+(\S+)/);
  if (m) return m[1];

  // Bare word (possibly with trailing punctuation or articles)
  const bare = text.replace(/[.,;:!?()^→„""«»]+$/, "").trim();
  // Must be a single word, at least 2 chars
  if (bare && !bare.includes(" ") && bare.length >= 2) return bare;

  return null;
}

// "aus X und Y" or "aus X sowie Y"
const COMPOUND_AUS_RE =
  /(?:Determinativ)?[Kk]ompositum[^,]*?aus\s+(.+?)\s+(?:und|sowie)\s+(.+?)(?:\s*[,;.]|$)/;
// "von X und Y" (e.g. "von Substantiv Straße, Fugenelement -n und Substantiv Bahn")
const COMPOUND_VON_RE =
  /(?:Determinativ)?[Kk]ompositum[^)]*?von\s+(.+?)\s+und\s+(.+?)(?:\s*[,;.]|$)/;
const ZUSAMMEN_RE =
  /zusammengesetzt\s+aus\s+(.+?)\s+(?:und|sowie)\s+(.+?)(?:\s*[,;.]|$)/;
const ZUSAMMENSETZUNG_RE =
  /Zusammensetzung[^,]*?(?:aus|von)\s+(.+?)\s+(?:und|sowie)\s+(.+?)(?:\s*[,;.]|$)/;
// Detect Fugenelement
const FUGEN_RE = /Fugenelement\s+[„"«-]*([a-zäöüß-]+)/i;

/**
 * Extract compound parts from a Wiktionary entry.
 * Returns { parts: string[], source: "wiktionary"|"algorithmic", verified: bool } or null.
 */
function extractCompoundParts(entry: WiktionaryEntry): CompoundResult | null {
  // Phase A: Wiktionary etymology parsing
  for (const etym of entry.etymology_texts || []) {
    const match =
      etym.match(COMPOUND_AUS_RE) ||
      etym.match(COMPOUND_VON_RE) ||
      etym.match(ZUSAMMEN_RE) ||
      etym.match(ZUSAMMENSETZUNG_RE);
    if (!match) continue;

    // Clean up captures: strip Fugenelement mentions and trailing "sowie ..."
    let raw1 = match[1];
    let raw2 = match[2];
    raw1 = raw1.replace(/,?\s*(?:dem\s+)?Fugenelement\s+\S+\s*$/i, "").trim();
    raw2 = raw2.replace(/\s+sowie\s+.*$/i, "").trim();
    raw2 = raw2.replace(/,?\s*(?:dem\s+)?Fugenelement\s+\S+\s*$/i, "").trim();

    const part1 = parseEtymologyComponent(raw1);
    const part2 = parseEtymologyComponent(raw2);
    if (part1 && part2) {
      return { parts: [part1, part2], source: "wiktionary", verified: true };
    }
  }

  // Phase B: Algorithmic fallback (nouns only, min 6 chars)
  if (entry.pos !== "noun" || !entry.word || entry.word.length < 6) return null;

  if (!knownLemmas) buildKnownLemmas();

  const word = entry.word;
  const FUGEN = ["", "s", "n", "en", "e", "er", "es"];

  // Try split points, prefer longest left component
  for (let i = word.length - 3; i >= 3; i--) {
    const left = word.slice(0, i);
    const rest = word.slice(i);

    for (const fuge of FUGEN) {
      if (fuge && !rest.toLowerCase().startsWith(fuge)) continue;
      const right = fuge ? rest.slice(fuge.length) : rest;
      if (right.length < 3) continue;

      if (
        knownLemmas!.has(left.toLowerCase()) &&
        knownLemmas!.has(right.toLowerCase())
      ) {
        // Capitalize right part for noun lemma form
        const rightLemma = right.charAt(0).toUpperCase() + right.slice(1);
        return {
          parts: [left, rightLemma],
          source: "algorithmic",
          verified: false,
        };
      }
    }
  }

  return null;
}

// ============================================================
// Merge: preserve manual fields from existing file
// ============================================================

/**
 * Load all existing homonym files for a word+POS from disk.
 * Used as the "old sibling" pool for cross-file translation transfer.
 * Matches files named exactly `{word}.json` or `{word}_{disambig}.json`.
 */
function loadOldSiblings(
  word: string,
  posDir: string,
): Map<string, { senses: Sense[]; orphans: OrphanEntry[] }> {
  const dir = join(DATA_DIR, "words", posDir);
  if (!existsSync(dir)) return new Map();
  const result = new Map<string, { senses: Sense[]; orphans: OrphanEntry[] }>();
  const stem = sanitizeFilename(word).toLowerCase();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const fileKey = f.slice(0, -5);
    const fileKeyLower = fileKey.toLowerCase();
    if (fileKeyLower !== stem && !fileKeyLower.startsWith(stem + "_")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Record<string, unknown>;
      const senses = (raw.senses as Sense[]) ?? [];
      const orphans = ((raw as { _orphaned_translations?: OrphanEntry[] })._orphaned_translations) ?? [];
      result.set(fileKey, { senses, orphans });
    } catch {
      // skip unreadable files
    }
  }
  return result;
}

function mergeWithExisting(newData: TransformOutput, existingPath: string): TransformOutput {
  if (!existsSync(existingPath)) return newData;

  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(readFileSync(existingPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return newData;
  }

  const existingSource = (existing as { _meta?: { source?: string } })._meta?.source;
  if (existingSource === "manual") {
    console.warn(
      `[manual-word] WIKTIONARY MERGE: "${newData.word}" (${existingPath}) was manually authored ` +
        `and now appears in the Wiktionary dump. Grammar data will be replaced. Review the merged file.`,
    );
  }

  // Preserve fields added by enrich step (not owned by transform)
  if ((existing as { zipf?: number }).zipf != null) {
    newData.zipf = (existing as { zipf: number }).zipf;
  }
  if ((existing as { plural_dominant?: boolean }).plural_dominant != null) {
    newData.plural_dominant = (existing as { plural_dominant: boolean }).plural_dominant;
  }
  if ((existing as Record<string, unknown>).collocation_nouns) {
    newData.collocation_nouns = (existing as Record<string, unknown>).collocation_nouns;
  }

  // Preserve compound data if already set (may have been LLM-verified or manually corrected)
  if ((existing as { compound_parts?: string[] }).compound_parts && !newData.compound_parts) {
    newData.compound_parts = (existing as { compound_parts: string[] }).compound_parts;
    if ((existing as { compound_source?: string }).compound_source)
      newData.compound_source = (existing as { compound_source: string }).compound_source;
    if ((existing as { compound_verified?: boolean }).compound_verified != null)
      newData.compound_verified = (existing as { compound_verified: boolean }).compound_verified;
  }

  // Preserve LLM-generated sense fields via gloss-text matching (see scripts/lib/merge.ts).
  const existingSenses = existing.senses as Sense[] | undefined;
  if (existingSenses && !newData.senses) {
    const lostAll = existingSenses.filter((s) => s.gloss_en != null);
    if (lostAll.length > 0) {
      console.warn(
        `[merge] TRANSLATION LOSS: ${newData.word} (${existingPath}) — ` +
        `new entry has no senses, existing had ${lostAll.length} translated sense(s)`,
      );
    }
  }
  if (existingSenses && newData.senses) {
    const existingOrphans: OrphanEntry[] =
      (existing as { _orphaned_translations?: OrphanEntry[] })._orphaned_translations ?? [];
    const { senses: mergedSenses, orphans } = mergeSenses(
      newData.senses,
      existingSenses,
      existingOrphans,
    );
    newData.senses = mergedSenses;
    if (orphans.length > 0) {
      const addedCount = orphans.length - existingOrphans.filter(
        (o) => orphans.some((n) => n.gloss === o.gloss),
      ).length;
      newData._orphaned_translations = orphans;
      console.warn(
        `[merge] ORPHANED TRANSLATIONS: ${newData.word} (${existingPath}) — ` +
        `${addedCount} newly lost, ${orphans.length - addedCount} carried forward. ` +
        `Glosses: ${orphans.map((o) => JSON.stringify(o.gloss)).join(", ")}`,
      );
    }
  }

  // Carry forward _proofread, invalidating aspects whose underlying data changed.
  const existingProofread = (existing as { _proofread?: ProofreadFlags })._proofread;
  if (existingProofread) {
    const proofread: Record<string, unknown> = { ...existingProofread };

    // Gloss flags are tied to the source content — clear them when the entry changes.
    const existingMeta = (existing as { _meta?: WordMeta })._meta;
    const sourceHashChanged = existingMeta?.source_hash !== newData._meta?.source_hash;
    if (sourceHashChanged) {
      delete proofread.gloss_en;
      delete proofread.gloss_en_full;
      delete proofread.synonyms_en;
    }

    // examples_owned is tied to the set of owned example IDs.
    if (proofread.examples_owned != null) {
      if (proofread.examples_owned !== exampleIdsHash(newData)) {
        delete proofread.examples_owned;
      }
    }

    // examples_ref cannot be verified by transform (it requires scanning all examples
    // to find cross-word annotations). It is managed by quality-check --mark-proofread.
    // We carry it forward unchanged; quality-check validates and clears it when stale.

    if (Object.keys(proofread).length > 0) {
      newData._proofread = proofread as ProofreadFlags;
    }
  }

  // Apply manual overrides last — these win over anything Wiktionary produces.
  // _overrides is never cleared by transform; edit it manually to correct source data bugs.
  const existingOverrides = (existing as { _overrides?: WordOverrides })._overrides;
  if (existingOverrides) {
    newData._overrides = existingOverrides;
    for (const [key, val] of Object.entries(existingOverrides)) {
      if (val && typeof val === "object" && !Array.isArray(val) &&
          newData[key] && typeof newData[key] === "object" && !Array.isArray(newData[key])) {
        newData[key] = { ...(newData[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
      } else {
        newData[key] = val;
      }
    }
  }

  return newData;
}

// ============================================================
// Main pipeline
// ============================================================

async function main(): Promise<void> {
  const useSeed = process.argv.includes("--seed");
  const seedWords = useSeed ? loadSeedList() : null;

  const maxFreqIdx = process.argv.indexOf("--max-frequency");
  const maxFrequency =
    maxFreqIdx !== -1 ? parseInt(process.argv[maxFreqIdx + 1], 10) : null;

  const maxSubtitleIdx = process.argv.indexOf("--max-subtitle-rank");
  const maxSubtitleRank =
    maxSubtitleIdx !== -1 ? parseInt(process.argv[maxSubtitleIdx + 1], 10) : null;

  const forcePosIdx = process.argv.indexOf("--force-pos");
  const forcePos = forcePosIdx !== -1 ? process.argv[forcePosIdx + 1] : null;

  // --words schaffen,scheren  OR  --words words.txt
  const wordsIdx = process.argv.indexOf("--words");
  let wordsFilter: Set<string> | null = null;
  if (wordsIdx !== -1) {
    const arg = process.argv[wordsIdx + 1];
    if (existsSync(arg)) {
      wordsFilter = new Set(readFileSync(arg, "utf-8").split("\n").map(l => l.trim()).filter(Boolean).map(w => w.toLowerCase()));
    } else {
      wordsFilter = new Set(arg.split(",").map(w => w.trim().toLowerCase()));
    }
  }

  let freqFilter: Set<string> | null = null;
  if (maxFrequency && !useSeed && !wordsFilter) {
    const wordsFile = join(ROOT, "data", "raw", "leipzig-words.txt");
    const subtitleFile = join(ROOT, "data", "raw", "opensubtitles-words.txt");
    if (!existsSync(wordsFile) && !existsSync(subtitleFile)) {
      console.error(
        `No frequency corpus found. Run 'npm run download-corpus' first.`,
      );
      process.exit(1);
    }
    const whitelistFile = join(ROOT, "config", "word-whitelist.json");
    const whitelist: string[] = existsSync(whitelistFile)
      ? (JSON.parse(readFileSync(whitelistFile, "utf-8")) as WhitelistConfig).words.map((w) => w.word)
      : [];
    freqFilter = loadFrequencyFilter(wordsFile, subtitleFile, maxFrequency, maxSubtitleRank, whitelist);
  }

  if (wordsFilter) console.log(`Words mode: processing ${wordsFilter.size} specific words`);
  else if (useSeed) console.log(`Seed mode: processing ${seedWords!.size} words`);
  else if (maxFrequency) console.log(`B2 mode: top ${maxFrequency} words by frequency (subtitle rank: ${maxSubtitleRank ?? maxFrequency})`);
  else console.log("Full mode: processing all entries");

  if (!existsSync(RAW_FILE)) {
    console.error(`Missing ${RAW_FILE}. Run 'npm run download' first.`);
    process.exit(1);
  }

  const state = loadState();

  // Phase 1: Collect matching entries, grouped by word|pos
  console.log("Scanning source data...");
  const groups = new Map<string, GroupEntry[]>();
  // Buffer for noun entries with gender-pair form references. Stores byte offset
  // instead of raw line to avoid holding hundreds of thousands of multi-KB strings
  // in memory. Phase 1b reads back only the lines it needs.
  const genderBuffer = new Map<string, number>(); // lowerCaseWord → byte offset into RAW_FILE
  const compoundBuffer = new Map<string, CompoundBufferEntry>(); // lowerCaseWord → { offset, pos } for compound part inclusion
  const rl = createInterface({ input: createReadStream(RAW_FILE) });
  let lineCount = 0;
  let byteOffset = 0;

  for await (const line of rl) {
    const lineStart = byteOffset;
    byteOffset += Buffer.byteLength(line, "utf-8") + 1; // +1 for newline
    lineCount++;
    if (lineCount % 50000 === 0)
      process.stdout.write(`\r  ${lineCount} lines scanned`);

    let entry: WiktionaryEntry;
    try {
      entry = JSON.parse(line) as WiktionaryEntry;
    } catch {
      continue;
    }

    if (entry.lang_code !== "de") continue;
    if (!SUPPORTED_POS[entry.pos]) continue;

    // Reclassify nouns tagged as abbreviations (e.g. "RUF" pos=noun tags=[abbrev])
    // to avoid filename collisions with the regular noun (e.g. "Ruf").
    if (
      entry.pos === "noun" &&
      entry.tags?.some((t: string) => t === "abbrev" || t === "abbreviation")
    ) {
      entry.pos = "abbrev";
    }

    // Skip surnames and first names — only keep toponyms for proper nouns.
    // pos_title: "Toponym" (places), "Nachname" (surnames), "Vorname" (first names)
    if (
      entry.pos === "name" &&
      entry.pos_title !== "Toponym"
    )
      continue;

    if (
      entry.senses &&
      entry.senses.length > 0 &&
      entry.senses.every((s) => (s.form_of?.length ?? 0) > 0 || (s.alt_of?.length ?? 0) > 0)
    )
      continue;

    // Buffer noun entries that carry a gender-pair reference, before filter
    // checks, so Phase 1b can retrieve them even if they didn't pass the filter.
    // Store byte offset only — raw line is read back on demand in Phase 1b.
    if (entry.pos === "noun" && extractGenderCounterpart(entry)) {
      if (!genderBuffer.has(entry.word.toLowerCase()))
        genderBuffer.set(entry.word.toLowerCase(), lineStart);
    }

    // Buffer all valid entries by lemma for compound part inclusion (Phase 1c)
    if (freqFilter && !compoundBuffer.has(entry.word.toLowerCase())) {
      const entryLen = Buffer.byteLength(line, "utf-8");
      compoundBuffer.set(entry.word.toLowerCase(), { offset: lineStart, length: entryLen, pos: entry.pos });
    }

    if (wordsFilter && !wordsFilter.has(entry.word.toLowerCase())) continue;
    if (seedWords && !seedWords.has(entry.word.toLowerCase())) continue;
    if (freqFilter && entry.pos !== "phrase" && entry.pos !== "intj" && !freqFilter.has(entry.word.toLowerCase())) continue;

    const key = `${entry.word}|${entry.pos}`;
    if (!groups.has(key)) groups.set(key, []);
    // Store byte offset + length + hash + stateKey. Raw line is read back on
    // demand in Phase 2 to keep memory proportional to entry count, not size.
    // stateKey lets Phase 2 check the hash against .import-state without re-reading.
    const lineBytes = Buffer.byteLength(line, "utf-8");
    const stateKey = `${entry.word}|${entry.pos}|${entry.etymology_number || 1}`;
    groups.get(key)!.push({ offset: lineStart, length: lineBytes, hash: sha256(line), stateKey });
  }

  const totalEntries = [...groups.values()].reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  console.log(
    `\n  Found ${totalEntries} entries across ${groups.size} word groups`,
  );

  // Phase 1b: Force-include gender counterparts of included nouns that were
  // dropped by the frequency filter (only in frequency mode, not seed mode).
  // We check ALL entries in each group because the same word can have multiple
  // noun entries (e.g. Koch has masculine=chef and neuter=abbreviation); only
  // one of them may carry the feminine form reference.
  // Helper: read a single line from RAW_FILE at a given byte offset + length
  const rawFd = openSync(RAW_FILE, "r");
  function readLineAt(offset: number, len?: number): string {
    const size = len || 65536; // fallback for genderBuffer entries (no length stored)
    const buf = Buffer.alloc(size);
    const bytesRead = readSync(rawFd, buf, 0, size, offset);
    const chunk = buf.toString("utf-8", 0, bytesRead);
    if (len) return chunk; // exact length known
    const newlineIdx = chunk.indexOf("\n");
    return newlineIdx >= 0 ? chunk.slice(0, newlineIdx) : chunk;
  }

  if (freqFilter && !useSeed) {
    let counterpartsAdded = 0;
    for (const [, entries] of groups) {
      for (const entry of entries) {
        const raw = readLineAt(entry.offset, entry.length);
        const parsed = JSON.parse(raw) as WiktionaryEntry;
        if (parsed.pos !== "noun") continue;
        const counterpartWord = extractGenderCounterpart(parsed);
        if (!counterpartWord) continue;
        const counterpartKey = `${counterpartWord}|noun`;
        if (groups.has(counterpartKey)) break; // already included — move to next group
        const bufferedOffset = genderBuffer.get(counterpartWord.toLowerCase());
        if (bufferedOffset == null) break; // not present in Wiktionary data
        const bufferedRaw = readLineAt(bufferedOffset);
        const bufferedLen = Buffer.byteLength(bufferedRaw, "utf-8");
        const bufferedParsed = JSON.parse(bufferedRaw) as WiktionaryEntry;
        const bufferedStateKey = `${bufferedParsed.word}|${bufferedParsed.pos}|${bufferedParsed.etymology_number || 1}`;
        groups.set(counterpartKey, [{ offset: bufferedOffset, length: bufferedLen, hash: sha256(bufferedRaw), stateKey: bufferedStateKey }]);
        counterpartsAdded++;
        break; // counterpart added, no need to check other entries in this group
      }
    }
    if (counterpartsAdded > 0)
      console.log(`  Added ${counterpartsAdded} gender counterpart(s) missing from frequency filter.`);
  }
  genderBuffer.clear(); // free memory — no longer needed after Phase 1b

  // Phase 1c: Force-include compound part lemmas that were dropped by the
  // frequency filter. For each included word with Wiktionary compound data,
  // ensure its component parts also get their own word files generated.
  if (freqFilter && !useSeed) {
    let compoundPartsAdded = 0;
    // Collect compound part lemmas from entries that passed the filter
    const neededParts = new Set<string>();
    for (const [, entries] of groups) {
      for (const entry of entries) {
        const raw = readLineAt(entry.offset, entry.length);
        const parsed = JSON.parse(raw) as WiktionaryEntry;
        const compound = extractCompoundParts(parsed);
        if (!compound || compound.source !== "wiktionary") continue;
        for (const partLemma of compound.parts) {
          const partKey = `${partLemma}|noun`;
          // Also check verb form for verb stems (e.g. "kühlen")
          const partKeyVerb = `${partLemma}|verb`;
          if (!groups.has(partKey) && !groups.has(partKeyVerb)) {
            neededParts.add(partLemma.toLowerCase());
          }
        }
      }
    }
    // Add buffered entries for needed parts
    for (const lemmaLower of neededParts) {
      const buffered = compoundBuffer.get(lemmaLower);
      if (!buffered) continue;
      const bufferedRaw = readLineAt(buffered.offset, buffered.length);
      const bufferedParsed = JSON.parse(bufferedRaw) as WiktionaryEntry;
      const key = `${bufferedParsed.word}|${bufferedParsed.pos}`;
      if (groups.has(key)) continue;
      const compStateKey = `${bufferedParsed.word}|${bufferedParsed.pos}|${bufferedParsed.etymology_number || 1}`;
      groups.set(key, [{ offset: buffered.offset, length: buffered.length, hash: sha256(bufferedRaw), stateKey: compStateKey }]);
      compoundPartsAdded++;
    }
    if (compoundPartsAdded > 0)
      console.log(`  Added ${compoundPartsAdded} compound part(s) missing from frequency filter.`);
  }

  // Phase 1d: Force-include the parent verb for any form-of-only verb entry that
  // passed the frequency/whitelist filter. German Wiktionary has separate entries
  // for conjugated forms (e.g. "vermisst" → "vermissen"). If an inflected form
  // made it into the dataset, its parent should too — otherwise the user gets a
  // useless empty grammar card with no conjugation table.
  if (freqFilter && !useSeed) {
    let parentVerbsAdded = 0;
    for (const [key, entries] of groups) {
      if (!key.endsWith("|verb")) continue;
      // Scan this group's entries for a purely form-of verb
      let parentWord: string | null = null;
      for (const entry of entries) {
        const raw = readLineAt(entry.offset, entry.length);
        const parsed = JSON.parse(raw) as WiktionaryEntry;
        if (parsed.pos !== "verb") continue;
        if (!parsed.senses?.length) continue;
        // Only care about entries where EVERY sense is form-of
        const allFormOf = parsed.senses.every(
          (s) => (s.form_of?.length ?? 0) > 0 || s.tags?.includes("form-of"),
        );
        if (!allFormOf) continue;
        // Extract parent word from structured form_of field
        for (const sense of parsed.senses) {
          if (sense.form_of?.[0]?.word) {
            parentWord = sense.form_of[0].word;
            break;
          }
        }
        if (parentWord) break;
      }
      if (!parentWord) continue;
      const parentKey = `${parentWord}|verb`;
      if (groups.has(parentKey)) continue; // parent already included
      const buffered = compoundBuffer.get(parentWord.toLowerCase());
      if (!buffered) continue; // parent not in Wiktionary data
      const bufferedRaw = readLineAt(buffered.offset, buffered.length);
      const parentParsed = JSON.parse(bufferedRaw) as WiktionaryEntry;
      const parentStateKey = `${parentParsed.word}|${parentParsed.pos}|${parentParsed.etymology_number || 1}`;
      groups.set(parentKey, [{
        offset: buffered.offset,
        length: buffered.length,
        hash: sha256(bufferedRaw),
        stateKey: parentStateKey,
      }]);
      parentVerbsAdded++;
    }
    if (parentVerbsAdded > 0)
      console.log(`  Added ${parentVerbsAdded} parent verb(s) for form-of entries.`);
  }

  compoundBuffer.clear(); // free memory

  // Load existing examples to preserve manually added data
  let existingExamples: ExampleMap = {};
  try {
    existingExamples = loadExamples();
  } catch {
    /* ignore */
  }

  // Seed allExamples with all existing examples so that skipped (unchanged)
  // entries don't lose their examples on incremental re-runs.
  // Newly processed entries will overwrite with fresh data (same content hash
  // → same id, so no actual change for identical text).
  for (const [id, ex] of Object.entries(existingExamples)) {
    allExamples[id] = ex as CollectedExample;
  }

  // Phase 2: Transform and write
  let written = 0;
  let skipped = 0;
  const transformers: Record<string, (entry: WiktionaryEntry) => TransformOutput> = {
    noun: transformNoun,
    verb: transformVerb,
    adj: transformAdj,
    phrase: transformPhrase,
    adv: (e) => transformSimple(e, POS_CONFIG.adv.label),
    prep: (e) => transformSimple(e, POS_CONFIG.prep.label),
    postp: (e) => transformSimple(e, POS_CONFIG.prep.label),
    conj: (e) => transformSimple(e, POS_CONFIG.conj.label),
    particle: (e) => transformSimple(e, POS_CONFIG.particle.label),
    intj: (e) => transformSimple(e, POS_CONFIG.intj.label),
    pron: (e) => transformSimple(e, POS_CONFIG.pron.label),
    det: (e) => transformSimple(e, POS_CONFIG.det.label),
    num: (e) => transformSimple(e, POS_CONFIG.num.label),
    name: (e) => transformNoun(e, POS_CONFIG.name.label),
    abbrev: (e) => transformSimple(e, POS_CONFIG.abbrev.label),
  };

  const today = new Date().toISOString().slice(0, 10);

  // Accumulate text_linked reference remaps from all cross-file matches.
  // Applied to examples in-memory before saveExamples() — critical for examples
  // with _proofread.annotations whose text_linked is otherwise frozen by build-index.
  const allTextLinkedRemaps: Array<{ oldRef: string; newRef: string }> = [];

  for (const [, entries] of groups) {
    const needsDisambig = entries.length > 1;
    const usedDisambigs = new Set<string>();

    // Collect processed entries so we can run cross-file sense merging before
    // writing.  The cross-file pass requires all new senses to be visible at
    // once so translations can be transferred across homonym file boundaries.
    type PendingWrite = {
      data: TransformOutput;
      fullPath: string;
      relPath: string;
      stateKey: string;
      hash: string;
      /** Filename stem without .json — used as Map key in mergeHomonymGroup. */
      fileKey: string;
    };
    const pendingWrites: PendingWrite[] = [];
    let groupWord = "";
    let groupPosDir = "";

    for (const { offset, length, hash, stateKey } of entries) {
      // Fast-path: check hash against import state BEFORE reading the JSONL line.
      // stateKey was captured during Phase 1 so we can skip the expensive
      // readLineAt + JSON.parse for unchanged entries (~99% of full runs).
      const stateEntry = state.entries[stateKey];

      if (!forcePos && !wordsFilter && stateEntry?.hash === hash) {
        if (stateEntry.file === "__form-of-skip__") {
          skipped++;
          continue;
        }
        const expectedPath = join(DATA_DIR, stateEntry.file);
        if (existsSync(expectedPath)) {
          skipped++;
          continue;
        }
      }

      // Hash mismatch or forced — read and parse the full JSONL line
      const raw = readLineAt(offset, length);
      const parsed = JSON.parse(raw) as WiktionaryEntry;

      // Re-apply abbreviation reclassification (same as Phase 1 — the raw
      // JSONL still says pos=noun, but we reclassified during scanning)
      if (
        parsed.pos === "noun" &&
        parsed.tags?.some((t: string) => t === "abbrev" || t === "abbreviation")
      ) {
        parsed.pos = "abbrev";
      }

      // --force-pos: only re-process entries of the specified POS
      if (forcePos && parsed.pos !== forcePos) {
        skipped++;
        continue;
      }

      // --force-pos re-processes existing files only — skip entries not yet in
      // the dataset so that rule-change runs don't pull in new words
      if (forcePos && !stateEntry) {
        skipped++;
        continue;
      }

      const transform = transformers[parsed.pos];
      if (!transform) continue;
      let data = transform(parsed);

      // Skip verb entries that are purely inflected forms (all senses tagged form-of).
      // The parent verb's conjugation table already covers these forms in the word_forms
      // search index, so a separate file adds nothing and produces an empty grammar card.
      // Write a sentinel state entry so the hash check short-circuits on future runs
      // without requiring the file to exist on disk.
      if (parsed.pos === "verb" && data.senses?.length > 0 &&
          data.senses.every((s) => s.tags?.includes("form-of") ||
            (s.tags?.includes("no-gloss") && !s.gloss))) {
        state.entries[stateKey] = { hash, file: "__form-of-skip__" };
        skipped++;
        continue;
      }

      // Skip entries where ALL senses have corrupt/markup glosses (Wiktionary parsing
      // artifacts like "==== Worttrennung ====" captured as gloss text).
      const CORRUPT_GLOSS_RE = /^={2,}|^\{\{|^\[\[Kategorie:/;
      data.senses = data.senses.filter(
        (s) => !s.gloss || !CORRUPT_GLOSS_RE.test(s.gloss),
      );
      if (data.senses.length === 0) {
        state.entries[stateKey] = { hash, file: "__form-of-skip__" };
        skipped++;
        continue;
      }

      // Skip stub phrase entries where ALL senses have empty gloss and no examples.
      // These are Wiktionary phrase entries with no definition text — they add
      // nothing to the dictionary. Non-phrase POS (nouns, verbs, adjectives, etc.)
      // are kept even with empty glosses because they carry grammar data (declension,
      // conjugation, gender, IPA). Entries with _overrides or _proofread are kept.
      if (parsed.pos === "phrase" &&
          data.senses.every((s) => !s.gloss && !s.example_ids?.length)) {
        const existingPath = join(DATA_DIR, "words", SUPPORTED_POS[parsed.pos],
          sanitizeFilename(parsed.word) + ".json");
        let hasManualData = false;
        if (existsSync(existingPath)) {
          try {
            const existing = JSON.parse(readFileSync(existingPath, "utf-8"));
            hasManualData = !!(existing._overrides || existing._proofread);
          } catch {}
        }
        if (!hasManualData) {
          state.entries[stateKey] = { hash, file: "__stub-skip__" };
          skipped++;
          continue;
        }
      }

      // Extract expressions and proverbs (word-level, not sense-level)
      const expressionIds = deduplicateExpressions(extractExpressions(parsed));
      if (expressionIds.length > 0) data.expression_ids = expressionIds;

      // Extract relationship hints for build-index resolution (entry-level fields)
      const rawDerived = (parsed.derived || [])
        .map((d) => d.word)
        .filter(Boolean);
      const rawHyponyms = (parsed.hyponyms || [])
        .map((h) => h.word)
        .filter(Boolean);
      const senseCount = data.senses?.length ?? 0;
      for (const [items, field] of [
        [parsed.synonyms || [], "synonyms"],
        [parsed.antonyms || [], "antonyms"],
      ] as [{ word?: string; sense_index?: string }[], "synonyms" | "antonyms"][]) {
        for (const item of items) {
          if (!item.word) continue;
          const indices = parseSenseIndices(item.sense_index);
          for (const idx of indices) {
            if (idx >= 0 && idx < senseCount) {
              const arr = (data.senses[idx][field] ??= []);
              if (!arr.includes(item.word)) arr.push(item.word);
            }
          }
        }
      }

      const rawAntonyms = [...new Set(
        (parsed.antonyms || []).map((a) => a.word).filter(Boolean),
      )];
      const rawSynonyms = [...new Set(
        (parsed.synonyms || []).map((s) => s.word).filter(Boolean),
      )];
      if (rawDerived.length) data._derived = rawDerived;
      if (rawHyponyms.length) data._hyponyms = rawHyponyms;
      if (rawAntonyms.length) data._antonyms = rawAntonyms;
      if (rawSynonyms.length) data._synonyms = rawSynonyms;

      // Gender pair reference: masculine ↔ feminine noun counterpart
      const genderCounterpart = extractGenderCounterpart(parsed);
      if (genderCounterpart) data._gender_counterpart = genderCounterpart;

      // Compound noun decomposition
      const compound = extractCompoundParts(parsed);
      if (compound) {
        data.compound_parts = compound.parts;
        data.compound_source = compound.source;
        data.compound_verified = compound.verified;
      }

      // Add _meta
      data._meta = {
        source_hash: hash,
        generated_at: today,
      };

      // Determine file path
      const disambig = needsDisambig ? getDisambiguator(parsed, usedDisambigs) : null;
      if (disambig) usedDisambigs.add(disambig);
      const filename =
        sanitizeFilename(
          disambig ? `${parsed.word}_${disambig}` : parsed.word,
        ) + ".json";
      const posDir = SUPPORTED_POS[parsed.pos];
      const relPath = join("words", posDir, filename);
      const fullPath = join(DATA_DIR, relPath);

      groupWord = parsed.word;
      groupPosDir = posDir;

      // Per-file merge: preserve manual fields + run mergeSenses for this file
      data = mergeWithExisting(data, fullPath);

      pendingWrites.push({
        data,
        fullPath,
        relPath,
        stateKey,
        hash,
        fileKey: filename.slice(0, -5),
      });
    }

    // Cross-file sense merge: fill null gloss_en slots from sibling old files.
    // Runs only when there are active entries — loads old siblings from disk
    // BEFORE any writes occur (pendingWrites are not yet on disk at this point).
    if (pendingWrites.length > 0 && groupWord) {
      const oldSiblings = loadOldSiblings(groupWord, groupPosDir);
      if (oldSiblings.size > 0) {
        const newSensesMap = new Map(
          pendingWrites.map((pw) => [pw.fileKey, pw.data.senses ?? []]),
        );
        const { files: mergedSensesMap, crossFileMatches } = mergeHomonymGroup(
          newSensesMap,
          oldSiblings,
        );
        if (crossFileMatches.length > 0) {
          for (const pw of pendingWrites) {
            const merged = mergedSensesMap.get(pw.fileKey);
            if (merged) pw.data.senses = merged;
          }

          // Build text_linked remaps: posDir/oldFile#oldIdx → posDir/newFile#newIdx
          // (1-based sense indices matching the [[word|posDir/file#N]] format)
          for (const match of crossFileMatches) {
            const oldSenses = oldSiblings.get(match.oldFile)?.senses ?? [];
            const oldIdx = oldSenses.findIndex((s) => s.gloss === match.oldGloss);
            const newPw = pendingWrites.find((pw) => pw.fileKey === match.newFile);
            const newIdx = newPw?.data.senses?.findIndex((s) => s.gloss === match.newGloss) ?? -1;
            if (oldIdx >= 0 && newIdx >= 0) {
              allTextLinkedRemaps.push({
                oldRef: `|${groupPosDir}/${match.oldFile}#${oldIdx + 1}`,
                newRef: `|${groupPosDir}/${match.newFile}#${newIdx + 1}`,
              });
            }
          }

          console.warn(
            `[cross-file] ${groupWord}: ${crossFileMatches.length} translation(s) transferred:`,
            crossFileMatches
              .map((m) => `${m.oldFile}→${m.newFile} "${m.newGloss.slice(0, 50)}"`)
              .join(" | "),
          );
        }
      }
    }

    // Write pass
    for (const { data, fullPath, relPath, stateKey, hash } of pendingWrites) {
      // Skip write if file content is identical (ignoring generated_at)
      if (existsSync(fullPath)) {
        try {
          const existing = JSON.parse(readFileSync(fullPath, "utf-8")) as Record<string, unknown>;
          const cmpNew = { ...data, _meta: { ...(data._meta as WordMeta), generated_at: "" } };
          const cmpOld = { ...existing, _meta: { ...(existing._meta as WordMeta), generated_at: "" } };
          if (JSON.stringify(cmpNew) === JSON.stringify(cmpOld)) {
            state.entries[stateKey] = { hash, file: relPath };
            skipped++;
            continue;
          }
        } catch {
          // file unreadable — proceed with write
        }
      }

      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n");

      state.entries[stateKey] = { hash, file: relPath };
      written++;
    }
  }

  // Prune state entries pointing to files that no longer exist on disk.
  // This prevents future runs from re-creating files that were intentionally
  // removed (e.g. after switching from full to B2-filtered mode).
  {
    let pruned = 0;
    for (const [key, entry] of Object.entries(state.entries)) {
      if (entry.file === "__form-of-skip__") continue;
      if (!existsSync(join(DATA_DIR, entry.file))) {
        delete state.entries[key];
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`Pruned ${pruned} stale state entries (files no longer on disk).`);
    }
  }

  saveState(state);

  // Patch text_linked references that moved across homonym files.
  // Non-proofread examples will be recomputed by build-index anyway, but
  // proofread examples (_proofread.annotations set) have frozen text_linked
  // that build-index skips — those MUST be patched here.
  if (allTextLinkedRemaps.length > 0) {
    let patchedCount = 0;
    for (const ex of Object.values(allExamples)) {
      if (!ex.text_linked) continue;
      for (const { oldRef, newRef } of allTextLinkedRemaps) {
        if (ex.text_linked.includes(oldRef)) {
          ex.text_linked = ex.text_linked.replaceAll(oldRef, newRef);
          patchedCount++;
        }
      }
    }
    if (patchedCount > 0) {
      console.warn(`[cross-file] Patched text_linked in ${patchedCount} example(s).`);
    }
  }

  // Write shared examples file (sharded)
  saveExamples(allExamples as unknown as ExampleMap);

  const exampleCount = Object.values(allExamples).filter(
    (e) => !e.type,
  ).length;
  const expressionCount = Object.values(allExamples).filter(
    (e) => e.type === "expression" || e.type === "proverb",
  ).length;
  closeSync(rawFd);
  console.log(`\nDone. Wrote ${written} word files, skipped ${skipped} unchanged.`);
  console.log(
    `Wrote ${exampleCount} examples + ${expressionCount} expressions/proverbs to examples.json.`,
  );

  if (seedWords) {
    const found = new Set(
      [...groups.keys()].map((k) => k.split("|")[0].toLowerCase()),
    );
    const missing = [...seedWords].filter((w) => !found.has(w));
    if (missing.length) {
      console.log(
        `\nWarning: ${missing.length} seed words not found in source:`,
      );
      missing.forEach((w) => console.log(`  - ${w}`));
    }
  }
}

main().catch((err: unknown) => {
  console.error("Transform failed:", err);
  process.exit(1);
});
