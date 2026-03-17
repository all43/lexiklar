/**
 * Diagnostic script for verb form contamination and inconsistencies.
 *
 * Checks all verb JSON files for:
 *
 * 1. sep_prefix_broken  — separable verb whose prefix is missing or not a prefix of the word
 * 2. pp2_missing_prefix — separable verb whose past_participle doesn't start with the prefix
 * 3. irregular_form_no_prefix — irregular separable verb with conjugation cells that are
 *    missing the expected " {prefix}" suffix (possible contamination from base verb's forms)
 * 4. irregular_pp_mismatch — irregular verb whose conjugation.participle2 doesn't match
 *    top-level past_participle
 * 5. stem_family_mismatch — separable verb whose stems differ from the base verb's stems
 *    (e.g. ablassen should have same stems as lassen)
 * 6. conjugation_missing_cell — any irregular verb with an incomplete conjugation table
 *    (present/preterite cells are sparse)
 *
 * Usage:
 *   node scripts/check-verb-forms.js
 *   node scripts/check-verb-forms.js --check irregular_form_no_prefix
 *   node scripts/check-verb-forms.js --word kommen          # show all kommen-family verbs
 *   node scripts/check-verb-forms.js --verbose              # full details per issue
 */

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { VerbWord, VerbStems, ConjugationTable, PersonForms } from "../types/word.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERBS_DIR = join(__dirname, "..", "data", "words", "verbs");

const args = process.argv.slice(2);
function arg(name: string): string | null {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] ?? null : null;
}
const FILTER_CHECK = arg("--check");
const FILTER_WORD = arg("--word");
const VERBOSE = args.includes("--verbose");

// ── Load all verb files ───────────────────────────────────────────────────────

interface VerbEntry extends VerbWord {
  _file: string;
}

const verbs: VerbEntry[] = [];
const verbsByWord = new Map<string, VerbEntry[]>(); // word → [verb, ...]

for (const file of readdirSync(VERBS_DIR).sort()) {
  if (!file.endsWith(".json")) continue;
  try {
    const data = JSON.parse(readFileSync(join(VERBS_DIR, file), "utf-8")) as VerbWord;
    const entry: VerbEntry = { ...data, _file: file.replace(".json", "") };
    verbs.push(entry);
    if (!verbsByWord.has(data.word)) verbsByWord.set(data.word, []);
    verbsByWord.get(data.word)!.push(entry);
  } catch {
    // skip unreadable
  }
}

// ── Issue collection ──────────────────────────────────────────────────────────

type CheckType =
  | "sep_prefix_broken"
  | "pp2_missing_prefix"
  | "irregular_mixed_forms"
  | "sep_flag_likely_wrong"
  | "irregular_form_no_prefix"
  | "irregular_pp_mismatch"
  | "stem_family_mismatch"
  | "conjugation_missing_cell";

interface Issue {
  check: CheckType;
  word: string;
  file: string;
  detail: string;
  base?: string;
  baseFile?: string;
  mismatches?: string[];
  tense?: string;
  form?: string;
  prefix?: string;
  missing?: string[];
}

const issues: Issue[] = [];

function report(check: CheckType, verb: VerbEntry, detail: string, extra: Partial<Issue> = {}): void {
  issues.push({ check, word: verb.word, file: verb._file, detail, ...extra });
}

const TENSES: readonly (keyof Pick<ConjugationTable, "present" | "preterite" | "subjunctive1" | "subjunctive2">)[] = [
  "present", "preterite", "subjunctive1", "subjunctive2",
];

// ── Check 1: sep_prefix_broken ────────────────────────────────────────────────

for (const verb of verbs) {
  if (!verb.separable) continue;
  if (!verb.prefix) {
    report("sep_prefix_broken", verb, "separable=true but prefix is null");
    continue;
  }
  if (!verb.word.startsWith(verb.prefix)) {
    report("sep_prefix_broken", verb,
      `prefix="${verb.prefix}" not found at start of word="${verb.word}"`);
  }
}

// ── Check 2: pp2_missing_prefix ───────────────────────────────────────────────

for (const verb of verbs) {
  if (!verb.separable || !verb.prefix) continue;
  const pp2 = verb.past_participle;
  if (!pp2) continue;
  // Past participle of separable verbs should start with the prefix
  // e.g. ankommen → angekommen (prefix "an" + ge + kommen-pp)
  // or   abfahren → abgefahren
  // It should at minimum CONTAIN the prefix at the start
  if (!pp2.startsWith(verb.prefix)) {
    report("pp2_missing_prefix", verb,
      `past_participle="${pp2}" doesn't start with prefix="${verb.prefix}"`);
  }
}

// ── Check 3 & 4: irregular verb checks ───────────────────────────────────────
// For separable irregular verbs, we classify each verb into one of:
//   - "consistent_separated": all person forms end with " {prefix}" → correct
//   - "consistent_joined":    no person forms end with " {prefix}" → separable flag wrong
//   - "mixed":                some separated, some joined → contamination from sibling verb

for (const verb of verbs) {
  if (verb.conjugation_class !== "irregular") continue;
  const conj = verb.conjugation;
  if (!conj) continue;

  // Check 4: participle2 in conjugation vs top-level past_participle.
  // Skip modal verbs: they legitimately have two pp forms — the regular
  // participle (gedurft) and the Ersatzinfinitiv (dürfen) used when a
  // dependent infinitive is present. Same applies to werden (worden/geworden).
  const MODAL_ERSATZINFINITIV = new Set([
    "dürfen", "können", "mögen", "müssen", "sollen", "wollen", "werden",
  ]);
  if (verb.past_participle && conj.participle2 &&
      conj.participle2 !== verb.past_participle &&
      !MODAL_ERSATZINFINITIV.has(verb.word)) {
    report("irregular_pp_mismatch", verb,
      `conjugation.participle2="${conj.participle2}" vs past_participle="${verb.past_participle}"`);
  }

  if (!verb.separable || !verb.prefix) continue;
  const prefix = verb.prefix;
  const suffix = " " + prefix;

  // Collect separated vs joined person form counts across present/preterite/subj1/subj2
  const separated: string[] = [];
  const joined: Array<{ cell: string; form: string }> = [];
  for (const tense of TENSES) {
    const tenseObj: PersonForms | undefined = conj[tense];
    if (!tenseObj) continue;
    for (const [person, form] of Object.entries(tenseObj)) {
      if (!form) continue;
      if (form.endsWith(suffix)) {
        separated.push(`${tense}.${person}`);
      } else {
        joined.push({ cell: `${tense}.${person}`, form });
      }
    }
  }

  if (separated.length === 0 && joined.length > 0) {
    // All person forms are joined — likely wrong separable flag
    report("sep_flag_likely_wrong", verb,
      `separable=true but all ${joined.length} person forms are joined (no " ${prefix}" suffix). ` +
      `Example: ${joined[0].form}`);
  } else if (separated.length > 0 && joined.length > 0) {
    // MIXED — some separated, some joined: contamination from inseparable sibling
    const joinedCells = joined.map(j => `${j.cell}="${j.form}"`).join(", ");
    report("irregular_mixed_forms", verb,
      `${separated.length} separated, ${joined.length} joined person forms — ` +
      `contamination from inseparable sibling. Joined: ${joinedCells}`);
  }
  // else all separated → correct, no issue

  // Participle 1: skip if it starts with a reflexive pronoun (sich auskennen → "sich auskennend")
  if (conj.participle1) {
    const p1 = conj.participle1;
    const p1WithoutReflexive = p1.replace(/^sich /, "");
    if (!p1WithoutReflexive.startsWith(prefix)) {
      report("irregular_form_no_prefix", verb,
        `participle1="${p1}" missing prefix "${prefix}"`,
        { tense: "participle1", form: p1, prefix });
    }
  }
}

// ── Check 5: stem_family_mismatch ─────────────────────────────────────────────
// For each separable verb, try to find the base verb (word minus prefix).
// Compare CORE stems only (past, subj2, present_du_er — not the optional
// imperative_du which legitimately differs across verb family members).
// Mismatches on core stems indicate Wiktionary data error or contamination.

const CORE_STEM_KEYS: readonly (keyof VerbStems)[] = ["past", "subj2", "present_du_er"];

for (const verb of verbs) {
  if (!verb.separable || !verb.prefix) continue;
  if (verb.conjugation_class === "irregular") continue;
  if (!verb.stems) continue;

  const base = verb.word.slice(verb.prefix.length);
  const baseVerbs = verbsByWord.get(base);
  if (!baseVerbs) continue;

  for (const baseVerb of baseVerbs) {
    if (baseVerb.conjugation_class === "irregular") continue;
    if (!baseVerb.stems) continue;

    const mismatches: string[] = [];
    for (const key of CORE_STEM_KEYS) {
      const a = verb.stems[key];
      const b = baseVerb.stems[key];
      // Only flag when both have the key and they differ
      if (a !== undefined && b !== undefined && a !== b) {
        mismatches.push(`stems.${key}: derived="${a}" vs base="${b}"`);
      }
    }
    if (mismatches.length > 0) {
      report("stem_family_mismatch", verb,
        `vs base "${base}" (${baseVerb._file}): ${mismatches.join("; ")}`,
        { base: baseVerb.word, baseFile: baseVerb._file, mismatches });
    }
  }
}

// ── Check 6: conjugation_missing_cell ────────────────────────────────────────

const EXPECTED_PERSONS: readonly (keyof PersonForms)[] = ["ich", "du", "er", "wir", "ihr", "sie"];

for (const verb of verbs) {
  if (verb.conjugation_class !== "irregular") continue;
  const conj = verb.conjugation;
  if (!conj) {
    report("conjugation_missing_cell", verb, "no conjugation object at all");
    continue;
  }

  for (const tense of ["present", "preterite"] as const) {
    const tenseObj: PersonForms | undefined = conj[tense];
    const missing = EXPECTED_PERSONS.filter(p => !tenseObj?.[p]);
    if (missing.length > 0) {
      report("conjugation_missing_cell", verb,
        `${tense} missing persons: [${missing.join(", ")}]`,
        { tense, missing: missing as string[] });
    }
  }
}

// ── Output ────────────────────────────────────────────────────────────────────

// Apply filters
let filtered = issues;
if (FILTER_CHECK) {
  filtered = filtered.filter(i => i.check === FILTER_CHECK);
}
if (FILTER_WORD) {
  // Show all issues for verbs in the same family as --word
  filtered = filtered.filter(i =>
    i.word === FILTER_WORD ||
    i.word.endsWith(FILTER_WORD) ||
    (i.base !== undefined && i.base === FILTER_WORD),
  );
}

// Group by check type
const byCheck: Record<string, Issue[]> = {};
for (const issue of filtered) {
  if (!byCheck[issue.check]) byCheck[issue.check] = [];
  byCheck[issue.check].push(issue);
}

const CHECK_DESCRIPTIONS: Record<CheckType, string> = {
  sep_prefix_broken:      "Separable verbs with broken/missing prefix field",
  pp2_missing_prefix:     "Past participles not starting with the separable prefix",
  irregular_mixed_forms:  "Irregular separable verbs with MIXED separated/joined forms (contamination from inseparable sibling)",
  sep_flag_likely_wrong:  "Irregular verbs marked separable=true but all forms are joined (wrong flag?)",
  irregular_form_no_prefix: "Irregular separable verbs with participle1 missing prefix",
  irregular_pp_mismatch:  "Irregular verbs where conjugation.participle2 ≠ past_participle",
  stem_family_mismatch:   "Separable verbs with stems differing from the base verb",
  conjugation_missing_cell: "Irregular verbs with incomplete conjugation tables",
};

if (Object.keys(byCheck).length === 0) {
  console.log("No issues found" + (FILTER_CHECK ? ` for check "${FILTER_CHECK}"` : "") + ".");
  process.exit(0);
}

let totalIssues = 0;
for (const [check, list] of Object.entries(byCheck)) {
  console.log(`\n── ${CHECK_DESCRIPTIONS[check as CheckType] || check} (${list.length}) ──`);
  for (const issue of list) {
    if (VERBOSE) {
      console.log(`  ${issue.file}`);
      console.log(`    ${issue.detail}`);
    } else {
      console.log(`  ${issue.file.padEnd(40)} ${issue.detail}`);
    }
  }
  totalIssues += list.length;
}

console.log(`\nTotal: ${totalIssues} issue(s) across ${Object.keys(byCheck).length} check(s).`);
console.log(`Scanned ${verbs.length} verb files.`);
