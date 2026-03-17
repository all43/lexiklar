/**
 * normalize-annotations.ts — Clean up annotation pos values in examples.json.
 *
 * 1. Normalize variant POS spellings to canonical word-file POS values
 *    (e.g. "article" → "determiner", "adv" → "adverb", "auxiliary" → "verb")
 * 2. Normalize contraction/preposition+article POS → "abbreviation" and fix
 *    lemma to the contracted form itself (e.g. lemma "in dem" → "im")
 * 3. Remove annotations with POS values that can never resolve
 *    (punctuation, symbol, prefix, suffix, etc.)
 *
 * Dry run: node scripts/normalize-annotations.js --dry-run
 */

import { loadExamples, saveExamples } from "./lib/examples.js";
import type { Annotation, ExampleMap } from "../types/example.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Known contractions: any lemma variant → canonical form
const CONTRACTION_LEMMAS: Record<string, string> = {
  "in dem": "im", "in+dem": "im", "in the": "im",
  "in das": "ins", "in+das": "ins",
  "an dem": "am", "an+dem": "am", "on the": "am",
  "an das": "ans", "an+das": "ans",
  "zu dem": "zum", "zu+dem": "zum",
  "zu der": "zur", "zu+der": "zur", "to the": "zur",
  "bei dem": "beim", "bei+dem": "beim",
  "von dem": "vom", "von+dem": "vom",
  "auf das": "aufs", "auf+das": "aufs",
  "um das": "ums", "um+das": "ums",
  "für das": "fürs", "für+das": "fürs",
  "durch das": "durchs", "durch+das": "durchs",
  "vor das": "vors", "vor+das": "vors",
};

// POS values that indicate a contraction annotation
const CONTRACTION_POS = new Set([
  "preposition+article", "preposition + article", "article+preposition",
  "prep+art", "präp+art", "contraction",
]);

// Maps annotation pos → canonical word-file pos
// null = remove the annotation entirely
const POS_NORM: Record<string, string | null> = {
  // Determiner variants
  article:              "determiner",
  "indefinite article": "determiner",
  det:                  "determiner",
  determinant:          "determiner",
  determinative:        "determiner",
  // Adverb variants
  adv:                  "adverb",
  // Preposition variants
  prep:                 "preposition",
  adposition:           "preposition",
  "adposition+article contraction": "preposition",
  // Conjunction variants
  conj:                 "conjunction",
  // Pronoun variants
  pron:                 "pronoun",
  "indefinite pronoun": "pronoun",
  "relative pronoun":   "pronoun",
  "reflexive pronoun":  "pronoun",
  "pronoun possessive": "pronoun",
  "pronoun/determiner": "pronoun",
  "rel pronoun":        "pronoun",
  "she (pronoun)":      "pronoun",
  she:                  "pronoun",
  // Numeral variants
  num:                  "numeral",
  number:               "numeral",
  // Verb variants
  auxiliary:            "verb",
  "auxiliary verb":     "verb",
  "modal verb":         "verb",
  // Adjective variants
  adj:                  "adjective",
  "possessive adjective": "adjective",
  // Typos / non-standard
  "präposition":        "preposition",
  "präp":               "preposition",
  "art":                "determiner",
  "disjunction":        "conjunction",
  participle:           "adjective",
  // Remove entirely — can never resolve to a word entry
  punctuation:          null,
  punct:                null,
  symbol:               null,
  prefix:               null,
  suffix:               null,
  morpheme:             null,
  phonetic:             null,
  phoneme:              null,
  letter:               null,
  expression:           null,
  clause:               null,
  sentence:             null,
  "noun+verb":          null,
  "noun+noun":          null,
  infinitive:           null,
  "dislocated phrase":  null,
  proverb:              null,
  idiom:                null,
  date:                 null,
  unit:                 null,
  reference:            null,
  ellipsis:             null,
  unknown:              null,
  other:                null,
  pos:                  null,
  "null (article) or ": null,
  // Punctuation chars used as pos
  ":":  null, ",": null, ".": null, "\u2026": null,
  "\u2013":  null, "\u2014": null, "-": null, "?": null, "...": null,
};

// Canonical POS values — no normalization needed
const CANONICAL = new Set([
  "noun", "verb", "adjective", "adverb", "preposition", "conjunction",
  "particle", "pronoun", "determiner", "numeral", "interjection",
  "proper noun", "phrase", "name", "abbreviation",
]);

const examples: ExampleMap = loadExamples();

let exModified = 0;
let annRemoved = 0;
let annNormalized = 0;
let annContraction = 0;
let total = 0;

for (const ex of Object.values(examples)) {
  if (!ex.annotations?.length) continue;
  const beforeStr = JSON.stringify(ex.annotations);

  ex.annotations = ex.annotations
    .map((ann: Annotation): Annotation | null => {
      total++;
      const pos = ann.pos;

      // Handle contractions — normalize to abbreviation + fix lemma
      if (CONTRACTION_POS.has(pos)) {
        const formLower = ann.form?.toLowerCase();
        const lemmaLower = ann.lemma?.toLowerCase();
        // Lemma is the contracted form itself, or we can look it up
        const canonicalLemma =
          CONTRACTION_LEMMAS[lemmaLower] ||
          CONTRACTION_LEMMAS[formLower] ||
          formLower;
        annContraction++;
        return { ...ann, pos: "abbreviation", lemma: canonicalLemma };
      }

      if (!pos || CANONICAL.has(pos)) return ann;

      const mapped = POS_NORM[pos];
      if (mapped === undefined) return ann; // unknown — leave as-is
      if (mapped === null) { annRemoved++; return null; }

      annNormalized++;
      return { ...ann, pos: mapped };
    })
    .filter((a): a is Annotation => a !== null);

  if (JSON.stringify(ex.annotations) !== beforeStr) exModified++;
}

console.log(`Total annotations scanned:    ${total.toLocaleString()}`);
console.log(`Normalized POS:               ${annNormalized.toLocaleString()}`);
console.log(`Contractions \u2192 abbreviation:  ${annContraction.toLocaleString()}`);
console.log(`Removed (unresolvable POS):   ${annRemoved.toLocaleString()}`);
console.log(`Examples modified:            ${exModified.toLocaleString()}`);

if (DRY_RUN) {
  console.log("\nDry run \u2014 no changes written.");
} else {
  saveExamples(examples);
  console.log("\nWritten to data/examples/");
}
