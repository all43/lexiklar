#!/usr/bin/env node
/**
 * Lookup raw Wiktionary entries by word name or substring.
 *
 * Strategy: use grep to pre-filter candidate lines (fast C string search),
 * then JSON-parse only the matching lines.
 *
 * Usage:
 *   npm run lookup -- <query> [options]
 *
 * Options:
 *   --exact       Match word exactly (default: substring, case-insensitive)
 *   --pos <pos>   Filter by part of speech  (noun, verb, adjective, ...)
 *   --lang <code> Language code filter      (default: de)
 *   --all-langs   Show all languages        (overrides --lang)
 *   --limit <n>   Max results to show       (default: 10)
 *   --full        Show all fields including translations, hyponyms, derived, etc.
 *   --no-color    Disable colored output
 *
 * Examples:
 *   npm run lookup -- Schuh
 *   npm run lookup -- schuh --exact
 *   npm run lookup -- "Elter" --all-langs
 *   npm run lookup -- Bildung --pos noun
 *   npm run lookup -- Schuh --full
 */

import fs from "fs";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";

const RAW_PATH   = "data/raw/de-extract.jsonl";
const INDEX_PATH = "data/raw/de-extract.offsets.db";

// ---- ANSI colors (disabled when not a TTY or --no-color) ----
const useColor = process.stdout.isTTY && !process.argv.includes("--no-color");

const C = useColor
  ? {
      reset:   "\x1b[0m",
      bold:    "\x1b[1m",
      dim:     "\x1b[2m",
      red:     "\x1b[31m",
      green:   "\x1b[32m",
      yellow:  "\x1b[33m",
      blue:    "\x1b[34m",
      magenta: "\x1b[35m",
      cyan:    "\x1b[36m",
      white:   "\x1b[37m",
      gray:    "\x1b[90m",
    }
  : Object.fromEntries(
      ["reset","bold","dim","red","green","yellow","blue","magenta","cyan","white","gray"]
        .map((k) => [k, ""])
    );

/** Syntax-highlight a JSON string with ANSI colors. */
function colorJson(obj) {
  const raw = JSON.stringify(obj, null, 2);
  return raw.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        return /:$/.test(match)
          ? `${C.cyan}${match}${C.reset}`   // key
          : `${C.green}${match}${C.reset}`; // string value
      }
      if (/true|false/.test(match)) return `${C.yellow}${match}${C.reset}`;
      if (/null/.test(match))       return `${C.dim}${match}${C.reset}`;
      return `${C.magenta}${match}${C.reset}`; // number
    },
  );
}

// ---- Parse args ----
const args = process.argv.slice(2).filter((a) => a !== "--no-color");
if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(
    `Usage: npm run lookup -- <query> [--exact] [--pos <pos>] [--lang <code>] [--all-langs] [--limit <n>] [--full]`,
  );
  process.exit(0);
}

const query = args[0];
let exact = false;
let posFilter = null;
let langFilter = "de";
let allLangs = false;
let limit = 10;
let full = false;

for (let i = 1; i < args.length; i++) {
  switch (args[i]) {
    case "--exact":     exact = true; break;
    case "--all-langs": allLangs = true; break;
    case "--pos":       posFilter = args[++i]; break;
    case "--lang":      langFilter = args[++i]; break;
    case "--limit":     limit = parseInt(args[++i], 10); break;
    case "--full":      full = true; break;
  }
}

// Fields omitted by default — large and rarely useful for quick inspection.
// Use --full to include them.
const OMIT_BY_DEFAULT = new Set([
  "translations",  // can be 100+ entries
  "hyponyms",      // can be 80+ entries
  "hypernyms",
  "coordinate_terms",
  "holonyms",
  "meronyms",
  "troponyms",
  "antonyms",
  "synonyms",
]);

if (!fs.existsSync(RAW_PATH)) {
  console.error(`${C.red}Raw data not found at ${RAW_PATH}. Run: npm run download${C.reset}`);
  process.exit(1);
}

// ---- Candidate collection ----
const queryLower = query.toLowerCase();
const results = [];

if (exact && fs.existsSync(INDEX_PATH)) {
  // Fast path: SQLite B-tree lookup → byte offset → direct fs.read() seek.
  // Build the index once with: npm run build-lookup-index
  const db   = new Database(INDEX_PATH, { readonly: true });
  const rows = db.prepare("SELECT byte_offset FROM offsets WHERE word = ?").all(query);
  db.close();

  if (rows.length) {
    const fd  = fs.openSync(RAW_PATH, "r");
    const buf = Buffer.alloc(512 * 1024); // 512 KB — larger than any single entry

    for (const { byte_offset } of rows) {
      if (results.length >= limit) break;

      const bytesRead = fs.readSync(fd, buf, 0, buf.length, byte_offset);
      const nl        = buf.indexOf(0x0a, 0); // newline byte
      const line      = buf.slice(0, nl === -1 ? bytesRead : nl).toString("utf8");

      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      if (!allLangs && entry.lang_code !== langFilter) continue;
      if (posFilter && entry.pos !== posFilter) continue;

      results.push(entry);
    }
    fs.closeSync(fd);
  }
} else {
  // Substring search (or no index built yet) — scan with grep.
  // For exact matches with no index, warn the user.
  if (exact && !fs.existsSync(INDEX_PATH)) {
    process.stderr.write(
      `${C.dim}Tip: run "npm run build-lookup-index" for instant exact lookups.${C.reset}\n`,
    );
  }

  // Anchor to line start — every JSONL entry begins with {"word": "..."}
  // Uses BRE (no -E/-F) so { is treated as a literal character, not a quantifier.
  const grepLimit = limit * 5; // extra candidates to account for lang/pos filtering
  let candidateLines = [];
  try {
    const grepArgs = exact
      ? ["-m", String(grepLimit), `^{"word": "${query}"`, RAW_PATH]
      : ["-i", "-m", String(grepLimit), `^{"word": "[^"]*${query}`, RAW_PATH];

    const output = execFileSync("grep", grepArgs, { maxBuffer: 100 * 1024 * 1024 });
    candidateLines = output.toString().split("\n").filter(Boolean);
  } catch (err) {
    if (err.status !== 1) { // status 1 = no matches, which is fine
      console.error(`${C.red}grep error: ${err.message}${C.reset}`);
      process.exit(1);
    }
  }

  for (const line of candidateLines) {
    if (results.length >= limit) break;

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (!allLangs && entry.lang_code !== langFilter) continue;
    if (posFilter && entry.pos !== posFilter) continue;

    const word = (entry.word || "").toLowerCase();
    if (exact ? word !== queryLower : !word.includes(queryLower)) continue;

    results.push(entry);
  }
}

// ---- Output ----
if (!results.length) {
  console.log(
    `${C.yellow}No results for ${C.bold}"${query}"${C.reset}${C.yellow} (${exact ? "exact" : "substring"}, lang=${allLangs ? "all" : langFilter}).${C.reset}`,
  );
  process.exit(0);
}

const label = exact ? "exact" : "substring";
const langLabel = allLangs ? "all" : langFilter;
const posLabel = posFilter ? `, pos=${posFilter}` : "";
console.log(
  `\n${C.bold}Found ${results.length} result${results.length !== 1 ? "s" : ""} for ${C.cyan}"${query}"${C.reset}${C.bold} (${label}, lang=${langLabel}${posLabel})${C.reset}\n`,
);

for (const entry of results) {
  const parts = [
    `${C.bold}${C.white}${entry.word}${C.reset}`,
    entry.lang_code ? `${C.gray}${entry.lang_code}${C.reset}` : null,
    entry.pos       ? `${C.yellow}${entry.pos}${C.reset}` : null,
    entry.tags?.length ? `${C.dim}${entry.tags.join(", ")}${C.reset}` : null,
  ].filter(Boolean).join(`  ${C.gray}|${C.reset}  `);

  // Strip noisy bulk fields unless --full requested
  const display = full
    ? entry
    : Object.fromEntries(Object.entries(entry).filter(([k]) => !OMIT_BY_DEFAULT.has(k)));

  // Note which fields were hidden
  const hidden = full ? [] : Object.keys(entry).filter((k) => OMIT_BY_DEFAULT.has(k) && entry[k]?.length);

  const divider = `${C.gray}${"─".repeat(60)}${C.reset}`;
  console.log(divider);
  console.log(`  ${parts}`);
  if (hidden.length) {
    console.log(`  ${C.dim}(omitted: ${hidden.map(k => `${k}[${entry[k].length}]`).join(", ")} — use --full to show)${C.reset}`);
  }
  console.log(divider);
  console.log(colorJson(display));
  console.log();
}

if (results.length >= limit) {
  console.log(`${C.dim}(showing first ${limit} — use --limit to see more)${C.reset}`);
}
