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
 *   node scripts/cleanup-words.js          # dry run (default)
 *   node scripts/cleanup-words.js --delete  # actually delete
 */
import { readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { join } from "path";

const DELETE = process.argv.includes("--delete");
const WORDS_DIR = "data/words";

// Load whitelist
let whitelist = new Set();
try {
  const wl = JSON.parse(readFileSync("config/word-whitelist.json", "utf-8"));
  for (const w of wl) whitelist.add(w.toLowerCase());
} catch {}

const posDirs = readdirSync(WORDS_DIR).filter(
  (d) => !d.startsWith(".") && statSync(join(WORDS_DIR, d)).isDirectory(),
);

let kept = 0,
  toRemove = 0;
const removePaths = [];

for (const pos of posDirs) {
  const dir = join(WORDS_DIR, pos);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(dir, file);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const senses = data.senses || [];

    const hasGlossEn = senses.some((s) => s.gloss_en);
    const hasGlossEnFull = senses.some((s) => s.gloss_en_full);
    const hasZipf = data.zipf != null;
    const inWhitelist = whitelist.has((data.word || "").toLowerCase());

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
