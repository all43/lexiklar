/**
 * Apply gloss proofreading results from agent verification.
 *
 * Reads one or more results JSON files, applies fixes to word files, and marks
 * confirmed words as proofread.
 *
 * Usage:
 *   npx tsx scripts/apply-gloss-proofread.ts --results <file> [<file2> ...] [--dry-run] [--mark-proofread] [--info]
 *
 * --results: path(s) to results JSON files (multiple allowed)
 * --dry-run: show what would change without writing
 * --mark-proofread: mark confirmed ("ok") + fixed words as _proofread.gloss_en + gloss_en_full = true
 * --info: show summary stats without applying
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

const args = process.argv.slice(2);
const resultsIdx = args.indexOf("--results");
if (resultsIdx === -1) {
  console.error("Usage: npx tsx scripts/apply-gloss-proofread.ts --results <file> [<file2> ...] [--dry-run] [--mark-proofread] [--info]");
  process.exit(1);
}

// Collect all result file paths (everything after --results until next flag)
const resultPaths: string[] = [];
for (let i = resultsIdx + 1; i < args.length; i++) {
  if (args[i].startsWith("--")) break;
  resultPaths.push(args[i]);
}
if (resultPaths.length === 0) {
  console.error("No result files specified");
  process.exit(1);
}

const dryRun = args.includes("--dry-run");
const markProofread = args.includes("--mark-proofread");
const infoOnly = args.includes("--info");

interface Fix {
  file: string;
  sense: number;
  field: "en" | "en_full";
  old: string | null;
  new: string;
  reason?: string;
}

interface Results {
  ok: string[];
  fixes: Fix[];
}

// Merge all result files
const allOk = new Set<string>();
const allFixes: Fix[] = [];
for (const rp of resultPaths) {
  if (!existsSync(rp)) {
    console.error(`File not found: ${rp}`);
    continue;
  }
  const data = JSON.parse(readFileSync(rp, "utf-8")) as Results;
  for (const f of data.ok) allOk.add(f);
  allFixes.push(...data.fixes);
}

console.log(`Loaded ${resultPaths.length} file(s): ${allOk.size} ok, ${allFixes.length} fixes`);

if (infoOnly) {
  const enFixes = allFixes.filter(f => f.field === "en");
  const enFullFixes = allFixes.filter(f => f.field === "en_full");
  const enFullNull = enFullFixes.filter(f => f.old === null);
  const uniqueFiles = new Set(allFixes.map(f => f.file));
  console.log(`\n  en fixes: ${enFixes.length}`);
  console.log(`  en_full fixes: ${enFullFixes.length} (${enFullNull.length} were null)`);
  console.log(`  unique files with fixes: ${uniqueFiles.size}`);
  console.log(`  total files (ok + fixed): ${allOk.size + uniqueFiles.size}`);
  console.log(`\nSample en fixes:`);
  for (const f of enFixes.slice(0, 8)) {
    console.log(`  ${f.file} s${f.sense}: "${f.old}" → "${f.new}"`);
  }
  process.exit(0);
}

// Apply fixes
let fixesApplied = 0;
let fixesSkipped = 0;
const fixesByFile = new Map<string, Fix[]>();
for (const fix of allFixes) {
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

    // Safety: verify old value matches (null matches null/undefined)
    if ((fix.old === null ? (current ?? null) : current) !== fix.old) {
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
  const allMarkedFiles = new Set([...allOk, ...fixesByFile.keys()]);
  for (const file of allMarkedFiles) {
    const filePath = join(WORDS_DIR, file + ".json");
    let data: any;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      continue;
    }

    if (data._proofread?.gloss_en && data._proofread?.gloss_en_full) continue; // already marked

    if (!dryRun) {
      if (!data._proofread) data._proofread = {};
      data._proofread.gloss_en = true;
      data._proofread.gloss_en_full = true;
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
