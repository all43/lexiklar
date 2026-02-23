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

const SUPPORTED_POS = { noun: "nouns", verb: "verbs", adj: "adjectives" };

// Load adjective endings rule for regularity check
const ADJ_ENDINGS = JSON.parse(
  readFileSync(join(RULES_DIR, "adj-endings.json"), "utf-8"),
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

// ============================================================
// Shared parsers
// ============================================================

function transformSenses(entry) {
  return (entry.senses || [])
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
      const gloss = glosses[glosses.length - 1] || glosses[0] || "";

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

function transformNoun(entry) {
  const { compact } = splitForms(entry);
  const gender = parseGender(entry);
  const caseForms = extractNounCaseForms(compact);

  if (!caseForms.singular.nom) caseForms.singular.nom = entry.word;

  return {
    word: entry.word,
    pos: "noun",
    etymology_number: entry.etymology_number || null,
    gender,
    article: gender ? { M: "der", F: "die", N: "das" }[gender] : null,
    plural_form: parsePluralForm(compact),
    case_forms: caseForms,
    senses: transformSenses(entry),
    sounds: extractSounds(entry),
  };
}

// ============================================================
// Verb parsing
// ============================================================

function extractVerbMeta(entry, compact) {
  const auxForms = compact
    .filter(
      (f) => f.tags?.includes("auxiliary") && f.tags?.includes("perfect"),
    )
    .map((f) => f.form);
  let auxiliary = null;
  if (auxForms.includes("sein") && auxForms.includes("haben"))
    auxiliary = "both";
  else if (auxForms.includes("sein")) auxiliary = "sein";
  else if (auxForms.includes("haben")) auxiliary = "haben";

  const ppForm = compact.find(
    (f) => f.tags?.includes("participle-2") && f.tags?.includes("perfect"),
  );
  const past_participle = ppForm?.form || null;

  const pastForm = compact.find(
    (f) =>
      f.tags?.includes("past") &&
      !f.tags?.includes("subjunctive-ii") &&
      f.pronouns?.includes("ich"),
  );
  const past_stem = pastForm?.form || null;

  let separable = false;
  let prefix = null;
  const presentForms = compact.filter(
    (f) => f.tags?.includes("present") && f.pronouns?.length,
  );
  for (const f of presentForms) {
    const parts = f.form.split(" ");
    if (parts.length === 2) {
      const candidatePrefix = parts[1];
      if (entry.word.startsWith(candidatePrefix)) {
        separable = true;
        prefix = candidatePrefix;
        break;
      }
    }
  }

  const senses = entry.senses || [];
  const reflexiveCount = senses.filter((s) =>
    s.tags?.includes("reflexive"),
  ).length;
  let reflexive = "none";
  if (reflexiveCount > 0 && reflexiveCount === senses.length)
    reflexive = "mandatory";
  else if (reflexiveCount > 0) reflexive = "optional";

  return {
    auxiliary,
    separable,
    prefix,
    reflexive,
    principal_parts: {
      infinitive: entry.word,
      past_stem,
      past_participle,
    },
  };
}

const PRONOUN_PREFIXES = [
  "er/sie/es ",
  "ich ",
  "du ",
  "er ",
  "sie ",
  "es ",
  "wir ",
  "ihr ",
];
function stripPronoun(form) {
  for (const p of PRONOUN_PREFIXES) {
    if (form.startsWith(p)) return form.slice(p.length);
  }
  return form;
}

function personKeyFromTags(tags) {
  const s = new Set(tags);
  if (s.has("first-person") && s.has("singular")) return "ich";
  if (s.has("second-person") && s.has("singular")) return "du";
  if (s.has("third-person") && s.has("singular")) return "er";
  if (s.has("first-person") && s.has("plural")) return "wir";
  if (s.has("second-person") && s.has("plural")) return "ihr";
  if (s.has("third-person") && s.has("plural")) return "sie";
  return null;
}

function personKeyFromPronouns(pronouns) {
  if (!pronouns?.length) return null;
  const p = pronouns[0];
  if (p === "ich") return "ich";
  if (p === "du") return "du";
  if (p === "er" || p === "sie" || p === "es") return "er";
  if (p === "wir") return "wir";
  if (p === "ihr") return "ihr";
  return null;
}

function extractVerbConjugation(compact, sourced) {
  const conjugation = {
    present: {},
    preterite: {},
    subjunctive1: {},
    subjunctive2: {},
    imperative: {},
    participle1: null,
    participle2: null,
  };

  for (const f of compact) {
    const tags = f.tags || [];

    if (tags.includes("participle-2")) {
      conjugation.participle2 = f.form;
      continue;
    }

    if (tags.includes("imperative")) {
      if (tags.includes("singular") && !conjugation.imperative.du) {
        conjugation.imperative.du = f.form;
      } else if (tags.includes("plural") && !conjugation.imperative.ihr) {
        conjugation.imperative.ihr = f.form;
      }
      continue;
    }

    if (tags.includes("present") && f.pronouns?.length) {
      const pk = personKeyFromPronouns(f.pronouns);
      if (pk && !conjugation.present[pk]) conjugation.present[pk] = f.form;
      continue;
    }

    if (
      tags.includes("past") &&
      !tags.includes("subjunctive-ii") &&
      f.pronouns?.length
    ) {
      const pk = personKeyFromPronouns(f.pronouns);
      if (pk && !conjugation.preterite[pk]) conjugation.preterite[pk] = f.form;
      continue;
    }

    if (tags.includes("subjunctive-ii") && f.pronouns?.length) {
      const pk = personKeyFromPronouns(f.pronouns);
      if (pk && !conjugation.subjunctive2[pk])
        conjugation.subjunctive2[pk] = f.form;
      continue;
    }
  }

  for (const f of sourced) {
    const tags = new Set(f.tags || []);
    if (!tags.has("active")) continue;
    if (tags.has("perfect") || tags.has("pluperfect")) continue;
    if (tags.has("future-i") || tags.has("future-ii")) continue;

    const form = stripPronoun(f.form);

    if (tags.has("participle") && tags.has("present")) {
      if (!conjugation.participle1) conjugation.participle1 = form;
      continue;
    }

    if (tags.has("imperative")) {
      if (tags.has("honorific") && tags.has("present")) {
        if (!conjugation.imperative.Sie) conjugation.imperative.Sie = f.form;
      }
      continue;
    }

    let moodKey = null;
    if (tags.has("indicative") && tags.has("present")) moodKey = "present";
    else if (tags.has("indicative") && tags.has("past")) moodKey = "preterite";
    else if (tags.has("subjunctive-i") && tags.has("present"))
      moodKey = "subjunctive1";
    else if (tags.has("subjunctive-ii") && tags.has("past"))
      moodKey = "subjunctive2";
    if (!moodKey) continue;

    const pk = personKeyFromTags(f.tags);
    if (!pk) continue;

    if (!conjugation[moodKey][pk]) conjugation[moodKey][pk] = form;
  }

  return conjugation;
}

function transformVerb(entry) {
  const { compact, sourced } = splitForms(entry);
  const meta = extractVerbMeta(entry, compact);

  return {
    word: entry.word,
    pos: "verb",
    etymology_number: entry.etymology_number || null,
    ...meta,
    conjugation: extractVerbConjugation(compact, sourced),
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

  const exampleCount = Object.keys(sortedExamples).length;
  console.log(`\nDone. Wrote ${written} word files, skipped ${skipped} unchanged.`);
  console.log(`Wrote ${exampleCount} examples to examples.json.`);

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
