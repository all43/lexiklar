/**
 * Compute German verb conjugation from stems + endings rules.
 * Shared between build-time validation (transform.js) and runtime display/search.
 */

const PERSONS = ["ich", "du", "er", "wir", "ihr", "sie"];

/**
 * Check if the infinitive is an -ern or -eln verb.
 * For separable verbs, checks the base infinitive (without prefix).
 */
function isErnElnVerb(word, separable, prefix) {
  let inf = word;
  if (separable && prefix) inf = inf.slice(prefix.length);
  return inf.endsWith("ern") || inf.endsWith("eln");
}

/**
 * Check if a stem requires e-insertion before consonant-starting endings.
 * Applies to stems ending in -d, -t, -chn, -fn, -gn, -dm, -tm.
 */
function needsEInsertion(stem) {
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
function isSibilantStem(stem) {
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
 * @param {string} ending - The raw ending
 * @param {string} stem - The stem to attach the ending to
 * @param {boolean} ernEln - Whether this verb is an -ern/-eln infinitive
 * @param {boolean} sibilantDedup - True for present tense (dedup), false for others (e-insertion)
 * @param {boolean} isAblautStem - True for strong verb vowel-change du/er stems (skip e-insertion, use t-absorption)
 */
function adjustEnding(ending, stem, ernEln, sibilantDedup = false, isAblautStem = false) {
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
function contractStemEnding(stem, adjustedEnding, ernEln) {
  if (ernEln && stem.endsWith("el") && adjustedEnding === "e") {
    return stem.slice(0, -2) + "le";
  }
  return stem + adjustedEnding;
}

/**
 * Build a 6-person tense table.
 * @param {string} defaultStem
 * @param {string[]} endingsArr - 6 endings [ich, du, er, wir, ihr, sie]
 * @param {Object} opts - { separable, prefix, stemOverrides, contract, ernEln, sibilantDedup }
 */
function buildTense(defaultStem, endingsArr, opts = {}) {
  const { separable = false, prefix = "", stemOverrides = {}, contract = false, ernEln = false, sibilantDedup = false } = opts;
  const result = {};
  PERSONS.forEach((person, i) => {
    const stem = stemOverrides[i] || defaultStem;
    const isAblaut = !!stemOverrides[i];
    const adjusted = adjustEnding(endingsArr[i], stem, ernEln, sibilantDedup, isAblaut);
    const base = contract ? contractStemEnding(stem, adjusted, ernEln) : stem + adjusted;
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
  const ernEln = isErnElnVerb(verb.word, separable, prefix);
  const opts = { separable, prefix, ernEln };

  // Present: present stem with optional du/er vowel change
  const presentOverrides = {};
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
  const imperative = {
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
