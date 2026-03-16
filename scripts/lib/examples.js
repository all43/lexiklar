/**
 * Shared helpers for reading and writing the examples store.
 *
 * Examples are sharded into data/examples/<xx>.json where <xx> is the first
 * two hex characters of the example ID. 256 shards × ~340 examples each ≈
 * 600 KB per file — editable in any editor and git-diffable.
 *
 * Legacy fallback: if data/examples/ doesn't exist but data/examples.json
 * does, loadExamples() reads the legacy file (used by migrate-examples.js).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

export const EXAMPLES_DIR = join(ROOT, "data", "examples");
export const EXAMPLES_LEGACY = join(ROOT, "data", "examples.json");

/**
 * Load all examples from the shard directory.
 * Falls back to the legacy examples.json if the shard directory doesn't exist.
 * Returns an empty object if neither source exists.
 */
export function loadExamples() {
  if (existsSync(EXAMPLES_DIR)) {
    const examples = {};
    for (const file of readdirSync(EXAMPLES_DIR).sort()) {
      if (!file.endsWith(".json")) continue;
      const shard = JSON.parse(
        readFileSync(join(EXAMPLES_DIR, file), "utf-8"),
      );
      Object.assign(examples, shard);
    }
    return examples;
  }

  if (existsSync(EXAMPLES_LEGACY)) {
    return JSON.parse(readFileSync(EXAMPLES_LEGACY, "utf-8"));
  }

  return {};
}

/**
 * Load only the shards needed for the given example IDs.
 * Much faster than loadExamples() when you only need a subset.
 */
export function loadExamplesByIds(ids) {
  const prefixes = new Set(ids.map((id) => id.slice(0, 2)));
  const examples = {};
  for (const prefix of prefixes) {
    const file = join(EXAMPLES_DIR, prefix + ".json");
    if (existsSync(file))
      Object.assign(examples, JSON.parse(readFileSync(file, "utf-8")));
  }
  return examples;
}

/**
 * Save examples to the shard directory.
 * Groups entries by the first 2 hex chars of the key (256 shards).
 * Existing shard files not represented in `examples` are left untouched
 * so incremental saves don't wipe unrelated shards.
 */
export function saveExamples(examples) {
  mkdirSync(EXAMPLES_DIR, { recursive: true });

  // Group by shard prefix
  const shards = new Map();
  for (const [id, ex] of Object.entries(examples)) {
    const prefix = id.slice(0, 2);
    if (!shards.has(prefix)) shards.set(prefix, {});
    shards.get(prefix)[id] = ex;
  }

  // Write each shard with sorted keys
  for (const [prefix, shard] of shards) {
    const sorted = {};
    for (const key of Object.keys(shard).sort()) sorted[key] = shard[key];
    writeFileSync(
      join(EXAMPLES_DIR, prefix + ".json"),
      JSON.stringify(sorted, null, 2) + "\n",
    );
  }
}
