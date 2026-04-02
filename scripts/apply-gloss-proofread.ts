/**
 * Apply gloss proofreading results from agent verification.
 *
 * Reads a results JSON file, applies fixes to word files, and marks
 * confirmed words as proofread.
 *
 * Usage:
 *   npx tsx scripts/apply-gloss-proofread.ts --results <file> [--dry-run] [--mark-proofread]
 *
 * --results: path to the results JSON file
 * --dry-run: show what would change without writing
 * --mark-proofread: mark confirmed ("ok") words as _proofread.gloss_en = true
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

const resultsIdx = process.argv.indexOf("--results");
if (resultsIdx === -1) {
  console.error("Usage: npx tsx scripts/apply-gloss-proofread.ts --results <file> [--dry-run] [--mark-proofread]");
  process.exit(1);
}
const resultsPath = process.argv[resultsIdx + 1];
const dryRun = process.argv.includes("--dry-run");
const markProofread = process.argv.includes("--mark-proofread");

interface Fix {
  file: string;
  sense: number;
  field: "en" | "en_full";
  old: string;
  new: string;
  reason: string;
}

interface Results {
  ok: string[];
  fixes: Fix[];
}

const results = JSON.parse(readFileSync(resultsPath, "utf-8")) as Results;

console.log(`Results: ${results.ok.length} confirmed, ${results.fixes.length} fixes`);

// Apply fixes
let fixesApplied = 0;
let fixesSkipped = 0;
const fixesByFile = new Map<string, Fix[]>();
for (const fix of results.fixes) {
  const list = fixesByFile.get(fix.file) ?? [];
  list.push(fix);
  fixesByFile.set(fix.file, list);
}

for (const [file, fixes] of fixesByFile) {
  const filePath = join(WORDS_DIR, file + ".json");
  let data: any;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    console.warn(`  SKIP: ${file} — file not found`);
    fixesSkipped += fixes.length;
    continue;
  }

  let changed = false;
  for (const fix of fixes) {
    const senseIdx = fix.sense - 1;
    if (!data.senses?.[senseIdx]) {
      console.warn(`  SKIP: ${file} sense #${fix.sense} — out of range`);
      fixesSkipped++;
      continue;
    }

    const sense = data.senses[senseIdx];
    const fieldKey = fix.field === "en" ? "gloss_en" : "gloss_en_full";
    const current = sense[fieldKey];

    // Safety: verify old value matches
    if (current !== fix.old) {
      console.warn(`  SKIP: ${file} #${fix.sense} ${fix.field} — expected "${fix.old}", found "${current}"`);
      fixesSkipped++;
      continue;
    }

    if (!dryRun) {
      sense[fieldKey] = fix.new;
      changed = true;
    }
    fixesApplied++;
    console.log(`  FIX: ${file} #${fix.sense} ${fix.field}: "${fix.old}" → "${fix.new}" (${fix.reason})`);
  }

  if (changed) {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  }
}

// Mark proofread
let marked = 0;
if (markProofread) {
  // Mark both confirmed words AND fixed words (fixes are now correct)
  const allFiles = new Set([...results.ok, ...fixesByFile.keys()]);
  for (const file of allFiles) {
    const filePath = join(WORDS_DIR, file + ".json");
    let data: any;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      continue;
    }

    if (data._proofread?.gloss_en) continue; // already marked

    if (!dryRun) {
      if (!data._proofread) data._proofread = {};
      data._proofread.gloss_en = true;
      writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
    }
    marked++;
  }
}

console.log(`\nSummary:`);
console.log(`  Fixes applied: ${fixesApplied}`);
console.log(`  Fixes skipped: ${fixesSkipped}`);
if (markProofread) {
  console.log(`  Marked proofread: ${marked}`);
}
if (dryRun) {
  console.log(`  (dry run — no files written)`);
}
