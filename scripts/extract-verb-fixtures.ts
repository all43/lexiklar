/**
 * Extract verb conjugation fixtures from Wiktionary JSONL for testing.
 * Reads de-extract.jsonl, extracts full conjugation tables for a curated
 * list of verbs, and writes them to tests/fixtures/wiktionary-verbs.json.
 *
 * Usage: node scripts/extract-verb-fixtures.js
 */

import { createReadStream, writeFileSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  splitForms,
  extractVerbConjugation,
  extractVerbMeta,
  extractPresentStem,
  classifyVerb,
  extractStems,
  majoritySubj2Stem,
  STRONG_SUBJ2_ENDINGS,
  MIXED_SUBJ2_ENDINGS,
} from "./lib/verb-extract.js";
import type { ConjugationTable, VerbStems } from "../types/word.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_FILE = join(ROOT, "data", "raw", "de-extract.jsonl");
const FIXTURE_DIR = join(ROOT, "tests", "fixtures");
const FIXTURE_FILE = join(FIXTURE_DIR, "wiktionary-verbs.json");

/** Minimal shape of a Wiktionary JSONL entry — matches WiktEntry from verb-extract. */
interface WiktionaryEntry {
  word: string;
  lang_code: string;
  pos: string;
  forms?: Array<{ form: string; tags?: string[]; source?: string; pronouns?: string[] }>;
  tags?: string[];
  senses?: Array<{ tags?: string[] }>;
}

/** Shape of verb metadata returned by extractVerbMeta. */
interface VerbMeta {
  separable: boolean;
  prefix: string | null;
  principal_parts: {
    infinitive: string;
    past_stem: string | null;
    past_participle: string | null;
  };
}

/** Shape of a single fixture entry. */
interface VerbFixture {
  word: string;
  conjugation_class: string;
  separable: boolean;
  prefix: string | null;
  stems: VerbStems | null;
  past_participle: string | null;
  inconsistent_cells?: string[];
  wiktionary: ConjugationTable;
}

// Wide set of verbs covering many conjugation patterns
const TEST_VERBS = new Set([
  // Weak -- basic
  "machen", "spielen", "kaufen", "sagen", "fragen", "leben",
  "lernen", "hören", "zeigen", "brauchen", "glauben", "suchen",
  // Weak -- e-insertion (-t/-d stems)
  "arbeiten", "reden", "warten", "antworten", "öffnen", "rechnen",
  // Weak -- e-insertion (-dn/-kn clusters)
  "ordnen", "trocknen",
  // Weak -- -ern/-eln stems
  "erinnern", "ändern", "wandern", "sammeln", "handeln", "wechseln",
  // Strong -- various ablaut patterns
  "laufen", "gehen", "geben", "nehmen", "sprechen", "lesen",
  "sehen", "kommen", "schreiben", "finden", "fahren", "tragen",
  "schlafen", "fallen", "helfen", "sterben", "werfen", "essen",
  "trinken", "singen", "schwimmen", "fliegen", "ziehen", "stehen",
  "liegen", "sitzen", "bitten", "brechen", "treffen",
  // Strong -- t-stem Ablaut (t-absorption, no e-insertion for du/er)
  "halten", "treten", "raten", "braten", "gelten", "fechten",
  // Strong -- d-stem Ablaut (no e-insertion for du/er)
  "laden",
  // Strong -- separable
  "ankommen", "aufheben", "ausgeben", "einladen", "aufstehen",
  "anfangen", "aufnehmen", "mitnehmen", "vorlesen",
  // Mixed
  "denken", "bringen", "kennen", "nennen", "rennen", "wissen",
  // Irregular
  "sein", "haben", "werden", "können", "müssen", "sollen",
  "wollen", "dürfen", "mögen",
]);

async function main(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const rl = createInterface({
    input: createReadStream(RAW_FILE),
    crlfDelay: Infinity,
  });

  const found: Record<string, VerbFixture> = {};
  let count = 0;

  for await (const line of rl) {
    count++;
    if (count % 100000 === 0) process.stderr.write(`  ${count} lines scanned\n`);

    let entry: WiktionaryEntry;
    try {
      entry = JSON.parse(line) as WiktionaryEntry;
    } catch {
      continue;
    }

    if (entry.lang_code !== "de") continue;
    if (entry.pos !== "verb") continue;
    if (!TEST_VERBS.has(entry.word)) continue;
    if (found[entry.word]) continue; // take first etymology only

    // verb-extract functions accept WiktEntry — our WiktionaryEntry is a superset
    const wiktEntry = entry as Parameters<typeof splitForms>[0];
    const { compact, sourced } = splitForms(wiktEntry);
    const meta = extractVerbMeta(wiktEntry, compact) as VerbMeta;
    const { separable, prefix } = meta;
    const conjugation = extractVerbConjugation(compact, sourced, separable) as ConjugationTable;
    const presentStem = extractPresentStem(entry.word, separable, prefix);
    const cls = classifyVerb(conjugation, presentStem, separable, prefix);
    const clsStr = cls as string;
    const stems: VerbStems | null = clsStr !== "irregular"
      ? extractStems(conjugation, cls, presentStem, separable, prefix)
      : null;
    const past_participle = conjugation.participle2 || meta.principal_parts.past_participle;

    // Detect Wiktionary-internal inconsistencies (e.g., ich uses different variant than other persons)
    let inconsistent_cells: string[] = [];
    if (cls === "strong") {
      const { inconsistentCells } = majoritySubj2Stem(
        conjugation, separable, prefix, STRONG_SUBJ2_ENDINGS
      ) as { stem: string | null; inconsistentCells: string[] };
      inconsistent_cells = inconsistentCells;
    } else if (cls === "mixed") {
      const { inconsistentCells } = majoritySubj2Stem(
        conjugation, separable, prefix, MIXED_SUBJ2_ENDINGS
      ) as { stem: string | null; inconsistentCells: string[] };
      inconsistent_cells = inconsistentCells;
    }

    found[entry.word] = {
      word: entry.word,
      conjugation_class: clsStr,
      separable,
      prefix,
      stems,
      past_participle,
      inconsistent_cells: inconsistent_cells.length ? inconsistent_cells : undefined,
      wiktionary: conjugation,
    };
  }

  const foundCount = Object.keys(found).length;
  const missing = [...TEST_VERBS].filter((v) => !found[v]);

  process.stderr.write(`\nExtracted ${foundCount}/${TEST_VERBS.size} verbs.\n`);
  if (missing.length) {
    process.stderr.write(`Missing: ${missing.join(", ")}\n`);
  }

  writeFileSync(FIXTURE_FILE, JSON.stringify(found, null, 2));
  process.stderr.write(`Wrote ${FIXTURE_FILE}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
