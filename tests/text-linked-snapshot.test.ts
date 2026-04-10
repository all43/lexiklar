/**
 * Snapshot regression test against the full proofread corpus.
 *
 * Runs the live resolver against every fixture in `text-linked-snapshot.json`
 * and asserts byte-for-byte equality with the expected `text_linked`. Each
 * fixture in the snapshot is *known* to currently match (the snapshot is
 * filtered to matching-only at generation time), so any divergence here is
 * a regression in either the resolver or the underlying annotations/lookup.
 *
 * The snapshot file is gitignored and regenerated on demand:
 *   npx tsx scripts/extract-text-linked-fixtures.ts --matching-only
 *
 * If the file is absent the test is skipped — local-only safety net, not
 * a CI gate.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  annotateExampleText,
  type WordLookupEntry,
} from "../scripts/lib/text-linked.js";
import type { Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "fixtures", "text-linked-snapshot.json");

interface FixtureSense {
  gloss: string;
  gloss_en: string | null;
  synonyms_en?: string[];
}

interface FixtureLookupEntry {
  posDir: string;
  file: string;
  senses: FixtureSense[];
}

interface Fixture {
  id: string;
  text: string;
  annotations: Annotation[];
  expected: string;
}

interface SnapshotFile {
  generated_at: string;
  total_proofread: number;
  fixture_count: number;
  fixtures: Fixture[];
  lookup: Record<string, FixtureLookupEntry[]>;
}

const hasSnapshot = existsSync(SNAPSHOT_PATH);

describe.skipIf(!hasSnapshot)("text-linked snapshot regression", () => {
  const raw = hasSnapshot
    ? (JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8")) as SnapshotFile)
    : null;

  const lookup = new Map<string, WordLookupEntry[]>();
  if (raw) {
    for (const [key, entries] of Object.entries(raw.lookup)) {
      lookup.set(
        key,
        entries.map((e) => ({
          posDir: e.posDir,
          file: e.file,
          senses: e.senses.map((s) => ({
            gloss: s.gloss,
            gloss_en: s.gloss_en,
            tags: [],
            example_ids: [],
            synonyms: [],
            antonyms: [],
            ...(s.synonyms_en ? { synonyms_en: s.synonyms_en } : {}),
          })),
        })),
      );
    }
  }

  it("every locked-in fixture still matches", () => {
    if (!raw) return;

    const failures: { id: string; expected: string; actual: string | null }[] = [];
    for (const f of raw.fixtures) {
      const actual = annotateExampleText(f.text, f.annotations, lookup);
      if (actual !== f.expected) {
        failures.push({ id: f.id, expected: f.expected, actual });
      }
    }

    if (failures.length > 0) {
      const sample = failures
        .slice(0, 10)
        .map(
          (f) =>
            `  ${f.id}\n    expected: ${f.expected.slice(0, 200)}\n    actual:   ${(f.actual ?? "null").slice(0, 200)}`,
        )
        .join("\n");
      console.log(
        `\n  ❌ ${failures.length}/${raw.fixtures.length} snapshot regressions:\n${sample}\n`,
      );
    } else {
      console.log(
        `  ✓ ${raw.fixtures.length} snapshot fixtures all match (corpus: ${raw.total_proofread} proofread examples)`,
      );
    }

    expect(failures.length).toBe(0);
  });
});
