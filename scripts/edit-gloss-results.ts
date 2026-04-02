/**
 * Edit gloss proofread results files without reading them in full.
 *
 * Usage:
 *   npx tsx scripts/edit-gloss-results.ts --results <file>
 *     --remove <file-path>              # Remove fix, add to ok
 *     --adjust <file-path> --new <val>  # Change fix's "new" value
 *     --info                            # Print summary (ok count, fixes list)
 */

import { readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const resultsIdx = args.indexOf("--results");
if (resultsIdx === -1) {
  console.error("Usage: --results <file> [--remove <path>] [--adjust <path> --new <val>] [--info]");
  process.exit(1);
}
const resultsPath = args[resultsIdx + 1];

interface Fix {
  file: string;
  sense: number;
  field: string;
  old: string;
  new: string;
  reason: string;
}

interface Results {
  ok: string[];
  fixes: Fix[];
}

const data: Results = JSON.parse(readFileSync(resultsPath, "utf-8"));

const showInfo = args.includes("--info");
const removeIdx = args.indexOf("--remove");
const adjustIdx = args.indexOf("--adjust");

if (showInfo) {
  console.log(`${data.ok.length} ok, ${data.fixes.length} fixes`);
  data.fixes.forEach((f, i) =>
    console.log(`  ${i + 1}. ${f.file} #${f.sense} ${f.field}: "${f.old}" → "${f.new}"`)
  );
  process.exit(0);
}

let changed = false;

// Handle multiple --remove flags
let i = 0;
while (i < args.length) {
  if (args[i] === "--remove" && args[i + 1]) {
    const target = args[i + 1];
    const before = data.fixes.length;
    data.fixes = data.fixes.filter((f) => f.file !== target);
    const removed = before - data.fixes.length;
    if (removed > 0) {
      if (!data.ok.includes(target)) data.ok.push(target);
      console.log(`Removed ${removed} fix(es) for ${target}, added to ok`);
      changed = true;
    } else {
      console.warn(`No fixes found for ${target}`);
    }
    i += 2;
  } else if (args[i] === "--adjust" && args[i + 1]) {
    const target = args[i + 1];
    const newIdx = args.indexOf("--new", i);
    if (newIdx === -1 || !args[newIdx + 1]) {
      console.error("--adjust requires --new <value>");
      process.exit(1);
    }
    const newVal = args[newIdx + 1];
    const fixes = data.fixes.filter((f) => f.file === target);
    if (fixes.length === 0) {
      console.warn(`No fixes found for ${target}`);
    } else if (fixes.length > 1) {
      console.error(`Multiple fixes for ${target} — use file directly`);
      process.exit(1);
    } else {
      console.log(`Adjusted ${target}: "${fixes[0].new}" → "${newVal}"`);
      fixes[0].new = newVal;
      changed = true;
    }
    i = newIdx + 2;
  } else {
    i++;
  }
}

if (changed) {
  writeFileSync(resultsPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`Saved. ${data.ok.length} ok, ${data.fixes.length} fixes`);
}
