/**
 * Word file iteration helpers.
 *
 * Provides a standard way to iterate over all word JSON files in data/words/,
 * avoiding the duplicated readdirSync + filter + JSON.parse pattern.
 *
 * Consumed by: translate-glosses.ts, generate-synonyms-en.ts, build-index.ts,
 *              quality-check.ts, cleanup-words.ts
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { POS_DIRS } from "./pos.js";
import type { Word } from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
export const WORDS_DIR = join(ROOT, "data", "words");

export interface WordFileEntry {
  /** Full absolute path to the JSON file */
  filePath: string;
  /** Relative key like "nouns/Tisch" or "verbs/laufen" */
  fileKey: string;
  /** POS directory name like "nouns", "verbs", etc. */
  posDir: string;
  /** Parsed word data */
  data: Word;
}

/**
 * Iterate all word JSON files across all POS directories.
 *
 * Yields one entry per file. Skips hidden files and non-JSON files.
 * Uses POS_DIRS from pos.ts for known directories, but also discovers
 * any additional directories under data/words/.
 */
export function* iterWordFiles(): Generator<WordFileEntry> {
  // Use all subdirectories (not just POS_DIRS) to catch any extras
  const dirs = readdirSync(WORDS_DIR).filter(
    (d) => !d.startsWith(".") && existsSync(join(WORDS_DIR, d)) && statSync(join(WORDS_DIR, d)).isDirectory(),
  );

  for (const posDir of dirs) {
    const dir = join(WORDS_DIR, posDir);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(dir, file);
      const fileKey = `${posDir}/${file.replace(/\.json$/, "")}`;
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as Word;
      yield { filePath, fileKey, posDir, data };
    }
  }
}

/**
 * Collect all word file entries into an array.
 * Convenience wrapper around iterWordFiles() for scripts that need random access.
 */
export function loadAllWordFiles(): WordFileEntry[] {
  return [...iterWordFiles()];
}

/**
 * Find all word JSON file paths (absolute).
 * Lighter than loadAllWordFiles — doesn't parse JSON.
 */
export function findWordFilePaths(): string[] {
  const results: string[] = [];
  const dirs = readdirSync(WORDS_DIR).filter(
    (d) => !d.startsWith(".") && existsSync(join(WORDS_DIR, d)) && statSync(join(WORDS_DIR, d)).isDirectory(),
  );
  for (const posDir of dirs) {
    const dir = join(WORDS_DIR, posDir);
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".json")) {
        results.push(join(dir, file));
      }
    }
  }
  return results;
}
