#!/usr/bin/env npx tsx
/**
 * find-missing-functional-words.ts
 *
 * Scans all example annotations and reports lemmas that appear frequently
 * but have no corresponding word file in the dataset.
 *
 * Focus: functional / closed-class words (pronouns, prepositions, conjunctions,
 * particles, adverbs, determiners, numerals, interjections) — content words
 * (nouns, verbs, adjectives) are reported separately as a bonus.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXAMPLES_DIR = path.join(ROOT, "data", "examples");
const WORDS_DIR = path.join(ROOT, "data", "words");

// Annotation POS label → data/words/ subdirectory
const POS_TO_DIR: Record<string, string> = {
  noun: "nouns",
  verb: "verbs",
  adjective: "adjectives",
  adverb: "adverbs",
  pronoun: "pronouns",
  preposition: "prepositions",
  conjunction: "conjunctions",
  particle: "particles",
  determiner: "determiners",
  numeral: "numerals",
  interjection: "interjections",
  "proper noun": "names",
  abbreviation: "abbreviations",
  phrase: "phrases",
};

// Common English stop words / function words to filter out annotation noise
const ENGLISH_WORDS = new Set([
  "the","a","an","of","in","on","at","to","for","with","from","by","as","or","and",
  "but","not","no","so","if","that","this","it","he","she","we","you","they","his",
  "her","their","our","my","your","its","one","two","three","four","five","six",
  "seven","eight","nine","ten","also","also","there","then","still","now","always",
  "already","here","more","often","today","about","like","up","never","away","out",
  "over","into","through","before","after","without","between","under","around",
  "since","until","behind","below","near","around","above","where","when","how",
  "what","who","which","whose","whom","do","did","done","will","would","can","could",
  "may","might","shall","should","must","have","has","had","be","been","being","am",
  "is","are","was","were","go","get","take","come","see","make","say","know","think",
  "look","want","use","find","give","tell","call","show","begin","need","seem","feel",
  "leave","become","live","stay","lead","reach","try","ask","keep","allow","spend",
  "consider","believe","play","sit","through","de","la","et","al","vs","vs.","re",
  "same","other","such","many","much","some","any","each","every","all","both","few",
  "long","high","big","small","old","new","good","bad","best","last","next","only",
  "just","even","well","too","very","really","quite","rather","enough","almost",
  "probably","especially","completely","indeed","himself","themselves","herself",
  "myself","yourself","ourselves","themselves","something","everything","anything",
  "nothing","someone","everyone","anyone","no one","become","because","while",
  "although","whether","unless","instead","among","toward","against","during",
  "according","between","within","throughout","actually","however","therefore",
]);

function looksGerman(lemma: string): boolean {
  if (!lemma || lemma.length < 2) return false;
  // Has German-specific characters
  if (/[äöüßÄÖÜ]/.test(lemma)) return true;
  // English stopword
  if (ENGLISH_WORDS.has(lemma.toLowerCase())) return false;
  // Contains spaces with only lowercase ASCII → likely English phrase
  if (/^[a-z]+ [a-z]+$/.test(lemma)) return false;
  // Looks like an English word (no capitals, no German chars, short)
  if (/^[a-z]{2,}$/.test(lemma) && lemma.length <= 6) return false;
  // Numbers / digit-heavy
  if (/^\d/.test(lemma)) return false;
  // Has a German capital (German nouns start uppercase)
  if (/^[A-ZÄÖÜ]/.test(lemma)) return true;
  // Longer lowercase words starting with common German patterns
  return true;
}

// Build index of existing word files: dir → Set<stem>
// Also builds a global set of all stems across all dirs
function buildWordIndex(): {
  byDir: Map<string, Set<string>>;
  global: Set<string>;
} {
  const byDir = new Map<string, Set<string>>();
  const global = new Set<string>();

  for (const dir of Object.values(POS_TO_DIR)) {
    const dirPath = path.join(WORDS_DIR, dir);
    const stems = new Set<string>();
    if (fs.existsSync(dirPath)) {
      for (const f of fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"))) {
        const base = f.replace(/\.json$/, "");
        stems.add(base);
        stems.add(base.toLowerCase());
        // Strip disambiguation suffix
        const stripped = base.replace(/_\[?\d+\]?$/, "").replace(/_[a-zäöü].+$/, "");
        stems.add(stripped);
        stems.add(stripped.toLowerCase());
        global.add(base);
        global.add(base.toLowerCase());
        global.add(stripped);
        global.add(stripped.toLowerCase());
      }
    }
    byDir.set(dir, stems);
  }
  return { byDir, global };
}

function wordExistsInDir(stems: Set<string>, lemma: string): boolean {
  if (stems.has(lemma)) return true;
  if (stems.has(lemma.toLowerCase())) return true;
  const cap = lemma.charAt(0).toUpperCase() + lemma.slice(1);
  if (stems.has(cap)) return true;
  return false;
}

function wordExistsGlobally(global: Set<string>, lemma: string): boolean {
  return wordExistsInDir(global, lemma);
}

type FreqMap = Map<string, number>;

async function main() {
  const { byDir, global } = buildWordIndex();

  // frequency maps: dir → (lemma → count)
  // "missing" = not found anywhere in dataset (and looks German)
  // "wrong_pos" = found globally but not in annotated dir
  // "present" = found in annotated dir
  const missing: Record<string, FreqMap> = {};
  const wrongPos: Record<string, FreqMap> = {};
  const present: Record<string, FreqMap> = {};

  for (const dir of Object.values(POS_TO_DIR)) {
    missing[dir] = new Map();
    wrongPos[dir] = new Map();
    present[dir] = new Map();
  }

  const shards = fs.readdirSync(EXAMPLES_DIR).filter((f) => /^[0-9a-f]{2}\.json$/.test(f));
  let totalAnnotations = 0;

  for (const shard of shards) {
    const data = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, shard), "utf8")) as Record<
      string,
      { annotations?: { lemma: string; pos: string }[] }
    >;

    for (const ex of Object.values(data)) {
      if (!ex.annotations) continue;
      for (const ann of ex.annotations) {
        totalAnnotations++;
        const dir = POS_TO_DIR[ann.pos];
        if (!dir) continue;

        if (wordExistsInDir(byDir.get(dir)!, ann.lemma)) {
          present[dir].set(ann.lemma, (present[dir].get(ann.lemma) ?? 0) + 1);
        } else if (wordExistsGlobally(global, ann.lemma)) {
          wrongPos[dir].set(ann.lemma, (wrongPos[dir].get(ann.lemma) ?? 0) + 1);
        } else if (looksGerman(ann.lemma)) {
          missing[dir].set(ann.lemma, (missing[dir].get(ann.lemma) ?? 0) + 1);
        }
      }
    }
  }

  console.log(`Total annotations scanned: ${totalAnnotations.toLocaleString()}\n`);

  // Report missing words by POS, sorted by frequency
  const FUNCTIONAL_POS = [
    "adverbs",
    "pronouns",
    "prepositions",
    "conjunctions",
    "particles",
    "determiners",
    "numerals",
    "interjections",
  ];
  const CONTENT_POS = ["nouns", "verbs", "adjectives"];
  const OTHER_POS = ["names", "abbreviations", "phrases"];

  const allGroups = [
    { label: "FUNCTIONAL WORDS", dirs: FUNCTIONAL_POS },
    { label: "CONTENT WORDS", dirs: CONTENT_POS },
    { label: "OTHER", dirs: OTHER_POS },
  ];

  for (const { label, dirs } of allGroups) {
    let groupTotal = 0;
    const groupLines: string[] = [];

    for (const dir of dirs) {
      const freq = missing[dir];
      const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) continue;

      const totalMissing = sorted.reduce((s, [, c]) => s + c, 0);
      groupTotal += totalMissing;
      const topN = sorted.slice(0, 50);
      groupLines.push(
        `\n  [${dir}] — ${sorted.length} distinct truly-missing, ${totalMissing.toLocaleString()} annotation refs\n` +
          topN
            .map(([lemma, count]) => `    ${count.toString().padStart(5)}  ${lemma}`)
            .join("\n")
      );
    }

    if (groupLines.length === 0) continue;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`${label} — total missing annotation refs: ${groupTotal.toLocaleString()}`);
    console.log("=".repeat(60));
    console.log(groupLines.join("\n"));
  }

  // Summary table
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY TABLE");
  console.log("=".repeat(70));
  console.log(
    `${"POS dir".padEnd(20)} ${"truly missing".padStart(13)} ${"missing refs".padStart(12)} ${"wrong-POS refs".padStart(15)} ${"present refs".padStart(12)}`
  );
  console.log("-".repeat(70));
  for (const dir of [...FUNCTIONAL_POS, ...CONTENT_POS, ...OTHER_POS]) {
    const m = missing[dir];
    const w = wrongPos[dir];
    const p = present[dir];
    const mLemmas = m.size;
    const mRefs = [...m.values()].reduce((s, c) => s + c, 0);
    const wRefs = [...w.values()].reduce((s, c) => s + c, 0);
    const pRefs = [...p.values()].reduce((s, c) => s + c, 0);
    if (mRefs + wRefs + pRefs === 0) continue;
    console.log(
      `${dir.padEnd(20)} ${mLemmas.toString().padStart(13)} ${mRefs.toLocaleString().padStart(12)} ${wRefs.toLocaleString().padStart(15)} ${pRefs.toLocaleString().padStart(12)}`
    );
  }
}

main().catch(console.error);
