#!/usr/bin/env npx tsx
/**
 * strip-numeric-intros.ts
 *
 * One-off patch to strip leading "N. " ordinal prefixes from:
 *
 * 1. German glosses in word files — only where the gloss starts with
 *    "N. Person " (verb conjugation forms and pronoun entries). Other
 *    ordinal uses like "4. Fall (Kasus)" or "1. Buch Mose" are left alone.
 *
 * 2. Example text fields — only where ALL owning lemmas are ordinal
 *    abbreviations (match /^\d+\.$/, e.g. "1.", "7."). This covers
 *    "7. Platz - Müller-Lüdenscheid" and "8. Die Aufgabe der Politik"
 *    but leaves "1. FC Dynamo Dresden" and "31. Dezember 2024: ..." intact.
 *
 * Run with --dry-run to preview changes without writing.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WORDS_DIR = path.join(ROOT, "data", "words");
const EXAMPLES_DIR = path.join(ROOT, "data", "examples");

const dryRun = process.argv.includes("--dry-run");

// ── Gloss patch ──────────────────────────────────────────────────────────────

const GLOSS_PREFIX = /^\d+\. (?=Person )/;

let glossPatched = 0;
let glossFiles = 0;

for (const posDir of fs.readdirSync(WORDS_DIR)) {
  const dirPath = path.join(WORDS_DIR, posDir);
  if (!fs.statSync(dirPath).isDirectory()) continue;

  for (const fn of fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"))) {
    const filePath = path.join(dirPath, fn);
    const raw = fs.readFileSync(filePath, "utf-8");
    const word = JSON.parse(raw) as { senses?: { gloss?: string }[] };

    let changed = false;
    for (const sense of word.senses ?? []) {
      if (sense.gloss && GLOSS_PREFIX.test(sense.gloss)) {
        const before = sense.gloss;
        sense.gloss = sense.gloss.replace(GLOSS_PREFIX, "");
        console.log(`  gloss: ${JSON.stringify(before)} → ${JSON.stringify(sense.gloss)}  [${posDir}/${fn}]`);
        changed = true;
        glossPatched++;
      }
    }

    if (changed) {
      glossFiles++;
      if (!dryRun) {
        fs.writeFileSync(filePath, JSON.stringify(word, null, 2) + "\n");
      }
    }
  }
}

console.log(`\nGlosses: patched ${glossPatched} glosses in ${glossFiles} files.\n`);

// ── Example patch ─────────────────────────────────────────────────────────────

const EX_PREFIX = /^\d+\. /;
const ORDINAL_LEMMA = /^\d+\.$/;

let exPatched = 0;
let exShards = 0;

for (const shard of fs.readdirSync(EXAMPLES_DIR).filter((f) => /^[0-9a-f]{2}\.json$/.test(f))) {
  const shardPath = path.join(EXAMPLES_DIR, shard);
  const data = JSON.parse(fs.readFileSync(shardPath, "utf-8")) as Record<
    string,
    { text?: string; lemmas?: string[] }
  >;

  let changed = false;
  for (const [id, ex] of Object.entries(data)) {
    if (!ex.text || !EX_PREFIX.test(ex.text)) continue;
    // Only strip if ALL owning lemmas are ordinal abbreviations
    const lemmas: string[] = ex.lemmas ?? [];
    if (lemmas.length === 0 || !lemmas.every((l) => ORDINAL_LEMMA.test(l))) continue;

    const before = ex.text;
    ex.text = ex.text.replace(EX_PREFIX, "");
    console.log(`  example ${id}: ${JSON.stringify(before)} → ${JSON.stringify(ex.text)}`);
    changed = true;
    exPatched++;
  }

  if (changed) {
    exShards++;
    if (!dryRun) {
      fs.writeFileSync(shardPath, JSON.stringify(data, null, 2) + "\n");
    }
  }
}

console.log(`\nExamples: patched ${exPatched} examples in ${exShards} shards.`);
if (dryRun) console.log("\n(dry run — no files written)");
