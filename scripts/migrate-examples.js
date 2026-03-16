/**
 * One-time migration: data/examples.json → data/examples/<xx>.json shards.
 *
 * Usage:
 *   node scripts/migrate-examples.js
 *
 * After running, verify the shard count and spot-check a few files,
 * then delete data/examples.json manually (or add it to .gitignore).
 */

import { existsSync, statSync, readdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples, saveExamples, EXAMPLES_DIR, EXAMPLES_LEGACY } from "./lib/examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DELETE_LEGACY = process.argv.includes("--delete-legacy");

if (!existsSync(EXAMPLES_LEGACY)) {
  console.log("No data/examples.json found — nothing to migrate.");
  process.exit(0);
}

const sizeMB = (statSync(EXAMPLES_LEGACY).size / 1024 / 1024).toFixed(1);
console.log(`Loading data/examples.json (${sizeMB} MB)...`);

// Force loading from legacy file even if shards already exist
const examples = JSON.parse(
  (await import("fs")).readFileSync(EXAMPLES_LEGACY, "utf-8"),
);
const total = Object.keys(examples).length;
console.log(`Loaded ${total.toLocaleString()} examples.`);

console.log(`Writing shards to data/examples/...`);
saveExamples(examples);

const shards = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json"));
console.log(`Done. ${shards.length} shard files written.`);

// Verify round-trip
console.log("Verifying round-trip...");
const reloaded = loadExamples();
const reloadedTotal = Object.keys(reloaded).length;
if (reloadedTotal !== total) {
  console.error(`ERROR: expected ${total} examples, got ${reloadedTotal} after reload.`);
  process.exit(1);
}
console.log(`Round-trip OK — ${reloadedTotal.toLocaleString()} examples.`);

if (DELETE_LEGACY) {
  unlinkSync(EXAMPLES_LEGACY);
  console.log("Deleted data/examples.json.");
} else {
  console.log(
    "\ndata/examples.json still exists. Run with --delete-legacy to remove it,\nor add it to .gitignore.",
  );
}
