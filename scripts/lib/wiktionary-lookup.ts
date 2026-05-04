/**
 * Core Wiktionary JSONL lookup — reusable by CLI (lookup.ts) and admin API.
 *
 * Strategy: SQLite byte-offset index for exact lookups (fast),
 * grep for substring/fallback (slower but always works).
 */
import { existsSync, openSync, readSync, closeSync } from "fs";
import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

export const RAW_PATH = join(ROOT, "data", "raw", "de-extract.jsonl");
export const INDEX_PATH = join(ROOT, "data", "raw", "de-extract.offsets.db");

export interface WiktionaryEntry {
  word: string;
  lang_code?: string;
  pos?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface LookupOptions {
  exact?: boolean;
  pos?: string | null;
  lang?: string;
  allLangs?: boolean;
  limit?: number;
}

/**
 * Try the SQLite byte-offset index for fast exact lookups.
 * Returns results or empty array if index unavailable.
 */
function lookupViaIndex(
  query: string,
  langFilter: string,
  allLangs: boolean,
  posFilter: string | null,
  limit: number,
): WiktionaryEntry[] {
  if (!existsSync(INDEX_PATH)) return [];

  try {
    // Dynamic require — better-sqlite3 is a native module, may not be in all contexts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const db = new Database(INDEX_PATH, { readonly: true });
    const rows = db
      .prepare("SELECT byte_offset FROM offsets WHERE word = ?")
      .all(query) as { byte_offset: number }[];
    db.close();

    const results: WiktionaryEntry[] = [];
    if (!rows.length) return results;

    const fd = openSync(RAW_PATH, "r");
    const buf = Buffer.alloc(512 * 1024);

    for (const { byte_offset } of rows) {
      if (results.length >= limit) break;
      const bytesRead = readSync(fd, buf, 0, buf.length, byte_offset);
      const nl = buf.indexOf(0x0a, 0);
      const line = buf
        .subarray(0, nl === -1 ? bytesRead : nl)
        .toString("utf8");
      try {
        const entry = JSON.parse(line) as WiktionaryEntry;
        if (!allLangs && entry.lang_code !== langFilter) continue;
        if (posFilter && entry.pos !== posFilter) continue;
        results.push(entry);
      } catch {
        /* skip malformed */
      }
    }
    closeSync(fd);
    return results;
  } catch {
    return [];
  }
}

/**
 * Grep-based lookup — works for both exact and substring searches.
 */
function lookupViaGrep(
  query: string,
  exact: boolean,
  langFilter: string,
  allLangs: boolean,
  posFilter: string | null,
  limit: number,
): WiktionaryEntry[] {
  const grepLimit = limit * 5;
  const queryLower = query.toLowerCase();
  let candidateLines: string[] = [];

  try {
    const grepArgs = exact
      ? ["-m", String(grepLimit), `^{"word": "${query}"`, RAW_PATH]
      : [
          "-i",
          "-m",
          String(grepLimit),
          `^{"word": "[^"]*${query}`,
          RAW_PATH,
        ];

    const output = execFileSync("grep", grepArgs, {
      maxBuffer: 100 * 1024 * 1024,
    });
    candidateLines = output.toString().split("\n").filter(Boolean);
  } catch (err) {
    const e = err as { status?: number };
    if (e.status !== 1) return [];
  }

  const results: WiktionaryEntry[] = [];
  for (const line of candidateLines) {
    if (results.length >= limit) break;
    try {
      const entry = JSON.parse(line) as WiktionaryEntry;
      if (!allLangs && entry.lang_code !== langFilter) continue;
      if (posFilter && entry.pos !== posFilter) continue;
      const w = (entry.word || "").toLowerCase();
      if (exact ? w !== queryLower : !w.includes(queryLower)) continue;
      results.push(entry);
    } catch {
      /* skip */
    }
  }

  return results;
}

/**
 * Look up raw Wiktionary entries by word.
 * Uses SQLite index for exact matches (when available), grep otherwise.
 */
export function lookupWiktionary(
  query: string,
  opts: LookupOptions = {},
): WiktionaryEntry[] {
  const exact = opts.exact ?? false;
  const posFilter = opts.pos ?? null;
  const langFilter = opts.lang ?? "de";
  const allLangs = opts.allLangs ?? false;
  const limit = opts.limit ?? 10;

  if (!existsSync(RAW_PATH)) return [];

  if (exact) {
    const indexed = lookupViaIndex(query, langFilter, allLangs, posFilter, limit);
    if (indexed.length) return indexed;
  }

  return lookupViaGrep(query, exact, langFilter, allLangs, posFilter, limit);
}
