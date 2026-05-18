<template>
  <div class="topic-explorer">
    <h1>Topic Explorer</h1>

    <!-- Mode toggle + input -->
    <div class="input-section">
      <div class="mode-toggle">
        <button :class="{ active: mode === 'topic' }" @click="mode = 'topic'">Topic &rarr; Words</button>
        <button :class="{ active: mode === 'word' }" @click="mode = 'word'">Word &rarr; Topics</button>
      </div>

      <div class="input-row">
        <input
          v-model="query"
          class="query-input"
          :placeholder="mode === 'topic' ? 'Enter a topic (e.g. cooking, transportation)' : 'Enter a German word'"
          @keydown.enter="generate"
        />
        <select v-model="provider" class="provider-select">
          <option v-for="p in providers" :key="p.name" :value="p.name" :disabled="!p.hasKey">
            {{ p.name }} ({{ p.model }}){{ !p.hasKey ? ' — no key' : '' }}
          </option>
        </select>
        <button class="btn-generate" @click="generate" :disabled="generating || !query.trim()">
          {{ generating ? 'Generating…' : 'Generate' }}
        </button>
      </div>
      <div v-if="generateError" class="error-msg">{{ generateError }}</div>
    </div>

    <!-- Batch add progress (above table so it's visible without scrolling) -->
    <div v-if="batchRunning || batchDone" class="progress-section">
      <h3>{{ batchDone ? 'Batch add complete' : 'Adding words…' }}</h3>
      <div class="progress-stages">
        <div v-for="s in stages" :key="s.id" class="stage" :class="stageClass(s)">
          <span class="stage-icon">
            <template v-if="s.status === 'done'">&#10003;</template>
            <template v-else-if="s.status === 'running'"><span class="spinner spinner--sm"></span></template>
            <template v-else>&#8226;</template>
          </span>
          {{ s.label }}
        </div>
      </div>
      <div v-if="batchDone && batchResult" class="batch-result">
        <div v-if="batchResult.added.length">
          Added {{ batchResult.added.length }} words:
          <span v-for="w in batchResult.added" :key="w.word" class="added-word">
            <router-link :to="'/words?select=' + w.file">{{ w.word }}</router-link>
          </span>
        </div>
        <div v-if="batchResult.failed.length" class="batch-failed">
          Failed: {{ batchResult.failed.map(w => w.word).join(', ') }}
        </div>
      </div>
      <div v-if="batchError" class="error-msg">{{ batchError }}</div>
    </div>

    <!-- Topic → Words results -->
    <div v-if="mode === 'topic' && wordResults.length > 0" class="results-section">
      <div class="results-header">
        <div class="results-stats">
          {{ wordResults.length }} words generated
          <template v-if="checkDone">
            — {{ statusCounts['in-app'] }} in app, {{ statusCounts['in-wiktionary'] }} addable, {{ statusCounts['not-found'] }} not found
          </template>
        </div>
        <div class="results-actions">
          <label class="select-all-label">
            <input type="checkbox" :checked="allAddableSelected" @change="toggleSelectAll" :disabled="addableCount === 0" />
            Select all addable ({{ addableCount }})
          </label>
          <button class="btn-batch-add" @click="batchAdd" :disabled="selectedCount === 0 || batchRunning">
            {{ batchRunning ? 'Adding…' : `Add selected (${selectedCount})` }}
          </button>
        </div>
      </div>

      <table class="results-table">
        <thead>
          <tr>
            <th class="col-check"></th>
            <th class="col-word">Word</th>
            <th class="col-pos">POS</th>
            <th class="col-gender">Gender</th>
            <th class="col-gloss">English</th>
            <th class="col-status">Status</th>
            <th class="col-zipf">Zipf</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in sortedResults" :key="row.word + idx" :class="rowClass(row)">
            <td class="col-check">
              <input
                v-if="row.status === 'in-wiktionary'"
                type="checkbox"
                v-model="row.selected"
              />
            </td>
            <td class="col-word">{{ row.word }}</td>
            <td class="col-pos">{{ row.pos }}</td>
            <td class="col-gender">{{ row.gender || '' }}</td>
            <td class="col-gloss">{{ row.gloss_en }}</td>
            <td class="col-status">
              <span v-if="row.status === 'in-app'" class="status-badge status-in-app">In app</span>
              <span v-else-if="row.status === 'in-wiktionary'" class="status-badge status-in-wikt">In Wiktionary</span>
              <span v-else-if="row.status === 'not-found'" class="status-badge status-not-found">Not found</span>
              <span v-else class="spinner spinner--sm"></span>
            </td>
            <td class="col-zipf">{{ row.zipf != null ? row.zipf.toFixed(2) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Word → Topics results -->
    <div v-if="mode === 'word' && topicResults.length > 0" class="topics-section">
      <h2>Suggested topics for "{{ lastWordQuery }}"</h2>
      <div class="topic-chips">
        <button
          v-for="t in topicResults"
          :key="t"
          class="topic-chip"
          @click="exploreTopic(t)"
        >{{ t }}</button>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";

interface LLMWord {
  word: string;
  pos: string;
  gender: string | null;
  gloss_en: string;
}

interface WordRow extends LLMWord {
  status: "in-app" | "in-wiktionary" | "not-found" | "checking";
  zipf: number | null;
  file?: string;
  selected: boolean;
}

interface Provider {
  name: string;
  model: string;
  hasKey: boolean;
}

interface BatchResult {
  added: { word: string; file: string | null }[];
  failed: { word: string; file: string | null }[];
}

interface Stage {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
}

const mode = ref<"topic" | "word">("topic");
const query = ref("");
const provider = ref("openai");
const providers = ref<Provider[]>([]);
const generating = ref(false);
const generateError = ref("");

const wordResults = ref<WordRow[]>([]);
const checkDone = ref(false);

const topicResults = ref<string[]>([]);
const lastWordQuery = ref("");

const batchRunning = ref(false);
const batchDone = ref(false);
const batchResult = ref<BatchResult | null>(null);
const batchError = ref("");
const stages = ref<Stage[]>([]);

const addableCount = computed(() => wordResults.value.filter(r => r.status === "in-wiktionary").length);
const selectedCount = computed(() => wordResults.value.filter(r => r.selected).length);
const allAddableSelected = computed(() => addableCount.value > 0 && selectedCount.value === addableCount.value);

const statusCounts = computed(() => {
  const counts: Record<string, number> = { "in-app": 0, "in-wiktionary": 0, "not-found": 0 };
  for (const r of wordResults.value) {
    if (r.status in counts) counts[r.status]++;
  }
  return counts;
});

const sortedResults = computed(() => {
  return [...wordResults.value].sort((a, b) => {
    const order = { "in-wiktionary": 0, "not-found": 1, "in-app": 2, checking: 3 };
    const o = (order[a.status] ?? 3) - (order[b.status] ?? 3);
    if (o !== 0) return o;
    return (b.zipf ?? -1) - (a.zipf ?? -1);
  });
});

function rowClass(row: WordRow) {
  return {
    "row-in-app": row.status === "in-app",
    "row-not-found": row.status === "not-found",
  };
}

function stageClass(s: Stage) {
  return { "stage-done": s.status === "done", "stage-running": s.status === "running" };
}

function toggleSelectAll() {
  const target = !allAddableSelected.value;
  for (const r of wordResults.value) {
    if (r.status === "in-wiktionary") r.selected = target;
  }
}

onMounted(async () => {
  try {
    const res = await fetch("/api/providers");
    providers.value = await res.json();
  } catch { /* ignore */ }
});

async function generate() {
  if (!query.value.trim()) return;
  generateError.value = "";
  generating.value = true;
  batchDone.value = false;
  batchResult.value = null;
  batchError.value = "";

  try {
    if (mode.value === "topic") {
      await generateTopicWords();
    } else {
      await generateWordTopics();
    }
  } catch (err: any) {
    generateError.value = err.message || "Request failed";
  } finally {
    generating.value = false;
  }
}

async function generateTopicWords() {
  wordResults.value = [];
  checkDone.value = false;

  const res = await fetch("/api/topic-words", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: query.value, provider: provider.value }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const words: LLMWord[] = data.words || [];
  wordResults.value = words.map(w => ({
    ...w,
    status: "checking" as const,
    zipf: null,
    selected: false,
  }));

  const checkRes = await fetch("/api/batch-wikt-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words: words.map(w => w.word) }),
  });
  const checkData = await checkRes.json();
  if (checkData.results) {
    const statusMap = new Map<string, { status: WordRow["status"]; zipf: number | null; file?: string }>(
      checkData.results.map((r: any) => [r.word, r]),
    );
    for (const row of wordResults.value) {
      const info = statusMap.get(row.word);
      if (info) {
        row.status = info.status;
        row.zipf = info.zipf ?? null;
        row.file = info.file ?? undefined;
      } else {
        row.status = "not-found";
      }
    }
  }
  checkDone.value = true;
}

async function generateWordTopics() {
  topicResults.value = [];
  lastWordQuery.value = query.value;

  const res = await fetch("/api/word-topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word: query.value, provider: provider.value }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  topicResults.value = data.topics || [];
}

function exploreTopic(topic: string) {
  mode.value = "topic";
  query.value = topic;
  generate();
}

async function batchAdd() {
  const selected = wordResults.value.filter(r => r.selected);
  if (!selected.length) return;

  batchRunning.value = true;
  batchDone.value = false;
  batchResult.value = null;
  batchError.value = "";
  stages.value = [
    { id: "whitelist", label: "Updating whitelist", status: "pending" },
    { id: "transform", label: "Running transform", status: "pending" },
    { id: "enrich", label: "Enriching frequency", status: "pending" },
    { id: "translate", label: "Translating glosses", status: "pending" },
  ];

  const topic = query.value;

  try {
    const response = await fetch("/api/batch-add-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        words: selected.map(r => ({
          word: r.word,
          domain: topic,
          reason: `topic explorer: ${topic}`,
        })),
        provider: provider.value,
      }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventName = line.slice(7);
        } else if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          handleSSE(eventName, data);
        }
      }
    }
  } catch (err: any) {
    batchError.value = err.message || "Batch add failed";
  } finally {
    batchRunning.value = false;
    batchDone.value = true;
  }
}

function handleSSE(event: string, data: any) {
  if (event === "progress") {
    const stage = stages.value.find(s => s.id === data.stage);
    if (stage) stage.status = data.status;
  } else if (event === "done") {
    batchResult.value = data;
    for (const added of data.added) {
      const row = wordResults.value.find(r => r.word.toLowerCase() === added.word.toLowerCase());
      if (row) {
        row.status = "in-app";
        row.file = added.file;
        row.selected = false;
      }
    }
  } else if (event === "error") {
    batchError.value = data.message || "Batch add failed";
  }
}
</script>

<style scoped>
.topic-explorer {
  max-width: 1000px;
}

h1 { margin-bottom: 1.5rem; font-size: 1.5rem; }
h2 { margin-bottom: 1rem; font-size: 1.1rem; font-weight: 500; }
h3 { margin-bottom: 0.75rem; font-size: 1rem; font-weight: 500; }

.input-section {
  margin-bottom: 1.5rem;
}

.mode-toggle {
  display: flex;
  gap: 0;
  margin-bottom: 0.75rem;
}

.mode-toggle button {
  padding: 0.4rem 1rem;
  border: 1px solid var(--admin-border);
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all var(--admin-transition);
}

.mode-toggle button:first-child { border-radius: 6px 0 0 6px; }
.mode-toggle button:last-child { border-radius: 0 6px 6px 0; border-left: 0; }
.mode-toggle button.active {
  background: var(--admin-primary);
  color: white;
  border-color: var(--admin-primary);
}

.input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.query-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--admin-transition);
}
.query-input:focus { border-color: var(--admin-primary); }

.provider-select {
  padding: 0.5rem 0.5rem;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  font-size: 0.82rem;
  background: white;
}

.btn-generate {
  padding: 0.5rem 1.25rem;
  border: none;
  border-radius: 6px;
  background: var(--admin-primary);
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--admin-transition);
  white-space: nowrap;
}
.btn-generate:hover:not(:disabled) { background: var(--admin-primary-dark); }
.btn-generate:disabled { opacity: 0.5; cursor: default; }

.error-msg {
  margin-top: 0.5rem;
  color: #d32f2f;
  font-size: 0.82rem;
}

/* ── Results section ── */

.results-section { margin-bottom: 1.5rem; }

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.results-stats {
  font-size: 0.85rem;
  color: var(--admin-text-secondary);
}

.results-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.select-all-label {
  font-size: 0.82rem;
  color: var(--admin-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.btn-batch-add {
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 6px;
  background: #2e7d32;
  color: white;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--admin-transition);
}
.btn-batch-add:hover:not(:disabled) { background: #1b5e20; }
.btn-batch-add:disabled { opacity: 0.5; cursor: default; }

.results-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--admin-shadow-sm);
  font-size: 0.85rem;
}

.results-table th {
  background: #fafafa;
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--admin-text-muted);
  border-bottom: 1px solid var(--admin-border);
}

.results-table td {
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--admin-subtle);
}

.col-check { width: 32px; text-align: center; }
.col-pos { width: 80px; }
.col-gender { width: 56px; text-align: center; }
.col-status { width: 110px; }
.col-zipf { width: 60px; text-align: right; font-variant-numeric: tabular-nums; }

.row-in-app { opacity: 0.55; }
.row-not-found { opacity: 0.65; }

.status-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.72rem;
  font-weight: 600;
}

.status-in-app { background: #e8f5e9; color: #2e7d32; }
.status-in-wikt { background: #e3f2fd; color: #1565c0; }
.status-not-found { background: #fce4ec; color: #c62828; }

/* ── Topics section ── */

.topics-section { margin-bottom: 1.5rem; }

.topic-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.topic-chip {
  padding: 0.5rem 1rem;
  border: 1px solid var(--admin-border);
  border-radius: 20px;
  background: white;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--admin-transition);
}
.topic-chip:hover {
  background: var(--admin-primary-bg);
  border-color: var(--admin-primary);
  color: var(--admin-primary);
}

/* ── Progress section ── */

.progress-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: white;
  border-radius: 8px;
  box-shadow: var(--admin-shadow-sm);
}

.progress-stages {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 0.75rem;
}

.stage {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--admin-text-muted);
}

.stage-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.stage-running { color: var(--admin-primary); font-weight: 500; }
.stage-done { color: #2e7d32; }

.batch-result {
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.added-word {
  display: inline-block;
  margin-right: 0.5rem;
}

.added-word a {
  color: var(--admin-primary);
  text-decoration: none;
}
.added-word a:hover { text-decoration: underline; }

.batch-failed {
  margin-top: 0.3rem;
  color: #d32f2f;
}
</style>
