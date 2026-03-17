/**
 * Compute German verb conjugation from stems + endings rules.
 * Shared between build-time validation (transform.js) and runtime display/search.
 */

import type { ConjugationTable, PersonForms, ImperativeForms, VerbStems } from "../../types/word.js";
import type { VerbEndingsFile } from "../../types/word.js";

interface VerbInput {
  word: string;
  conjugation_class: string | null;
  stems?: VerbStems;
  past_participle: string | null;
  separable: boolean;
  prefix: string | null;
  conjugation?: ConjugationTable;
}

const PERSONS = ["ich", "du", "er", "wir", "ihr", "sie"] as const;

/**
 * Check if the infinitive is an -ern or -eln verb.
 * For separable verbs, checks the base infinitive (without prefix).
 */
function isErnElnVerb(word: string, separable: boolean, prefix: string | null): boolean {
  let inf = word;
  if (separable && prefix) inf = inf.slice(prefix.length);
  return inf.endsWith("ern") || inf.endsWith("eln");
}

/**
 * Check if a stem requires e-insertion before consonant-starting endings.
 * Applies to stems ending in -d, -t, -chn, -fn, -gn, -dm, -tm.
 */
function needsEInsertion(stem: string): boolean {
  const last = stem[stem.length - 1];
  if (last === "t" || last === "d") return true;
  const last2 = stem.slice(-2);
  if (["fn", "gn", "dn", "kn", "dm", "tm"].includes(last2)) return true;
  if (stem.slice(-3) === "chn") return true;
  return false;
}

/**
 * Check if stem ends with a sibilant (s, ß, z, x).
 */
function isSibilantStem(stem: string): boolean {
  return /[sßzx]$/.test(stem);
}

/**
 * Adjust an ending for the given stem, handling:
 * 1. -ern/-eln stems: "en" → "n", "est" → "st", "et" → "t"
 * 2. e-insertion for stems ending in -t/-d/etc: prepend "e" before "s"/"t" starts
 * 3. Sibilant stems + "st" ending:
 *    - Present tense (sibilantDedup=true): "st" → "t" (du liest, not du liesst)
 *    - Other tenses (sibilantDedup=false): "st" → "est" (du lasest, not du last)
 * 4. Strong verb Ablaut stems: no e-insertion, t-absorption when stem ends in "t"
 *
 * @param ending - The raw ending
 * @param stem - The stem to attach the ending to
 * @param ernEln - Whether this verb is an -ern/-eln infinitive
 * @param sibilantDedup - True for present tense (dedup), false for others (e-insertion)
 * @param isAblautStem - True for strong verb vowel-change du/er stems (skip e-insertion, use t-absorption)
 */
function adjustEnding(ending: string, stem: string, ernEln: boolean, sibilantDedup = false, isAblautStem = false): string {
  let e = ending;

  // -ern/-eln stem adjustments — only for actual -ern/-eln verbs
  if (ernEln && (stem.endsWith("er") || stem.endsWith("el"))) {
    if (e === "en") e = "n";
    else if (e === "en Sie") e = "n Sie";
    else if (e === "est") e = "st";
    else if (e === "et") e = "t";
  }

  // Strong verb Ablaut stems: no e-insertion, handle t-absorption
  if (isAblautStem) {
    // Stem-final "t" absorbs the "t" ending (er hält, er tritt — not hältt/trittt)
    if (e === "t" && stem.endsWith("t")) {
      e = "";
    }
    // Sibilant handling still applies (du liest)
    if (e === "st" && isSibilantStem(stem)) {
      e = sibilantDedup ? "t" : "est";
    }
    return e;
  }

  // e-insertion: prepend "e" before consonant-starting endings on -t/-d stems
  if (needsEInsertion(stem) && e.length > 0 && (e[0] === "s" || e[0] === "t")) {
    e = "e" + e;
  }

  // Sibilant handling: stems ending in s/ß/z/x with bare "st" ending
  if (e === "st" && isSibilantStem(stem)) {
    e = sibilantDedup ? "t" : "est";
  }

  return e;
}

/**
 * Apply -eln contraction: "sammel" + "e" → "sammle" (metathesis of final -el to -le).
 * Only affects actual -eln verb stems, not stems that happen to end in "el" (e.g., "spiel").
 */
function contractStemEnding(stem: string, adjustedEnding: string, ernEln: boolean): string {
  if (ernEln && stem.endsWith("el") && adjustedEnding === "e") {
    return stem.slice(0, -2) + "le";
  }
  return stem + adjustedEnding;
}

interface BuildTenseOpts {
  separable?: boolean;
  prefix?: string;
  stemOverrides?: Record<number, string>;
  contract?: boolean;
  ernEln?: boolean;
  sibilantDedup?: boolean;
}

/**
 * Build a 6-person tense table.
 * @param defaultStem
 * @param endingsArr - 6 endings [ich, du, er, wir, ihr, sie]
 * @param opts - { separable, prefix, stemOverrides, contract, ernEln, sibilantDedup }
 */
function buildTense(defaultStem: string, endingsArr: string[], opts: BuildTenseOpts = {}): PersonForms {
  const { separable = false, prefix = "", stemOverrides = {}, contract = false, ernEln = false, sibilantDedup = false } = opts;
  const result: Record<string, string> = {};
  PERSONS.forEach((person, i) => {
    const stem = stemOverrides[i] || defaultStem;
    const isAblaut = !!stemOverrides[i];
    const adjusted = adjustEnding(endingsArr[i], stem, ernEln, sibilantDedup, isAblaut);
    const base = contract ? contractStemEnding(stem, adjusted, ernEln) : stem + adjusted;
    result[person] = separable ? base + " " + prefix : base;
  });
  return result as unknown as PersonForms;
}

/**
 * Compute full conjugation table from verb data + endings rules.
 *
 * @param verb - Verb data with conjugation_class, stems, past_participle, etc.
 * @param endings - The verb-endings.json data
 * @returns { present, preterite, subjunctive1, subjunctive2, imperative, participle1, participle2 }
 */
export function computeConjugation(verb: VerbInput, endings: VerbEndingsFile): ConjugationTable {
  if (verb.conjugation_class === "irregular") {
    return verb.conjugation!;
  }

  const cls = verb.conjugation_class as "strong" | "weak" | "mixed";
  const stems = verb.stems!;
  const classEndings = endings[cls];
  const separable = verb.separable || false;
  const prefix = verb.prefix || "";
  const ernEln = isErnElnVerb(verb.word, separable, prefix);
  const opts = { separable, prefix, ernEln };

  // Present: present stem with optional du/er vowel change
  const presentOverrides: Record<number, string> = {};
  if (stems.present_du_er) {
    presentOverrides[1] = stems.present_du_er; // du
    presentOverrides[2] = stems.present_du_er; // er
  }
  const present = buildTense(stems.present, endings.present, {
    ...opts,
    stemOverrides: presentOverrides,
    contract: true,
    sibilantDedup: true,
  });

  // Subjunctive 1: always present stem, shared endings
  const subjunctive1 = buildTense(stems.present, endings.subjunctive1, opts);

  // Preterite: weak uses present stem; strong/mixed use past stem
  const preteriteStem = cls === "weak" ? stems.present : stems.past;
  const preterite = buildTense(preteriteStem, classEndings.preterite, opts);

  // Subjunctive 2: weak uses present stem; strong/mixed use subj2 (or fall back to past)
  const subj2Stem =
    cls === "weak" ? stems.present : stems.subj2 || stems.past;
  const subjunctive2 = buildTense(subj2Stem, classEndings.subjunctive2, opts);

  // Imperative
  const impEndings = classEndings.imperative;
  const impDuStem = stems.imperative_du || stems.present;
  const impDuAdj = adjustEnding(impEndings[0], impDuStem, ernEln);
  const impIhrAdj = adjustEnding(impEndings[1], stems.present, ernEln);
  const impSieAdj = adjustEnding(impEndings[2], stems.present, ernEln);

  const impDuBase = contractStemEnding(impDuStem, impDuAdj, ernEln);
  const imperative: ImperativeForms = {
    du: separable
      ? impDuBase + " " + prefix + "!"
      : impDuBase + "!",
    ihr: separable
      ? stems.present + impIhrAdj + " " + prefix + "!"
      : stems.present + impIhrAdj + "!",
    Sie: separable
      ? stems.present + impSieAdj + " " + prefix + "!"
      : stems.present + impSieAdj + "!",
  };

  // Participle 1: (prefix?) + stem + en/n + d
  const infSuffix = ernEln ? "n" : "en";
  const participle1 = separable
    ? prefix + stems.present + infSuffix + "d"
    : stems.present + infSuffix + "d";

  // Participle 2: stored explicitly
  const participle2 = verb.past_participle!;

  return {
    present,
    preterite,
    subjunctive1,
    subjunctive2,
    imperative,
    participle1,
    participle2,
  };
}

/**
 * Compute all unique lowercase forms for search indexing.
 *
 * @param verb - Verb data
 * @param endings - The verb-endings.json data
 * @returns Set<string>
 */
export function computeAllForms(verb: VerbInput, endings: VerbEndingsFile): Set<string> {
  const conj = computeConjugation(verb, endings);
  const forms = new Set<string>();

  // Person forms from each tense
  for (const tense of [
    "present",
    "preterite",
    "subjunctive1",
    "subjunctive2",
  ] as const) {
    for (const form of Object.values(conj[tense] as PersonForms)) {
      forms.add(form.toLowerCase());
    }
  }

  // Imperative (strip trailing "!")
  // For du-form: also add the short variant without trailing -e (kaufe → kauf)
  // so both the full and elided forms are searchable.
  for (const [person, form] of Object.entries(conj.imperative)) {
    const stripped = form.replace(/!$/, "").trim().toLowerCase();
    forms.add(stripped);
    if (person === "du" && stripped.endsWith("e") && !stripped.includes(" ")) {
      forms.add(stripped.slice(0, -1));
    }
  }

  // Participles
  if (conj.participle1) forms.add(conj.participle1.toLowerCase());
  if (conj.participle2) forms.add(conj.participle2.toLowerCase());

  // Infinitive
  forms.add(verb.word.toLowerCase());

  // Zu-infinitive: separable verbs insert "zu" between prefix and stem
  // e.g. aufstehen → aufzustehen, ankommen → anzukommen
  if (verb.separable && verb.prefix) {
    const pfx = verb.prefix;
    const stem = verb.word.slice(pfx.length); // e.g. "stehen" from "aufstehen"
    forms.add((pfx + "zu" + stem).toLowerCase());
  }

  // For separable verbs, also add rejoined forms (komme an → ankomme)
  if (verb.separable && verb.prefix) {
    const pfx = verb.prefix;
    const suffix = " " + pfx;
    for (const form of [...forms]) {
      if (form.endsWith(suffix)) {
        const base = form.slice(0, -suffix.length);
        // Only join single-word bases (skip "kommen sie" from Sie imperative)
        if (!base.includes(" ")) {
          forms.add(pfx + base);
        }
      }
    }
  }

  return forms;
}
