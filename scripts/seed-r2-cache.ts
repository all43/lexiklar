/**
 * Seed the R2 admin cache with word files, example shards, and config.
 *
 * Usage:
 *   npx tsx scripts/seed-r2-cache.ts --bucket lexiklar-admin
 *
 * Requires: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars,
 * or run via `npx wrangler r2 object put` (this script uses the R2 API directly).
 *
 * This is a one-time setup script. After initial seed, the GitHub webhook
 * keeps R2 in sync incrementally.
 */

import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { stringArg } from "./lib/cli.js";

const args = process.argv.slice(2);
const BUCKET = stringArg(args, "--bucket") || "lexiklar-admin";
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars");
  process.exit(1);
}

const ROOT = resolve(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");
const EXAMPLES_DIR = join(ROOT, "data", "examples");

const POS_DIRS = [
  "abbreviations", "adjectives", "adverbs", "conjunctions", "determiners",
  "interjections", "names", "nouns", "numerals", "particles", "phrases",
  "postpositions", "prepositions", "pronouns", "verbs",
];

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects`;

async function putObject(key: string, body: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body,
  });
  return res.ok;
}

async function main() {
  let uploaded = 0;
  let errors = 0;

  // Upload word files
  for (const pos of POS_DIRS) {
    const dirPath = join(WORDS_DIR, pos);
    const files = readdirSync(dirPath).filter(f => f.endsWith(".json"));
    const index: string[] = [];

    console.log(`Uploading ${pos}/ (${files.length} files)...`);
    for (const file of files) {
      const content = readFileSync(join(dirPath, file), "utf-8");
      const key = `words/${pos}/${file}`;
      if (await putObject(key, content)) {
        uploaded++;
        index.push(file);
      } else {
        errors++;
        console.error(`  Failed: ${key}`);
      }
    }

    // Upload directory index
    await putObject(`_index/words/${pos}.json`, JSON.stringify(index));
  }

  // Upload example shards
  const shardFiles = readdirSync(EXAMPLES_DIR).filter(f => f.endsWith(".json")).sort();
  console.log(`Uploading examples/ (${shardFiles.length} shards)...`);
  for (const file of shardFiles) {
    const content = readFileSync(join(EXAMPLES_DIR, file), "utf-8");
    const key = `examples/${file}`;
    if (await putObject(key, content)) {
      uploaded++;
    } else {
      errors++;
      console.error(`  Failed: ${key}`);
    }
  }
  await putObject("_index/examples.json", JSON.stringify(shardFiles));

  // Upload config
  const whitelistContent = readFileSync(join(ROOT, "config", "word-whitelist.json"), "utf-8");
  if (await putObject("config/word-whitelist.json", whitelistContent)) {
    uploaded++;
  }

  // Upload verb endings
  const verbEndingsPath = join(ROOT, "data", "rules", "verb-endings.json");
  const verbEndingsContent = readFileSync(verbEndingsPath, "utf-8");
  if (await putObject("rules/verb-endings.json", verbEndingsContent)) {
    uploaded++;
  }

  console.log(`\nDone. Uploaded: ${uploaded}, Errors: ${errors}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
