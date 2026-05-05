/**
 * Generate batches for LLM subagents to fix wrong_sense / wrong_path divergences.
 *
 * For each diverged example, includes:
 *   - The German sentence + translation
 *   - Current annotations (with gloss_hints)
 *   - Expected vs actual text_linked
 *   - Per-divergent-link: all senses from the word file(s) so the agent
 *     can determine the correct sense and provide a disambiguating gloss_hint
 *
 * The agent determines:
 *   1. Proofread baseline is correct → output gloss_hint fix for the annotation
 *   2. Resolver is correct → output baseline_ok (text_linked should be updated)
 *   3. Neither is correct → output the correct sense/path
 *
 * Output: data/annotation-fix-batches/f{NN}.json
 *
 * Usage:
 *   npx tsx scripts/generate-annotation-fix-batches.ts          # all wrong_sense + wrong_path
 *   npx tsx scripts/generate-annotation-fix-batches.ts --limit 200
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples } from "./lib/examples.js";
import { findWordFilePaths } from "./lib/words.js";
import {
  annotateExampleText,
  type WordLookupEntry,
} from "./lib/text-linked.js";
import type { WordBase } from "../types/index.js";
import type { Annotation } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const OUT_DIR = join(DATA_DIR, "annotation-fix-batches");

const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();

// ── Build word lookup ──

console.log("Building word lookup...");
const files = findWordFilePaths();
const lookup = new Map<string, WordLookupEntry[]>();

interface SenseInfo {
  index_1based: number;
  gloss: string;
  gloss_en: string | null;
  synonyms_en?: string[] | null;
}

interface WordFileInfo {
  path: string;
  word: string;
  senses: SenseInfo[];
}

const fileInfoByPath = new Map<string, WordFileInfo>();

for (const filePath of files) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
  const relPath = relative(DATA_DIR, filePath);
  const parts = relPath.split("/");
  const posDir = parts[1];
  const file = parts[2].replace(".json", "");
  const key = `${data.word}|${data.pos}`;
  const path = `${posDir}/${file}`;

  if (!lookup.has(key)) lookup.set(key, []);
  lookup.get(key)!.push({ posDir, file, senses: data.senses || [] });

  fileInfoByPath.set(path, {
    path,
    word: data.word,
    senses: (data.senses || []).map((s, i) => ({
      index_1based: i + 1,
      gloss: s.gloss || "",
      gloss_en: s.gloss_en ?? null,
      synonyms_en: s.synonyms_en ?? null,
    })),
  });
}

// ── Parse links from text_linked ──

interface ParsedLink {
  form: string;
  path: string;
  sense: number | null;
  delinkedPos: number;
}

function parseAndDelink(textLinked: string): { delinked: string; links: ParsedLink[] } {
  let out = "";
  const links: ParsedLink[] = [];
  let i = 0;
  while (i < textLinked.length) {
    if (textLinked[i] === "[" && textLinked[i + 1] === "[") {
      const pipeIdx = textLinked.indexOf("|", i + 2);
      if (pipeIdx === -1) { out += textLinked[i]; i++; continue; }
      let endIdx = -1;
      for (let j = pipeIdx + 1; j < textLinked.length - 1; j++) {
        if (textLinked[j] === "]" && textLinked[j + 1] === "]") {
          if (textLinked[j + 2] === "]") continue;
          endIdx = j;
          break;
        }
      }
      if (endIdx === -1) { out += textLinked[i]; i++; continue; }
      const form = textLinked.slice(i + 2, pipeIdx);
      const pathRaw = textLinked.slice(pipeIdx + 1, endIdx);
      const senseMatch = pathRaw.match(/^(.*)#(\d+)$/);
      links.push({
        form,
        path: senseMatch ? senseMatch[1] : pathRaw,
        sense: senseMatch ? parseInt(senseMatch[2], 10) : null,
        delinkedPos: out.length,
      });
      out += form;
      i = endIdx + 2;
    } else {
      out += textLinked[i];
      i++;
    }
  }
  return { delinked: out, links };
}

// ── Main ──

console.log("Loading examples...");
const examples = loadExamples();

interface DivergentLink {
  form: string;
  category: "wrong_sense" | "wrong_path";
  expected_path: string;
  expected_sense: number | null;
  actual_path: string;
  actual_sense: number | null;
  current_gloss_hint: string | null;
  expected_file: WordFileInfo | null;
  actual_file: WordFileInfo | null;
}

interface FixCase {
  id: string;
  text: string;
  translation: string | null;
  annotations: Annotation[];
  expected_text_linked: string;
  actual_text_linked: string;
  divergent_links: DivergentLink[];
}

const cases: FixCase[] = [];

for (const [id, ex] of Object.entries(examples)) {
  if (cases.length >= LIMIT) break;
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations?.length) continue;

  const actual = annotateExampleText(ex.text, ex.annotations, lookup);
  if (actual === null || actual === ex.text_linked) continue;

  const expected = parseAndDelink(ex.text_linked);
  const got = parseAndDelink(actual);

  const expByPos = new Map<number, ParsedLink>();
  for (const l of expected.links) expByPos.set(l.delinkedPos, l);
  const gotByPos = new Map<number, ParsedLink>();
  for (const l of got.links) gotByPos.set(l.delinkedPos, l);

  const divergentLinks: DivergentLink[] = [];

  for (const [pos, expLink] of expByPos) {
    const gotLink = gotByPos.get(pos);
    if (!gotLink) continue;

    if (expLink.path === gotLink.path && expLink.sense !== gotLink.sense) {
      // Skip single-sense words (not real divergences)
      const info = fileInfoByPath.get(expLink.path);
      if (info && info.senses.length <= 1) continue;

      const ann = ex.annotations!.find(a => a.form === expLink.form);
      divergentLinks.push({
        form: expLink.form,
        category: "wrong_sense",
        expected_path: expLink.path,
        expected_sense: expLink.sense,
        actual_path: gotLink.path,
        actual_sense: gotLink.sense,
        current_gloss_hint: ann?.gloss_hint ?? null,
        expected_file: fileInfoByPath.get(expLink.path) ?? null,
        actual_file: null, // same file
      });
    } else if (expLink.path !== gotLink.path) {
      const ann = ex.annotations!.find(a => a.form === expLink.form);
      divergentLinks.push({
        form: expLink.form,
        category: "wrong_path",
        expected_path: expLink.path,
        expected_sense: expLink.sense,
        actual_path: gotLink.path,
        actual_sense: gotLink.sense,
        current_gloss_hint: ann?.gloss_hint ?? null,
        expected_file: fileInfoByPath.get(expLink.path) ?? null,
        actual_file: fileInfoByPath.get(gotLink.path) ?? null,
      });
    }
  }

  if (divergentLinks.length === 0) continue;

  cases.push({
    id,
    text: ex.text,
    translation: ex.translation,
    annotations: ex.annotations!,
    expected_text_linked: ex.text_linked,
    actual_text_linked: actual,
    divergent_links: divergentLinks,
  });
}

console.log(`\nFound ${cases.length} examples with fixable divergences`);
console.log(`  total divergent links: ${cases.reduce((s, c) => s + c.divergent_links.length, 0)}`);

// ── Split into batches ──

const BATCH_SIZE = 25;
mkdirSync(OUT_DIR, { recursive: true });

let batchNum = 1;
for (let i = 0; i < cases.length; i += BATCH_SIZE) {
  const batch = cases.slice(i, i + BATCH_SIZE);
  const filename = `f${String(batchNum).padStart(2, "0")}.json`;
  writeFileSync(
    join(OUT_DIR, filename),
    JSON.stringify({ cases: batch }, null, 2) + "\n",
  );
  console.log(`  ${filename}: ${batch.length} cases (${batch.reduce((s, c) => s + c.divergent_links.length, 0)} links)`);
  batchNum++;
}

console.log(`\nWrote ${batchNum - 1} batches to ${OUT_DIR}`);
