/**
 * Drill down on phantom links targeting content-word POS directories
 * (verbs/nouns/adjectives). These are the risky ones — function-word phantoms
 * are clearly unwanted, but a phantom verb/noun link may be a real annotation
 * that got lost.
 *
 * For each content-word phantom, dump enough context to judge whether the
 * proofread link was correct (i.e., the form actually refers to that lemma in
 * the sentence).
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamples } from "./lib/examples.js";
import { buildFileMetaMap } from "./lib/words.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CONTENT_DIRS = new Set(["verbs", "nouns", "adjectives"]);

const pathToFile = buildFileMetaMap();

// More forgiving link parser — strips a leading `[` if the form starts with one,
// because Wiktionary editorial brackets in text confuse the basic parser.
function parseLinks(textLinked: string): Array<{
  form: string;
  path: string;
  sense: number | null;
}> {
  const links: Array<{ form: string; path: string; sense: number | null }> = [];
  const re = /\[\[([^|]+)\|([^\]#]+)(?:#(\d+))?\]\]/g;
  let m;
  while ((m = re.exec(textLinked))) {
    let form = m[1];
    // Strip leading `[` artifact from nested editorial brackets
    if (form.startsWith("[")) form = form.slice(1);
    links.push({
      form,
      path: m[2],
      sense: m[3] ? parseInt(m[3], 10) : null,
    });
  }
  return links;
}

const examples = loadExamples();

interface ContentPhantom {
  id: string;
  text: string;
  text_linked: string;
  annotations: Array<{ form: string; lemma: string; pos: string }>;
  phantom: {
    form: string;
    path: string;
    sense: number | null;
    target_pos: string;
    target_word: string;
    target_first_sense: string | null;
  };
}

const cases: ContentPhantom[] = [];

for (const [id, ex] of Object.entries(examples)) {
  if (!ex._proofread?.annotations || !ex.text_linked || !ex.annotations) continue;

  const annotationForms = new Set(ex.annotations.map((a) => a.form));
  const links = parseLinks(ex.text_linked);

  for (const link of links) {
    if (annotationForms.has(link.form)) continue;
    const target = pathToFile.get(link.path);
    if (!target || !CONTENT_DIRS.has(target.posDir)) continue;

    cases.push({
      id,
      text: ex.text,
      text_linked: ex.text_linked,
      annotations: ex.annotations.map((a) => ({ form: a.form, lemma: a.lemma, pos: a.pos })),
      phantom: {
        form: link.form,
        path: link.path,
        sense: link.sense,
        target_pos: target.pos,
        target_word: target.word,
        target_first_sense: target.first_sense_gloss_en,
      },
    });
  }
}

console.log(`Content-word phantom links found: ${cases.length}`);

// Group by target word to see if there are recurring patterns
const byWord = new Map<string, number>();
for (const c of cases) byWord.set(c.phantom.target_word, (byWord.get(c.phantom.target_word) ?? 0) + 1);
console.log("\n## Top 20 phantom-linked content words");
for (const [w, n] of [...byWord.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${w.padEnd(20)} ${n}`);
}

// Also categorize: is the phantom form a substring/prefix of an annotated form?
// (e.g. annotation has "habe" but phantom is "Ich"; or annotation has "geleben" but phantom is "leben")
function relatedToAnnotation(phantomForm: string, annotations: Array<{ form: string }>): string | null {
  const lower = phantomForm.toLowerCase();
  for (const a of annotations) {
    const al = a.form.toLowerCase();
    if (al === lower) return "exact";
    if (al.includes(lower) || lower.includes(al)) return "substring";
  }
  return null;
}

let related = 0;
let unrelated = 0;
for (const c of cases) {
  if (relatedToAnnotation(c.phantom.form, c.annotations)) related++;
  else unrelated++;
}
console.log(`\nForm relates to an annotation form: ${related}`);
console.log(`Form has no relation to any annotation: ${unrelated}`);

writeFileSync("/tmp/content-phantoms.json", JSON.stringify({ cases }, null, 2) + "\n");
console.log(`\nWrote ${cases.length} cases to /tmp/content-phantoms.json`);
