/**
 * Patch individual example fields (annotations, translation) in shard files.
 *
 * Usage:
 *   # Fix a gloss_hint on a specific annotation
 *   npx tsx scripts/patch-example.ts <id> --annotation <lemma> --set-gloss-hint "new hint"
 *   npx tsx scripts/patch-example.ts <id> --annotation <lemma> --set-gloss-hint null
 *
 *   # Fix lemma or POS on a specific annotation
 *   npx tsx scripts/patch-example.ts <id> --annotation <lemma> --set-lemma "newLemma"
 *   npx tsx scripts/patch-example.ts <id> --annotation <lemma> --set-pos "adjective"
 *
 *   # Remove a specific annotation by lemma
 *   npx tsx scripts/patch-example.ts <id> --annotation <lemma> --remove
 *
 *   # Remove all non-content annotations (keeps only noun/verb/adjective)
 *   npx tsx scripts/patch-example.ts <id> --remove-non-content
 *
 *   # Fix translation text
 *   npx tsx scripts/patch-example.ts <id> --set-translation "New translation text"
 *
 *   # Strip annotation metadata leaked into translation (after pipe, brackets, HTML, markdown bold)
 *   npx tsx scripts/patch-example.ts <id> --clean-translation
 *
 *   # Replace entire annotations array from JSON
 *   npx tsx scripts/patch-example.ts <id> --set-annotations '[{"form":"Hut","lemma":"Hut","pos":"noun","gloss_hint":null}]'
 *
 *   # Match annotation by form instead of lemma (for ambiguous cases)
 *   npx tsx scripts/patch-example.ts <id> --annotation <lemma> --form <form> --set-gloss-hint "hint"
 *
 * Multiple --annotation patches can be chained by running the command multiple times.
 * The script loads only the affected shard, applies the patch, and writes back.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Annotation, ExampleShard } from "../types/example.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "..", "data", "examples");

function usage(): never {
  console.error("Usage: npx tsx scripts/patch-example.ts <id> [options]");
  console.error("  --annotation <lemma>     Target annotation by lemma");
  console.error("  --form <form>            Narrow annotation match by form");
  console.error("  --set-gloss-hint <val>   Set gloss_hint (use 'null' for null)");
  console.error("  --set-lemma <val>        Set lemma");
  console.error("  --set-pos <val>          Set POS");
  console.error("  --remove                 Remove matched annotation");
  console.error("  --remove-non-content     Remove non-content word annotations");
  console.error("  --set-translation <val>  Replace translation text");
  console.error("  --clean-translation      Strip leaked metadata from translation");
  console.error("  --set-annotations <json> Replace entire annotations array");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();

const exId = args[0];
const shardFile = join(EXAMPLES_DIR, exId.slice(0, 2) + ".json");

if (!existsSync(shardFile)) {
  console.error(`Shard file not found: ${shardFile}`);
  process.exit(1);
}

const shard: ExampleShard = JSON.parse(readFileSync(shardFile, "utf-8"));
const ex = shard[exId];
if (!ex) {
  console.error(`Example ${exId} not found in shard`);
  process.exit(1);
}

let changed = false;

// Parse remaining args
let i = 1;
while (i < args.length) {
  const arg = args[i];

  if (arg === "--set-translation") {
    ex.translation = args[++i];
    (ex as Record<string, unknown>).translation_model = "anthropic/claude-sonnet-4-6";
    changed = true;
    console.log(`  Set translation`);
  } else if (arg === "--clean-translation") {
    if (ex.translation) {
      let t = ex.translation;
      // Remove pipe-separated glossary: " | word (noun), ..."
      t = t.replace(/\s*\|[^|]*$/, "");
      // Remove bracketed annotations: [word|lemma:pos] or [word: translation]
      t = t.replace(/\s*\[([^\]]*)\]\s*/g, " ").trim();
      // Remove HTML tags
      t = t.replace(/<\/?[bi]>/gi, "");
      // Remove markdown bold
      t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
      // Clean up double spaces
      t = t.replace(/ {2,}/g, " ").trim();
      if (t !== ex.translation) {
        ex.translation = t;
        changed = true;
        console.log(`  Cleaned translation`);
      } else {
        console.log(`  Translation unchanged`);
      }
    }
  } else if (arg === "--set-annotations") {
    const json = args[++i];
    ex.annotations = JSON.parse(json) as Annotation[];
    changed = true;
    console.log(`  Replaced annotations (${ex.annotations.length} entries)`);
  } else if (arg === "--remove-non-content") {
    if (ex.annotations) {
      const before = ex.annotations.length;
      const contentPOS = new Set(["noun", "verb", "adjective"]);
      ex.annotations = ex.annotations.filter((a) => contentPOS.has(a.pos));
      const removed = before - ex.annotations.length;
      if (removed > 0) {
        changed = true;
        console.log(`  Removed ${removed} non-content annotations`);
      } else {
        console.log(`  No non-content annotations found`);
      }
    }
  } else if (arg === "--annotation") {
    const targetLemma = args[++i];
    let targetForm: string | null = null;
    let action: string | null = null;
    let value: string | null = null;

    // Peek ahead for --form and action flags
    while (i + 1 < args.length) {
      const next = args[i + 1];
      if (next === "--form") {
        i++;
        targetForm = args[++i];
      } else if (next === "--set-gloss-hint") {
        action = "set-gloss-hint";
        i++;
        value = args[++i];
      } else if (next === "--set-lemma") {
        action = "set-lemma";
        i++;
        value = args[++i];
      } else if (next === "--set-pos") {
        action = "set-pos";
        i++;
        value = args[++i];
      } else if (next === "--remove") {
        action = "remove";
        i++;
      } else {
        break;
      }
    }

    if (!action) {
      console.error(`No action specified for --annotation ${targetLemma}`);
      process.exit(1);
    }

    if (!ex.annotations) {
      console.error(`Example ${exId} has no annotations`);
      process.exit(1);
    }

    // Find matching annotation(s)
    const matches = ex.annotations.filter(
      (a) =>
        a.lemma === targetLemma &&
        (!targetForm || a.form === targetForm),
    );

    if (matches.length === 0) {
      console.error(
        `No annotation with lemma '${targetLemma}'${targetForm ? ` and form '${targetForm}'` : ""} in ${exId}`,
      );
      process.exit(1);
    }

    if (action === "remove") {
      ex.annotations = ex.annotations.filter(
        (a) =>
          !(
            a.lemma === targetLemma &&
            (!targetForm || a.form === targetForm)
          ),
      );
      changed = true;
      console.log(`  Removed annotation(s) with lemma '${targetLemma}'`);
    } else {
      for (const ann of matches) {
        if (action === "set-gloss-hint") {
          ann.gloss_hint = value === "null" ? null : value;
          console.log(`  Set gloss_hint='${ann.gloss_hint}' on ${ann.form}`);
        } else if (action === "set-lemma") {
          console.log(`  Set lemma '${ann.lemma}' → '${value}' on ${ann.form}`);
          ann.lemma = value!;
        } else if (action === "set-pos") {
          console.log(`  Set pos '${ann.pos}' → '${value}' on ${ann.form}`);
          ann.pos = value!;
        }
      }
      changed = true;
    }
  } else {
    console.error(`Unknown option: ${arg}`);
    usage();
  }

  i++;
}

if (changed) {
  const sorted: ExampleShard = {};
  for (const key of Object.keys(shard).sort()) sorted[key] = shard[key];
  writeFileSync(shardFile, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Saved ${shardFile}`);
} else {
  console.log("No changes made.");
}
