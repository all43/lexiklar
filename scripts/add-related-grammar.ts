/**
 * Adds `related_grammar` arrays to word JSON files.
 *
 * Run: npx tsx scripts/add-related-grammar.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const WORDS_DIR = resolve("data/words");

// grammar page id → list of posDir/file paths to annotate
const GRAMMAR_MAP: Record<string, string[]> = {
  "connectors": [
    "conjunctions/weil_konjunktion",
    "conjunctions/weil_subjunktion",
    "conjunctions/da",
    "conjunctions/denn",
    "conjunctions/deshalb",
    "adverbs/deswegen",
    "adverbs/daher",
    "adverbs/darum",
    "adverbs/also",
    "conjunctions/folglich",
    "conjunctions/obwohl",
    "conjunctions/obgleich",
    "conjunctions/trotzdem",
    "adverbs/dennoch",
    "adverbs/jedoch",
    "conjunctions/aber",
    "prepositions/wegen",
    "prepositions/aufgrund",
    "prepositions/trotz",
  ],
  "modal-verbs": [
    "verbs/dürfen",
    "verbs/können_beherrschen",
    "verbs/können_etwas",
    "verbs/mögen_etwas",
    "verbs/mögen_jemanden",
    "verbs/müssen",
    "verbs/sollen",
    "verbs/wollen",
    "verbs/brauchen",
  ],
  "cases": [
    // Accusative
    "prepositions/durch",
    "prepositions/für",
    "particles/gegen",
    "prepositions/ohne",
    "prepositions/um",
    "conjunctions/bis",
    "particles/bis",
    "postpositions/entlang",
    "adverbs/entlang",
    "prepositions/wider",
    // Dative
    "prepositions/aus",
    "prepositions/bei",
    "prepositions/mit",
    "prepositions/nach",
    "prepositions/seit",
    "prepositions/von",
    "prepositions/zu",
    "prepositions/gegenüber",
    "prepositions/außer",
    "prepositions/ab",
    // Two-way
    "prepositions/an",
    "prepositions/auf",
    "prepositions/hinter",
    "prepositions/in",
    "prepositions/neben",
    "prepositions/über",
    "prepositions/unter",
    "prepositions/vor",
    "prepositions/zwischen",
  ],
};

let added = 0;
let skipped = 0;
let missing = 0;

for (const [pageId, files] of Object.entries(GRAMMAR_MAP)) {
  for (const posFile of files) {
    const filePath = `${WORDS_DIR}/${posFile}.json`;

    if (!existsSync(filePath)) {
      console.warn(`  missing: ${posFile}`);
      missing++;
      continue;
    }

    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    const existing = (data.related_grammar as string[] | undefined) ?? [];

    if (existing.includes(pageId)) {
      skipped++;
      continue;
    }

    data.related_grammar = [...existing, pageId].sort();
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
    console.log(`  + ${posFile} → ${data.related_grammar}`);
    added++;
  }
}

console.log(`\nDone: ${added} added, ${skipped} already present, ${missing} missing`);
