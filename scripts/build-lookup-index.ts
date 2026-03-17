#!/usr/bin/env node
/**
 * Build a word → byte-offset index for de-extract.jsonl.
 * Stored in SQLite for ~2ms open+query (vs ~540ms loading a 34 MB JSON file).
 * Run once after download; enables instant exact lookups in lookup.js.
 *
 * Usage: npm run build-lookup-index
 * Output: data/raw/de-extract.offsets.db
 *
 * How it works:
 *   grep -ob gives "byte_offset:matching_text" for every entry (one file scan).
 *   We stream that output to insert word→offset rows into SQLite in batches,
 *   then build a B-tree index. Subsequent lookups seek directly to the offset.
 */

import fs from "fs";
import readline from "readline";
import { spawn } from "child_process";
import Database from "better-sqlite3";

const RAW_PATH   = "data/raw/de-extract.jsonl";
const INDEX_PATH = "data/raw/de-extract.offsets.db";

if (!fs.existsSync(RAW_PATH)) {
  console.error(`Raw data not found at ${RAW_PATH}. Run: npm run download`);
  process.exit(1);
}

const fileSize: number = fs.statSync(RAW_PATH).size;
console.log(`Indexing ${(fileSize / 1e9).toFixed(2)} GB — run once after download.`);
const t0: number = Date.now();

// Prepare database (recreate from scratch)
if (fs.existsSync(INDEX_PATH)) fs.unlinkSync(INDEX_PATH);
const db = new Database(INDEX_PATH);
db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous  = OFF;
  CREATE TABLE offsets (word TEXT NOT NULL, byte_offset INTEGER NOT NULL);
`);
const insert    = db.prepare("INSERT INTO offsets VALUES (?, ?)");
const BATCH     = 10_000;
let   pending: [string, number][] = [];
let   count     = 0;

const commitBatch = db.transaction((rows: [string, number][]) => {
  for (const [w, o] of rows) insert.run(w, o);
});

function flush(): void {
  if (pending.length) { commitBatch(pending); pending = []; }
}

// grep -ob '^{"word": "[^"]*"' outputs lines like:
//   29147200:{"word": "Schuh"
// — byte offset + word for every JSONL entry in one pass.
const grep = spawn("grep", ["-ob", '^{"word": "[^"]*"', RAW_PATH]);
grep.stderr.on("data", (d: Buffer) => process.stderr.write(d));

const rl = readline.createInterface({ input: grep.stdout, crlfDelay: Infinity });

rl.on("line", (line: string) => {
  const colon: number = line.indexOf(":");
  if (colon === -1) return;

  const offset: number    = parseInt(line.slice(0, colon), 10);
  const wordStart: number = colon + 11; // skip ':{"word": "' (11 chars)
  const wordEnd: number   = line.indexOf('"', wordStart);
  if (wordEnd === -1) return;

  pending.push([line.slice(wordStart, wordEnd), offset]);
  count++;

  if (pending.length >= BATCH) flush();
  if (count % 100_000 === 0) process.stdout.write(`  ${(count / 1_000).toFixed(0)}k entries...\r`);
});

rl.on("close", () => {
  flush();

  process.stdout.write("\nBuilding index...");
  db.exec("CREATE INDEX idx_word ON offsets(word);");
  db.close();
  console.log(" done.");

  const elapsed: string = ((Date.now() - t0) / 1000).toFixed(1);
  const mb: string      = (fs.statSync(INDEX_PATH).size / 1e6).toFixed(1);
  console.log(`Indexed ${count.toLocaleString()} entries in ${elapsed}s → ${INDEX_PATH} (${mb} MB)`);
  console.log("Exact lookups will now be ~instant.");
});
