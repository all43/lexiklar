/**
 * Verb conjugation extraction from Wiktionary data.
 * Shared between transform.js (build-time) and test fixtures.
 */

import type {
  ConjugationTable,
  PersonForms,
  ImperativeForms,
  VerbStems,
} from "../../types/word.js";

// ============================================================
// Wiktionary source data shapes
// ============================================================

/** A single form entry from the Wiktionary JSONL dump. */
interface WiktForm {
  form: string;
  tags?: string[];
  source?: string;
  pronouns?: string[];
}

/** Minimal shape of a Wiktionary entry used by verb extraction. */
interface WiktEntry {
  word: string;
  forms?: WiktForm[];
  senses?: Array<{ tags?: string[] }>;
}

// ============================================================
// Internal partial types (built up incrementally)
// ============================================================

type PersonKey = keyof PersonForms;
type ImperativeKey = keyof ImperativeForms;

type PartialPersonForms = Partial<PersonForms>;
type PartialImperativeForms = Partial<ImperativeForms>;

interface PartialConjugationTable {
  present: PartialPersonForms;
  preterite: PartialPersonForms;
  subjunctive1: PartialPersonForms;
  subjunctive2: PartialPersonForms;
  imperative: PartialImperativeForms;
  participle1: string | null;
  participle2: string | null;
}

type MoodKey = "present" | "preterite" | "subjunctive1" | "subjunctive2";

/** Result of {@link validateConjugation}. */
interface ValidationResult {
  valid: boolean;
  mismatch?: string;
}

/** Result of {@link majoritySubj2Stem}. */
interface MajorityStemResult {
  stem: string | null;
  inconsistentCells: string[];
}

/** Result of {@link extractVerbMeta}. */
interface VerbMetaResult {
  auxiliary: "haben" | "sein" | "both" | null;
  separable: boolean;
  prefix: string | null;
  reflexive: "none" | "mandatory" | "optional";
  principal_parts: {
    infinitive: string;
    past_stem: string | null;
    past_participle: string | null;
  };
}

type VerbClass = "weak" | "strong" | "mixed" | "irregular";

type PersonEndingsMap = Record<PersonKey, string>;

// ============================================================
// Form parsing helpers
// ============================================================

export function splitForms(entry: WiktEntry): {
  compact: WiktForm[];
  sourced: WiktForm[];
} {
  const forms = entry.forms || [];
  return {
    compact: forms.filter((f) => !f.source),
    sourced: forms.filter((f) => f.source),
  };
}

const PRONOUN_PREFIXES: readonly string[] = [
  "er/sie/es ",
  "ich ",
  "du ",
  "er ",
  "sie ",
  "es ",
  "wir ",
  "ihr ",
];

function stripPronoun(form: string): string {
  for (const p of PRONOUN_PREFIXES) {
    if (form.startsWith(p)) return form.slice(p.length);
  }
  return form;
}

function personKeyFromTags(tags: string[]): PersonKey | null {
  const s = new Set(tags);
  if (s.has("first-person") && s.has("singular")) return "ich";
  if (s.has("second-person") && s.has("singular")) return "du";
  if (s.has("third-person") && s.has("singular")) return "er";
  if (s.has("first-person") && s.has("plural")) return "wir";
  if (s.has("second-person") && s.has("plural")) return "ihr";
  if (s.has("third-person") && s.has("plural")) return "sie";
  return null;
}

function personKeyFromPronouns(pronouns: string[] | undefined): PersonKey | null {
  if (!pronouns?.length) return null;
  const p = pronouns[0];
  if (p === "ich") return "ich";
  if (p === "du") return "du";
  if (p === "er" || p === "sie" || p === "es") return "er";
  if (p === "wir") return "wir";
  if (p === "ihr") return "ihr";
  return null;
}

// ============================================================
// Majority-vote stem extraction
// ============================================================

// Strong subjunctive 2 endings by person
export const STRONG_SUBJ2_ENDINGS: PersonEndingsMap = {
  ich: "e",
  du: "est",
  er: "e",
  wir: "en",
  ihr: "et",
  sie: "en",
};
// Mixed subjunctive 2 endings by person (weak-style)
export const MIXED_SUBJ2_ENDINGS: PersonEndingsMap = {
  ich: "te",
  du: "test",
  er: "te",
  wir: "ten",
  ihr: "tet",
  sie: "ten",
};

/**
 * Derive the subjunctive 2 stem from all 6 persons, picking the majority.
 * Handles Wiktionary inconsistencies where ich uses a different variant
 * than the other 5 persons (e.g., helfen: hülfe vs hälfe).
 */
export function majoritySubj2Stem(
  conjugation: PartialConjugationTable,
  separable: boolean,
  prefix: string | null,
  endingsMap: PersonEndingsMap,
): MajorityStemResult {
  const candidates: Record<string, PersonKey[]> = {};
  for (const [person, ending] of Object.entries(endingsMap) as Array<
    [PersonKey, string]
  >) {
    const form = conjugation.subjunctive2?.[person];
    if (!form) continue;
    const base = stripSepPrefix(form, separable, prefix);
    if (base.endsWith(ending)) {
      const stem = base.slice(0, -ending.length);
      if (!candidates[stem]) candidates[stem] = [];
      candidates[stem].push(person);
    }
  }

  const entries = Object.entries(candidates);
  if (!entries.length) return { stem: null, inconsistentCells: [] };

  // Sort by frequency descending, pick majority
  entries.sort((a, b) => b[1].length - a[1].length);
  const majorityStem = entries[0][0];

  // Collect cells that disagree with the majority
  const inconsistentCells: string[] = [];
  for (const [stem, persons] of entries) {
    if (stem !== majorityStem) {
      for (const p of persons) inconsistentCells.push(`subjunctive2.${p}`);
    }
  }

  return { stem: majorityStem, inconsistentCells };
}

// ============================================================
// Conjugation extraction
// ============================================================

// Reflexive pronouns that may appear anywhere in a stripped sourced form.
// In conjugation tables the only reason these words appear inside a form is
// when the table is for a reflexive verb (sich übergeben, sich erinnern, …).
const REFLEXIVE_RE = /\b(mich|dich|sich|uns|euch|mir|dir)\b/;

export function extractVerbConjugation(
  compact: WiktForm[],
  sourced: WiktForm[],
  entrySeparable: boolean | null = null,
  entryReflexive: string | null = null,
  entryPrefix: string | null = null,
): PartialConjugationTable {
  const conjugation: PartialConjugationTable = {
    present: {},
    preterite: {},
    subjunctive1: {},
    subjunctive2: {},
    imperative: {},
    participle1: null,
    participle2: null,
  };

  // Filter sourced forms to match the entry's separability when the raw data
  // tags forms with "separable"/"inseparable" (dual-form verb Flexion pages
  // include both conjugation tables — we only want the matching half).
  let filteredSourced = sourced;
  if (entrySeparable !== null) {
    filteredSourced = filteredSourced.filter((f) => {
      const tags = f.tags || [];
      const isSep = tags.includes("separable");
      const isInsep = tags.includes("inseparable");
      if (!isSep && !isInsep) return true;
      return entrySeparable ? isSep : isInsep;
    });
  }

  // For non-reflexive verb entries, skip sourced forms that carry a reflexive
  // pronoun (mich/dich/sich/uns/euch/mir/dir) in the form string.
  if (entryReflexive === "none") {
    filteredSourced = filteredSourced.filter((f) => {
      const stripped = stripPronoun(f.form || "");
      return !REFLEXIVE_RE.test(stripped);
    });
  }

  // Note: separability/reflexive filtering happens before the compact loop so
  // filteredSourced is ready, but the paradigm-preference reorder (below) must
  // happen AFTER the compact loop because it depends on preterite.ich.

  for (const f of compact) {
    const tags = f.tags || [];

    if (tags.includes("participle-2")) {
      // First-wins: Wiktionary lists standard form first, archaic/dialectal second
      // (e.g. aufgehängt before aufgehangen, gewinkt before gewunken)
      if (!conjugation.participle2) conjugation.participle2 = f.form;
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

  // When the compact preterite.ich indicates a strong/irregular paradigm (no -te
  // ending), reorder filteredSourced so non-regular forms come first.  Wiktionary
  // Flexion pages for dual-paradigm verbs list the regular (weak) table before the
  // irregular (strong) one, so without reordering the first-wins slot-fill picks up
  // weak du/er/… forms even though the verb is being treated as strong.
  const ichPretRaw = conjugation.preterite?.ich ?? "";
  const ichPretBare = stripSepPrefix(ichPretRaw, entrySeparable ?? false, entryPrefix);
  const preferNonRegular =
    ichPretBare.length > 0 &&
    !ichPretBare.endsWith("te") &&
    !ichPretBare.endsWith("ete");
  if (preferNonRegular) {
    filteredSourced = [
      ...filteredSourced.filter((f) => !(f.tags ?? []).includes("regular")),
      ...filteredSourced.filter((f) => (f.tags ?? []).includes("regular")),
    ];
  }

  for (const f of filteredSourced) {
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

    let moodKey: MoodKey | null = null;
    if (tags.has("indicative") && tags.has("present")) moodKey = "present";
    else if (tags.has("indicative") && tags.has("past")) moodKey = "preterite";
    else if (tags.has("subjunctive-i") && tags.has("present"))
      moodKey = "subjunctive1";
    else if (tags.has("subjunctive-ii") && tags.has("past"))
      moodKey = "subjunctive2";
    if (!moodKey) continue;

    const pk = personKeyFromTags(f.tags || []);
    if (!pk) continue;

    if (!conjugation[moodKey][pk]) conjugation[moodKey][pk] = form;
  }

  return conjugation;
}

// ============================================================
// Classification and stem extraction
// ============================================================

export function stripSepPrefix(
  form: string,
  separable: boolean,
  prefix: string | null,
): string {
  if (!separable || !prefix) return form;
  const suffix = " " + prefix;
  if (form.endsWith(suffix)) return form.slice(0, -suffix.length);
  return form;
}

export function extractPresentStem(
  word: string,
  separable: boolean,
  prefix: string | null,
): string {
  let inf = word;
  if (separable && prefix) inf = inf.slice(prefix.length);
  if (inf.endsWith("ern") || inf.endsWith("eln")) return inf.slice(0, -1);
  if (inf.endsWith("en")) return inf.slice(0, -2);
  if (inf.endsWith("n")) return inf.slice(0, -1);
  return inf;
}

export function classifyVerb(
  conjugation: PartialConjugationTable,
  presentStem: string,
  separable: boolean,
  prefix: string | null,
): VerbClass {
  const pretIch = conjugation.preterite?.ich;
  if (pretIch) {
    const form = stripSepPrefix(pretIch, separable, prefix);

    if (form === presentStem + "te" || form === presentStem + "ete") {
      return "weak";
    }
    if (form.endsWith("te")) {
      return "mixed";
    }
    return "strong";
  }

  // Fallback: infer from past participle when preterite.ich is missing.
  // Weak verbs have pp2 ending in -t (gekauft, besucht, geregnet).
  // Strong verbs end in -en (gelaufen, geschehen). Mixed end in -t with
  // vowel change (gebracht) — can't safely distinguish from weak, so only
  // classify as weak when it's unambiguous.
  const pp2 = conjugation.participle2;
  if (pp2) {
    const ppBase =
      separable && prefix
        ? pp2.replace(new RegExp("^" + prefix), "")
        : pp2;
    // Weak pp2: ge-...-t or ...-t (but NOT -en ending)
    if (ppBase.endsWith("t") && !ppBase.endsWith("en")) {
      // Verify the stem matches: strip ge- prefix and -t/-et suffix
      const stripped = ppBase.replace(/^ge/, "");
      const stem = stripped.endsWith("et")
        ? stripped.slice(0, -2)
        : stripped.slice(0, -1);
      if (
        stem === presentStem ||
        stem + "e" === presentStem ||
        presentStem.endsWith(stem)
      ) {
        return "weak";
      }
    }
  }

  return "irregular";
}

export function extractStems(
  conjugation: PartialConjugationTable,
  cls: VerbClass,
  presentStem: string,
  separable: boolean,
  prefix: string | null,
): VerbStems {
  const stems: VerbStems = { present: presentStem, past: "" };

  if (cls === "weak") {
    return stems;
  }

  if (cls === "strong") {
    const pretIch = stripSepPrefix(
      conjugation.preterite?.ich || "",
      separable,
      prefix,
    );
    stems.past = pretIch;

    const erForm = stripSepPrefix(
      conjugation.present?.er || "",
      separable,
      prefix,
    );
    if (erForm.endsWith("t")) {
      let candidate: string | null;

      if (presentStem.endsWith("t")) {
        // For t-ending stems, the er-form "t" ending may be absorbed.
        // But first check: is this just e-insertion (no vowel change)?
        // e.g., bitten: bitt + et = bittet (regular, no Ablaut) → no override needed
        const isEInsertion = erForm === presentStem + "et";
        if (isEInsertion) {
          candidate = null; // no override — regular stem with e-insertion
        } else {
          // Actual Ablaut: halten→hält, treten→tritt. Keep full form as stem.
          candidate = erForm;
        }
      } else {
        // Non-t stems: strip the "t" ending normally (er gibt → gib)
        candidate = erForm.slice(0, -1);
      }

      if (candidate && candidate !== presentStem)
        stems.present_du_er = candidate;
    }

    const { stem: subj2Stem } = majoritySubj2Stem(
      conjugation,
      separable,
      prefix,
      STRONG_SUBJ2_ENDINGS,
    );
    if (subj2Stem && subj2Stem !== stems.past) stems.subj2 = subj2Stem;

    let impDu = (conjugation.imperative?.du || "").replace(/!$/, "");
    impDu = stripSepPrefix(impDu, separable, prefix);
    if (impDu && impDu !== presentStem) stems.imperative_du = impDu;

    return stems;
  }

  if (cls === "mixed") {
    const pretIch = stripSepPrefix(
      conjugation.preterite?.ich || "",
      separable,
      prefix,
    );
    if (pretIch.endsWith("te")) {
      stems.past = pretIch.slice(0, -2);
    } else {
      stems.past = pretIch;
    }

    const { stem: subj2Stem } = majoritySubj2Stem(
      conjugation,
      separable,
      prefix,
      MIXED_SUBJ2_ENDINGS,
    );
    if (subj2Stem && subj2Stem !== stems.past) stems.subj2 = subj2Stem;

    return stems;
  }

  return stems;
}

export function extractVerbMeta(
  entry: WiktEntry,
  compact: WiktForm[],
): VerbMetaResult {
  const auxForms = compact
    .filter(
      (f) => f.tags?.includes("auxiliary") && f.tags?.includes("perfect"),
    )
    .map((f) => f.form);
  let auxiliary: VerbMetaResult["auxiliary"] = null;
  if (auxForms.includes("sein") && auxForms.includes("haben"))
    auxiliary = "both";
  else if (auxForms.includes("sein")) auxiliary = "sein";
  else if (auxForms.includes("haben")) auxiliary = "haben";

  const ppForm = compact.find(
    (f) => f.tags?.includes("participle-2") && f.tags?.includes("perfect"),
  );
  const past_participle = ppForm?.form || null;

  let separable = false;
  let prefix: string | null = null;
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

  const pastForm = compact.find(
    (f) =>
      f.tags?.includes("past") &&
      !f.tags?.includes("subjunctive-ii") &&
      f.pronouns?.includes("ich"),
  );
  const past_stem = pastForm?.form || null;

  const senses = entry.senses || [];
  const reflexiveCount = senses.filter((s) =>
    s.tags?.includes("reflexive"),
  ).length;
  let reflexive: VerbMetaResult["reflexive"] = "none";
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

// ============================================================
// Validation helpers
// ============================================================

/**
 * Check if two imperative forms are equivalent, allowing optional -e before "!".
 * In German, both "kaufe!" and "kauf!" are valid for weak verb du-imperatives.
 * Also handles separable forms: "kaufe ein!" ≈ "kauf ein!".
 */
function imperativeEquivalent(
  computed: string | undefined,
  extracted: string,
): boolean {
  if (computed === extracted) return true;
  if (!computed || !extracted) return false;

  // Strip trailing "!" from both
  const a = computed.replace(/!$/, "");
  const b = extracted.replace(/!$/, "");
  if (a === b) return true;

  // Check if one is the other with a trailing "e" (before any space for separable)
  // "kaufe" vs "kauf", "kaufe ein" vs "kauf ein"
  const partsA = a.split(" ");
  const partsB = b.split(" ");
  // Only the verb part (first word) can differ by trailing -e
  if (partsA.length !== partsB.length) return false;
  for (let i = 1; i < partsA.length; i++) {
    if (partsA[i] !== partsB[i]) return false;
  }
  const verbA = partsA[0];
  const verbB = partsB[0];
  return verbA + "e" === verbB || verbB + "e" === verbA;
}

/**
 * Check if two forms are equivalent, allowing -eln/-ern contraction variants.
 * Three valid forms for -eln verbs (all equivalent):
 *   "sammele" (uncontracted) ≈ "sammle" (contracted) ≈ "sammel" (bare stem)
 * Two valid forms for -ern verbs:
 *   "wandere" (uncontracted) ≈ "wandre" (contracted)
 */
function elnErnEquivalent(
  computed: string | undefined,
  extracted: string,
): boolean {
  if (computed === extracted) return true;
  if (!computed || !extracted) return false;

  // For separable verbs, compare only the verb part
  const partsC = computed.split(" ");
  const partsE = extracted.split(" ");
  if (partsC.length !== partsE.length) return false;
  for (let i = 1; i < partsC.length; i++) {
    if (partsC[i] !== partsE[i]) return false;
  }
  const vc = partsC[0];
  const ve = partsE[0];

  // Normalize both to the "uncontracted" form for comparison:
  // "sammle" → "sammele", "sammel" → "sammele", "wandre" → "wandere"
  function normalize(s: string): string {
    // contracted: "sammle" (ends in consonant + "le") → "sammele"
    // contracted: "wandre" (ends in consonant + "re") → "wandere"
    const contractedMatch = s.match(/^(.+[^e])([lr])e$/);
    if (contractedMatch) return contractedMatch[1] + "e" + contractedMatch[2] + "e";
    // bare stem: "sammel" / "dunkel" (ends in "el") → "sammele" / "dunkele"
    if (s.endsWith("el") || s.endsWith("er")) return s + "e";
    return s;
  }

  return normalize(vc) === normalize(ve);
}

export function validateConjugation(
  computed: PartialConjugationTable,
  extracted: PartialConjugationTable,
): ValidationResult {
  const tenses: MoodKey[] = [
    "present",
    "preterite",
    "subjunctive1",
    "subjunctive2",
  ];
  for (const tense of tenses) {
    for (const [person, form] of Object.entries(extracted[tense] || {}) as Array<
      [PersonKey, string]
    >) {
      if (!form) continue;
      const comp = computed[tense]?.[person];
      if (comp === form) continue;

      // Allow -eln/-ern contraction variants for ich-form (present/subjunctive1)
      if (
        person === "ich" &&
        (tense === "present" || tense === "subjunctive1")
      ) {
        if (elnErnEquivalent(comp, form)) continue;
      }

      return {
        valid: false,
        mismatch: `${tense}.${person}: "${comp}" vs "${form}"`,
      };
    }
  }

  for (const [person, form] of Object.entries(extracted.imperative || {}) as Array<
    [ImperativeKey, string]
  >) {
    if (!form) continue;
    const comp = computed.imperative?.[person];
    if (person === "du") {
      // Allow optional -e (both "kaufe!" and "kauf!" are valid)
      // Also allow -eln/-ern contraction variants ("sammle!" ≈ "sammele!", "wandre!" ≈ "wandere!")
      const compStrip = comp?.replace(/!$/, "");
      const formStrip = form.replace(/!$/, "");
      if (
        comp !== form &&
        !imperativeEquivalent(comp, form) &&
        !elnErnEquivalent(compStrip, formStrip)
      ) {
        return {
          valid: false,
          mismatch: `imperative.${person}: "${comp}" vs "${form}"`,
        };
      }
    } else if (comp !== form) {
      return {
        valid: false,
        mismatch: `imperative.${person}: "${comp}" vs "${form}"`,
      };
    }
  }

  if (
    extracted.participle1 &&
    computed.participle1 !== extracted.participle1
  ) {
    return {
      valid: false,
      mismatch: `participle1: "${computed.participle1}" vs "${extracted.participle1}"`,
    };
  }
  if (
    extracted.participle2 &&
    computed.participle2 !== extracted.participle2
  ) {
    return {
      valid: false,
      mismatch: `participle2: "${computed.participle2}" vs "${extracted.participle2}"`,
    };
  }

  return { valid: true };
}
