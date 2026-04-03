/**
 * Generate a verification batch for divergent golden fixtures.
 *
 * Extracts examples where resolver output ≠ proofread text_linked,
 * formats them for sonnet agent verification.
 *
 * Usage:
 *   npx tsx scripts/generate-golden-verification.ts
 *
 * Output: data/golden-verification-batch.json (gitignored via data/raw/)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import {
  annotateExampleText,
  resolveWordFile,
  type WordLookupEntry,
} from "./lib/text-linked.js";
import type { Annotation } from "../types/example.js";
import type { Sense } from "../types/word.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load golden fixtures
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

const raw = JSON.parse(
  readFileSync(join(ROOT, "tests", "fixtures", "text-linked-golden.json"), "utf-8"),
) as FixtureFile;

// Convert lookup
const lookup = new Map<string, WordLookupEntry[]>();
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

// Build valid paths for stale detection
const validPaths = new Set<string>();
for (const entries of lookup.values()) {
  for (const e of entries) validPaths.add(`${e.posDir}/${e.file}`);
}

// Parse links
interface ParsedLink {
  form: string;
  path: string;
  sense: number | null;
  full: string;
}

function parseLinks(text: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const re = /\[\[([^|]+)\|([^\]#]+)(?:#(\d+))?\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    links.push({ form: m[1], path: m[2], sense: m[3] ? parseInt(m[3], 10) : null, full: m[0] });
  }
  return links;
}

// Find divergences
interface VerificationItem {
  id: string;
  text: string;
  proofread_text_linked: string;
  resolver_text_linked: string | null;
  annotations: Annotation[];
  conflicts: {
    form: string;
    proofread: string;
    resolver: string;
    type: "path" | "sense" | "missing" | "extra";
    context: Record<string, unknown>;
  }[];
}

const items: VerificationItem[] = [];

for (const fixture of raw.fixtures) {
  const actual = annotateExampleText(fixture.text, fixture.annotations, lookup);
  if (actual === fixture.expected) continue;

  const expLinks = parseLinks(fixture.expected);
  const actLinks = actual ? parseLinks(actual) : [];
  const expByForm = new Map(expLinks.map(l => [l.form, l]));
  const actByForm = new Map(actLinks.map(l => [l.form, l]));

  const conflicts: VerificationItem["conflicts"] = [];

  for (const [form, exp] of expByForm) {
    const act = actByForm.get(form);
    if (!act) {
      // Check if proofread path still exists
      const pathExists = validPaths.has(exp.path);
      conflicts.push({
        form,
        proofread: exp.full,
        resolver: "(not linked)",
        type: "missing",
        context: { proofread_path_exists: pathExists },
      });
    } else if (exp.path !== act.path) {
      // Collect senses for both paths for context
      const expSenses = getSenseSummary(exp.path);
      const actSenses = getSenseSummary(act.path);
      conflicts.push({
        form,
        proofread: exp.full,
        resolver: act.full,
        type: "path",
        context: {
          proofread_path_exists: validPaths.has(exp.path),
          proofread_senses: expSenses,
          resolver_senses: actSenses,
        },
      });
    } else if (exp.sense !== act.sense) {
      const senses = getSenseSummary(exp.path);
      const ann = fixture.annotations.find(a => a.form === form);
      conflicts.push({
        form,
        proofread: exp.full,
        resolver: act.full,
        type: "sense",
        context: {
          gloss_hint: ann?.gloss_hint ?? null,
          senses,
        },
      });
    }
  }

  for (const [form, act] of actByForm) {
    if (!expByForm.has(form)) {
      const senses = getSenseSummary(act.path);
      conflicts.push({
        form,
        proofread: "(not linked)",
        resolver: act.full,
        type: "extra",
        context: { resolver_senses: senses },
      });
    }
  }

  if (conflicts.length > 0) {
    items.push({
      id: fixture.id,
      text: fixture.text,
      proofread_text_linked: fixture.expected,
      resolver_text_linked: actual,
      annotations: fixture.annotations,
      conflicts,
    });
  }
}

function getSenseSummary(path: string): string[] {
  // Find the word entry in lookup by path
  for (const entries of lookup.values()) {
    for (const e of entries) {
      if (`${e.posDir}/${e.file}` === path) {
        return e.senses.map((s, i) => `#${i + 1}: ${s.gloss_en ?? s.gloss}`);
      }
    }
  }
  return ["(not found in lookup)"];
}

const outPath = join(ROOT, "data", "golden-verification-batch.json");
writeFileSync(outPath, JSON.stringify(items, null, 2) + "\n");
console.log(`Generated ${items.length} items for verification.`);
console.log(`Total conflicts: ${items.reduce((s, i) => s + i.conflicts.length, 0)}`);

// Summary
const typeCounts = new Map<string, number>();
for (const item of items) {
  for (const c of item.conflicts) {
    typeCounts.set(c.type, (typeCounts.get(c.type) ?? 0) + 1);
  }
}
console.log("\nConflict types:");
for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count}`);
}
