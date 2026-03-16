/**
 * Search examples by various criteria.
 *
 * Scans example shards and prints matching example IDs with excerpts.
 * Use this to locate specific examples before writing fixes to a results file.
 *
 * Usage:
 *   node scripts/search-examples.js --annotation-form <form>
 *   node scripts/search-examples.js --annotation-lemma <lemma>
 *   node scripts/search-examples.js --annotation-form <form> --annotation-lemma <lemma>
 *   node scripts/search-examples.js --owned-by <lemma>
 *   node scripts/search-examples.js --text <substring>
 *   node scripts/search-examples.js --id <exampleId>
 *
 * Options:
 *   --annotation-form <form>    Match examples with annotation.form == <form>
 *   --annotation-lemma <lemma>  Match examples with annotation.lemma == <lemma>
 *   --owned-by <lemma>          Match examples whose lemmas[] contains <lemma>
 *   --text <substring>          Match examples whose text contains <substring> (case-insensitive)
 *   --id <exampleId>            Print a single example by ID
 *   --no-proofread              Only show examples not yet proofread
 *   --limit <n>                 Stop after <n> results (default: 50)
 *   --full                      Print full example JSON instead of summary
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EXAMPLES_DIR = join(ROOT, "data", "examples");

const args = process.argv.slice(2);

function arg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const annotationForm = arg("--annotation-form");
const annotationLemma = arg("--annotation-lemma");
const ownedBy = arg("--owned-by");
const textSearch = arg("--text");
const singleId = arg("--id");
const limitArg = arg("--limit");
const LIMIT = limitArg ? parseInt(limitArg, 10) : 50;
const NO_PROOFREAD = args.includes("--no-proofread");
const FULL = args.includes("--full");

if (!annotationForm && !annotationLemma && !ownedBy && !textSearch && !singleId) {
  console.error("No search criteria specified. Use --help to see options.");
  process.exit(1);
}

if (!existsSync(EXAMPLES_DIR)) {
  console.error("Examples directory not found:", EXAMPLES_DIR);
  process.exit(1);
}

// If searching by single ID, load just that shard
if (singleId) {
  const prefix = singleId.slice(0, 2);
  const file = join(EXAMPLES_DIR, prefix + ".json");
  if (!existsSync(file)) { console.error("Shard not found:", file); process.exit(1); }
  const shard = JSON.parse(readFileSync(file, "utf-8"));
  const ex = shard[singleId];
  if (!ex) { console.error("Example not found:", singleId); process.exit(1); }
  console.log(JSON.stringify({ [singleId]: ex }, null, 2));
  process.exit(0);
}

function matchesAnnotation(ann) {
  if (annotationForm && ann.form !== annotationForm) return false;
  if (annotationLemma && ann.lemma !== annotationLemma) return false;
  return true;
}

function matchesExample(id, ex) {
  if (NO_PROOFREAD && ex._proofread && ex._proofread.translation && ex._proofread.annotations) return false;

  if (ownedBy && !(ex.lemmas || []).includes(ownedBy)) return false;

  if (textSearch && !(ex.text || "").toLowerCase().includes(textSearch.toLowerCase())) return false;

  if (annotationForm || annotationLemma) {
    const anns = ex.annotations || [];
    if (!anns.some(matchesAnnotation)) return false;
  }

  return true;
}

let found = 0;
const shardFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();

outer: for (const file of shardFiles) {
  const shard = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), "utf-8"));
  for (const [id, ex] of Object.entries(shard)) {
    if (!matchesExample(id, ex)) continue;
    found++;

    if (FULL) {
      console.log(JSON.stringify({ [id]: ex }, null, 2));
    } else {
      const matchingAnns = (ex.annotations || []).filter(matchesAnnotation);
      console.log(`\n${id}:`);
      console.log(`  text: ${(ex.text || "").slice(0, 100)}`);
      console.log(`  lemmas: [${(ex.lemmas || []).join(", ")}]`);
      if (matchingAnns.length > 0) {
        console.log(`  matching annotations:`);
        for (const a of matchingAnns) {
          console.log(`    form="${a.form}" lemma="${a.lemma}" pos="${a.pos}" gloss_hint=${JSON.stringify(a.gloss_hint)}`);
        }
      }
      if (ex._proofread) console.log(`  _proofread: ${JSON.stringify(ex._proofread)}`);
    }

    if (found >= LIMIT) {
      console.log(`\n(limit of ${LIMIT} reached — use --limit to see more)`);
      break outer;
    }
  }
}

if (found === 0) console.log("No matching examples found.");
else if (found < LIMIT) console.log(`\n${found} result(s).`);
