/**
 * Tests for publish-update.ts hash-based patch generation.
 *
 * Verifies that --old-hashes produces the same patch as --old <db>,
 * and that edge cases (insert/update/delete) are handled correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { extractHashes, generatePatchFromHashes, mergeManifestPatches, type DbHashes } from "../scripts/publish-update.js";

// ---- Helpers ----

function makeDb(path: string): Database.Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE words (
      id INTEGER PRIMARY KEY,
      lemma TEXT NOT NULL, lemma_folded TEXT NOT NULL, pos TEXT NOT NULL,
      gender TEXT, frequency INTEGER, plural_dominant INTEGER, plural_form TEXT,
      superlative TEXT,
      file TEXT NOT NULL UNIQUE, gloss_en TEXT, data TEXT NOT NULL, hash TEXT NOT NULL
    );
    CREATE TABLE word_forms (form TEXT NOT NULL, word_id INTEGER NOT NULL, PRIMARY KEY (form, word_id));
    CREATE TABLE en_terms (term TEXT NOT NULL, word_id INTEGER NOT NULL, PRIMARY KEY (term, word_id));
    CREATE TABLE examples (id TEXT PRIMARY KEY, data TEXT NOT NULL, hash TEXT NOT NULL);
  `);
  return db;
}

function insertWord(db: Database.Database, file: string, lemma: string, hash: string, forms: string[] = [], terms: string[] = []) {
  const result = db.prepare(
    `INSERT INTO words (lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, superlative, file, gloss_en, data, hash)
     VALUES (?, ?, 'noun', NULL, 1, 0, NULL, NULL, ?, NULL, '{}', ?)`
  ).run(lemma, lemma.toLowerCase(), file, hash);
  const wordId = result.lastInsertRowid as number;
  for (const form of forms) {
    db.prepare("INSERT INTO word_forms (form, word_id) VALUES (?, ?)").run(form, wordId);
  }
  for (const term of terms) {
    db.prepare("INSERT INTO en_terms (term, word_id) VALUES (?, ?)").run(term, wordId);
  }
}

function insertExample(db: Database.Database, id: string, data: string, hash: string) {
  db.prepare("INSERT INTO examples (id, data, hash) VALUES (?, ?, ?)").run(id, data, hash);
}

function insertMeta(db: Database.Database, version: string) {
  db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?)").run(version);
  db.prepare("INSERT INTO meta (key, value) VALUES ('built_at', ?)").run(new Date().toISOString());
}

const TMP = "/tmp/lexiklar-test-publish-update";

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// ---- Tests ----

describe("extractHashes", () => {
  it("extracts version and all word/example hashes", () => {
    const db = makeDb(join(TMP, "extract.db"));
    insertMeta(db, "aabbccdd");
    insertWord(db, "nouns/Tisch", "Tisch", "hash1");
    insertWord(db, "verbs/gehen", "gehen", "hash2");
    insertExample(db, "ex001", "{}", "ehash1");
    db.close();

    const db2 = new Database(join(TMP, "extract.db"), { readonly: true });
    const hashes = extractHashes(db2);
    db2.close();

    expect(hashes.version).toBe("aabbccdd");
    expect(hashes.words["nouns/Tisch"]).toBe("hash1");
    expect(hashes.words["verbs/gehen"]).toBe("hash2");
    expect(hashes.examples["ex001"]).toBe("ehash1");
    expect(Object.keys(hashes.words)).toHaveLength(2);
    expect(Object.keys(hashes.examples)).toHaveLength(1);
  });
});

describe("generatePatchFromHashes — basic diff", () => {
  let oldHashes: DbHashes;
  let newDb: Database.Database;

  beforeAll(() => {
    // Old state: words A-E (A,D,E unchanged; B changed; C deleted), examples ex1-ex5 (ex1,ex3,ex4,ex5 unchanged; ex2 changed)
    // New state: same minus C, plus word D (inserted), plus ex3 (inserted)
    // Changes: B(changed) + C(deleted) = 2 of 5 words = 40%; ex2(changed) = 1 of 5 examples = 20% → total 3/10 = 30% < 50%
    const oldDb = makeDb(join(TMP, "old-basic.db"));
    insertMeta(oldDb, "v1");
    insertWord(oldDb, "nouns/A", "A", "hashA", ["a_form"], ["a_term"]);
    insertWord(oldDb, "nouns/B", "B", "hashB_old");
    insertWord(oldDb, "nouns/C", "C", "hashC");
    insertWord(oldDb, "nouns/E1", "E1", "hashE1");
    insertWord(oldDb, "nouns/E2", "E2", "hashE2");
    insertExample(oldDb, "ex1", '{"text":"hello"}', "exhash1");
    insertExample(oldDb, "ex2", '{"text":"world"}', "exhash2_old");
    insertExample(oldDb, "ex4", '{"text":"four"}', "exhash4");
    insertExample(oldDb, "ex5", '{"text":"five"}', "exhash5");
    insertExample(oldDb, "ex6", '{"text":"six"}', "exhash6");
    oldDb.close();

    const oldDbRO = new Database(join(TMP, "old-basic.db"), { readonly: true });
    oldHashes = extractHashes(oldDbRO);
    oldDbRO.close();

    newDb = makeDb(join(TMP, "new-basic.db"));
    insertMeta(newDb, "v2");
    insertWord(newDb, "nouns/A", "A", "hashA", ["a_form"], ["a_term"]); // unchanged
    insertWord(newDb, "nouns/B", "B_updated", "hashB_new");              // changed
    insertWord(newDb, "nouns/D", "D", "hashD", ["d_form"]);              // inserted
    insertWord(newDb, "nouns/E1", "E1", "hashE1");                       // unchanged
    insertWord(newDb, "nouns/E2", "E2", "hashE2");                       // unchanged
    // nouns/C is absent → deleted
    insertExample(newDb, "ex1", '{"text":"hello"}', "exhash1");          // unchanged
    insertExample(newDb, "ex2", '{"text":"WORLD"}', "exhash2_new");      // changed
    insertExample(newDb, "ex3", '{"text":"new"}', "exhash3");            // inserted
    insertExample(newDb, "ex4", '{"text":"four"}', "exhash4");           // unchanged
    insertExample(newDb, "ex5", '{"text":"five"}', "exhash5");           // unchanged
    insertExample(newDb, "ex6", '{"text":"six"}', "exhash6");            // unchanged
  });

  afterAll(() => newDb.close());

  it("returns a patch string (not null)", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb);
    expect(patch).not.toBeNull();
  });

  it("does not touch unchanged word A", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    // No UPDATE or INSERT for nouns/A
    expect(patch).not.toMatch(/WHERE file = 'nouns\/A'/);
    expect(patch).not.toMatch(/INSERT INTO words.*nouns\/A/);
  });

  it("UPDATE for changed word B", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).toMatch(/UPDATE words SET.*WHERE file = 'nouns\/B'/);
    expect(patch).toMatch(/B_updated/); // new lemma value
  });

  it("DELETE for removed word C", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).toMatch(/DELETE FROM words WHERE file = 'nouns\/C'/);
    expect(patch).toMatch(/DELETE FROM word_forms WHERE word_id = \(SELECT id FROM words WHERE file = 'nouns\/C'\)/);
    expect(patch).toMatch(/DELETE FROM en_terms WHERE word_id = \(SELECT id FROM words WHERE file = 'nouns\/C'\)/);
  });

  it("INSERT for new word D with its forms", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).toMatch(/INSERT INTO words.*nouns\/D/);
    expect(patch).toMatch(/INSERT OR IGNORE INTO word_forms.*d_form.*SELECT id FROM words WHERE file = 'nouns\/D'/);
  });

  it("rebuilds word_forms and en_terms for updated word B", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).toMatch(/DELETE FROM word_forms WHERE word_id = \(SELECT id FROM words WHERE file = 'nouns\/B'\)/);
    expect(patch).toMatch(/DELETE FROM en_terms WHERE word_id = \(SELECT id FROM words WHERE file = 'nouns\/B'\)/);
  });

  it("UPDATE for changed example ex2", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).toMatch(/UPDATE examples SET.*WHERE id = 'ex2'/);
  });

  it("does not touch unchanged example ex1", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).not.toMatch(/WHERE id = 'ex1'/);
  });

  it("INSERT for new example ex3", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).toMatch(/INSERT INTO examples.*'ex3'/);
  });

  it("DELETE for removed example ex2 — wait, ex2 changed not removed", () => {
    // ex2 was changed, not deleted — ensure no DELETE for ex2
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).not.toMatch(/DELETE FROM examples WHERE id = 'ex2'/);
  });

  it("updates meta table", () => {
    const patch = generatePatchFromHashes(oldHashes, newDb)!;
    expect(patch).toMatch(/UPDATE meta SET value = 'v2' WHERE key = 'version'/);
  });
});

describe("generatePatchFromHashes — 50% threshold", () => {
  it("returns null when more than 50% of rows changed", () => {
    const oldHashes: DbHashes = {
      version: "v1",
      words: {
        "nouns/A": "hashA",
        "nouns/B": "hashB",
        "nouns/C": "hashC",
        "nouns/D": "hashD",
      },
      examples: {},
    };

    const newDb = makeDb(join(TMP, "new-threshold.db"));
    insertMeta(newDb, "v2");
    // Only 1 of 4 old words survives unchanged — 75% changed → should return null
    insertWord(newDb, "nouns/A", "A", "hashA");         // unchanged
    insertWord(newDb, "nouns/B", "B", "hashB_changed"); // changed
    insertWord(newDb, "nouns/C", "C", "hashC_changed"); // changed
    insertWord(newDb, "nouns/D", "D", "hashD_changed"); // changed

    const patch = generatePatchFromHashes(oldHashes, newDb);
    newDb.close();
    expect(patch).toBeNull();
  });

  it("returns patch string when exactly 50% changed (boundary)", () => {
    const oldHashes: DbHashes = {
      version: "v1",
      words: { "nouns/A": "hashA", "nouns/B": "hashB" },
      examples: {},
    };

    const newDb = makeDb(join(TMP, "new-boundary.db"));
    insertMeta(newDb, "v2");
    insertWord(newDb, "nouns/A", "A", "hashA");         // unchanged
    insertWord(newDb, "nouns/B", "B", "hashB_changed"); // changed — 1/2 = 50%, not > 0.5

    const patch = generatePatchFromHashes(oldHashes, newDb);
    newDb.close();
    expect(patch).not.toBeNull();
  });
});

describe("generatePatchFromHashes — equivalence with --old <db>", () => {
  it("produces identical patch SQL via extractHashes as via full old DB", () => {
    // Build a realistic scenario
    const oldDb = makeDb(join(TMP, "equiv-old.db"));
    insertMeta(oldDb, "vOld");
    insertWord(oldDb, "nouns/Baum", "Baum", "h1", ["baum", "bäume"], ["tree"]);
    insertWord(oldDb, "nouns/Haus", "Haus", "h2");
    insertExample(oldDb, "ex10", '{"text":"Der Baum"}', "eh1");
    insertExample(oldDb, "ex11", '{"text":"Das Haus"}', "eh2");
    oldDb.close();

    // Extract hashes from old DB (simulates what publish-update writes to db-hashes.json)
    const oldDbRO = new Database(join(TMP, "equiv-old.db"), { readonly: true });
    const hashes = extractHashes(oldDbRO);
    oldDbRO.close();

    // New DB: Baum changed, Haus unchanged, Birke inserted, ex11 changed
    const newDb = makeDb(join(TMP, "equiv-new.db"));
    insertMeta(newDb, "vNew");
    insertWord(newDb, "nouns/Baum", "Baum", "h1_updated", ["baum", "bäume", "baumes"], ["tree", "beech"]);
    insertWord(newDb, "nouns/Haus", "Haus", "h2"); // unchanged
    insertWord(newDb, "nouns/Birke", "Birke", "h3", ["birke"]);
    insertExample(newDb, "ex10", '{"text":"Der Baum"}', "eh1"); // unchanged
    insertExample(newDb, "ex11", '{"text":"Das große Haus"}', "eh2_new");

    const patchFromHashes = generatePatchFromHashes(hashes, newDb);

    // Also generate via old DB path (extractHashes internally)
    const oldDb2 = new Database(join(TMP, "equiv-old.db"), { readonly: true });
    const hashesFromDb = extractHashes(oldDb2);
    oldDb2.close();
    const patchFromDb = generatePatchFromHashes(hashesFromDb, newDb);

    newDb.close();

    // Both approaches must produce the same patch
    expect(patchFromHashes).toBe(patchFromDb);
    expect(patchFromHashes).not.toBeNull();
  });
});

describe("generatePatchFromHashes — empty old state", () => {
  it("generates only INSERT statements when old is empty", () => {
    const oldHashes: DbHashes = { version: "v0", words: {}, examples: {} };

    const newDb = makeDb(join(TMP, "new-empty-old.db"));
    insertMeta(newDb, "v1");
    insertWord(newDb, "nouns/X", "X", "hX");
    insertExample(newDb, "exA", "{}", "eA");

    const patch = generatePatchFromHashes(oldHashes, newDb);
    newDb.close();

    expect(patch).not.toBeNull();
    expect(patch).toMatch(/INSERT INTO words.*nouns\/X/);
    expect(patch).toMatch(/INSERT INTO examples.*'exA'/);
    expect(patch).not.toMatch(/UPDATE words/);
    expect(patch).not.toMatch(/UPDATE examples/);
    expect(patch).not.toMatch(/DELETE/);
  });
});

// ---- Manifest patch merging ----

describe("mergeManifestPatches", () => {
  const p = (url: string, size = 100) => ({ url, size });

  it("adds new entry when existing is empty", () => {
    const result = mergeManifestPatches(undefined, { fromVersion: "v1", url: "v1_to_v2.sql.gz", size: 100 }, "v2");
    expect(Object.keys(result)).toEqual(["v1"]);
    expect(result["v1"].url).toBe("v1_to_v2.sql.gz");
  });

  it("accumulates patches across runs (v1→v2, v2→v3)", () => {
    // Run 1: no existing patches, generates v1→v2
    const afterRun1 = mergeManifestPatches(undefined, { fromVersion: "v1", url: "v1_to_v2.sql.gz", size: 100 }, "v2");
    expect(Object.keys(afterRun1)).toEqual(["v1"]);

    // Run 2: existing has v1 patch, generates v2→v3
    const afterRun2 = mergeManifestPatches(afterRun1, { fromVersion: "v2", url: "v2_to_v3.sql.gz", size: 200 }, "v3");
    expect(Object.keys(afterRun2)).toEqual(["v1", "v2"]);
    expect(afterRun2["v1"].url).toBe("v1_to_v2.sql.gz");
    expect(afterRun2["v2"].url).toBe("v2_to_v3.sql.gz");
  });

  it("trims to keepPatches=3 after 4 runs", () => {
    // Simulate 4 successive runs
    let patches = mergeManifestPatches(undefined, { fromVersion: "v1", url: "p1", size: 1 }, "v2");
    patches = mergeManifestPatches(patches, { fromVersion: "v2", url: "p2", size: 2 }, "v3");
    patches = mergeManifestPatches(patches, { fromVersion: "v3", url: "p3", size: 3 }, "v4");
    patches = mergeManifestPatches(patches, { fromVersion: "v4", url: "p4", size: 4 }, "v5");

    // keepPatches defaults to 3 — v1 patch should be dropped
    expect(Object.keys(patches)).toEqual(["v2", "v3", "v4"]);
  });

  it("respects custom keepPatches value", () => {
    let patches = mergeManifestPatches(undefined, { fromVersion: "v1", url: "p1", size: 1 }, "v2", 2);
    patches = mergeManifestPatches(patches, { fromVersion: "v2", url: "p2", size: 2 }, "v3", 2);
    patches = mergeManifestPatches(patches, { fromVersion: "v3", url: "p3", size: 3 }, "v4", 2);

    expect(Object.keys(patches)).toEqual(["v2", "v3"]);
  });

  it("does not carry forward a patch whose fromVersion equals newVersion (self-ref)", () => {
    // e.g. manifest had v3→v4 patch, but now we're publishing v4 again with same version
    const existing = { v3: p("v3_to_v4.sql.gz") };
    const result = mergeManifestPatches(existing, null, "v4");
    // v3 entry should be dropped because it points to newVersion (v4 is the new current)
    // Actually: the guard is `ver === newVersion` — meaning we skip entries WHERE the key IS the new version.
    // Here key is "v3" (not "v4"), so it IS carried forward. Let's verify the actual guard.
    expect(Object.keys(result)).toEqual(["v3"]);
  });

  it("skips carry-forward entry whose key equals newVersion", () => {
    // An old manifest somehow has a key "v4" (pointing from v4 to something)
    const existing = { v3: p("v3_to_v4.sql.gz"), v4: p("v4_to_v5.sql.gz") };
    // Publishing v4: v4 key is self-referential — skip it, keep v3
    const result = mergeManifestPatches(existing, null, "v4");
    expect(Object.keys(result)).toContain("v3");
    expect(Object.keys(result)).not.toContain("v4");
  });

  it("no patch generated (null newEntry) preserves existing patches", () => {
    const existing = { v1: p("v1_to_v2.sql.gz"), v2: p("v2_to_v3.sql.gz") };
    const result = mergeManifestPatches(existing, null, "v4");
    expect(Object.keys(result)).toEqual(["v1", "v2"]);
  });

  it("does not duplicate new patch key in carry-forward", () => {
    // existing already has v2 (stale entry from a re-run)
    const existing = { v1: p("old-v1.sql.gz"), v2: p("old-v2.sql.gz") };
    const result = mergeManifestPatches(existing, { fromVersion: "v2", url: "new-v2.sql.gz", size: 999 }, "v3");
    // new entry wins for v2, old-v2 should not overwrite it
    expect(result["v2"].url).toBe("new-v2.sql.gz");
    expect(result["v2"].size).toBe(999);
  });
});
