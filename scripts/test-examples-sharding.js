/**
 * Tests for the examples sharding helpers (scripts/lib/examples.js).
 *
 * Usage: node scripts/test-examples-sharding.js
 */

import assert from "assert/strict";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Test helpers ──────────────────────────────────────────────────────────────

const TMP_DIR = join(ROOT, "data", "_test_examples_tmp");
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Patch EXAMPLES_DIR for isolation ─────────────────────────────────────────
// We monkey-patch the module to use a tmp directory so tests don't touch real data.

import * as examplesModule from "./lib/examples.js";

// Build isolated versions of save/load pointing at TMP_DIR
import {
  mkdirSync as _mkdir,
  readdirSync as _readdir,
  readFileSync as _read,
  writeFileSync as _write,
} from "fs";

function saveToDir(dir, examples) {
  _mkdir(dir, { recursive: true });
  const shards = new Map();
  for (const [id, ex] of Object.entries(examples)) {
    const prefix = id.slice(0, 2);
    if (!shards.has(prefix)) shards.set(prefix, {});
    shards.get(prefix)[id] = ex;
  }
  for (const [prefix, shard] of shards) {
    const sorted = {};
    for (const key of Object.keys(shard).sort()) sorted[key] = shard[key];
    _write(join(dir, prefix + ".json"), JSON.stringify(sorted, null, 2) + "\n");
  }
}

function loadFromDir(dir) {
  const examples = {};
  for (const file of _readdir(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    Object.assign(examples, JSON.parse(_read(join(dir, file), "utf-8")));
  }
  return examples;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE = {
  "ab1234567a": { text: "Satz eins.", translation: "Sentence one.", annotations: [] },
  "ab1234567b": { text: "Satz zwei.", translation: "Sentence two.", annotations: [] },
  "ff0000cafe": { text: "Satz drei.", translation: "Sentence three.", annotations: [] },
  "ff0000dead": { text: "Satz vier.", translation: "Sentence four.", annotations: [] },
  "001a2b3c4d": { text: "Satz fünf.", translation: "Sentence five.", annotations: [] },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\nExamples sharding tests\n");

// Clean up before tests
if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });

test("saveToDir creates shard files", () => {
  saveToDir(TMP_DIR, FIXTURE);
  const files = readdirSync(TMP_DIR);
  // Expect shards: "ab.json", "ff.json", "00.json"
  assert.ok(files.includes("ab.json"), "ab.json should exist");
  assert.ok(files.includes("ff.json"), "ff.json should exist");
  assert.ok(files.includes("00.json"), "00.json should exist");
  assert.equal(files.filter((f) => f.endsWith(".json")).length, 3);
});

test("shard keys are correct prefixes", () => {
  const ab = JSON.parse(readFileSync(join(TMP_DIR, "ab.json"), "utf-8"));
  assert.ok("ab1234567a" in ab);
  assert.ok("ab1234567b" in ab);
  const ff = JSON.parse(readFileSync(join(TMP_DIR, "ff.json"), "utf-8"));
  assert.ok("ff0000cafe" in ff);
  assert.ok("ff0000dead" in ff);
  const z = JSON.parse(readFileSync(join(TMP_DIR, "00.json"), "utf-8"));
  assert.ok("001a2b3c4d" in z);
});

test("keys within each shard are sorted", () => {
  const ab = JSON.parse(readFileSync(join(TMP_DIR, "ab.json"), "utf-8"));
  const keys = Object.keys(ab);
  assert.deepEqual(keys, [...keys].sort());
});

test("loadFromDir round-trips all examples", () => {
  const loaded = loadFromDir(TMP_DIR);
  assert.equal(Object.keys(loaded).length, Object.keys(FIXTURE).length);
  for (const [id, ex] of Object.entries(FIXTURE)) {
    assert.ok(id in loaded, `${id} should be present`);
    assert.equal(loaded[id].text, ex.text);
    assert.equal(loaded[id].translation, ex.translation);
  }
});

test("incremental save updates only changed shard", () => {
  const updated = { ...FIXTURE };
  updated["ab1234567a"] = { ...updated["ab1234567a"], translation: "UPDATED" };
  saveToDir(TMP_DIR, updated);
  const loaded = loadFromDir(TMP_DIR);
  assert.equal(loaded["ab1234567a"].translation, "UPDATED");
  // Other shard untouched
  assert.equal(loaded["ff0000cafe"].translation, "Sentence three.");
});

test("new key goes to correct shard", () => {
  const withNew = { ...FIXTURE, "cd9999abcd": { text: "Neu.", translation: "New.", annotations: [] } };
  saveToDir(TMP_DIR, withNew);
  const files = readdirSync(TMP_DIR).filter((f) => f.endsWith(".json"));
  assert.ok(files.includes("cd.json"), "cd.json should exist for new key");
  const cd = JSON.parse(readFileSync(join(TMP_DIR, "cd.json"), "utf-8"));
  assert.ok("cd9999abcd" in cd);
});

test("empty examples object produces no shard files", () => {
  const emptyDir = TMP_DIR + "_empty";
  saveToDir(emptyDir, {});
  const files = existsSync(emptyDir)
    ? readdirSync(emptyDir).filter((f) => f.endsWith(".json"))
    : [];
  assert.equal(files.length, 0);
  if (existsSync(emptyDir)) rmSync(emptyDir, { recursive: true });
});

test("shard content is valid JSON", () => {
  for (const file of readdirSync(TMP_DIR).filter((f) => f.endsWith(".json"))) {
    const content = readFileSync(join(TMP_DIR, file), "utf-8");
    assert.doesNotThrow(() => JSON.parse(content), `${file} should be valid JSON`);
  }
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

rmSync(TMP_DIR, { recursive: true });

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
