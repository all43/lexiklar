/**
 * Remove word files that didn't pass B2 filtering and have no translations.
 *
 * Keeps a file if ANY of:
 *   - has gloss_en on any sense
 *   - has gloss_en_full on any sense
 *   - has zipf score (was enriched = part of B2 set)
 *   - is in config/word-whitelist.json
 *
 * Usage:
 *   node scripts/cleanup-words.ts          # dry run (default)
 *   node scripts/cleanup-words.ts --delete  # actually delete
 */
import { readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import type { Word } from "../types/word.js";

const DELETE: boolean = process.argv.includes("--delete");
const WORDS_DIR = "data/words";

// Load whitelist
const whitelist = new Set<string>();
try {
  const wl: string[] = JSON.parse(readFileSync("config/word-whitelist.json", "utf-8"));
  for (const w of wl) whitelist.add(w.toLowerCase());
} catch {
  // whitelist missing — proceed without it
}

const posDirs: string[] = readdirSync(WORDS_DIR).filter(
  (d) => !d.startsWith(".") && statSync(join(WORDS_DIR, d)).isDirectory(),
);

let kept = 0;
let toRemove = 0;
const removePaths: string[] = [];

for (const pos of posDirs) {
  const dir: string = join(WORDS_DIR, pos);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const filePath: string = join(dir, file);
    const data: Word = JSON.parse(readFileSync(filePath, "utf-8"));
    const senses = data.senses || [];

    const hasGlossEn: boolean = senses.some((s) => s.gloss_en);
    const hasGlossEnFull: boolean = senses.some((s) => s.gloss_en_full);
    const hasZipf: boolean = data.zipf != null;
    const inWhitelist: boolean = whitelist.has((data.word || "").toLowerCase());

    if (hasGlossEn || hasGlossEnFull || hasZipf || inWhitelist) {
      kept++;
    } else {
      toRemove++;
      removePaths.push(filePath);
    }
  }
}

console.log(`Keep: ${kept}`);
console.log(`Remove: ${toRemove}`);

if (DELETE) {
  for (const p of removePaths) {
    unlinkSync(p);
  }
  console.log(`Deleted ${toRemove} files.`);
} else {
  console.log("Dry run. Pass --delete to actually remove files.");
  // Show sample
  for (const p of removePaths.slice(0, 10)) {
    console.log("  would remove:", p);
  }
  if (removePaths.length > 10) console.log(`  ... and ${removePaths.length - 10} more`);
}
