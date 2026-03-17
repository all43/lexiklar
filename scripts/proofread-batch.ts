/**
 * Model-based proofreading for example translations and word-sense annotations.
 *
 * For each example the LLM checks:
 *   1. Is the English translation accurate?
 *   2. Does every gloss_hint correctly identify the sense used in context?
 *      (the model sees the sentence, the translation, and all available senses)
 *
 * Only marks _proofread flags for content the model confirms correct.
 * Issues (wrong translations, bad hints) are logged but not auto-fixed here.
 *
 * NEVER calls expensive models — no sonnet, no opus, no gpt-4.
 * Defaults to anthropic haiku-4.5 (cheap). Prefers local if --provider ollama|lm-studio.
 *
 * Usage:
 *   node scripts/proofread-batch.js                          # top 100 words, haiku
 *   node scripts/proofread-batch.js --top 500
 *   node scripts/proofread-batch.js --provider ollama        # local, free
 *   node scripts/proofread-batch.js --provider openai --model gpt-4.1-mini
 *   node scripts/proofread-batch.js --word Tisch
 *   node scripts/proofread-batch.js --word-list words.txt
 *   node scripts/proofread-batch.js --dry-run                # show batches, no API calls
 *   node scripts/proofread-batch.js --pos noun
 *   node scripts/proofread-batch.js --batch-size 5
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
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
import { loadExamplesByIds, annotationsHash, patchExamples } from "./lib/examples.js";
import type { ExamplePatch } from "./lib/examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");
const WHITELIST_FILE = join(ROOT, "config", "word-whitelist.json");

// ── Guard: never call expensive models ───────────────────────────────────────

const FORBIDDEN_MODELS = ["sonnet", "opus", "gpt-4.1", "gpt-4o", "gpt-4-"];
function assertCheapModel(provider: string, model: string): void {
  const label = `${provider}/${model}`.toLowerCase();
  for (const forbidden of FORBIDDEN_MODELS) {
    if (label.includes(forbidden)) {
      console.error(`ERROR: Model "${label}" is too expensive for proofreading. Use haiku, gpt-4.1-mini, gpt-4.1-nano, or a local model.`);
      process.exit(1);
    }
  }
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const topIdx = args.indexOf("--top");
const TOP_N = topIdx !== -1 ? parseInt(args[topIdx + 1]) : 100;
const DRY_RUN = args.includes("--dry-run");
const WHITELIST_ONLY = args.includes("--whitelist-only");
const posIdx = args.indexOf("--pos");
const POS_FILTER = posIdx !== -1 ? args[posIdx + 1] : null;
const wordIdx = args.indexOf("--word");
const WORD_FILTER = wordIdx !== -1 ? args[wordIdx + 1] : null;
const wordListIdx = args.indexOf("--word-list");
const WORD_LIST_FILE = wordListIdx !== -1 ? args[wordListIdx + 1] : null;
const batchIdx = args.indexOf("--batch-size");
const BATCH_SIZE = batchIdx !== -1 ? parseInt(args[batchIdx + 1]) : 10;
const SKIP_DONE = !args.includes("--recheck"); // skip already-proofread examples

const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args, "anthropic");
const RESOLVED_MODEL = MODEL ||
  (isLocalProvider(PROVIDER)
    ? await resolveLocalModel(PROVIDER_DEFAULTS[PROVIDER as keyof typeof PROVIDER_DEFAULTS]?.url ?? "", getDefaultModel(PROVIDER))
    : getDefaultModel(PROVIDER));
const MODEL_LABEL = `${PROVIDER}/${RESOLVED_MODEL}`;

if (!DRY_RUN) assertCheapModel(PROVIDER, RESOLVED_MODEL);

// ── Types ─────────────────────────────────────────────────────────────────────

interface WordFileEntry {
  file: string;
  relPath: string;
  data: WordBase;
  dir: string;
}

interface SenseInfo {
  gloss: string;
  gloss_en: string;
}

interface WhitelistEntry {
  word: string;
}

interface WhitelistFile {
  words: WhitelistEntry[];
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

interface FoundIssue {
  id: string;
  text: string;
  issue_type: string;
  detail: string;
}

// ── Load word files ───────────────────────────────────────────────────────────

process.stdout.write("Loading word files...");
const allWords: WordFileEntry[] = [];
// lemma (lowercase) → array of sense objects [{gloss, gloss_en}]
const sensesIndex = new Map<string, SenseInfo[]>();

for (const posDir of readdirSync(WORDS_DIR)) {
  if (posDir.startsWith(".")) continue;
  const dir = join(WORDS_DIR, posDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const relPath = `${posDir}/${file.replace(".json", "")}`;
    const data = JSON.parse(readFileSync(join(dir, file), "utf-8")) as WordBase;
    allWords.push({ file, relPath, data, dir });

    // Build senses index for annotation context
    const key = data.word.toLowerCase();
    const senses: SenseInfo[] = (data.senses || []).map((s: Sense) => ({
      gloss: s.gloss || "",
      gloss_en: s.gloss_en || "",
    }));
    if (sensesIndex.has(key)) {
      sensesIndex.get(key)!.push(...senses);
    } else {
      sensesIndex.set(key, senses);
    }
  }
}
console.log(` ${allWords.length} files.`);

// ── Select targets ────────────────────────────────────────────────────────────

let targets: WordFileEntry[];
if (WORD_FILTER) {
  targets = allWords.filter((w) => w.data.word.toLowerCase() === WORD_FILTER.toLowerCase());
  if (!targets.length) { console.error(`Word "${WORD_FILTER}" not found.`); process.exit(1); }
} else if (WORD_LIST_FILE) {
  const raw = readFileSync(WORD_LIST_FILE, "utf-8").trim();
  const wordList: string[] = raw.startsWith("[")
    ? (JSON.parse(raw) as Array<string | { word: string }>).map((w) => (typeof w === "string" ? w : w.word))
    : raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const wordSet = new Set(wordList.map((w) => w.toLowerCase()));
  targets = allWords.filter((w) => wordSet.has(w.data.word.toLowerCase()));
} else {
  const whitelistData = JSON.parse(readFileSync(WHITELIST_FILE, "utf-8")) as WhitelistFile;
  const whitelistWords = new Set(
    whitelistData.words.map((e) => e.word.toLowerCase()),
  );
  const byZipf = [...allWords].sort((a, b) => (b.data.zipf ?? 0) - (a.data.zipf ?? 0));
  const topSet = new Set(byZipf.slice(0, TOP_N).map((w) => w.data.word.toLowerCase()));
  targets = WHITELIST_ONLY
    ? allWords.filter((w) => whitelistWords.has(w.data.word.toLowerCase()))
    : allWords.filter((w) => whitelistWords.has(w.data.word.toLowerCase()) || topSet.has(w.data.word.toLowerCase()));
  if (POS_FILTER) targets = targets.filter((w) => w.data.pos === POS_FILTER);
}

console.log(`Targets: ${targets.length} words.`);

// ── Load examples ─────────────────────────────────────────────────────────────

const ownedIdsByWord = new Map<string, Set<string>>(); // word → Set<exampleId>
const allExampleIds = new Set<string>();

for (const { data } of targets) {
  const ids = new Set<string>();
  for (const sense of data.senses || []) {
    for (const id of sense.example_ids || []) { ids.add(id); allExampleIds.add(id); }
  }
  for (const id of data.expression_ids || []) { ids.add(id); allExampleIds.add(id); }
  ownedIdsByWord.set(data.word, ids);
}

const examplesById: Record<string, Example> = allExampleIds.size > 0
  ? loadExamplesByIds([...allExampleIds])
  : {};
console.log(`Loaded ${Object.keys(examplesById).length} examples.\n`);

// ── Build verification items ──────────────────────────────────────────────────

/**
 * For a single example, build the context needed for LLM verification:
 *   - German text + English translation
 *   - For each annotation with gloss_hint (or word with 2+ senses), include sense list
 */
function buildVerifyItem(exId: string, ex: Example): VerifyItem | null {
  if (!ex.translation) return null; // can't verify untranslated examples

  const annotations: Annotation[] = ex.annotations || [];

  // Collect sense context for annotated words that have multiple senses
  // (only these are worth checking — single-sense words can't be misidentified)
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

// Gather all items that need verification
const verifyItems: VerifyItem[] = [];
for (const { data } of targets) {
  const ids = ownedIdsByWord.get(data.word) || new Set<string>();
  for (const id of ids) {
    const ex = examplesById[id];
    if (!ex) continue;
    if (SKIP_DONE && ex._proofread?.translation && ex._proofread?.annotations) continue;
    // Skip expressions/proverbs — no annotations to check, translation is human-idiomatic
    if (ex.type === "expression" || ex.type === "proverb") continue;
    const item = buildVerifyItem(id, ex);
    if (item) verifyItems.push(item);
  }
}

if (verifyItems.length === 0) {
  console.log("All examples already proofread. Nothing to do. (Use --recheck to re-verify.)");
  process.exit(0);
}

console.log(`Examples to verify: ${verifyItems.length} (batch size ${BATCH_SIZE}, model: ${MODEL_LABEL})\n`);

// ── Prompts ───────────────────────────────────────────────────────────────────

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

function parseResponse(content: string): VerifyResult[] {
  let raw: unknown = extractJSON(content);
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "results" in raw) {
    raw = (raw as { results: unknown }).results;
  }
  if (!Array.isArray(raw)) throw new Error("Response is not an array");
  const parsed = raw as VerifyResult[];
  for (const item of parsed) {
    if (!item.id) throw new Error("Item missing id");
    if (typeof item.translation_ok !== "boolean") item.translation_ok = true;
    if (!Array.isArray(item.annotation_issues)) item.annotation_issues = [];
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

// Check API key
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

// Accumulate patches to apply at the end
const examplePatches: Record<string, ExamplePatch> = {}; // id → { _proofread: {...} }
const issuesFound: FoundIssue[] = []; // { id, text, issue_type, detail }

let verified = 0;
let flagged = 0;
let errors = 0;

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  const prompt = buildPrompt(batch);

  process.stdout.write(`  Batch ${i + 1}/${batches.length} (${batch.length} examples)... `);

  let results: VerifyResult[];
  try {
    const response: LLMResponse = await retryWithBackoff(
      () => callLLM(SYSTEM_PROMPT, prompt, llmOptions),
      3, 4000,
    );
    results = parseResponse(response.content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAILED: ${message}`);
    errors += batch.length;
    continue;
  }

  let batchVerified = 0;
  let batchFlagged = 0;

  for (const result of results) {
    const ex = examplesById[result.id];
    if (!ex) continue;

    const pr: Record<string, unknown> = {};

    if (result.translation_ok) {
      pr.translation = true;
    } else {
      batchFlagged++;
      issuesFound.push({
        id: result.id,
        text: ex.text,
        issue_type: "translation",
        detail: result.translation_issue || "(no detail)",
      });
    }

    if (result.annotation_issues.length === 0) {
      if (ex.annotations) pr.annotations = annotationsHash(ex.annotations);
    } else {
      batchFlagged++;
      for (const { form, issue } of result.annotation_issues) {
        issuesFound.push({
          id: result.id,
          text: ex.text,
          issue_type: "annotation",
          detail: `"${form}": ${issue}`,
        });
      }
    }

    if (Object.keys(pr).length > 0) {
      examplePatches[result.id] = { _proofread: pr };
      batchVerified++;
    }
  }

  verified += batchVerified;
  flagged += batchFlagged;
  console.log(`${batchVerified} verified, ${batchFlagged} flagged`);
}

// Write all patches at once
if (Object.keys(examplePatches).length > 0) {
  patchExamples(examplePatches);
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`Proofread complete -- ${MODEL_LABEL}`);
console.log("=".repeat(60));
console.log(`  Examples verified (clean):   ${verified}`);
console.log(`  Examples flagged (issues):   ${flagged}`);
if (errors > 0) console.log(`  Batches with errors:         ${errors}`);

if (issuesFound.length > 0) {
  console.log(`\n  Issues found (${issuesFound.length}):`);
  for (const { id, text, issue_type, detail } of issuesFound.slice(0, 20)) {
    console.log(`    [${issue_type}] ${id}  "${text.slice(0, 60)}"`);
    console.log(`      -> ${detail}`);
  }
  if (issuesFound.length > 20) {
    console.log(`    ... and ${issuesFound.length - 20} more`);
  }
}
console.log();
