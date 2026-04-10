/**
 * Strip annotations whose lemma is a definite English word with no valid
 * German interpretation. These produce no link (the lemma is not in the
 * German word index) and are pure noise carried over from earlier LLM
 * passes that occasionally annotated the *translation* instead of the
 * source text.
 *
 * Conservative: only acts on lemmas that have NO valid German meaning.
 * Excludes German cognates: man, was, an, fallen, held, hand, name, …
 *
 * Preserves _proofread.annotations by recomputing the hash after the drop.
 *
 * Usage:
 *   npx tsx scripts/cleanup-english-lemma-anns.ts          # dry run
 *   npx tsx scripts/cleanup-english-lemma-anns.ts --apply  # write changes
 */

import { loadExamples, patchExamples, annotationsHash } from "./lib/examples.js";
import type { Annotation } from "../types/example.js";

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

// English lemmas with NO valid German interpretation. Each entry was
// cross-checked against the German lexicon to rule out cognates.
const STRICT_ENGLISH = new Set([
  // Aux/inflected English verb forms (German lemma would always be the
  // infinitive: haben, machen, gehen, …)
  "have", "had", "has", "having",
  "did", "does", "doing",
  "went", "gone", "going",
  "got", "gotten", "getting",
  "made", "making",
  "said", "saying",
  "took", "taken", "taking",
  "came", "coming",
  "gave", "given", "giving",
  "knew", "known", "knowing",
  "thought", "thinking",
  "saw", "seen", "seeing",
  "found", "finding",
  "told", "telling",
  "felt", "feeling",
  "brought", "bringing",
  "kept", "keeping",
  "stood", "standing",
  "wrote", "written", "writing",
  "spoke", "spoken", "speaking",
  "lost", "losing",
  "broke", "broken", "breaking",
  "drove", "driven", "driving",
  "ate", "eaten", "eating",
  "fell", "falling",            // NOT "fallen" — that IS a German verb
  "grew", "grown", "growing",
  "flew", "flown", "flying",
  "threw", "thrown", "throwing",
  "sang", "sung", "singing",
  "lain",
  "led", "leading",
  "caught", "catching",
  "taught", "teaching",
  "bought", "buying",
  "sent", "sending",
  "built", "building",
  "sold", "selling",
  "spent", "spending",

  // English pronouns / articles (no German lemma form)
  "the",
  "he", "she", "they", "you",
  "his", "her", "their", "our", "your", "its",
  "him", "them", "us",
  "myself", "yourself", "himself", "herself", "ourselves", "themselves",

  // English nouns whose German equivalents are capitalized.
  // Lowercase form here means the LLM annotated the English translation.
  // Excluded false-positive cognates: hand (DE: Hand), name (DE: Name),
  // end (DE: Ende), eye → "eye" *is* unique to English so kept; etc.
  "family", "foot", "tooth", "mouse", "goose", "child", "woman", "person",
  "life", "wife", "knife", "half", "leaf",
  "year", "time", "house", "city", "mother", "father", "brother", "sister",
  "language", "day", "night", "world", "country", "place", "thing", "way",
  "people", "children", "women", "feet", "teeth", "lives",
  "eye", "head",
  "one", "two", "three",
]);

// (lemma, pos) tuples to KEEP even though the lemma is in STRICT_ENGLISH —
// these have a legitimate German word file matching the same lowercase form
// at a different part-of-speech.
const KEEP_LEMMA_POS = new Set([
  "her|adverb",        // adverbs/her.json — German "her" (toward speaker)
  "he|interjection",   // interjections/he.json — German "he!"
  "lost|adjective",    // adjectives/lost.json — colloquial DE "lost"
]);

const examples = loadExamples();

interface Patch {
  annotations: Annotation[];
  _proofread?: { annotations?: string };
}

const patches: Record<string, Patch> = {};
let droppedTotal = 0;
let droppedFromProofread = 0;
let examplesTouched = 0;
const byLemma = new Map<string, number>();

for (const [id, ex] of Object.entries(examples)) {
  if (!ex.annotations?.length) continue;

  const cleaned: Annotation[] = [];
  let dropped = 0;
  for (const a of ex.annotations) {
    // Case-SENSITIVE: lowercase English forms only. German nouns whose
    // English homonym is in the strict set (e.g. `Person`, `House`, `Made`,
    // `Feeling`) are capitalized as proper German lemmas and must not be
    // dropped.
    if (a.lemma && STRICT_ENGLISH.has(a.lemma) && !KEEP_LEMMA_POS.has(`${a.lemma}|${a.pos}`)) {
      dropped++;
      byLemma.set(a.lemma, (byLemma.get(a.lemma) ?? 0) + 1);
      if (VERBOSE) console.log(`  ${id}: drop ${a.form}|${a.lemma}|${a.pos}`);
      continue;
    }
    cleaned.push(a);
  }

  if (dropped === 0) continue;

  examplesTouched++;
  droppedTotal += dropped;

  const patch: Patch = { annotations: cleaned };
  if (ex._proofread?.annotations) {
    droppedFromProofread += dropped;
    patch._proofread = { annotations: annotationsHash(cleaned) };
  }
  patches[id] = patch;
}

console.log(`\nDropped ${droppedTotal} annotations from ${examplesTouched} examples`);
console.log(`  ...from proofread examples: ${droppedFromProofread}\n`);

console.log("By lemma:");
const sorted = [...byLemma.entries()].sort((a, b) => b[1] - a[1]);
for (const [lemma, count] of sorted) {
  console.log(`  ${lemma.padEnd(14)} ${count}`);
}

if (!APPLY) {
  console.log(`\nDry run — pass --apply to write changes.`);
} else {
  console.log(`\nApplying patches to ${Object.keys(patches).length} examples...`);
  patchExamples(patches);
  console.log("Done.");
}
