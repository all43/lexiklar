/**
 * Verb conjugation extraction from Wiktionary data.
 * Shared between transform.js (build-time) and test fixtures.
 */

// ============================================================
// Form parsing helpers
// ============================================================

export function splitForms(entry) {
  const forms = entry.forms || [];
  return {
    compact: forms.filter((f) => !f.source),
    sourced: forms.filter((f) => f.source),
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

// ============================================================
// Majority-vote stem extraction
// ============================================================

// Strong subjunctive 2 endings by person
export const STRONG_SUBJ2_ENDINGS = { ich: "e", du: "est", er: "e", wir: "en", ihr: "et", sie: "en" };
// Mixed subjunctive 2 endings by person (weak-style)
export const MIXED_SUBJ2_ENDINGS = { ich: "te", du: "test", er: "te", wir: "ten", ihr: "tet", sie: "ten" };

/**
 * Derive the subjunctive 2 stem from all 6 persons, picking the majority.
 * Handles Wiktionary inconsistencies where ich uses a different variant
 * than the other 5 persons (e.g., helfen: hülfe vs hälfe).
 *
 * @returns {{ stem: string|null, inconsistentCells: string[] }}
 */
export function majoritySubj2Stem(conjugation, separable, prefix, endingsMap) {
  const candidates = {};
  for (const [person, ending] of Object.entries(endingsMap)) {
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
  const inconsistentCells = [];
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

export function extractVerbConjugation(compact, sourced) {
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

// ============================================================
// Classification and stem extraction
// ============================================================

export function stripSepPrefix(form, separable, prefix) {
  if (!separable || !prefix) return form;
  const suffix = " " + prefix;
  if (form.endsWith(suffix)) return form.slice(0, -suffix.length);
  return form;
}

export function extractPresentStem(word, separable, prefix) {
  let inf = word;
  if (separable && prefix) inf = inf.slice(prefix.length);
  if (inf.endsWith("ern") || inf.endsWith("eln")) return inf.slice(0, -1);
  if (inf.endsWith("en")) return inf.slice(0, -2);
  if (inf.endsWith("n")) return inf.slice(0, -1);
  return inf;
}

export function classifyVerb(conjugation, presentStem, separable, prefix) {
  const pretIch = conjugation.preterite?.ich;
  if (!pretIch) return "irregular";

  const form = stripSepPrefix(pretIch, separable, prefix);

  if (form === presentStem + "te" || form === presentStem + "ete") {
    return "weak";
  }
  if (form.endsWith("te")) {
    return "mixed";
  }
  return "strong";
}

export function extractStems(conjugation, cls, presentStem, separable, prefix) {
  const stems = { present: presentStem };

  if (cls === "weak") {
    return stems;
  }

  if (cls === "strong") {
    const pretIch = stripSepPrefix(conjugation.preterite?.ich || "", separable, prefix);
    stems.past = pretIch;

    const erForm = stripSepPrefix(conjugation.present?.er || "", separable, prefix);
    if (erForm.endsWith("t")) {
      const candidate = erForm.slice(0, -1);
      if (candidate !== presentStem) stems.present_du_er = candidate;
    }

    const { stem: subj2Stem } = majoritySubj2Stem(conjugation, separable, prefix, STRONG_SUBJ2_ENDINGS);
    if (subj2Stem && subj2Stem !== stems.past) stems.subj2 = subj2Stem;

    let impDu = (conjugation.imperative?.du || "").replace(/!$/, "");
    impDu = stripSepPrefix(impDu, separable, prefix);
    if (impDu && impDu !== presentStem) stems.imperative_du = impDu;

    return stems;
  }

  if (cls === "mixed") {
    const pretIch = stripSepPrefix(conjugation.preterite?.ich || "", separable, prefix);
    if (pretIch.endsWith("te")) {
      stems.past = pretIch.slice(0, -2);
    } else {
      stems.past = pretIch;
    }

    const { stem: subj2Stem } = majoritySubj2Stem(conjugation, separable, prefix, MIXED_SUBJ2_ENDINGS);
    if (subj2Stem && subj2Stem !== stems.past) stems.subj2 = subj2Stem;

    return stems;
  }

  return stems;
}

export function extractVerbMeta(entry, compact) {
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

export function validateConjugation(computed, extracted) {
  const tenses = ["present", "preterite", "subjunctive1", "subjunctive2"];
  for (const tense of tenses) {
    for (const [person, form] of Object.entries(extracted[tense] || {})) {
      if (form && computed[tense]?.[person] !== form) {
        return {
          valid: false,
          mismatch: `${tense}.${person}: "${computed[tense]?.[person]}" vs "${form}"`,
        };
      }
    }
  }

  for (const [person, form] of Object.entries(extracted.imperative || {})) {
    if (form && computed.imperative?.[person] !== form) {
      return {
        valid: false,
        mismatch: `imperative.${person}: "${computed.imperative?.[person]}" vs "${form}"`,
      };
    }
  }

  if (extracted.participle1 && computed.participle1 !== extracted.participle1) {
    return {
      valid: false,
      mismatch: `participle1: "${computed.participle1}" vs "${extracted.participle1}"`,
    };
  }
  if (extracted.participle2 && computed.participle2 !== extracted.participle2) {
    return {
      valid: false,
      mismatch: `participle2: "${computed.participle2}" vs "${extracted.participle2}"`,
    };
  }

  return { valid: true };
}
