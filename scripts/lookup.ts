#!/usr/bin/env node
/**
 * Lookup raw Wiktionary entries by word name or substring.
 *
 * Core lookup logic lives in scripts/lib/wiktionary-lookup.ts.
 * This file is the CLI wrapper with arg parsing and colored output.
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
 *   --full        Show all fields (incl. translations, hyponyms, etc.)
 *   --raw         Output raw JSON array — no headers/colors, pipe-friendly
 *   --no-color    Disable colored output
 *
 * Examples:
 *   npm run lookup -- Schuh
 *   npm run lookup -- schuh --exact
 *   npm run lookup -- "Elter" --all-langs
 *   npm run lookup -- Bildung --pos noun
 *   npm run lookup -- Schuh --exact --full
 *   npm run lookup -- Schuh --exact --raw | jq '.[0].senses[].glosses[]'
 */

import { lookupWiktionary, RAW_PATH, type WiktionaryEntry } from "./lib/wiktionary-lookup.js";
import fs from "fs";

// ---- ANSI colors (disabled when not a TTY or --no-color) ----
const useColor = process.stdout.isTTY && !process.argv.includes("--no-color");

interface ColorMap {
  reset: string;
  bold: string;
  dim: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  gray: string;
}

const C: ColorMap = useColor
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
  : (Object.fromEntries(
      (["reset","bold","dim","red","green","yellow","blue","magenta","cyan","white","gray"] as const)
        .map((k) => [k, ""])
    ) as unknown as ColorMap);

/** Syntax-highlight a JSON value with ANSI colors. No-op when colors disabled. */
function colorJson(obj: unknown): string {
  const raw = JSON.stringify(obj, null, 2);
  if (!useColor) return raw;
  return raw.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        return /:$/.test(match)
          ? `${C.cyan}${match}${C.reset}`
          : `${C.green}${match}${C.reset}`;
      }
      if (/true|false/.test(match)) return `${C.yellow}${match}${C.reset}`;
      if (/null/.test(match))       return `${C.dim}${match}${C.reset}`;
      return `${C.magenta}${match}${C.reset}`;
    },
  );
}

// ---- Parse args ----
const args = process.argv.slice(2).filter((a) => a !== "--no-color");
if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(
    `Usage: npm run lookup -- <query> [--exact] [--pos <pos>] [--lang <code>] [--all-langs] [--limit <n>] [--full] [--raw] [--no-color]`,
  );
  process.exit(0);
}

const query = args[0];
let exact = false;
let posFilter: string | null = null;
let langFilter = "de";
let allLangs = false;
let limit = 10;
let full = false;
let raw  = false;

for (let i = 1; i < args.length; i++) {
  switch (args[i]) {
    case "--exact":     exact = true; break;
    case "--all-langs": allLangs = true; break;
    case "--pos":       posFilter = args[++i]; break;
    case "--lang":      langFilter = args[++i]; break;
    case "--limit":     limit = parseInt(args[++i], 10); break;
    case "--full":      full = true; break;
    case "--raw":       raw  = true; break;
  }
}

const OMIT_BY_DEFAULT = new Set([
  "translations",
  "hyponyms",
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

// ---- Lookup ----
const results = lookupWiktionary(query, {
  exact,
  pos: posFilter,
  lang: langFilter,
  allLangs,
  limit,
});

// ---- Output ----
if (!results.length) {
  if (raw) {
    process.stdout.write("[]\n");
  } else {
    console.log(
      `${C.yellow}No results for ${C.bold}"${query}"${C.reset}${C.yellow} (${exact ? "exact" : "substring"}, lang=${allLangs ? "all" : langFilter}).${C.reset}`,
    );
  }
  process.exit(0);
}

if (raw) {
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  process.exit(0);
}

// ---- Human-readable browsing mode ----
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

  const display: Record<string, unknown> = full
    ? entry
    : Object.fromEntries(Object.entries(entry).filter(([k]) => !OMIT_BY_DEFAULT.has(k)));
  const hidden = full
    ? []
    : Object.keys(entry).filter((k) => OMIT_BY_DEFAULT.has(k) && Array.isArray(entry[k]) && (entry[k] as unknown[]).length);

  const divider = `${C.gray}${"─".repeat(60)}${C.reset}`;
  console.log(divider);
  console.log(`  ${parts}`);
  if (hidden.length) {
    console.log(`  ${C.dim}(omitted: ${hidden.map(k => `${k}[${(entry[k] as unknown[]).length}]`).join(", ")} — use --full to show, --raw for JSON)${C.reset}`);
  }
  console.log(divider);
  console.log(colorJson(display));
  console.log();
}

if (results.length >= limit) {
  console.log(`${C.dim}(showing first ${limit} — use --limit to see more)${C.reset}`);
}
