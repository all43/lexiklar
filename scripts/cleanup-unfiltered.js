#!/usr/bin/env node
/**
 * Removes word files that have NO gloss_en_full on any sense.
 *
 * Usage:
 *   node scripts/cleanup-unfiltered.js          # dry run (default)
 *   node scripts/cleanup-unfiltered.js --delete  # actually delete
 */

import { readdirSync, readFileSync, unlinkSync, statSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const WORDS_DIR = join(ROOT, "data", "words");
const DRY_RUN = !process.argv.includes("--delete");

const posDirs = readdirSync(WORDS_DIR).filter(
  (d) => !d.startsWith(".") && statSync(join(WORDS_DIR, d)).isDirectory()
);

let total = 0;
let kept = 0;
let toRemove = [];
const removedByPos = {};

for (const pos of posDirs) {
  const dir = join(WORDS_DIR, pos);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    total++;
    const fullPath = join(dir, file);

    let hasFullGloss = false;
    try {
      const data = JSON.parse(readFileSync(fullPath, "utf-8"));
      hasFullGloss = (data.senses || []).some((s) => s.gloss_en_full);
    } catch {
      // corrupt → remove
    }

    if (hasFullGloss) {
      kept++;
    } else {
      toRemove.push(fullPath);
      removedByPos[pos] = (removedByPos[pos] || 0) + 1;
    }
  }
}

console.log(`Total files: ${total}`);
console.log(`Keeping (has gloss_en_full): ${kept}`);
console.log(`To remove (no gloss_en_full): ${toRemove.length}`);
console.log(`By POS:`, JSON.stringify(removedByPos));
console.log();

if (DRY_RUN) {
  console.log("DRY RUN — pass --delete to actually remove files.");
} else {
  let deleted = 0;
  for (const f of toRemove) {
    try {
      unlinkSync(f);
      deleted++;
    } catch (e) {
      console.error(`Failed: ${f}: ${e.message}`);
    }
  }
  console.log(`Deleted ${deleted} files.`);
}
