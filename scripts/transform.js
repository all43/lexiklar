import {
  createReadStream,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "fs";
import { createInterface } from "readline";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_FILE = join(ROOT, "data", "raw", "de-extract.jsonl");
const DATA_DIR = join(ROOT, "data");
const WORDS_DIR = join(DATA_DIR, "words");
const EXAMPLES_FILE = join(DATA_DIR, "examples.json");
const RULES_DIR = join(DATA_DIR, "rules");
const STATE_FILE = join(ROOT, "data", "raw", ".import-state.json");
const SEED_FILE = join(ROOT, "config", "seed-words.json");

import { POS_CONFIG, SUPPORTED_POS } from "./lib/pos.js";
import { computeConjugation } from "../src/utils/verb-forms.js";
import {
  extractVerbConjugation,
  extractVerbMeta,
  extractPresentStem,
  classifyVerb,
  extractStems,
  validateConjugation,
} from "./lib/verb-extract.js";

// Load adjective endings rule for regularity check
const ADJ_ENDINGS = JSON.parse(
  readFileSync(join(RULES_DIR, "adj-endings.json"), "utf-8"),
);

// Load verb endings rules for conjugation classification
const VERB_ENDINGS = JSON.parse(
  readFileSync(join(RULES_DIR, "verb-endings.json"), "utf-8"),
);

// Load noun gender rules for rule matching
const NOUN_GENDER_RULES = JSON.parse(
  readFileSync(join(RULES_DIR, "noun-gender.json"), "utf-8"),
);

// Only match rules at 95%+ reliability; moderate rules are stored for future use
const ACTIVE_RELIABILITY = new Set(["always", "nearly_always", "high"]);

// Pre-sort suffix rules by pattern length descending for longest-match-first
const SUFFIX_RULES = NOUN_GENDER_RULES.rules
  .filter((r) => r.type === "suffix" && ACTIVE_RELIABILITY.has(r.reliability))
  .sort((a, b) => b.pattern.length - a.pattern.length);

const NOMINALIZED_INF_RULE = NOUN_GENDER_RULES.rules.find(
  (r) => r.type === "nominalized_infinitive",
);

// ============================================================
// Utilities
// ============================================================

function sha256(str) {
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function contentHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 10);
}

function loadState() {
  if (existsSync(STATE_FILE)) {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    if (!data.entries) data.entries = {};
    return data;
  }
  return { entries: {} };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadSeedList() {
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf-8"));
  return new Set(seed.words.map((w) => w.word.toLowerCase()));
}

/**
 * Build a Set of words that appear in the top `maxRank` positions of the
 * Leipzig frequency list. Used to restrict the full pipeline to B2 vocabulary.
 * Words are stored exactly as they appear in the corpus (case-sensitive).
 * `maxSubtitleRank` can be set higher than `maxRank` to capture everyday
 * spoken vocabulary that is underrepresented in news corpora.
 */
function loadFrequencyFilter(wordsFile, subtitleFile, maxRank, maxSubtitleRank, whitelist = []) {
  const filter = new Set();

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
      .filter(Boolean)
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

function splitForms(entry) {
  const forms = entry.forms || [];
  return {
    compact: forms.filter((f) => !f.source),
    sourced: forms.filter((f) => f.source),
  };
}

// Tags that identify a declension cell rather than a gender-pair reference.
const CASE_NUMBER_TAGS = new Set([
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
function extractGenderCounterpart(entry) {
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

const allExamples = {};

function collectExample(text, translation, lemma) {
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
const EXPRESSION_SYNONYM_STOPWORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
  "und", "oder", "aber", "auch", "nicht", "so", "noch", "schon",
]);

function collectExpression(text, type, note, lemma) {
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
function addExpressionSynonym(expressionId, word) {
  if (!expressionId || !allExamples[expressionId]) return;
  const trimmed = word.trim();
  if (!trimmed || EXPRESSION_SYNONYM_STOPWORDS.has(trimmed.toLowerCase())) return;
  if (!allExamples[expressionId].synonyms) allExamples[expressionId].synonyms = [];
  if (!allExamples[expressionId].synonyms.includes(trimmed)) {
    allExamples[expressionId].synonyms.push(trimmed);
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
function extractExpressions(entry) {
  const ids = [];
  let lastExprId = null;

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

// ============================================================
// Shared parsers
// ============================================================

/**
 * Build a mapping from Wiktionary sense_index → our 1-based output position.
 * Only counts senses that survive the form_of/alt_of filter.
 */
function buildSenseIndexMap(rawSenses) {
  const map = {};
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
 *   ^([1])                  → superscript sense ref (~1,048 in full dataset)
 *   [N] (bare, in context)  → unter [2], Frucht von [1], in [1], etc. (~1,200 total)
 *
 * Output tokens:
 *   [[^N]]  — superscript reference to sense N (1-based)
 *   [[#N]]  — inline reference to sense N (1-based)
 *
 * Unmappable refs (pointing to filtered-out senses) are stripped.
 */
function resolveGlossRefs(gloss, senseIndexMap) {
  return gloss
    // ^([N]) → [[^mapped]] (superscript sense refs)
    .replace(/\s*\^\(\[(\d+)\]\)/g, (_, n) => {
      const mapped = senseIndexMap[n];
      return mapped != null ? ` [[^${mapped}]]` : "";
    })
    // All remaining [N] → [[#mapped]] (covers unter [N], Frucht von [N], in [N], etc.)
    .replace(/\[(\d+)\]/g, (_, n) => {
      const mapped = senseIndexMap[n];
      return mapped != null ? `[[#${mapped}]]` : "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

function transformSenses(entry) {
  const rawSenses = entry.senses || [];
  const senseIndexMap = buildSenseIndexMap(rawSenses);

  return rawSenses
    .filter((s) => !s.form_of?.length && !s.alt_of?.length)
    .map((s) => {
      const exampleIds = (s.examples || [])
        .map((e) =>
          collectExample(
            e.text,
            e.english || e.translation || null,
            entry.word,
          ),
        )
        .filter(Boolean);

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
    });
}

function extractSounds(entry) {
  return (entry.sounds || [])
    .filter((s) => s.ipa)
    .map((s) => ({ ipa: s.ipa, tags: s.tags || [] }));
}

// ============================================================
// Noun parsing
// ============================================================

function parseGender(entry) {
  const tags = entry.tags || [];
  if (tags.includes("masculine")) return "M";
  if (tags.includes("feminine")) return "F";
  if (tags.includes("neuter")) return "N";
  return null;
}

const CASE_TAGS = {
  nominative: "nom",
  accusative: "acc",
  dative: "dat",
  genitive: "gen",
};

function extractNounCaseForms(compact) {
  const cases = {
    singular: { nom: null, acc: null, dat: null, gen: null },
    plural: { nom: null, acc: null, dat: null, gen: null },
  };

  for (const f of compact) {
    const tags = new Set(f.tags || []);
    for (const [tag, key] of Object.entries(CASE_TAGS)) {
      if (!tags.has(tag)) continue;
      const num = tags.has("plural") ? "plural" : "singular";
      if (!cases[num][key]) {
        cases[num][key] = f.form;
      }
    }
  }

  return cases;
}

function parsePluralForm(compact) {
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
function matchNounGenderRule(word, gender, pluralForm) {
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
  const wordLower = word.toLowerCase();
  for (const rule of SUFFIX_RULES) {
    if (wordLower.endsWith(rule.pattern)) {
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

function transformNoun(entry, posLabel = "noun") {
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
        ? { M: "der", F: "die", N: "das" }[gender]
        : null,
    plural_form: pluralForm,
    gender_rule: matchNounGenderRule(entry.word, gender, pluralForm),
    case_forms: caseForms,
    senses: transformSenses(entry),
    sounds: extractSounds(entry),
  };
}

function transformVerb(entry) {
  const { compact, sourced } = splitForms(entry);
  const meta = extractVerbMeta(entry, compact);
  const fullConjugation = extractVerbConjugation(compact, sourced);

  const { separable, prefix } = meta;
  const presentStem = extractPresentStem(entry.word, separable, prefix);
  const cls = classifyVerb(fullConjugation, presentStem, separable, prefix);
  const past_participle =
    fullConjugation.participle2 || meta.principal_parts.past_participle;

  const base = {
    word: entry.word,
    pos: "verb",
    etymology_number: entry.etymology_number || null,
    auxiliary: meta.auxiliary,
    separable: meta.separable,
    prefix: meta.prefix,
    reflexive: meta.reflexive,
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
  const stems = extractStems(
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

function extractAdjComparison(compact, word) {
  let comparative = null;
  let superlative = null;

  for (const f of compact) {
    const tags = f.tags || [];
    if (tags.includes("comparative") && !comparative) comparative = f.form;
    if (tags.includes("superlative") && !superlative) superlative = f.form;
  }

  const umlaut_in_comparison =
    !!comparative && /[äöü]/i.test(comparative) && !/[äöü]/i.test(word);

  return { comparative, superlative, umlaut_in_comparison };
}

const ADJ_CASES = {
  nominative: "nom",
  accusative: "acc",
  dative: "dat",
  genitive: "gen",
};
const ADJ_GENDERS = { masculine: "masc", feminine: "fem", neuter: "neut" };
const ADJ_DECL_TYPES = ["strong", "weak", "mixed"];

function extractAdjDeclension(sourced) {
  const declension = {
    strong: { masc: {}, fem: {}, neut: {}, plural: {} },
    weak: { masc: {}, fem: {}, neut: {}, plural: {} },
    mixed: { masc: {}, fem: {}, neut: {}, plural: {} },
  };

  for (const f of sourced) {
    const tags = new Set(f.tags || []);
    if (!tags.has("positive")) continue;

    const declType = ADJ_DECL_TYPES.find((d) => tags.has(d));
    if (!declType) continue;

    let genderKey = null;
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
function checkAdjRegularity(declension) {
  const strongMascNom = declension.strong?.masc?.nom;
  if (!strongMascNom || !strongMascNom.endsWith("er")) {
    return { regular: false, stem: null };
  }

  const stem = strongMascNom.slice(0, -2);

  for (const declType of ADJ_DECL_TYPES) {
    const endings = ADJ_ENDINGS[declType];
    if (!endings) continue;
    for (const [gender, cases] of Object.entries(endings)) {
      if (gender === "description") continue;
      for (const [caseName, ending] of Object.entries(cases)) {
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

function transformAdj(entry) {
  const { compact, sourced } = splitForms(entry);
  const comparison = extractAdjComparison(compact, entry.word);
  const hasSourced = sourced.length > 0;

  const result = {
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
      result.declension = declension;
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
function transformSimple(entry, posLabel) {
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
function detectPhraseType(entry) {
  const cats = entry.categories || [];
  if (cats.includes("Sprichwort (Deutsch)"))   return "proverb";
  if (cats.includes("Grußformel (Deutsch)"))   return "greeting";
  if (cats.includes("Toponym (Deutsch)"))       return "toponym";
  if (cats.includes("Redewendung (Deutsch)"))   return "idiom";
  if (cats.includes("Wortverbindung (Deutsch)")) return "collocation";
  return null;
}

/**
 * Phrase transformer — extracts phrase_type from Wiktionary categories.
 */
function transformPhrase(entry) {
  const base = transformSimple(entry, "phrase");
  const phraseType = detectPhraseType(entry);
  if (phraseType) base.phrase_type = phraseType;
  return base;
}

// ============================================================
// File naming
// ============================================================

function sanitizeFilename(name) {
  return name.replace(/[\/\\:*?"<>|]/g, "_");
}

function getDisambiguator(entry) {
  const firstSense = (entry.senses || [])[0];
  if (!firstSense?.glosses?.length)
    return String(entry.etymology_number || 1);

  const gloss = firstSense.glosses[firstSense.glosses.length - 1];
  const skip = new Set([
    "the", "a", "an", "to", "of", "in", "on", "for", "und", "oder",
    "ein", "eine", "der", "die", "das", "mit", "für", "von", "aus",
  ]);
  const word = gloss
    .split(/[\s,;()/]+/)
    .map((w) => w.replace(/[-.:!?]+$/, ""))
    .find((w) => w.length > 1 && !skip.has(w.toLowerCase()));
  return (word || String(entry.etymology_number || 1)).toLowerCase();
}

// ============================================================
// Merge: preserve manual fields from existing file
// ============================================================

function mergeWithExisting(newData, existingPath) {
  if (!existsSync(existingPath)) return newData;

  let existing;
  try {
    existing = JSON.parse(readFileSync(existingPath, "utf-8"));
  } catch {
    return newData;
  }

  // Preserve fields added by enrich step (not owned by transform)
  if (existing.frequency != null) {
    newData.frequency = existing.frequency;
  }
  if (existing.plural_dominant != null) {
    newData.plural_dominant = existing.plural_dominant;
  }

  // Preserve LLM-generated sense fields (match by position)
  if (existing.senses && newData.senses) {
    for (let i = 0; i < newData.senses.length; i++) {
      const oldSense = existing.senses[i];
      if (!oldSense) continue;
      if (oldSense.gloss_en != null)           newData.senses[i].gloss_en           = oldSense.gloss_en;
      if (oldSense.gloss_en_model != null)     newData.senses[i].gloss_en_model     = oldSense.gloss_en_model;
      if (oldSense.gloss_en_full != null)      newData.senses[i].gloss_en_full      = oldSense.gloss_en_full;
      if (oldSense.gloss_en_full_model != null) newData.senses[i].gloss_en_full_model = oldSense.gloss_en_full_model;
    }
  }

  return newData;
}

// ============================================================
// Main pipeline
// ============================================================

async function main() {
  const useSeed = process.argv.includes("--seed");
  const seedWords = useSeed ? loadSeedList() : null;

  const maxFreqIdx = process.argv.indexOf("--max-frequency");
  const maxFrequency =
    maxFreqIdx !== -1 ? parseInt(process.argv[maxFreqIdx + 1], 10) : null;

  const maxSubtitleIdx = process.argv.indexOf("--max-subtitle-rank");
  const maxSubtitleRank =
    maxSubtitleIdx !== -1 ? parseInt(process.argv[maxSubtitleIdx + 1], 10) : null;

  let freqFilter = null;
  if (maxFrequency && !useSeed) {
    const wordsFile = join(ROOT, "data", "raw", "leipzig-words.txt");
    const subtitleFile = join(ROOT, "data", "raw", "opensubtitles-words.txt");
    if (!existsSync(wordsFile) && !existsSync(subtitleFile)) {
      console.error(
        `No frequency corpus found. Run 'npm run download-corpus' first.`,
      );
      process.exit(1);
    }
    const whitelistFile = join(ROOT, "config", "word-whitelist.json");
    const whitelist = existsSync(whitelistFile)
      ? JSON.parse(readFileSync(whitelistFile, "utf-8")).words.map((w) => w.word)
      : [];
    freqFilter = loadFrequencyFilter(wordsFile, subtitleFile, maxFrequency, maxSubtitleRank, whitelist);
  }

  if (useSeed) console.log(`Seed mode: processing ${seedWords.size} words`);
  else if (maxFrequency) console.log(`B2 mode: top ${maxFrequency} words by frequency (subtitle rank: ${maxSubtitleRank ?? maxFrequency})`);
  else console.log("Full mode: processing all entries");

  if (!existsSync(RAW_FILE)) {
    console.error(`Missing ${RAW_FILE}. Run 'npm run download' first.`);
    process.exit(1);
  }

  const state = loadState();

  // Phase 1: Collect matching entries, grouped by word|pos
  console.log("Scanning source data...");
  const groups = new Map();
  // Buffer for noun entries with gender-pair form references. Populated for ALL
  // such nouns regardless of the frequency filter so that Phase 1b can force-
  // include counterparts of filtered-out words (e.g. Automechanikerin when only
  // Automechaniker passed the cutoff).
  const genderBuffer = new Map(); // lowerCaseWord → raw JSON string
  const rl = createInterface({ input: createReadStream(RAW_FILE) });
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount % 50000 === 0)
      process.stdout.write(`\r  ${lineCount} lines scanned`);

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.lang_code !== "de") continue;
    if (!SUPPORTED_POS[entry.pos]) continue;

    // Skip surnames and first names — only keep toponyms for proper nouns.
    // pos_title: "Toponym" (places), "Nachname" (surnames), "Vorname" (first names)
    if (
      entry.pos === "name" &&
      entry.pos_title !== "Toponym"
    )
      continue;

    if (
      entry.senses?.length > 0 &&
      entry.senses.every((s) => s.form_of?.length || s.alt_of?.length)
    )
      continue;

    // Buffer noun entries that carry a gender-pair reference, before filter
    // checks, so Phase 1b can retrieve them even if they didn't pass the filter.
    // Store only the raw string — parsed object is re-created on demand.
    if (entry.pos === "noun" && extractGenderCounterpart(entry)) {
      if (!genderBuffer.has(entry.word.toLowerCase()))
        genderBuffer.set(entry.word.toLowerCase(), line);
    }

    if (seedWords && !seedWords.has(entry.word.toLowerCase())) continue;
    if (freqFilter && entry.pos !== "phrase" && !freqFilter.has(entry.word.toLowerCase())) continue;

    const key = `${entry.word}|${entry.pos}`;
    if (!groups.has(key)) groups.set(key, []);
    // Store raw string + pre-computed hash only. Parsed object is recreated in
    // Phase 2 to avoid holding two copies (raw + JS object) per entry in RAM.
    groups.get(key).push({ raw: line, hash: sha256(line) });
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
  if (freqFilter && !useSeed) {
    let counterpartsAdded = 0;
    for (const [, entries] of groups) {
      for (const { raw } of entries) {
        const parsed = JSON.parse(raw);
        if (parsed.pos !== "noun") continue;
        const counterpartWord = extractGenderCounterpart(parsed);
        if (!counterpartWord) continue;
        const counterpartKey = `${counterpartWord}|noun`;
        if (groups.has(counterpartKey)) break; // already included — move to next group
        const bufferedRaw = genderBuffer.get(counterpartWord.toLowerCase());
        if (!bufferedRaw) break; // not present in Wiktionary data
        groups.set(counterpartKey, [{ raw: bufferedRaw, hash: sha256(bufferedRaw) }]);
        counterpartsAdded++;
        break; // counterpart added, no need to check other entries in this group
      }
    }
    if (counterpartsAdded > 0)
      console.log(`  Added ${counterpartsAdded} gender counterpart(s) missing from frequency filter.`);
  }
  genderBuffer.clear(); // free memory — no longer needed after Phase 1b

  // Load existing examples to preserve manually added data
  let existingExamples = {};
  if (existsSync(EXAMPLES_FILE)) {
    try {
      existingExamples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));
    } catch {
      /* ignore */
    }
  }

  // Seed allExamples with all existing examples so that skipped (unchanged)
  // entries don't lose their examples on incremental re-runs.
  // Newly processed entries will overwrite with fresh data (same content hash
  // → same id, so no actual change for identical text).
  for (const [id, ex] of Object.entries(existingExamples)) {
    allExamples[id] = ex;
  }

  // Phase 2: Transform and write
  let written = 0;
  let skipped = 0;
  const transformers = {
    noun: transformNoun,
    verb: transformVerb,
    adj: transformAdj,
    phrase: transformPhrase,
    adv: (e) => transformSimple(e, POS_CONFIG.adv.label),
    prep: (e) => transformSimple(e, POS_CONFIG.prep.label),
    conj: (e) => transformSimple(e, POS_CONFIG.conj.label),
    particle: (e) => transformSimple(e, POS_CONFIG.particle.label),
    intj: (e) => transformSimple(e, POS_CONFIG.intj.label),
    pron: (e) => transformSimple(e, POS_CONFIG.pron.label),
    det: (e) => transformSimple(e, POS_CONFIG.det.label),
    num: (e) => transformSimple(e, POS_CONFIG.num.label),
    name: (e) => transformNoun(e, POS_CONFIG.name.label),
  };

  const today = new Date().toISOString().slice(0, 10);

  for (const [, entries] of groups) {
    const needsDisambig = entries.length > 1;

    for (const { raw, hash } of entries) {
      // Parse lazily here — we deliberately did NOT store the parsed object in
      // Phase 1 so that genderBuffer and groups don't hold two copies (raw string
      // + JS object) of every entry simultaneously.
      const parsed = JSON.parse(raw);
      const stateKey = `${parsed.word}|${parsed.pos}|${parsed.etymology_number || 1}`;

      if (state.entries[stateKey]?.hash === hash) {
        skipped++;
        continue;
      }

      const transform = transformers[parsed.pos];
      if (!transform) continue;
      let data = transform(parsed);

      // Extract expressions and proverbs (word-level, not sense-level)
      const expressionIds = extractExpressions(parsed);
      if (expressionIds.length > 0) data.expression_ids = expressionIds;

      // Extract relationship hints for build-index resolution (entry-level fields)
      const rawDerived = (parsed.derived || [])
        .map((d) => d.word)
        .filter(Boolean);
      const rawHyponyms = (parsed.hyponyms || [])
        .map((h) => h.word)
        .filter(Boolean);
      // Antonyms and synonyms are entry-level in German Wiktionary (not sense-level)
      const rawAntonyms = [...new Set(
        (parsed.antonyms || []).map((a) => a.word).filter(Boolean)
      )];
      const rawSynonyms = [...new Set(
        (parsed.synonyms || []).map((s) => s.word).filter(Boolean)
      )];
      if (rawDerived.length) data._derived = rawDerived;
      if (rawHyponyms.length) data._hyponyms = rawHyponyms;
      if (rawAntonyms.length) data._antonyms = rawAntonyms;
      if (rawSynonyms.length) data._synonyms = rawSynonyms;

      // Gender pair reference: masculine ↔ feminine noun counterpart
      const genderCounterpart = extractGenderCounterpart(parsed);
      if (genderCounterpart) data._gender_counterpart = genderCounterpart;

      // Add _meta
      data._meta = {
        source_hash: hash,
        generated_at: today,
      };

      // Determine file path
      const disambig = needsDisambig ? getDisambiguator(parsed) : null;
      const filename =
        sanitizeFilename(
          disambig ? `${parsed.word}_${disambig}` : parsed.word,
        ) + ".json";
      const posDir = SUPPORTED_POS[parsed.pos];
      const relPath = join("words", posDir, filename);
      const fullPath = join(DATA_DIR, relPath);

      // Merge with existing file to preserve manual fields
      data = mergeWithExisting(data, fullPath);

      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n");

      state.entries[stateKey] = { hash, file: relPath };
      written++;
    }
  }

  saveState(state);

  // Write shared examples file
  // Sort keys for stable output
  const sortedExamples = {};
  for (const key of Object.keys(allExamples).sort()) {
    sortedExamples[key] = allExamples[key];
  }
  writeFileSync(EXAMPLES_FILE, JSON.stringify(sortedExamples, null, 2) + "\n");

  const exampleCount = Object.values(sortedExamples).filter(
    (e) => !e.type,
  ).length;
  const expressionCount = Object.values(sortedExamples).filter(
    (e) => e.type === "expression" || e.type === "proverb",
  ).length;
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

main().catch((err) => {
  console.error("Transform failed:", err);
  process.exit(1);
});
