/**
 * Audit translation coverage across all word files.
 *
 * Reports senses with missing gloss_en or gloss_en_full.
 * Intended as a post-transform sanity check to catch accidental translation losses.
 *
 * Usage:
 *   node scripts/check-translations.js
 *   node scripts/check-translations.js --pos verbs
 *   node scripts/check-translations.js --full          # also check gloss_en_full gaps
 *   node scripts/check-translations.js --since HEAD    # only files changed vs git ref
 *   node scripts/check-translations.js --verbose       # list every null sense
 */

import { readdirSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Word } from "../types/word.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(__dirname, "..", "data", "words");

const args = process.argv.slice(2);
function arg(name: string): string | null {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] ?? null : null;
}
const FILTER_POS = arg("--pos");
const CHECK_FULL = args.includes("--full");
const VERBOSE = args.includes("--verbose");
const SINCE_REF = arg("--since");

// -- Collect files to check ---------------------------------------------------

let filesToCheck: Set<string> | null = null; // null = all files

if (SINCE_REF) {
  try {
    const out = execSync(`git diff --name-only -z ${SINCE_REF}`, { encoding: "utf-8" });
    filesToCheck = new Set(
      out.split("\0").filter(f => f.endsWith(".json") && f.startsWith("data/words/"))
    );
    console.log(`Checking ${filesToCheck.size} files changed since ${SINCE_REF}`);
  } catch {
    console.error("git diff failed \u2014 checking all files");
  }
}

// -- Scan ---------------------------------------------------------------------

// Metadata-only gloss patterns — these correctly have null gloss_en
const METADATA_GLOSS_RE = /^(mit Plural:|ohne Plural:|transitiv[,:]|intransitiv[,:]|Hilfsverb|umgangssprachlich:|nur Plural:|nur Singular:)/i;

interface PosStats {
  files: number;
  nullEn: number;
  nullFull: number;
  nullEnFiles: string[];
  nullFullFiles: string[];
}

const stats: Record<string, PosStats> = {};
let totalNullEn = 0;
let totalNullFull = 0;

for (const posDir of readdirSync(WORDS_DIR).sort()) {
  if (FILTER_POS && posDir !== FILTER_POS) continue;
  const dirPath = join(WORDS_DIR, posDir);
  let files: string[];
  try { files = readdirSync(dirPath).filter(f => f.endsWith(".json")); } catch { continue; }

  const posStats: PosStats = { files: 0, nullEn: 0, nullFull: 0, nullEnFiles: [], nullFullFiles: [] };

  for (const file of files) {
    const relPath = `data/words/${posDir}/${file}`;
    if (filesToCheck && !filesToCheck.has(relPath)) continue;

    let data: Word;
    try { data = JSON.parse(readFileSync(join(dirPath, file), "utf-8")) as Word; } catch { continue; }
    posStats.files++;

    let fileHasNullEn = false;
    let fileHasNullFull = false;

    for (let i = 0; i < (data.senses || []).length; i++) {
      const s = data.senses[i];
      const gloss = s.gloss || "";

      // null gloss_en: only flag if there IS a non-metadata gloss
      if (s.gloss_en == null && gloss && !METADATA_GLOSS_RE.test(gloss)) {
        posStats.nullEn++;
        totalNullEn++;
        fileHasNullEn = true;
        if (VERBOSE) {
          console.log(`  MISSING gloss_en: ${relPath} sense ${i}: "${gloss.slice(0, 60)}"`);
        }
      }

      // null gloss_en_full: only flag if gloss_en is set (skip untranslated senses)
      if (CHECK_FULL && s.gloss_en != null && s.gloss_en_full == null) {
        posStats.nullFull++;
        totalNullFull++;
        fileHasNullFull = true;
        if (VERBOSE) {
          console.log(`  MISSING gloss_en_full: ${relPath} sense ${i}: gloss_en="${s.gloss_en}"`);
        }
      }
    }

    if (fileHasNullEn) posStats.nullEnFiles.push(file);
    if (fileHasNullFull) posStats.nullFullFiles.push(file);
  }

  if (posStats.files > 0) stats[posDir] = posStats;
}

// -- Report -------------------------------------------------------------------

const hasMissingEn = Object.values(stats).some(s => s.nullEn > 0);
const hasMissingFull = CHECK_FULL && Object.values(stats).some(s => s.nullFull > 0);

if (!hasMissingEn && !hasMissingFull) {
  console.log("\u2713 No missing translations found.");
  process.exit(0);
}

if (hasMissingEn) {
  console.log("\n\u2500\u2500 Missing gloss_en (non-metadata senses without translation) \u2500\u2500");
  console.log(`${"POS".padEnd(16)} ${"files".padStart(6)} ${"null senses".padStart(12)}`);
  for (const [pos, s] of Object.entries(stats)) {
    if (s.nullEn === 0) continue;
    console.log(`${pos.padEnd(16)} ${String(s.nullEnFiles.length).padStart(6)} ${String(s.nullEn).padStart(12)}`);
    if (!VERBOSE) {
      for (const f of s.nullEnFiles.slice(0, 5)) console.log(`  ${f}`);
      if (s.nullEnFiles.length > 5) console.log(`  ... and ${s.nullEnFiles.length - 5} more`);
    }
  }
  console.log(`\nTotal: ${totalNullEn} null gloss_en senses across ${
    Object.values(stats).reduce((n, s) => n + s.nullEnFiles.length, 0)
  } files`);
}

if (hasMissingFull) {
  console.log("\n\u2500\u2500 Missing gloss_en_full (has gloss_en but no full translation) \u2500\u2500");
  console.log(`${"POS".padEnd(16)} ${"files".padStart(6)} ${"null senses".padStart(12)}`);
  for (const [pos, s] of Object.entries(stats)) {
    if (s.nullFull === 0) continue;
    console.log(`${pos.padEnd(16)} ${String(s.nullFullFiles.length).padStart(6)} ${String(s.nullFull).padStart(12)}`);
  }
  console.log(`\nTotal: ${totalNullFull} null gloss_en_full senses`);
}

process.exit(totalNullEn > 0 ? 1 : 0);
