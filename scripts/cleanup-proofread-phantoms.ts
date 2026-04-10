/**
 * Cleanup phantom links in proofread `text_linked` (Option C — surgical with promotion).
 *
 * Phantom = link in proofread text_linked whose `form` does not appear in the
 * example's `annotations` array. The current resolver is annotation-driven and
 * cannot reproduce these links.
 *
 * Action plan (decided after spot-check, see audit-content-phantoms.ts output):
 *
 * 1. **Function-word phantoms** (pronouns, prepositions, determiners, adverbs,
 *    conjunctions, particles, postpositions, numerals): STRIP from text_linked.
 *    The current pipeline never annotates these.
 *
 * 2. **Auxiliary/modal verb phantoms** (haben, sein, werden, wollen, können,
 *    müssen, sollen, mögen, dürfen): STRIP. These are auxiliaries, not main verbs.
 *
 * 3. **Curated wrong content phantoms**: STRIP (the proofread link was wrong).
 *
 * 4. **Curated correct content phantoms**: PROMOTE — add an annotation in
 *    text-order so the resolver can reproduce the link. Update _proofread.annotations hash.
 *
 * 5. **Parser-artifact "phantoms"** (form starts with "[" because Wiktionary
 *    editorial brackets like "[des Foo Bar]" confuse the regex): NOT phantoms,
 *    leave alone — strip leading "[" before checking annotation membership.
 *
 * 6. **Debatable cases**: leave alone for manual review later.
 *
 * Usage:
 *   npx tsx scripts/cleanup-proofread-phantoms.ts          # dry run
 *   npx tsx scripts/cleanup-proofread-phantoms.ts --apply  # write changes
 */

import { readFileSync, writeFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { loadExamples, patchExamples } from "./lib/examples.js";
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

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

// ============================================================
// Action plan from spot-check
// ============================================================

const STRIP_FUNCTION_POS_DIRS = new Set([
  "pronouns",
  "prepositions",
  "determiners",
  "adverbs",
  "conjunctions",
  "particles",
  "postpositions",
  "numerals",
]);

const STRIP_AUX_LEMMAS = new Set([
  "haben",
  "sein",
  "werden",
  "wollen",
  "können",
  "müssen",
  "sollen",
  "mögen",
  "dürfen",
]);

/** Per-example list of phantom forms to STRIP because the proofread link is wrong. */
const STRIP_WRONG_CONTENT: Record<string, string[]> = {
  "0a91b4f1dd": ["Ellipsoid"], // → nouns/Ei (germ cell), wrong: Earth is an ellipsoid
  "5203c377eb": ["an"], // → verbs/ankommen, wrong: "an meine Tafel" — preposition not separable particle
  "6e958d4e1c": ["China"], // → nouns/China_chinarinde (the plant), wrong: country
  "efabc67ddd": ["China"], // same
  "bf2e894597": ["Sie"], // → nouns/Sie_besondere (card game), wrong: formal pronoun
  "c21c5a8e0f": ["Sie"], // same
  "87b9997b46": ["LED-]Birnen"], // → nouns/Birne (pear tree), wrong: LED bulb + parser artifact
  "71338a08d8": ["mal"], // → nouns/Mal_bestimmter, wrong: "schon mal" is adverbial particle
  "c73246872d": ["zu helfen", "zu verteidigen"], // duplicate of bare-form annotations
};

/** Per-example list of phantom forms to PROMOTE: add an annotation so resolver reproduces the link.
 *  The link's path/sense are read from the existing text_linked.
 *
 *  Note: hints are matched as substrings against gloss/gloss_en/synonyms_en. After promotion
 *  the script normalizes text_linked's #N for the promoted form to match what the resolver
 *  outputs (handles P1 single-sense / multi-sense normalization automatically). */
const PROMOTE_TO_ANNOTATION: Record<string, Array<{ form: string; lemma: string; pos: string; gloss_hint: string | null }>> = {
  "691e51a57e": [{ form: "Bundestag", lemma: "Bundestag", pos: "noun", gloss_hint: "parliament" }],
  "71338a08d8": [{ form: "Teams", lemma: "Team", pos: "noun", gloss_hint: "team" }],
  "81bbd11cd5": [{ form: "warm", lemma: "warm", pos: "adjective", gloss_hint: "warm" }],
  "9b63bd452f": [
    { form: "Oma", lemma: "Oma", pos: "noun", gloss_hint: "old woman" },
    { form: "Kostüm", lemma: "Kostüm", pos: "noun", gloss_hint: "costume" },
  ],
  "f015ef5d6b": [{ form: "genügend", lemma: "genügend", pos: "adjective", gloss_hint: "sufficient" }],
  "fa907943c7": [{ form: "Zieh", lemma: "ziehen", pos: "verb", gloss_hint: "pull" }],
  "fba2e8adb4": [
    { form: "Vater", lemma: "Vater", pos: "noun", gloss_hint: "father" },
    // hint "hand" matches sense #2 "vorhanden sein" via German substring; use "give" (synonyms_en[1])
    { form: "Gib", lemma: "geben", pos: "verb", gloss_hint: "give" },
    { form: "teilte", lemma: "teilen", pos: "verb", gloss_hint: "divide" },
  ],
  "f35d1babbd": [{ form: "Meiers", lemma: "Meier", pos: "noun", gloss_hint: "steward" }],
  "fb64802c35": [{ form: "Freitag", lemma: "Freitag", pos: "noun", gloss_hint: "Friday" }],
};

// ============================================================
// Build word lookup
// ============================================================

const lookup = new Map<string, WordLookupEntry[]>();
const pathToPosDir = new Map<string, string>();
const pathToLemma = new Map<string, string>();

for (const filePath of findWordFilePaths()) {
  const data = JSON.parse(readFileSync(filePath, "utf-8")) as WordBase;
  const relPath = relative(DATA_DIR, filePath);
  const parts = relPath.split("/");
  const posDir = parts[1];
  const file = parts[2].replace(".json", "");
  const path = `${posDir}/${file}`;
  const key = `${data.word}|${data.pos}`;

  if (!lookup.has(key)) lookup.set(key, []);
  lookup.get(key)!.push({ posDir, file, senses: data.senses || [] });
  pathToPosDir.set(path, posDir);
  pathToLemma.set(path, data.word);
}

// ============================================================
// Link parser (with parser-artifact awareness)
// ============================================================

interface ParsedLink {
  form: string;          // raw form as parsed (may have leading "[")
  cleanForm: string;     // form with leading "[" stripped — what we check against annotations
  path: string;
  sense: number | null;
  fullMatch: string;     // full [[...]] string for replacement
}

function parseLinks(textLinked: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const re = /\[\[([^|]+)\|([^\]#]+)(?:#(\d+))?\]\]/g;
  let m;
  while ((m = re.exec(textLinked))) {
    const form = m[1];
    links.push({
      form,
      cleanForm: form.startsWith("[") ? form.slice(1) : form,
      path: m[2],
      sense: m[3] ? parseInt(m[3], 10) : null,
      fullMatch: m[0],
    });
  }
  return links;
}

// ============================================================
// Strip a phantom link from text_linked
// Replace [[form|path#N]] with form (preserving any leading "[")
// ============================================================

function stripLink(textLinked: string, link: ParsedLink): string {
  // The replacement is just the form text (preserving leading "[" for parser-artifact cases)
  return textLinked.replace(link.fullMatch, link.form);
}

// ============================================================
// Annotation hash (matches lib/examples.ts annotationsHash)
// ============================================================

function annotationsHash(annotations: unknown[] | undefined): string {
  return createHash("sha256")
    .update(JSON.stringify(annotations || []))
    .digest("hex")
    .slice(0, 8);
}

// ============================================================
// Insert annotation in text-order
// ============================================================

function insertAnnotationInOrder(
  annotations: Annotation[],
  text: string,
  newAnn: Annotation,
): Annotation[] {
  // Find position of newAnn.form in text
  const pos = text.indexOf(newAnn.form);
  if (pos < 0) {
    // Form not found in text — append
    return [...annotations, newAnn];
  }
  // Find where in the existing annotation list to insert
  let insertIdx = annotations.length;
  let cursor = 0;
  for (let i = 0; i < annotations.length; i++) {
    const annPos = text.indexOf(annotations[i].form, cursor);
    if (annPos > pos) {
      insertIdx = i;
      break;
    }
    cursor = annPos >= 0 ? annPos + annotations[i].form.length : cursor;
  }
  const result = [...annotations];
  result.splice(insertIdx, 0, newAnn);
  return result;
}

// ============================================================
// Main pass
// ============================================================

const examples = loadExamples();

interface Patch {
  text_linked?: string;
  annotations?: Annotation[];
  _proofread?: { annotations?: string };
}

const patches: Record<string, Patch> = {};

let stripFunctionCount = 0;
let stripAuxCount = 0;
let stripWrongContentCount = 0;
let promoteCount = 0;
let parserArtifactSkipCount = 0;
let untouchedPhantomCount = 0; // debatable cases left alone
let examplesTouched = 0;

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations) continue;

  const annotationForms = new Set(ex.annotations.map((a) => a.form));
  const links = parseLinks(ex.text_linked);

  let textLinked = ex.text_linked;
  let modified = false;
  let annotations = [...ex.annotations];

  const promoteList = PROMOTE_TO_ANNOTATION[id] || [];
  const promoteForms = new Set(promoteList.map((p) => p.form));

  for (const link of links) {
    // Not a phantom — annotation exists for this form
    if (annotationForms.has(link.cleanForm)) continue;

    // Parser-artifact false positive: form has leading "[" and the cleanForm
    // matches an annotation. Already handled above by cleanForm check.
    if (link.form !== link.cleanForm && annotationForms.has(link.cleanForm)) {
      parserArtifactSkipCount++;
      continue;
    }
    // Pure parser artifact (form starts with "[" but cleanForm also missing) — leave alone
    if (link.form !== link.cleanForm) {
      parserArtifactSkipCount++;
      continue;
    }

    // Promote to annotation?
    if (promoteForms.has(link.form)) {
      const promoteEntry = promoteList.find((p) => p.form === link.form)!;
      annotations = insertAnnotationInOrder(annotations, ex.text, {
        form: promoteEntry.form,
        lemma: promoteEntry.lemma,
        pos: promoteEntry.pos,
        gloss_hint: promoteEntry.gloss_hint,
      });
      promoteCount++;
      modified = true;
      if (VERBOSE) console.log(`  ${id}: PROMOTE ${link.form} → annotation`);
      continue;
    }

    // Strip wrong content (curated)?
    const stripList = STRIP_WRONG_CONTENT[id];
    if (stripList && stripList.includes(link.form)) {
      textLinked = stripLink(textLinked, link);
      stripWrongContentCount++;
      modified = true;
      if (VERBOSE) console.log(`  ${id}: STRIP wrong content ${link.form} (${link.path})`);
      continue;
    }

    // Strip auxiliary/modal verb?
    const lemma = pathToLemma.get(link.path);
    const dir = pathToPosDir.get(link.path);
    if (lemma && STRIP_AUX_LEMMAS.has(lemma) && dir === "verbs") {
      textLinked = stripLink(textLinked, link);
      stripAuxCount++;
      modified = true;
      if (VERBOSE) console.log(`  ${id}: STRIP aux ${link.form} (${link.path})`);
      continue;
    }

    // Strip function word (by POS dir)?
    if (dir && STRIP_FUNCTION_POS_DIRS.has(dir)) {
      textLinked = stripLink(textLinked, link);
      stripFunctionCount++;
      modified = true;
      if (VERBOSE) console.log(`  ${id}: STRIP function ${link.form} (${link.path})`);
      continue;
    }

    // Anything else: leave alone (debatable / content phantom not in our lists)
    untouchedPhantomCount++;
    if (VERBOSE) console.log(`  ${id}: SKIP (debatable) ${link.form} (${link.path})`);
  }

  if (modified) {
    examplesTouched++;
    const patch: Patch = {};
    if (textLinked !== ex.text_linked) patch.text_linked = textLinked;
    if (annotations !== ex.annotations) {
      patch.annotations = annotations;
      patch._proofread = { annotations: annotationsHash(annotations) };
    }
    patches[id] = patch;
  }
}

// ============================================================
// Verify promoted examples — for each promoted form, compare ONLY that form's
// link (path + sense) between the (modified) proofread text_linked and the
// resolver's output. Other links may legitimately differ (stale hints
// throughout the example), and we want to leave them as-is.
//
// Also auto-normalize the promoted form's #N: if path matches but the
// resolver's #N differs (e.g. resolver picks #1 for a multi-sense file where
// the proofread had no #N, or the file is single-sense and the proofread had
// #1), patch the proofread link to match the resolver. This handles P1 cases.
// ============================================================

function findLinkForForm(textLinked: string, form: string): ParsedLink | null {
  const links = parseLinks(textLinked);
  for (const link of links) {
    if (link.cleanForm === form) return link;
  }
  return null;
}

function buildLink(form: string, path: string, sense: number | null): string {
  return sense !== null ? `[[${form}|${path}#${sense}]]` : `[[${form}|${path}]]`;
}

let verifyMatch = 0;
let verifyMismatch = 0;
let normalizedSenseCount = 0;
const mismatches: Array<{ id: string; form: string; expected: string; actual: string }> = [];

for (const id of Object.keys(PROMOTE_TO_ANNOTATION)) {
  const patch = patches[id];
  const ex = examples[id];
  if (!patch || !ex) continue;

  const newAnnotations = patch.annotations ?? ex.annotations;
  let newTextLinked = patch.text_linked ?? ex.text_linked!;
  if (!newAnnotations) continue;

  const resolverOutput = annotateExampleText(ex.text, newAnnotations, lookup);
  if (!resolverOutput) {
    verifyMismatch++;
    for (const p of PROMOTE_TO_ANNOTATION[id]) {
      mismatches.push({ id, form: p.form, expected: "(some link)", actual: "NULL_OUTPUT" });
    }
    continue;
  }

  for (const promoteEntry of PROMOTE_TO_ANNOTATION[id]) {
    const proofreadLink = findLinkForForm(newTextLinked, promoteEntry.form);
    const resolverLink = findLinkForForm(resolverOutput, promoteEntry.form);

    if (!proofreadLink) {
      verifyMismatch++;
      mismatches.push({
        id,
        form: promoteEntry.form,
        expected: "(missing in proofread text_linked)",
        actual: resolverLink?.fullMatch ?? "NULL",
      });
      continue;
    }
    if (!resolverLink) {
      verifyMismatch++;
      mismatches.push({
        id,
        form: promoteEntry.form,
        expected: proofreadLink.fullMatch,
        actual: "NOT_LINKED_BY_RESOLVER",
      });
      continue;
    }

    // Path mismatch — real bug, the hint resolves to wrong file
    if (proofreadLink.path !== resolverLink.path) {
      verifyMismatch++;
      mismatches.push({
        id,
        form: promoteEntry.form,
        expected: proofreadLink.fullMatch,
        actual: resolverLink.fullMatch,
      });
      continue;
    }

    // Sense mismatch — auto-normalize ONLY when one side has null (P1 case:
    // single-sense vs multi-sense file shape difference between old generator
    // and current resolver). Two non-null but different senses = real
    // wrong-sense hint, must be reported, not silently patched.
    if (proofreadLink.sense !== resolverLink.sense) {
      const isP1Normalization =
        proofreadLink.sense === null || resolverLink.sense === null;
      if (isP1Normalization) {
        const newLink = buildLink(
          proofreadLink.form,
          resolverLink.path,
          resolverLink.sense,
        );
        newTextLinked = newTextLinked.replace(proofreadLink.fullMatch, newLink);
        normalizedSenseCount++;
        if (VERBOSE) {
          console.log(
            `  ${id}: NORMALIZE ${promoteEntry.form} ${proofreadLink.fullMatch} → ${newLink}`,
          );
        }
        verifyMatch++;
      } else {
        verifyMismatch++;
        mismatches.push({
          id,
          form: promoteEntry.form,
          expected: proofreadLink.fullMatch,
          actual: resolverLink.fullMatch,
        });
      }
      continue;
    }

    verifyMatch++;
  }

  // Persist normalized text_linked back into the patch
  if (newTextLinked !== (patch.text_linked ?? ex.text_linked!)) {
    patch.text_linked = newTextLinked;
  }
}

// ============================================================
// Report
// ============================================================

console.log("\n=== Phantom cleanup summary ===");
console.log(`Examples touched: ${examplesTouched}`);
console.log(`  Strip function-word links: ${stripFunctionCount}`);
console.log(`  Strip auxiliary verb links: ${stripAuxCount}`);
console.log(`  Strip wrong content links (curated): ${stripWrongContentCount}`);
console.log(`  Promote to annotation (curated): ${promoteCount}`);
console.log(`  Parser-artifact phantoms (left alone): ${parserArtifactSkipCount}`);
console.log(`  Debatable phantoms (left alone): ${untouchedPhantomCount}`);

console.log(`\nPromote verification: ${verifyMatch} match, ${verifyMismatch} mismatch`);
console.log(`  Sense-only normalizations (#N patched in text_linked): ${normalizedSenseCount}`);
if (mismatches.length > 0) {
  console.log("\nPath/missing mismatches (resolver disagrees on promoted form's link):");
  for (const m of mismatches) {
    console.log(`  ${m.id}  ${m.form}`);
    console.log(`    expected: ${m.expected}`);
    console.log(`    actual:   ${m.actual}`);
  }
}

if (!APPLY) {
  console.log("\n(dry run — pass --apply to write changes)");
} else {
  if (verifyMismatch > 0) {
    console.log("\nABORTING write — resolver mismatches on promoted examples. Fix gloss_hints first.");
    process.exit(1);
  }
  console.log("\nWriting patches...");
  patchExamples(patches as Record<string, Record<string, unknown>>);
  console.log(`Patched ${Object.keys(patches).length} examples`);
}
