/**
 * Example-level proofreading via LLM API.
 *
 * Scans example shards directly for unproofread examples (no duplication).
 * For each example the LLM checks:
 *   1. Is the English translation accurate?
 *   2. Does every gloss_hint correctly identify the sense used in context?
 *
 * Writes results to a JSON file for human review before applying.
 * Apply with: npx tsx scripts/apply-proofread-results.ts --results <file>
 *
 * Defaults to anthropic sonnet-4-6. Use --provider/--model to override.
 *
 * Usage:
 *   npx tsx scripts/proofread-examples.ts                          # all unproofread examples
 *   npx tsx scripts/proofread-examples.ts --word Tisch             # examples owned by Tisch
 *   npx tsx scripts/proofread-examples.ts --word-list words.txt
 *   npx tsx scripts/proofread-examples.ts --top 100 --pos noun     # examples from top 100 nouns by zipf
 *   npx tsx scripts/proofread-examples.ts --limit 500              # cap at 500 examples
 *   npx tsx scripts/proofread-examples.ts --provider ollama        # local, free
 *   npx tsx scripts/proofread-examples.ts --batch-size 5
 *   npx tsx scripts/proofread-examples.ts --dry-run
 *   npx tsx scripts/proofread-examples.ts --out /tmp/results.json
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { LLMProvider, LLMResponse } from "../types/llm.js";
import type { Example, Annotation } from "../types/example.js";
import type { WordBase, Sense } from "../types/word.js";
import {
  callLLM, extractJSON, retryWithBackoff,
  parseProviderArgs, getApiKey, isLocalProvider,
  getDefaultModel, resolveLocalModel, PROVIDER_DEFAULTS,
} from "./lib/llm.js";
import { EXAMPLES_DIR } from "./lib/examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_DONE = !args.includes("--recheck");
const batchIdx = args.indexOf("--batch-size");
const BATCH_SIZE = batchIdx !== -1 ? parseInt(args[batchIdx + 1]) : 10;
const outIdx = args.indexOf("--out");
const OUT_FILE = outIdx !== -1 ? args[outIdx + 1] : join(ROOT, "data", "proofread-results", `examples-${new Date().toISOString().slice(0, 10)}.json`);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : Infinity;

// Word-scope filters
const wordIdx = args.indexOf("--word");
const WORD_FILTER = wordIdx !== -1 ? args[wordIdx + 1] : null;
const wordListIdx = args.indexOf("--word-list");
const WORD_LIST_FILE = wordListIdx !== -1 ? args[wordListIdx + 1] : null;
const topIdx = args.indexOf("--top");
const TOP_N = topIdx !== -1 ? parseInt(args[topIdx + 1]) : 0;
const posIdx = args.indexOf("--pos");
const POS_FILTER = posIdx !== -1 ? args[posIdx + 1] : null;

const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args, "anthropic");
const DEFAULT_MODEL = PROVIDER === "anthropic" ? "claude-sonnet-4-6" : getDefaultModel(PROVIDER);
const RESOLVED_MODEL = MODEL ||
  (isLocalProvider(PROVIDER)
    ? await resolveLocalModel(PROVIDER_DEFAULTS[PROVIDER as keyof typeof PROVIDER_DEFAULTS]?.url ?? "", DEFAULT_MODEL)
    : DEFAULT_MODEL);
const MODEL_LABEL = `${PROVIDER}/${RESOLVED_MODEL}`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SenseInfo {
  gloss_en: string;
  gloss: string;
}

interface VerifyItem {
  id: string;
  text: string;
  translation: string;
  senseContext: SenseContextEntry[];
}

interface SenseContextEntry {
  form: string;
  lemma: string;
  gloss_hint: string | null;
  senses: string;
}

interface VerifyResult {
  id: string;
  translation_ok: boolean;
  translation_issue?: string | null;
  annotation_issues: Array<{ form: string; issue: string }>;
}

interface ProofreadIssue { id: string; type: string; detail: string }

// ── Build senses index from word files ────────────────────────────────────────

process.stdout.write("Loading word files for sense index...");
const sensesIndex = new Map<string, SenseInfo[]>();
let scopeExampleIds: Set<string> | null = null;

interface WordEntry { word: string; pos: string; zipf: number; exampleIds: string[] }
const wordEntries: WordEntry[] = [];

for (const posDir of readdirSync(WORDS_DIR)) {
  if (posDir.startsWith(".")) continue;
  const dir = join(WORDS_DIR, posDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(readFileSync(join(dir, file), "utf-8")) as WordBase;

    const key = data.word.toLowerCase();
    const senses: SenseInfo[] = (data.senses || []).map((s: Sense) => ({
      gloss_en: s.gloss_en || "",
      gloss: s.gloss || "",
    }));
    if (sensesIndex.has(key)) {
      sensesIndex.get(key)!.push(...senses);
    } else {
      sensesIndex.set(key, senses);
    }

    const exIds: string[] = [];
    for (const s of data.senses || []) {
      for (const id of s.example_ids || []) exIds.push(id);
    }
    for (const id of data.expression_ids || []) exIds.push(id);
    wordEntries.push({ word: data.word, pos: data.pos, zipf: data.zipf ?? 0, exampleIds: exIds });
  }
}
console.log(` ${sensesIndex.size} lemmas.`);

// ── Build word-scope filter (optional) ────────────────────────────────────────

if (WORD_FILTER || WORD_LIST_FILE || TOP_N > 0) {
  let matchWords: Set<string>;

  if (WORD_FILTER) {
    matchWords = new Set([WORD_FILTER.toLowerCase()]);
  } else if (WORD_LIST_FILE) {
    const raw = readFileSync(WORD_LIST_FILE, "utf-8").trim();
    const wordList: string[] = raw.startsWith("[")
      ? (JSON.parse(raw) as Array<string | { word: string }>).map((w) => (typeof w === "string" ? w : w.word))
      : raw.split("\n").map((l) => l.trim()).filter(Boolean);
    matchWords = new Set(wordList.map((w) => w.toLowerCase()));
  } else {
    let filtered = POS_FILTER ? wordEntries.filter((w) => w.pos === POS_FILTER) : wordEntries;
    filtered = filtered.sort((a, b) => b.zipf - a.zipf).slice(0, TOP_N);
    matchWords = new Set(filtered.map((w) => w.word.toLowerCase()));
  }

  scopeExampleIds = new Set<string>();
  for (const entry of wordEntries) {
    if (!matchWords.has(entry.word.toLowerCase())) continue;
    if (POS_FILTER && entry.pos !== POS_FILTER) continue;
    for (const id of entry.exampleIds) scopeExampleIds.add(id);
  }
  console.log(`Word scope: ${matchWords.size} words, ${scopeExampleIds.size} example IDs.`);
}

// ── Scan shards for unproofread examples ──────────────────────────────────────

process.stdout.write("Scanning example shards...");

function buildVerifyItem(exId: string, ex: Example): VerifyItem | null {
  if (!ex.translation) return null;

  const annotations: Annotation[] = ex.annotations || [];
  const senseContext: SenseContextEntry[] = [];

  for (const ann of annotations) {
    if (!ann.lemma) continue;
    const senses = sensesIndex.get(ann.lemma.toLowerCase());
    if (!senses || senses.length < 2) continue;
    const senseList = senses
      .map((s, i) => `${i + 1}: ${s.gloss_en || s.gloss}`)
      .join(" | ");
    senseContext.push({
      form: ann.form,
      lemma: ann.lemma,
      gloss_hint: ann.gloss_hint || null,
      senses: senseList,
    });
  }

  return { id: exId, text: ex.text, translation: ex.translation, senseContext };
}

const verifyItems: VerifyItem[] = [];

for (const shardFile of readdirSync(EXAMPLES_DIR).sort()) {
  if (!shardFile.endsWith(".json")) continue;
  if (verifyItems.length >= LIMIT) break;

  const shard = JSON.parse(readFileSync(join(EXAMPLES_DIR, shardFile), "utf-8")) as Record<string, Example>;

  for (const [id, ex] of Object.entries(shard)) {
    if (verifyItems.length >= LIMIT) break;
    if (scopeExampleIds && !scopeExampleIds.has(id)) continue;
    if (SKIP_DONE && ex._proofread?.translation) continue;
    if (ex.type === "expression" || ex.type === "proverb") continue;

    const item = buildVerifyItem(id, ex);
    if (item) verifyItems.push(item);
  }
}

console.log(` ${verifyItems.length} examples to verify.`);

if (verifyItems.length === 0) {
  console.log("Nothing to do. (Use --recheck to re-verify.)");
  process.exit(0);
}

console.log(`\nBatch size ${BATCH_SIZE}, model: ${MODEL_LABEL}\n`);

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are proofreading a German-English dictionary app. For each example sentence you will:
1. Check whether the English translation accurately conveys the German.
2. For each word annotation that includes sense options, check whether the indicated hint (or absence of hint) correctly identifies the sense used in context.

Be strict but fair. Minor stylistic differences are fine; mark translation_ok=false only for genuine mistranslations or missing meaning. Mark an annotation issue only when the wrong sense is clearly indicated or a disambiguation hint is missing for an ambiguous word.`;

function buildPrompt(batch: VerifyItem[]): string {
  const lines: string[] = [
    `Verify ${batch.length} example(s). Reply with a JSON array -- one object per example.\n`,
  ];

  for (let i = 0; i < batch.length; i++) {
    const { id, text, translation, senseContext } = batch[i];
    lines.push(`[${i + 1}] id: ${id}`);
    lines.push(`    German:      ${text}`);
    lines.push(`    Translation: ${translation}`);
    if (senseContext.length > 0) {
      lines.push(`    Annotations to check:`);
      for (const { form, lemma, gloss_hint, senses } of senseContext) {
        const hintNote = gloss_hint ? `hint="${gloss_hint}"` : "no hint";
        lines.push(`      "${form}" (${lemma}) -- ${hintNote} -- senses: [${senses}]`);
      }
    }
    lines.push("");
  }

  lines.push(
    `Reply with:\n` +
    `[\n` +
    `  {"id": "...", "translation_ok": true/false, "translation_issue": null or "brief note", "annotation_issues": []},\n` +
    `  ...\n` +
    `]`,
  );

  return lines.join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    results: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id:                { type: "string" as const },
          translation_ok:    { type: "boolean" as const },
          translation_issue: { type: ["string", "null"] as const },
          annotation_issues: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                form:  { type: "string" as const },
                issue: { type: "string" as const },
              },
              required: ["form", "issue"] as const,
              additionalProperties: false,
            },
          },
        },
        required: ["id", "translation_ok", "annotation_issues"] as const,
        additionalProperties: false,
      },
    },
  },
  required: ["results"] as const,
  additionalProperties: false,
};

// ── Parse LLM response ────────────────────────────────────────────────────────

function parseResponse(content: string, batchIds: Set<string>): VerifyResult[] {
  let raw: unknown = extractJSON(content);
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "results" in raw) {
    raw = (raw as { results: unknown }).results;
  }
  if (!Array.isArray(raw)) throw new Error("Response is not an array");
  const parsed: VerifyResult[] = [];
  for (const item of raw as VerifyResult[]) {
    if (!item.id) throw new Error("Item missing id");
    if (!batchIds.has(item.id)) {
      console.warn(`    Warning: LLM returned unknown id "${item.id}", skipping`);
      continue;
    }
    if (typeof item.translation_ok !== "boolean") item.translation_ok = true;
    if (!Array.isArray(item.annotation_issues)) item.annotation_issues = [];
    parsed.push(item);
  }
  return parsed;
}

// ── Main loop ─────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  const dryBatches: VerifyItem[][] = [];
  for (let i = 0; i < verifyItems.length; i += BATCH_SIZE) {
    dryBatches.push(verifyItems.slice(i, i + BATCH_SIZE));
  }
  console.log(`Dry run: ${verifyItems.length} items -> ${dryBatches.length} batches.`);
  if (dryBatches.length > 0) {
    console.log("\nSample batch 1 prompt:\n");
    console.log(buildPrompt(dryBatches[0]));
  }
  process.exit(0);
}

if (!isLocalProvider(PROVIDER)) {
  const apiKey = getApiKey(PROVIDER);
  if (!apiKey) {
    const keyName = PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    console.error(`No ${keyName} found. Set the env var or use --provider ollama.`);
    process.exit(1);
  }
}

const llmOptions = {
  provider: PROVIDER as LLMProvider,
  model: RESOLVED_MODEL,
  maxTokens: 4096,
  temperature: 0,
  jsonSchema: isLocalProvider(PROVIDER) ? undefined : RESPONSE_SCHEMA,
};

const batches: VerifyItem[][] = [];
for (let i = 0; i < verifyItems.length; i += BATCH_SIZE) {
  batches.push(verifyItems.slice(i, i + BATCH_SIZE));
}

const resultVerified: string[] = [];
const resultTranslationOk: string[] = [];
const resultIssues: ProofreadIssue[] = [];
const missedIds: string[] = [];

let totalVerified = 0;
let totalFlagged = 0;
let totalErrors = 0;

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  const batchIds = new Set(batch.map((item) => item.id));
  const prompt = buildPrompt(batch);

  process.stdout.write(`  Batch ${i + 1}/${batches.length} (${batch.length} examples)... `);

  let results: VerifyResult[];
  try {
    const response: LLMResponse = await retryWithBackoff(
      () => callLLM(SYSTEM_PROMPT, prompt, llmOptions),
      3, 4000,
    );
    results = parseResponse(response.content, batchIds);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAILED: ${message}`);
    totalErrors += batch.length;
    continue;
  }

  const returnedIds = new Set(results.map((r) => r.id));
  for (const id of batchIds) {
    if (!returnedIds.has(id)) missedIds.push(id);
  }

  let batchVerified = 0;
  let batchFlagged = 0;

  for (const result of results) {
    const translationOk = result.translation_ok;
    const annotationsOk = result.annotation_issues.length === 0;

    if (translationOk && annotationsOk) {
      resultVerified.push(result.id);
      batchVerified++;
    } else if (translationOk) {
      resultTranslationOk.push(result.id);
      batchVerified++;
      for (const { form, issue } of result.annotation_issues) {
        resultIssues.push({ id: result.id, type: "annotation", detail: `"${form}": ${issue}` });
      }
      batchFlagged++;
    } else {
      resultIssues.push({
        id: result.id,
        type: "translation",
        detail: result.translation_issue || "(no detail)",
      });
      if (!annotationsOk) {
        for (const { form, issue } of result.annotation_issues) {
          resultIssues.push({ id: result.id, type: "annotation", detail: `"${form}": ${issue}` });
        }
      }
      batchFlagged++;
    }
  }

  totalVerified += batchVerified;
  totalFlagged += batchFlagged;
  const missed = batch.length - returnedIds.size;
  const missedNote = missed > 0 ? `, ${missed} missed` : "";
  console.log(`${batchVerified} verified, ${batchFlagged} flagged${missedNote}`);
}

// ── Write results file ────────────────────────────────────────────────────────

const output = {
  _meta: {
    model: MODEL_LABEL,
    date: new Date().toISOString().slice(0, 10),
    examples_checked: verifyItems.length,
    checks: ["translation", "gloss_hint"],
    ...(missedIds.length > 0 ? { missed: missedIds.length } : {}),
  },
  verified: resultVerified,
  translation_ok: resultTranslationOk,
  issues: resultIssues,
  ...(missedIds.length > 0 ? { missed_ids: missedIds } : {}),
};

writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n");

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`Proofread complete -- ${MODEL_LABEL}`);
console.log("=".repeat(60));
console.log(`  Results written to: ${OUT_FILE}`);
console.log(`  Examples verified (clean):   ${resultVerified.length}`);
console.log(`  Examples translation-only:   ${resultTranslationOk.length}`);
console.log(`  Issues found:                ${resultIssues.length}`);
if (totalErrors > 0) console.log(`  Batches with errors:         ${totalErrors}`);
if (missedIds.length > 0) console.log(`  Missed by LLM (no response): ${missedIds.length}`);

if (resultIssues.length > 0) {
  console.log(`\n  Sample issues (first 20):`);
  for (const { id, type, detail } of resultIssues.slice(0, 20)) {
    console.log(`    [${type}] ${id}`);
    console.log(`      -> ${detail}`);
  }
  if (resultIssues.length > 20) {
    console.log(`    ... and ${resultIssues.length - 20} more`);
  }
}
console.log(`\nTo apply: npx tsx scripts/apply-proofread-results.ts --results ${OUT_FILE}`);
