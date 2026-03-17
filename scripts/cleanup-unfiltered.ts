#!/usr/bin/env node
/**
 * Removes word files that have NO gloss_en_full on any sense.
 *
 * Usage:
 *   node scripts/cleanup-unfiltered.ts          # dry run (default)
 *   node scripts/cleanup-unfiltered.ts --delete  # actually delete
 */

import { readdirSync, readFileSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import type { Word } from "../types/word.js";

const ROOT: string = new URL("..", import.meta.url).pathname;
const WORDS_DIR: string = join(ROOT, "data", "words");
const DRY_RUN: boolean = !process.argv.includes("--delete");

const posDirs: string[] = readdirSync(WORDS_DIR).filter(
  (d) => !d.startsWith(".") && statSync(join(WORDS_DIR, d)).isDirectory()
);

let total = 0;
let kept = 0;
const toRemove: string[] = [];
const removedByPos: Record<string, number> = {};

for (const pos of posDirs) {
  const dir: string = join(WORDS_DIR, pos);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    total++;
    const fullPath: string = join(dir, file);

    let hasFullGloss = false;
    try {
      const data: Word = JSON.parse(readFileSync(fullPath, "utf-8"));
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Failed: ${f}: ${msg}`);
    }
  }
  console.log(`Deleted ${deleted} files.`);
}
