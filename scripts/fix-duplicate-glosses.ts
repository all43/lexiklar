/**
 * Find multi-sense words where two or more senses share the same gloss_en label,
 * then null out ALL senses on those words so they get re-translated with sibling context.
 *
 * Usage:
 *   node scripts/fix-duplicate-glosses.ts           # show stats + write
 *   node scripts/fix-duplicate-glosses.ts --dry-run # show stats only
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { POS_DIRS } from "./lib/pos.js";
import type { Word, Sense } from "../types/word.js";

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR: string = join(__dirname, "..", "data", "words");
const DRY_RUN: boolean = process.argv.includes("--dry-run");

let wordCount = 0;
let senseCount = 0;
const examples: string[] = [];

for (const posDir of POS_DIRS) {
  const dir: string = join(WORDS_DIR, posDir);
  if (!existsSync(dir)) continue;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const filePath: string = join(dir, file);
    const data: Word = JSON.parse(readFileSync(filePath, "utf-8"));
    const senses: Sense[] = data.senses || [];
    if (senses.length <= 1) continue;

    // Count occurrences of each gloss_en label
    const labelCount: Record<string, number> = {};
    for (const s of senses) {
      if (s.gloss_en) labelCount[s.gloss_en] = (labelCount[s.gloss_en] || 0) + 1;
    }

    const dupeLabels = new Set<string>(Object.keys(labelCount).filter((l) => labelCount[l] > 1));
    if (dupeLabels.size === 0) continue;

    // Null ALL senses of this word so the full sibling context is available during re-translation
    let changed = false;
    for (const s of senses) {
      if (s.gloss_en) {
        s.gloss_en = null;
        delete s.gloss_en_model;
        senseCount++;
        changed = true;
      }
    }

    if (changed) {
      wordCount++;
      if (examples.length < 10) {
        examples.push(`  ${data.word}: [${[...dupeLabels].join(", ")}]`);
      }
      if (!DRY_RUN) {
        writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      }
    }
  }
}

console.log(`${DRY_RUN ? "[dry-run] Would reset" : "Reset"} ${senseCount} senses across ${wordCount} words with duplicate labels.`);
console.log("Examples:");
examples.forEach((e) => console.log(e));
