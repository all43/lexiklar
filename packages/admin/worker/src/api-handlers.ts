import type { DataStore } from "../../server/data-store.js";
import type { Env } from "./index.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface WordListItem {
  pos: string;
  file: string;
  word: string;
  gloss_en?: string;
  zipf?: number;
  flags?: string[];
}

function getWordFlags(data: any): string[] {
  const flags: string[] = [];
  const pr = data._proofread || {};
  if (pr.gloss_en) flags.push("proofread");
  if (data._overrides && Object.keys(data._overrides).length) flags.push("overrides");
  const hasMissing = (data.senses || []).some((s: any) => !s.gloss_en);
  if (hasMissing) flags.push("missing_en");
  if (!pr.gloss_en) flags.push("unproofread");
  if (data._meta?.source === "manual") flags.push("manual");
  return flags;
}

let wordIndexCache: { items: WordListItem[]; ts: number } | null = null;

async function getWordIndex(store: DataStore): Promise<WordListItem[]> {
  if (wordIndexCache && Date.now() - wordIndexCache.ts < 60_000) {
    return wordIndexCache.items;
  }
  const items: WordListItem[] = [];
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    for (const file of files) {
      const word = file.replace(/\.json$/, "");
      const item: WordListItem = { pos: dir, file, word };
      try {
        const data = await store.readWord(dir, word);
        item.gloss_en = data.senses?.[0]?.gloss_en || undefined;
        item.zipf = data.zipf;
        item.flags = getWordFlags(data);
      } catch { /* skip */ }
      items.push(item);
    }
  }
  wordIndexCache = { items, ts: Date.now() };
  return items;
}

export async function handleApiRequest(
  request: Request,
  url: URL,
  store: DataStore,
  env: Env,
): Promise<Response> {
  const path = url.pathname;
  const params = url.searchParams;
  const method = request.method;

  // ── Word list ──
  if (path === "/api/words" && method === "GET") {
    return handleWordList(params, store);
  }

  // ── POS summary ──
  if (path === "/api/pos") {
    return handlePosSummary(store);
  }

  // ── Stats ──
  if (path === "/api/stats") {
    return handleStats(store);
  }

  // ── Search words ──
  if (path === "/api/search-words") {
    return handleSearchWords(params, store);
  }

  // ── Uncommitted words ──
  if (path === "/api/uncommitted-words") {
    return handleUncommittedWords(store);
  }

  // ── Commit words ──
  if (path === "/api/commit-words" && method === "POST") {
    const body = await request.json() as any;
    return handleCommitWords(body, store);
  }

  // ── Proofread stats ──
  if (path === "/api/proofread/stats") {
    return handleProofreadStats(store);
  }

  // ── Proofread word queue ──
  if (path === "/api/proofread/word-queue") {
    return handleWordQueue(params, store);
  }

  // ── Proofread example queue ──
  if (path === "/api/proofread/example-queue") {
    return handleExampleQueue(params, store);
  }

  // ── Example patch ──
  const exPatchMatch = path.match(/^\/api\/proofread\/examples\/([a-f0-9]+)$/);
  if (exPatchMatch && method === "PATCH") {
    const body = await request.json() as any;
    return handleExamplePatch(exPatchMatch[1], body, store);
  }

  // ── Word detail / patch ──
  const wordMatch = path.match(/^\/api\/words\/([^/]+)\/(.+)$/);
  if (wordMatch) {
    const [, pos, file] = wordMatch;
    if (method === "PATCH") {
      const body = await request.json() as any;
      return handleWordPatch(pos, file, body, store);
    }
    return handleWordDetail(pos, file, store);
  }

  // ── Translate ──
  if (path === "/api/translate" && method === "POST") {
    const body = await request.json() as any;
    return handleTranslate(body, env);
  }

  // ── Providers ──
  if (path === "/api/providers") {
    return handleProviders(env);
  }

  // ── Add word (pipeline) ──
  if (path === "/api/add-word" && method === "POST") {
    const body = await request.json() as any;
    return handleAddWord(body, store);
  }

  // ── Topic words (LLM) ──
  if (path === "/api/topic-words" && method === "POST") {
    const body = await request.json() as any;
    return handleTopicWords(body, env);
  }

  // ── Batch add (pipeline) ──
  if (path === "/api/batch-add-words" && method === "POST") {
    const body = await request.json() as any;
    return handleBatchAdd(body, store, env);
  }

  // ── Dev-only endpoints (return 501 in hosted mode) ──
  if (path === "/api/lookup" || path === "/api/wikt-check" || path === "/api/db-search") {
    return json({ error: "Not available in hosted mode. Requires local Wiktionary dump." }, 501);
  }
  if (path === "/api/batch-wikt-check" && method === "POST") {
    return json({ error: "Not available in hosted mode. Requires local Wiktionary dump." }, 501);
  }

  return json({ error: "not found" }, 404);
}

// ── Handler implementations ──

async function handleWordList(params: URLSearchParams, store: DataStore): Promise<Response> {
  const pos = params.get("pos");
  const q = params.get("q")?.toLowerCase() || "";
  const limit = Math.min(parseInt(params.get("limit") || "100"), 500);
  const offset = parseInt(params.get("offset") || "0");
  const filter = params.get("filter");
  const sort = params.get("sort") || "alpha";

  const allItems = await getWordIndex(store);
  let results = allItems;

  if (pos) results = results.filter(i => i.pos === pos);
  if (q) results = results.filter(i => i.word.toLowerCase().includes(q));

  if (filter) {
    const filters = new Set(filter.split(","));
    results = results.filter(i => {
      const flags = i.flags || [];
      for (const f of filters) {
        if (f === "manual") {
          if (!flags.includes("manual")) return false;
        } else if (!flags.includes(f)) return false;
      }
      return true;
    });
  }

  const qLow = q.toLowerCase();
  results = [...results].sort((a, b) => {
    if (q) {
      const tier = (w: string) => {
        const wl = w.toLowerCase();
        if (wl === qLow) return 0;
        if (wl.startsWith(qLow)) return 1;
        return 2;
      };
      const tierDiff = tier(a.word) - tier(b.word);
      if (tierDiff !== 0) return tierDiff;
    }
    if (sort === "zipf") return (b.zipf ?? 0) - (a.zipf ?? 0);
    if (sort === "zipf-asc") return (a.zipf ?? 0) - (b.zipf ?? 0);
    return a.word.localeCompare(b.word, "de");
  });

  const page = results.slice(offset, offset + limit);
  return json({ total: results.length, offset, items: page });
}

async function handlePosSummary(store: DataStore): Promise<Response> {
  const counts: { pos: string; count: number }[] = [];
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    counts.push({ pos: dir, count: files.length });
  }
  return json(counts);
}

async function handleStats(store: DataStore): Promise<Response> {
  const stats = {
    total: 0, proofread_gloss: 0, proofread_full: 0, proofread_syn: 0,
    has_overrides: 0, missing_gloss_en: 0, total_examples: 0,
    by_pos: {} as Record<string, number>,
  };

  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    let posCount = 0;
    for (const file of files) {
      posCount++;
      stats.total++;
      try {
        const data = await store.readWord(dir, file.replace(/\.json$/, ""));
        const pr = data._proofread || {};
        if (pr.gloss_en) stats.proofread_gloss++;
        if (pr.gloss_en_full) stats.proofread_full++;
        if (pr.synonyms_en) stats.proofread_syn++;
        if (data._overrides && Object.keys(data._overrides).length) stats.has_overrides++;
        for (const s of data.senses || []) {
          stats.total_examples += (s.example_ids || []).length;
          if (!s.gloss_en) { stats.missing_gloss_en++; break; }
        }
      } catch { /* skip */ }
    }
    stats.by_pos[dir] = posCount;
  }

  return json(stats);
}

async function handleWordDetail(pos: string, file: string, store: DataStore): Promise<Response> {
  const lemma = file.endsWith(".json") ? file.replace(/\.json$/, "") : file;
  if (!(await store.wordExists(pos, lemma))) return json({ error: "not found" }, 404);

  const word = await store.readWord(pos, lemma);

  const exampleIds: string[] = [];
  for (const sense of word.senses || []) {
    for (const id of sense.example_ids || []) exampleIds.push(id);
  }

  const examples: Record<string, unknown> = {};
  const prefixes = new Set(exampleIds.map((id: string) => id.slice(0, 2)));
  for (const prefix of prefixes) {
    const shard = await store.readExampleShard(prefix);
    for (const id of exampleIds) {
      if (shard[id]) examples[id] = shard[id];
    }
  }

  let exProofread = 0;
  let exTotal = 0;
  for (const ex of Object.values(examples) as any[]) {
    if (ex.translation) {
      exTotal++;
      if (ex._proofread?.translation) exProofread++;
    }
  }

  return json({ word, examples, exampleStats: { total: exTotal, proofread: exProofread, unproofread: exTotal - exProofread } });
}

async function handleWordPatch(pos: string, file: string, body: any, store: DataStore): Promise<Response> {
  const lemma = file.endsWith(".json") ? file.replace(/\.json$/, "") : file;
  if (!(await store.wordExists(pos, lemma))) return json({ error: "not found" }, 404);

  const word = await store.readWord(pos, lemma);

  if (body.senses && Array.isArray(body.senses)) {
    for (const patch of body.senses) {
      const idx = patch.index;
      if (typeof idx !== "number" || !word.senses?.[idx]) continue;
      const sense = word.senses[idx];
      if ("gloss_en" in patch) sense.gloss_en = patch.gloss_en || null;
      if ("gloss_en_full" in patch) sense.gloss_en_full = patch.gloss_en_full || null;
      if ("synonyms_en" in patch) {
        sense.synonyms_en = Array.isArray(patch.synonyms_en)
          ? patch.synonyms_en.filter((s: string) => s)
          : null;
      }
    }
  }

  if ("_proofread" in body && typeof body._proofread === "object") {
    const merged = { ...(word._proofread || {}), ...body._proofread };
    for (const k of Object.keys(merged)) { if (!merged[k]) delete merged[k]; }
    if (Object.keys(merged).length) word._proofread = merged;
    else delete word._proofread;
  }

  if ("_overrides" in body && typeof body._overrides === "object") {
    if (Object.keys(body._overrides).length) word._overrides = body._overrides;
    else delete word._overrides;
  }

  await store.writeWord(pos, lemma, word);
  wordIndexCache = null;
  return json({ ok: true });
}

async function handleSearchWords(params: URLSearchParams, store: DataStore): Promise<Response> {
  const q = params.get("q")?.toLowerCase() || "";
  const limit = Math.min(parseInt(params.get("limit") || "20"), 50);
  if (!q || q.length < 2) return json([]);

  const allItems = await getWordIndex(store);
  const results: { pos: string; word: string; gloss_en?: string }[] = [];
  for (const item of allItems) {
    if (item.word.toLowerCase().includes(q)) {
      results.push({ pos: item.pos, word: item.word, gloss_en: item.gloss_en });
      if (results.length >= limit) break;
    }
  }
  return json(results);
}

async function handleUncommittedWords(store: DataStore): Promise<Response> {
  try {
    const status = await store.getStatus(["data/words/", "config/word-whitelist.json"]);
    const words: { word: string; file: string }[] = [];
    for (const line of status.split("\n")) {
      const match = line.match(/^\s*[AM?]+\s+data\/words\/([^/]+\/(.+))\.json$/);
      if (match) words.push({ word: match[2], file: match[1] });
    }
    const whitelistDirty = status.includes("word-whitelist.json");
    return json({ words, whitelistDirty });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleCommitWords(body: any, store: DataStore): Promise<Response> {
  let words: string[] = Array.isArray(body.words) ? body.words : [];
  const topic: string = body.topic || "topic explorer";

  try {
    if (!words.length) {
      const status = await store.getStatus(["data/words/"]);
      for (const line of status.split("\n")) {
        const match = line.match(/^\s*[AM?]+\s+data\/words\/[^/]+\/(.+)\.json$/);
        if (match) words.push(match[1]);
      }
    }
    if (!words.length) return json({ error: "no changes to commit" }, 400);

    const filesToAdd = ["config/word-whitelist.json"];
    for (const word of words) filesToAdd.push(`data/words/*/${word}.json`);
    filesToAdd.push("data/examples/*.json");

    const msg = `feat(data): add ${words.length} words from topic "${topic}"`;
    const { hash } = await store.addAndCommit(filesToAdd, msg);
    return json({ ok: true, commit: hash, message: msg });
  } catch (err: any) {
    return json({ error: err.message || "commit failed" }, 500);
  }
}

async function handleExamplePatch(exId: string, body: any, store: DataStore): Promise<Response> {
  const prefix = exId.slice(0, 2);
  const shard = await store.readExampleShard(prefix);
  if (!shard[exId]) return json({ error: "Example not found" }, 404);

  const ex = shard[exId];

  if (body.action === "verify") {
    ex._proofread = { ...(ex._proofread || {}), translation: true };
  } else if (body.action === "flag") {
    ex._flagged = { date: new Date().toISOString(), reason: body.reason || null };
  } else if (body.action === "unflag") {
    delete ex._flagged;
  } else if (body.action === "update") {
    if (typeof body.translation === "string") ex.translation = body.translation;
    if (Array.isArray(body.annotations)) ex.annotations = body.annotations;
    ex._proofread = { ...(ex._proofread || {}), translation: true };
    delete ex._flagged;
  } else {
    return json({ error: "Unsupported action" }, 400);
  }

  await store.writeExampleShard(prefix, shard);
  return json({ ok: true });
}

async function handleProofreadStats(store: DataStore): Promise<Response> {
  const wordIdx = await getWordIndex(store);
  const proofreadGloss = wordIdx.filter(w => w.flags?.includes("proofread")).length;
  const unproofreadGloss = wordIdx.filter(w => w.flags?.includes("unproofread")).length;

  return json({
    words: { total: wordIdx.length, proofread_gloss: proofreadGloss, unproofread_gloss: unproofreadGloss },
  });
}

async function handleWordQueue(params: URLSearchParams, store: DataStore): Promise<Response> {
  const limit = Math.min(parseInt(params.get("limit") || "50"), 200);
  const offset = parseInt(params.get("offset") || "0");
  const posParam = params.get("pos") || null;
  const posSet = posParam ? new Set(posParam.split(",").map(s => s.trim()).filter(Boolean)) : null;
  const wordFilter = params.get("word")?.toLowerCase() || null;
  const filter = params.get("filter") || null;

  const allItems = await getWordIndex(store);
  let items = allItems.map(i => ({
    word: i.word,
    pos: i.pos,
    zipf: i.zipf ?? 0,
    gloss_en: i.gloss_en || null,
    proofreadGloss: i.flags?.includes("proofread") ?? false,
  }));

  if (posSet) items = items.filter(i => posSet.has(i.pos));
  if (wordFilter) items = items.filter(i => i.word.toLowerCase().includes(wordFilter));
  if (filter === "unproofread_gloss") items = items.filter(i => !i.proofreadGloss);

  items.sort((a, b) => b.zipf - a.zipf);
  const page = items.slice(offset, offset + limit);
  return json({ total: items.length, offset, items: page });
}

async function handleExampleQueue(params: URLSearchParams, store: DataStore): Promise<Response> {
  // Simplified version for hosted mode — returns unproofread examples sorted by owner zipf
  const limit = Math.min(parseInt(params.get("limit") || "20"), 100);
  const offset = parseInt(params.get("offset") || "0");
  const posParam = params.get("pos") || null;
  const posSet = posParam ? new Set(posParam.split(",").map(s => s.trim()).filter(Boolean)) : null;
  const wordFilter = params.get("word")?.toLowerCase() || null;

  // Build owner map
  const ownerMap = new Map<string, { word: string; pos: string; zipf: number }>();
  for (const dir of store.listPosDirs()) {
    const files = await store.listWordFiles(dir);
    for (const file of files) {
      try {
        const data = await store.readWord(dir, file.replace(/\.json$/, ""));
        const zipf = (data.zipf as number) ?? 0;
        for (const s of data.senses || []) {
          for (const id of s.example_ids || []) {
            if (!ownerMap.has(id)) ownerMap.set(id, { word: data.word, pos: dir, zipf });
          }
        }
      } catch { /* skip */ }
    }
  }

  const items: any[] = [];
  const shardFiles = await store.listExampleShards();
  for (const shardFile of shardFiles) {
    const prefix = shardFile.replace(/\.json$/, "");
    let shard: Record<string, any>;
    try { shard = await store.readExampleShard(prefix); }
    catch { continue; }

    for (const [id, ex] of Object.entries(shard)) {
      if (!ex.translation || ex._proofread?.translation) continue;
      if (ex.type === "expression" || ex.type === "proverb") continue;
      const owner = ownerMap.get(id);
      if (!owner) continue;

      if (posSet && !posSet.has(owner.pos)) continue;
      if (wordFilter && !owner.word.toLowerCase().includes(wordFilter)) continue;

      items.push({ id, text: ex.text, translation: ex.translation, owner });
    }
  }

  items.sort((a, b) => b.owner.zipf - a.owner.zipf);
  const page = items.slice(offset, offset + limit);
  return json({ total: items.length, offset, items: page });
}

async function handleTranslate(body: any, env: Env): Promise<Response> {
  const { word, gloss, mode, provider } = body;
  if (!word || !gloss) return json({ error: "Missing word or gloss" }, 400);

  const apiKey = provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: `API key not configured for ${provider || "anthropic"}` }, 500);

  // Simplified LLM call for hosted mode
  const isFull = mode === "full";
  const userMessage = `Translate this German word/phrase to English (${isFull ? "natural explanation" : "concise, 1-3 words"}): "${word}" (meaning: "${gloss}")`;

  try {
    let translation: string;
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: userMessage }],
          max_tokens: isFull ? 200 : 64,
          temperature: 0.2,
        }),
      });
      const data = await res.json() as any;
      translation = data.choices?.[0]?.message?.content?.trim() || "";
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: isFull ? 200 : 64,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      const data = await res.json() as any;
      translation = data.content?.[0]?.text?.trim() || "";
    }
    return json({ translation });
  } catch (err: any) {
    return json({ error: err.message || "LLM call failed" }, 500);
  }
}

function handleProviders(env: Env): Response {
  return json([
    { name: "anthropic", model: "claude-haiku-4-5-20251001", hasKey: !!env.ANTHROPIC_API_KEY },
    { name: "openai", model: "gpt-4o-mini", hasKey: !!env.OPENAI_API_KEY },
  ]);
}

async function handleAddWord(body: any, store: DataStore): Promise<Response> {
  const word = typeof body.word === "string" ? body.word.trim() : "";
  if (!word) return json({ error: "missing word" }, 400);

  let whitelisted = false;
  try {
    const wl = await store.readWhitelist();
    const alreadyListed = wl.words.some((e: any) => e.word === word);
    if (!alreadyListed) {
      wl.words.push({ word, domain: "user-reported", reason: "added via admin" });
      await store.writeWhitelist(wl);
      whitelisted = true;
    }
  } catch (err: any) {
    return json({ error: `Failed to update whitelist: ${err.message}` }, 500);
  }

  try {
    await store.runPipeline([
      { script: "transform", args: ["--words", word] },
      { script: "enrich-frequency", args: ["--words", word] },
    ]);
  } catch (err: any) {
    return json({ error: err.message || "Pipeline failed" }, 500);
  }

  wordIndexCache = null;
  return json({ ok: true, whitelisted });
}

async function handleTopicWords(body: any, env: Env): Promise<Response> {
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return json({ error: "missing topic" }, 400);

  const count = body.count || 40;
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: "OpenAI API key not configured" }, 500);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Generate German vocabulary words for the given topic. Return JSON: { \"words\": [{ \"word\": \"...\", \"pos\": \"noun|verb|adjective|adverb\", \"gender\": \"m|f|n|null\" }] }" },
          { role: "user", content: `Topic: "${topic}". Generate approximately ${count} words.` },
        ],
        max_tokens: 2048,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return json({ words: parsed.words ?? [] });
  } catch (err: any) {
    return json({ error: err.message || "LLM call failed" }, 500);
  }
}

async function handleBatchAdd(body: any, store: DataStore, env: Env): Promise<Response> {
  const entries: { word: string; domain?: string; reason?: string }[] = Array.isArray(body.words) ? body.words : [];
  if (!entries.length) return json({ error: "No words provided" }, 400);

  const provider = body.provider || "openai";

  try {
    // 1. Whitelist
    const wl = await store.readWhitelist();
    const existing = new Set(wl.words.map((e: any) => e.word));
    for (const entry of entries) {
      if (!existing.has(entry.word)) {
        wl.words.push({ word: entry.word, domain: entry.domain || "topic-explorer", reason: entry.reason || "added via topic explorer" });
      }
    }
    await store.writeWhitelist(wl);

    // 2. Run pipeline via GitHub Actions
    const wordList = entries.map(e => e.word).join(",");
    await store.runPipeline([
      { script: "transform", args: ["--words", wordList], timeoutMs: 180_000 },
      { script: "enrich-frequency", args: ["--words", wordList], timeoutMs: 180_000 },
      { script: "translate-glosses", args: ["--words", wordList, "--provider", provider], timeoutMs: 180_000 },
    ]);

    wordIndexCache = null;
    return json({ ok: true, added: entries.length });
  } catch (err: any) {
    return json({ error: err.message || "Batch add failed" }, 500);
  }
}
