/**
 * Compute German verb conjugation from stems + endings rules.
 * Shared between build-time validation (transform.js) and runtime display/search.
 */

const PERSONS = ["ich", "du", "er", "wir", "ihr", "sie"];

/**
 * Check if a stem requires e-insertion before consonant-starting endings.
 * Applies to stems ending in -d, -t, -chn, -fn, -gn, -dm, -tm.
 */
function needsEInsertion(stem) {
  const last = stem[stem.length - 1];
  if (last === "t" || last === "d") return true;
  const last2 = stem.slice(-2);
  if (["fn", "gn", "dm", "tm"].includes(last2)) return true;
  if (stem.slice(-3) === "chn") return true;
  return false;
}

/**
 * Adjust an ending for the given stem, handling:
 * 1. -ern/-eln stems: "en" → "n", "est" → "st", "et" → "t"
 * 2. e-insertion for stems ending in -t/-d/etc: prepend "e" before "s"/"t" starts
 */
function adjustEnding(ending, stem) {
  let e = ending;

  // -ern/-eln stem adjustments (avoids double vowels like "erinneren")
  if (stem.endsWith("er") || stem.endsWith("el")) {
    if (e === "en") e = "n";
    else if (e === "en Sie") e = "n Sie";
    else if (e === "est") e = "st";
    else if (e === "et") e = "t";
  }

  // e-insertion: prepend "e" before consonant-starting endings on -t/-d stems
  if (needsEInsertion(stem) && e.length > 0 && (e[0] === "s" || e[0] === "t")) {
    e = "e" + e;
  }

  return e;
}

/**
 * Build a 6-person tense table.
 * @param {string} defaultStem
 * @param {string[]} endingsArr - 6 endings [ich, du, er, wir, ihr, sie]
 * @param {Object} opts - { separable, prefix, stemOverrides: { personIndex: stem } }
 */
function buildTense(defaultStem, endingsArr, opts = {}) {
  const { separable = false, prefix = "", stemOverrides = {} } = opts;
  const result = {};
  PERSONS.forEach((person, i) => {
    const stem = stemOverrides[i] || defaultStem;
    const adjusted = adjustEnding(endingsArr[i], stem);
    const base = stem + adjusted;
    result[person] = separable ? base + " " + prefix : base;
  });
  return result;
}

/**
 * Compute full conjugation table from verb data + endings rules.
 *
 * @param {Object} verb - Verb data with conjugation_class, stems, past_participle, etc.
 * @param {Object} endings - The verb-endings.json data
 * @returns {Object} { present, preterite, subjunctive1, subjunctive2, imperative, participle1, participle2 }
 */
export function computeConjugation(verb, endings) {
  if (verb.conjugation_class === "irregular") {
    return verb.conjugation;
  }

  const cls = verb.conjugation_class;
  const stems = verb.stems;
  const classEndings = endings[cls];
  const separable = verb.separable || false;
  const prefix = verb.prefix || "";
  const opts = { separable, prefix };

  // Present: present stem with optional du/er vowel change
  const presentOverrides = {};
  if (stems.present_du_er) {
    presentOverrides[1] = stems.present_du_er; // du
    presentOverrides[2] = stems.present_du_er; // er
  }
  const present = buildTense(stems.present, endings.present, {
    ...opts,
    stemOverrides: presentOverrides,
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
  const impDuAdj = adjustEnding(impEndings[0], impDuStem);
  const impIhrAdj = adjustEnding(impEndings[1], stems.present);
  const impSieAdj = adjustEnding(impEndings[2], stems.present);

  const imperative = {
    du: separable
      ? impDuStem + impDuAdj + " " + prefix + "!"
      : impDuStem + impDuAdj + "!",
    ihr: separable
      ? stems.present + impIhrAdj + " " + prefix + "!"
      : stems.present + impIhrAdj + "!",
    Sie: separable
      ? stems.present + impSieAdj + " " + prefix + "!"
      : stems.present + impSieAdj + "!",
  };

  // Participle 1: (prefix?) + stem + en/n + d
  const infSuffix =
    stems.present.endsWith("er") || stems.present.endsWith("el") ? "n" : "en";
  const participle1 = separable
    ? prefix + stems.present + infSuffix + "d"
    : stems.present + infSuffix + "d";

  // Participle 2: stored explicitly
  const participle2 = verb.past_participle;

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
 * @param {Object} verb - Verb data
 * @param {Object} endings - The verb-endings.json data
 * @returns {Set<string>}
 */
export function computeAllForms(verb, endings) {
  const conj = computeConjugation(verb, endings);
  const forms = new Set();

  // Person forms from each tense
  for (const tense of [
    "present",
    "preterite",
    "subjunctive1",
    "subjunctive2",
  ]) {
    for (const form of Object.values(conj[tense])) {
      forms.add(form.toLowerCase());
    }
  }

  // Imperative (strip trailing "!")
  for (const form of Object.values(conj.imperative)) {
    forms.add(
      form
        .replace(/!$/, "")
        .trim()
        .toLowerCase(),
    );
  }

  // Participles
  if (conj.participle1) forms.add(conj.participle1.toLowerCase());
  if (conj.participle2) forms.add(conj.participle2.toLowerCase());

  // Infinitive
  forms.add(verb.word.toLowerCase());

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
