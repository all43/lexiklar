/**
 * Shared CLI argument parsing helpers.
 *
 * Consumed by: translate-glosses.ts, translate-examples.ts, generate-synonyms-en.ts,
 *              quality-check.ts, and other pipeline scripts.
 */

import { readFileSync } from "fs";

/** Get an integer CLI argument value, or return a default. */
export function intArg(args: string[], flag: string, defaultValue: number): number {
  const idx = args.indexOf(flag);
  return idx >= 0 ? parseInt(args[idx + 1], 10) || defaultValue : defaultValue;
}

/** Get an optional integer CLI argument value (null if absent). */
export function intArgOptional(args: string[], flag: string): number | null {
  const idx = args.indexOf(flag);
  return idx >= 0 ? parseInt(args[idx + 1], 10) || null : null;
}

/** Get a string CLI argument value, or return null if absent. */
export function stringArg(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

/**
 * Load a word-list filter from a file path specified by --word-list.
 * Returns null if the flag is not present.
 * Each line is trimmed; blank lines are skipped.
 */
export function wordListFilter(args: string[]): Set<string> | null {
  const path = stringArg(args, "--word-list");
  if (!path) return null;
  return new Set(
    readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
}
