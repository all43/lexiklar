#!/usr/bin/env node
/**
 * Lookup raw Wiktionary entries by word name or substring.
 *
 * Usage:
 *   npm run lookup -- <query> [options]
 *   node scripts/lookup.js <query> [options]
 *
 * Options:
 *   --exact       Match word exactly (default: substring, case-insensitive)
 *   --pos <pos>   Filter by part of speech  (noun, verb, adjective, ...)
 *   --lang <code> Language code filter      (default: de)
 *   --all-langs   Show all languages        (overrides --lang)
 *   --limit <n>   Max results to show       (default: 10)
 *
 * Examples:
 *   npm run lookup -- Schuh
 *   npm run lookup -- schuh --exact
 *   npm run lookup -- "Elter" --all-langs
 *   npm run lookup -- Bildung --pos noun
 *   npm run lookup -- "ung" --pos noun --limit 5
 */

import fs from "fs";
import readline from "readline";
import path from "path";

const RAW_PATH = "data/raw/de-extract.jsonl";

// ---- Parse args ----
const args = process.argv.slice(2);
if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(`Usage: npm run lookup -- <query> [--exact] [--pos <pos>] [--lang <code>] [--all-langs] [--limit <n>]`);
  process.exit(0);
}

const query = args[0];
let exact = false;
let posFilter = null;
let langFilter = "de";
let allLangs = false;
let limit = 10;

for (let i = 1; i < args.length; i++) {
  switch (args[i]) {
    case "--exact":      exact = true; break;
    case "--all-langs":  allLangs = true; break;
    case "--pos":        posFilter = args[++i]; break;
    case "--lang":       langFilter = args[++i]; break;
    case "--limit":      limit = parseInt(args[++i], 10); break;
  }
}

if (!fs.existsSync(RAW_PATH)) {
  console.error(`Raw data not found at ${RAW_PATH}. Run: npm run download`);
  process.exit(1);
}

// ---- Stream through JSONL ----
const rl = readline.createInterface({
  input: fs.createReadStream(RAW_PATH),
  crlfDelay: Infinity,
});

const queryLower = query.toLowerCase();
const results = [];
let scanned = 0;

rl.on("line", (line) => {
  if (!line.trim() || results.length >= limit) return;
  scanned++;

  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }

  // Language filter
  if (!allLangs && entry.lang_code !== langFilter) return;

  // POS filter
  if (posFilter && entry.pos !== posFilter) return;

  // Word match
  const word = (entry.word || "").toLowerCase();
  const matches = exact ? word === queryLower : word.includes(queryLower);
  if (!matches) return;

  results.push(entry);
});

rl.on("close", () => {
  if (!results.length) {
    console.log(`No results found for "${query}"${exact ? " (exact)" : " (substring)"}.`);
    process.exit(0);
  }

  const label = exact ? "exact" : "substring";
  console.log(`\nFound ${results.length} result${results.length !== 1 ? "s" : ""} for "${query}" (${label}, lang=${allLangs ? "all" : langFilter}${posFilter ? `, pos=${posFilter}` : ""}):\n`);

  for (const entry of results) {
    // Print a compact header then the full entry
    const header = [
      entry.word,
      entry.lang_code,
      entry.pos,
      entry.tags?.join(", "),
    ]
      .filter(Boolean)
      .join("  |  ");

    console.log("─".repeat(Math.min(header.length + 4, 80)));
    console.log(`  ${header}`);
    console.log("─".repeat(Math.min(header.length + 4, 80)));
    console.log(JSON.stringify(entry, null, 2));
    console.log();
  }

  if (results.length === limit) {
    console.log(`(showing first ${limit} — use --limit to see more)`);
  }
});
