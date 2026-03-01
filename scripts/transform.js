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
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
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

function splitForms(entry) {
  const forms = entry.forms || [];
  return {
    compact: forms.filter((f) => !f.source),
    sourced: forms.filter((f) => f.source),
  };
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

/**
 * Extract expressions and proverbs from a Wiktionary entry.
 * Returns array of content-hash IDs.
 */
function extractExpressions(entry) {
  const ids = [];
  for (const e of entry.expressions || []) {
    const id = collectExpression(e.word, "expression", e.note, entry.word);
    if (id) ids.push(id);
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

function transformNoun(entry) {
  const { compact } = splitForms(entry);
  const gender = parseGender(entry);
  const caseForms = extractNounCaseForms(compact);
  const pluralForm = parsePluralForm(compact);

  if (!caseForms.singular.nom) caseForms.singular.nom = entry.word;

  return {
    word: entry.word,
    pos: "noun",
    etymology_number: entry.etymology_number || null,
    gender,
    article: gender ? { M: "der", F: "die", N: "das" }[gender] : null,
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
 * Phrase transformer — same as simple but separate for future extensibility
 * (may later gain fields like components, literal_translation).
 */
function transformPhrase(entry) {
  return transformSimple(entry, "phrase");
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

  // Preserve frequency (added by enrich step, not owned by transform)
  if (existing.frequency != null) {
    newData.frequency = existing.frequency;
  }

  // Preserve gloss_en in senses (match by position)
  if (existing.senses && newData.senses) {
    for (let i = 0; i < newData.senses.length; i++) {
      const oldSense = existing.senses[i];
      if (oldSense?.gloss_en != null) {
        newData.senses[i].gloss_en = oldSense.gloss_en;
      }
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

  if (useSeed) console.log(`Seed mode: processing ${seedWords.size} words`);
  else console.log("Full mode: processing all entries");

  if (!existsSync(RAW_FILE)) {
    console.error(`Missing ${RAW_FILE}. Run 'npm run download' first.`);
    process.exit(1);
  }

  const state = loadState();

  // Phase 1: Collect matching entries, grouped by word|pos
  console.log("Scanning source data...");
  const groups = new Map();
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

    if (
      entry.senses?.length > 0 &&
      entry.senses.every((s) => s.form_of?.length || s.alt_of?.length)
    )
      continue;

    if (seedWords && !seedWords.has(entry.word.toLowerCase())) continue;

    const key = `${entry.word}|${entry.pos}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ raw: line, parsed: entry });
  }

  const totalEntries = [...groups.values()].reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  console.log(
    `\n  Found ${totalEntries} entries across ${groups.size} word groups`,
  );

  // Load existing examples to preserve manually added data
  let existingExamples = {};
  if (existsSync(EXAMPLES_FILE)) {
    try {
      existingExamples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));
    } catch {
      /* ignore */
    }
  }

  // Seed allExamples with existing manual data (translation, extra lemmas)
  for (const [id, ex] of Object.entries(existingExamples)) {
    if (ex.translation || ex.source !== "wiktionary") {
      allExamples[id] = ex;
    }
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
  };

  const today = new Date().toISOString().slice(0, 10);

  for (const [, entries] of groups) {
    const needsDisambig = entries.length > 1;

    for (const { raw, parsed } of entries) {
      const sourceHash = sha256(raw);
      const stateKey = `${parsed.word}|${parsed.pos}|${parsed.etymology_number || 1}`;

      if (state.entries[stateKey]?.hash === sourceHash) {
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
      if (rawDerived.length) data._derived = rawDerived;
      if (rawHyponyms.length) data._hyponyms = rawHyponyms;

      // Add _meta
      data._meta = {
        source_hash: sourceHash,
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
      writeFileSync(fullPath, JSON.stringify(data, null, 2));

      state.entries[stateKey] = { hash: sourceHash, file: relPath };
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
  writeFileSync(EXAMPLES_FILE, JSON.stringify(sortedExamples, null, 2));

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
