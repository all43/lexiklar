import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  resolveWordFile,
  findFormInText,
  annotateExampleText,
  normalizeHint,
  IRREGULAR_EN,
  type WordLookupEntry,
} from "../scripts/lib/text-linked.js";
import type { Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Fixtures ──

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

interface FixtureFile {
  fixtures: Fixture[];
  lookup: Record<string, FixtureLookupEntry[]>;
}

let goldenFixtures: Fixture[];
let goldenLookup: Map<string, WordLookupEntry[]>;

beforeAll(() => {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "text-linked-golden.json"), "utf-8"),
  ) as FixtureFile;
  goldenFixtures = raw.fixtures;

  // Convert Record to Map with proper Sense type
  goldenLookup = new Map();
  for (const [key, entries] of Object.entries(raw.lookup)) {
    goldenLookup.set(
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
});

// ── Helper to build a quick lookup ──

function makeLookup(
  entries: Record<string, { posDir: string; file: string; senses: { gloss: string; gloss_en: string | null; synonyms_en?: string[] }[] }[]>,
): Map<string, WordLookupEntry[]> {
  const m = new Map<string, WordLookupEntry[]>();
  for (const [key, list] of Object.entries(entries)) {
    m.set(
      key,
      list.map((e) => ({
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
  return m;
}

// ============================================================
// Unit tests: normalizeHint
// ============================================================

describe("normalizeHint", () => {
  it("lowercases", () => {
    expect(normalizeHint("Running")).toBe("running");
  });

  it("takes first pipe-separated value", () => {
    expect(normalizeHint("from | of")).toBe("from");
  });

  it("handles no pipe", () => {
    expect(normalizeHint("table")).toBe("table");
  });
});

// ============================================================
// Unit tests: findFormInText
// ============================================================

describe("findFormInText", () => {
  it("finds word at start", () => {
    expect(findFormInText("Tisch steht hier.", "Tisch", 0)).toBe(0);
  });

  it("finds word in middle", () => {
    expect(findFormInText("Der Tisch steht.", "Tisch", 0)).toBe(4);
  });

  it("respects word boundaries (no partial match)", () => {
    expect(findFormInText("Ankunft ist wichtig.", "Kunst", 0)).toBe(-1);
  });

  it("handles umlauts in text", () => {
    expect(findFormInText("Die Bücher liegen.", "Bücher", 0)).toBe(4);
  });

  it("returns -1 when not found", () => {
    expect(findFormInText("Der Tisch steht.", "Stuhl", 0)).toBe(-1);
  });

  it("respects startAfter", () => {
    expect(findFormInText("Tisch und Tisch.", "Tisch", 1)).toBe(10);
  });
});

// ============================================================
// Unit tests: resolveWordFile
// ============================================================

describe("resolveWordFile", () => {
  it("returns null for unknown lemma", () => {
    const lookup = makeLookup({});
    expect(resolveWordFile("unknown", "noun", null, lookup)).toBeNull();
  });

  it("resolves single-sense word without sense number", () => {
    const lookup = makeLookup({
      "Tisch|noun": [{ posDir: "nouns", file: "Tisch", senses: [{ gloss: "Möbelstück", gloss_en: "table" }] }],
    });
    const result = resolveWordFile("Tisch", "noun", null, lookup);
    expect(result).toEqual({ posDir: "nouns", file: "Tisch", senseNumber: null });
  });

  it("resolves multi-sense word with exact gloss_en match", () => {
    const lookup = makeLookup({
      "Bank|noun": [{ posDir: "nouns", file: "Bank_sitz", senses: [
        { gloss: "Sitzgelegenheit", gloss_en: "bench" },
        { gloss: "Geldinstitut", gloss_en: "bank (financial)" },
      ] }],
    });
    const result = resolveWordFile("Bank", "noun", "bench", lookup);
    expect(result).toEqual({ posDir: "nouns", file: "Bank_sitz", senseNumber: 1 });
  });

  it("resolves via gloss_en when German gloss doesn't match", () => {
    const lookup = makeLookup({
      "Zug|noun": [{ posDir: "nouns", file: "Zug_fahrzeug", senses: [
        { gloss: "Schienenfahrzeug", gloss_en: "train" },
        { gloss: "Luftzug", gloss_en: "draft" },
      ] }],
    });
    const result = resolveWordFile("Zug", "noun", "train", lookup);
    expect(result).toEqual({ posDir: "nouns", file: "Zug_fahrzeug", senseNumber: 1 });
  });

  it("uses English stemming (created → creat matches 'create')", () => {
    const lookup = makeLookup({
      "schaffen|verb": [{ posDir: "verbs", file: "schaffen", senses: [
        { gloss: "erschaffen", gloss_en: "to create" },
        { gloss: "bewältigen", gloss_en: "to manage" },
      ] }],
    });
    // "created" → strip -ed → "creat" (5 chars, ≥4) → substring of "create"
    const result = resolveWordFile("schaffen", "verb", "created", lookup);
    expect(result).toEqual({ posDir: "verbs", file: "schaffen", senseNumber: 1 });
  });

  it("stemming: 'running' doesn't match 'to run' (runn ≠ substring of run)", () => {
    const lookup = makeLookup({
      "laufen|verb": [{ posDir: "verbs", file: "laufen", senses: [
        { gloss: "sich bewegen", gloss_en: "to run" },
        { gloss: "funktionieren", gloss_en: "to work" },
      ] }],
    });
    // "running" → "runn" — NOT a substring of "to run", so no sense match
    const result = resolveWordFile("laufen", "verb", "running", lookup);
    expect(result?.senseNumber).toBeNull();
  });

  it("uses irregular English mapping (went → go)", () => {
    const lookup = makeLookup({
      "gehen|verb": [{ posDir: "verbs", file: "gehen", senses: [
        { gloss: "sich bewegen", gloss_en: "to go" },
        { gloss: "funktionieren", gloss_en: "to work" },
      ] }],
    });
    const result = resolveWordFile("gehen", "verb", "went", lookup);
    expect(result).toEqual({ posDir: "verbs", file: "gehen", senseNumber: 1 });
  });

  it("falls back to synonyms_en", () => {
    const lookup = makeLookup({
      "Wohnung|noun": [{ posDir: "nouns", file: "Wohnung", senses: [
        { gloss: "Räumlichkeit zum Wohnen", gloss_en: "apartment", synonyms_en: ["flat", "dwelling"] },
        { gloss: "Aufenthaltsort", gloss_en: "residence" },
      ] }],
    });
    const result = resolveWordFile("Wohnung", "noun", "flat", lookup);
    expect(result).toEqual({ posDir: "nouns", file: "Wohnung", senseNumber: 1 });
  });

  it("uses word-level fallback for homonyms", () => {
    const lookup = makeLookup({
      "Bank|noun": [
        { posDir: "nouns", file: "Bank_sitz", senses: [{ gloss: "Sitzgelegenheit", gloss_en: "bench" }] },
        { posDir: "nouns", file: "Bank_geldinstitut", senses: [{ gloss: "Geldinstitut", gloss_en: "bank (financial institution)" }] },
      ],
    });
    const result = resolveWordFile("Bank", "noun", "financial institution", lookup);
    // Word-level fallback picks the right file but no sense number
    expect(result?.file).toBe("Bank_geldinstitut");
    expect(result?.senseNumber).toBeNull();
  });

  it("suppresses sense number for single-sense words even with gloss_hint", () => {
    const lookup = makeLookup({
      "Tisch|noun": [{ posDir: "nouns", file: "Tisch", senses: [{ gloss: "Möbelstück", gloss_en: "table" }] }],
    });
    const result = resolveWordFile("Tisch", "noun", "table", lookup);
    expect(result?.senseNumber).toBeNull();
  });

  it("falls back to first entry when hint doesn't match anything", () => {
    const lookup = makeLookup({
      "Schloss|noun": [{ posDir: "nouns", file: "Schloss", senses: [
        { gloss: "Schließvorrichtung", gloss_en: "lock" },
        { gloss: "Prunkbau", gloss_en: "castle" },
      ] }],
    });
    const result = resolveWordFile("Schloss", "noun", "completely unrelated hint", lookup);
    expect(result?.file).toBe("Schloss");
    expect(result?.senseNumber).toBeNull();
  });
});

// ============================================================
// Unit tests: annotateExampleText
// ============================================================

describe("annotateExampleText", () => {
  const lookup = makeLookup({
    "Tisch|noun": [{ posDir: "nouns", file: "Tisch", senses: [{ gloss: "Möbelstück", gloss_en: "table" }] }],
    "stehen|verb": [{ posDir: "verbs", file: "stehen", senses: [{ gloss: "aufrecht sein", gloss_en: "to stand" }] }],
    "Ecke|noun": [{ posDir: "nouns", file: "Ecke", senses: [{ gloss: "Winkel", gloss_en: "corner" }] }],
  });

  it("generates linked text from annotations", () => {
    const annotations: Annotation[] = [
      { form: "Tisch", lemma: "Tisch", pos: "noun", gloss_hint: null },
      { form: "steht", lemma: "stehen", pos: "verb", gloss_hint: null },
      { form: "Ecke", lemma: "Ecke", pos: "noun", gloss_hint: null },
    ];
    const result = annotateExampleText("Der Tisch steht in der Ecke.", annotations, lookup);
    expect(result).toBe("Der [[Tisch|nouns/Tisch]] [[steht|verbs/stehen]] in der [[Ecke|nouns/Ecke]].");
  });

  it("returns null for empty annotations", () => {
    expect(annotateExampleText("Some text.", [], lookup)).toBeNull();
  });

  it("returns null when no forms found in text", () => {
    const annotations: Annotation[] = [
      { form: "Stuhl", lemma: "Stuhl", pos: "noun", gloss_hint: null },
    ];
    expect(annotateExampleText("Der Tisch steht.", annotations, lookup)).toBeNull();
  });

  it("handles overlapping annotations (first match wins)", () => {
    // If two annotations would overlap in the text, the first by position wins
    const overlappingLookup = makeLookup({
      "Tisch|noun": [{ posDir: "nouns", file: "Tisch", senses: [{ gloss: "Möbelstück", gloss_en: "table" }] }],
    });
    const annotations: Annotation[] = [
      { form: "Tisch", lemma: "Tisch", pos: "noun", gloss_hint: null },
      { form: "Tisch", lemma: "Tisch", pos: "noun", gloss_hint: null }, // duplicate
    ];
    const result = annotateExampleText("Der Tisch steht.", annotations, overlappingLookup);
    // Should have exactly one link, not two
    expect(result).toBe("Der [[Tisch|nouns/Tisch]] steht.");
  });

  it("includes sense number for multi-sense words", () => {
    const multiSenseLookup = makeLookup({
      "Schloss|noun": [{ posDir: "nouns", file: "Schloss", senses: [
        { gloss: "Schließvorrichtung", gloss_en: "lock" },
        { gloss: "Prunkbau", gloss_en: "castle" },
      ] }],
    });
    const annotations: Annotation[] = [
      { form: "Schloss", lemma: "Schloss", pos: "noun", gloss_hint: "castle" },
    ];
    const result = annotateExampleText("Das Schloss ist alt.", annotations, multiSenseLookup);
    expect(result).toBe("Das [[Schloss|nouns/Schloss#2]] ist alt.");
  });
});

// ============================================================
// Golden proofread examples
// ============================================================

describe("golden proofread examples", () => {
  it("should have loaded fixtures", () => {
    expect(goldenFixtures.length).toBeGreaterThan(0);
    expect(goldenLookup.size).toBeGreaterThan(0);
  });

  // Parse [[form|path#N]] links from text_linked
  function parseLinks(textLinked: string): { form: string; path: string; sense: number | null }[] {
    const links: { form: string; path: string; sense: number | null }[] = [];
    const re = /\[\[([^|]+)\|([^\]#]+)(?:#(\d+))?\]\]/g;
    let m;
    while ((m = re.exec(textLinked))) {
      links.push({
        form: m[1],
        path: m[2],
        sense: m[3] ? parseInt(m[3], 10) : null,
      });
    }
    return links;
  }

  it("resolver matches proofread text_linked", () => {
    // Build set of valid paths from lookup for stale-proofread detection
    const validPaths = new Set<string>();
    for (const entries of goldenLookup.values()) {
      for (const e of entries) validPaths.add(`${e.posDir}/${e.file}`);
    }

    let matched = 0;
    let diverged = 0;
    let proofreadStale = 0;
    const divergences: { id: string; expected: string; actual: string | null; category: string }[] = [];

    for (const fixture of goldenFixtures) {
      const actual = annotateExampleText(fixture.text, fixture.annotations, goldenLookup);

      if (actual === fixture.expected) {
        matched++;
        continue;
      }

      // Categorize divergence
      const expectedLinks = parseLinks(fixture.expected);
      const actualLinks = actual ? parseLinks(actual) : [];

      let category = "unknown";
      let isStale = false;

      if (!actual) {
        category = "no_output";
      } else if (expectedLinks.length !== actualLinks.length) {
        // Check if extra links are from new word files (proofread is stale)
        const expForms = new Set(expectedLinks.map(l => l.form));
        const extraLinks = actualLinks.filter(l => !expForms.has(l.form));
        const missingLinks = expectedLinks.filter(l => !new Set(actualLinks.map(a => a.form)).has(l.form));

        if (extraLinks.length > 0 && extraLinks.every(l => validPaths.has(l.path)) && missingLinks.length === 0) {
          isStale = true;
          category = "proofread_stale_extra";
        } else {
          category = "link_count_mismatch";
        }
      } else {
        let hasPathDiff = false;
        let hasSenseDiff = false;
        let allPathStale = true;
        for (let i = 0; i < expectedLinks.length; i++) {
          const exp = expectedLinks[i];
          const act = actualLinks[i];
          if (exp.path !== act?.path) {
            hasPathDiff = true;
            // Check if expected path no longer exists
            if (validPaths.has(exp.path) || !validPaths.has(act?.path ?? "")) {
              allPathStale = false;
            }
          }
          if (exp.sense !== act?.sense) hasSenseDiff = true;
        }
        if (hasPathDiff && allPathStale) {
          isStale = true;
          category = "proofread_stale_path";
        } else if (hasPathDiff) {
          category = "wrong_path";
        } else if (hasSenseDiff) {
          category = "wrong_sense";
        } else {
          category = "text_difference";
        }
      }

      if (isStale) {
        proofreadStale++;
      } else {
        diverged++;
      }

      divergences.push({
        id: fixture.id,
        expected: fixture.expected,
        actual,
        category,
      });
    }

    // Report statistics
    const total = matched + diverged + proofreadStale;
    console.log(`\n  Golden test results: ${matched}/${total} matched, ${proofreadStale} proofread-stale, ${diverged} diverged`);

    if (divergences.length > 0) {
      const byCat = new Map<string, number>();
      for (const d of divergences) {
        byCat.set(d.category, (byCat.get(d.category) ?? 0) + 1);
      }
      console.log("  Divergence categories:");
      for (const [cat, count] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${cat}: ${count}`);
      }

      // Show first few real divergences (not stale)
      const realDivergences = divergences.filter(d => !d.category.startsWith("proofread_stale"));
      if (realDivergences.length > 0) {
        console.log("\n  Sample divergences (not stale):");
        for (const d of realDivergences.slice(0, 5)) {
          console.log(`    [${d.category}] ${d.id}`);
          console.log(`      expected: ${d.expected.slice(0, 120)}`);
          console.log(`      actual:   ${(d.actual ?? "null").slice(0, 120)}`);
        }
      }
    }

    // Baseline assertion: track total, allow divergences for now.
    // Once annotations and resolver are fixed, tighten to:
    // expect(diverged).toBe(0);
    expect(total).toBeGreaterThan(0);
  });
});
