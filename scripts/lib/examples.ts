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
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Example, ExampleMap, ExampleShard } from "../../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

export const EXAMPLES_DIR = join(ROOT, "data", "examples");
export const EXAMPLES_LEGACY = join(ROOT, "data", "examples.json");

/**
 * Load all examples from the shard directory.
 * Falls back to the legacy examples.json if the shard directory doesn't exist.
 * Returns an empty object if neither source exists.
 */
export function loadExamples(): ExampleMap {
  if (existsSync(EXAMPLES_DIR)) {
    const examples: ExampleMap = {};
    for (const file of readdirSync(EXAMPLES_DIR).sort()) {
      if (!file.endsWith(".json")) continue;
      const shard: ExampleShard = JSON.parse(
        readFileSync(join(EXAMPLES_DIR, file), "utf-8"),
      );
      Object.assign(examples, shard);
    }
    return examples;
  }

  if (existsSync(EXAMPLES_LEGACY)) {
    return JSON.parse(readFileSync(EXAMPLES_LEGACY, "utf-8")) as ExampleMap;
  }

  return {};
}

/**
 * Load only the shards needed for the given example IDs.
 * Much faster than loadExamples() when you only need a subset.
 */
export function loadExamplesByIds(ids: string[]): ExampleMap {
  const prefixes = new Set(ids.map((id) => id.slice(0, 2)));
  const examples: ExampleMap = {};
  for (const prefix of prefixes) {
    const file = join(EXAMPLES_DIR, prefix + ".json");
    if (existsSync(file))
      Object.assign(examples, JSON.parse(readFileSync(file, "utf-8")) as ExampleShard);
  }
  return examples;
}

/**
 * Short fingerprint of an example's annotations array.
 * Used by _proofread.annotations to detect when annotations have changed.
 */
export function annotationsHash(annotations: unknown[] | undefined): string {
  return createHash("sha256")
    .update(JSON.stringify(annotations || []))
    .digest("hex")
    .slice(0, 8);
}

export interface ExamplePatch {
  _proofread?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Apply targeted patches to shard files without loading all examples.
 * patches: { [id]: partialFields } — only the provided fields are merged.
 * Special case: patches[id]._proofread is deep-merged with the existing _proofread.
 */
export function patchExamples(patches: Record<string, ExamplePatch>): void {
  const ids = Object.keys(patches);
  if (!ids.length) return;

  const prefixes = new Set(ids.map((id) => id.slice(0, 2)));
  for (const prefix of prefixes) {
    const file = join(EXAMPLES_DIR, prefix + ".json");
    if (!existsSync(file)) continue;

    const shard: ExampleShard = JSON.parse(readFileSync(file, "utf-8"));
    let changed = false;

    for (const id of ids) {
      if (id.slice(0, 2) !== prefix || !shard[id]) continue;
      const { _proofread, ...rest } = patches[id];
      Object.assign(shard[id], rest);
      if (_proofread) {
        const existing = shard[id]._proofread || {};
        shard[id]._proofread = { ...existing, ..._proofread } as Example["_proofread"];
        // Remove aspects explicitly set to undefined/null
        const pr = shard[id]._proofread!;
        for (const [k, v] of Object.entries(pr)) {
          if (v == null) delete (pr as Record<string, unknown>)[k];
        }
        if (Object.keys(pr).length === 0) {
          delete shard[id]._proofread;
        }
      }
      changed = true;
    }

    if (!changed) continue;
    const sorted: ExampleShard = {};
    for (const key of Object.keys(shard).sort()) sorted[key] = shard[key];
    writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
  }
}

/**
 * Save examples to the shard directory.
 * Groups entries by the first 2 hex chars of the key (256 shards).
 * Existing shard files not represented in `examples` are left untouched
 * so incremental saves don't wipe unrelated shards.
 */
export function saveExamples(examples: ExampleMap): void {
  mkdirSync(EXAMPLES_DIR, { recursive: true });

  // Group by shard prefix
  const shards = new Map<string, ExampleShard>();
  for (const [id, ex] of Object.entries(examples)) {
    const prefix = id.slice(0, 2);
    if (!shards.has(prefix)) shards.set(prefix, {});
    shards.get(prefix)![id] = ex;
  }

  // Write each shard with sorted keys
  for (const [prefix, shard] of shards) {
    const sorted: ExampleShard = {};
    for (const key of Object.keys(shard).sort()) sorted[key] = shard[key];
    writeFileSync(
      join(EXAMPLES_DIR, prefix + ".json"),
      JSON.stringify(sorted, null, 2) + "\n",
    );
  }
}
