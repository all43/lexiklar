<template>
  <div>
    <div class="reports-header">
      <h1>Reports</h1>
      <button class="refresh-btn" @click="fetchReports" :disabled="loading">
        {{ loading ? "Loading…" : "Refresh" }}
      </button>
    </div>

    <div v-if="error" class="reports-error">{{ error }}</div>

    <div v-if="!loading && !error && reports.length === 0" class="reports-empty">
      No reports yet.
    </div>

    <div v-if="reports.length" class="reports-summary">
      {{ reports.length }} report{{ reports.length !== 1 ? "s" : "" }}
      &mdash;
      {{ typeCounts.missing_word }} missing word, {{ typeCounts.incorrect_data }} incorrect data
    </div>

    <table v-if="reports.length" class="reports-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Word</th>
          <th>File / Wiktionary</th>
          <th>Details</th>
          <th>Version</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in reports" :key="r.id">
          <td class="cell-time">{{ formatTime(r.ts) }}</td>
          <td>
            <span class="type-badge" :class="'type-' + r.type">{{ typeLabel(r.type) }}</span>
          </td>
          <td class="cell-word">{{ r.word }}</td>
          <td class="cell-file">
            <template v-if="r.type === 'incorrect_data'">
              <a v-if="r.file" href="#" @click.prevent="openWord(r.file)">{{ r.file }}</a>
              <span v-else class="cell-na">—</span>
            </template>
            <template v-else>
              <div v-if="wiktChecks[r.word] === undefined" class="wikt-loading">…</div>
              <template v-else-if="wiktChecks[r.word].inPipeline">
                <a href="#" @click.prevent="openWord(wiktChecks[r.word].file)" class="wikt-in-pipeline">
                  ✓ {{ wiktChecks[r.word].file }}
                </a>
              </template>
              <template v-else-if="wiktChecks[r.word].wiktEntries.length">
                <div class="wikt-found">
                  <span class="wikt-found-label">In Wiktionary:</span>
                  <span v-for="e in wiktChecks[r.word].wiktEntries" :key="e.pos" class="wikt-found-entry">
                    {{ e.pos }}<template v-if="e.tags.includes('masculine')"> M</template><template v-else-if="e.tags.includes('feminine')"> F</template><template v-else-if="e.tags.includes('neuter')"> N</template><template v-if="e.glosses.length"> — {{ e.glosses[0] }}</template>
                  </span>
                  <div class="wikt-found-actions">
                    <button class="btn-add-word" @click="addWord(r.word)" :disabled="addingWords[r.word]">
                      {{ addingWords[r.word] ? 'Adding…' : '+ Add to pipeline' }}
                    </button>
                    <span v-if="addWordResults[r.word] && !addWordResults[r.word].ok" class="add-word-error">{{ addWordResults[r.word].error }}</span>
                  </div>
                </div>
              </template>
              <span v-else class="wikt-absent">not in Wiktionary</span>
            </template>
          </td>
          <td class="cell-details">{{ r.details || "—" }}</td>
          <td class="cell-version">
            <span v-if="r.appVersion" class="version-tag">v{{ r.appVersion }}</span>
            <span v-if="r.dbVersion" class="version-tag db">{{ r.dbVersion }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";

interface Report {
  id: string;
  ts: number;
  type: "missing_word" | "incorrect_data";
  word: string;
  details: string | null;
  file: string | null;
  appVersion: string | null;
  dbVersion: string | null;
}

interface WiktCheck {
  inPipeline: boolean;
  file: string | null;
  wiktEntries: { pos: string; tags: string[]; glosses: string[] }[];
}

const router = useRouter();
const reports = ref<Report[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const wiktChecks = ref<Record<string, WiktCheck>>({});
const addingWords = ref<Record<string, boolean>>({});
const addWordResults = ref<Record<string, { ok: boolean; file?: string | null; error?: string }>>({});

const typeCounts = computed(() => {
  const counts = { missing_word: 0, incorrect_data: 0 };
  for (const r of reports.value) {
    if (r.type in counts) counts[r.type]++;
  }
  return counts;
});

async function fetchReports() {
  loading.value = true;
  error.value = null;
  wiktChecks.value = {};
  try {
    const res = await fetch("/api/reports");
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      error.value = data?.error || `HTTP ${res.status}`;
      return;
    }
    reports.value = await res.json();
    checkMissingWordReports();
  } catch (e: any) {
    error.value = e.message || "Failed to load reports";
  } finally {
    loading.value = false;
  }
}

async function addWord(word: string) {
  addingWords.value = { ...addingWords.value, [word]: true };
  try {
    const res = await fetch("/api/add-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word }),
    });
    const data = await res.json();
    addWordResults.value = { ...addWordResults.value, [word]: data };
    if (data.ok) {
      wiktChecks.value = { ...wiktChecks.value, [word]: { inPipeline: true, file: data.file, wiktEntries: [] } };
    }
  } catch (e: any) {
    addWordResults.value = { ...addWordResults.value, [word]: { ok: false, error: e.message } };
  } finally {
    addingWords.value = { ...addingWords.value, [word]: false };
  }
}

async function checkMissingWordReports() {
  const words = [...new Set(
    reports.value.filter(r => r.type === "missing_word").map(r => r.word)
  )];
  for (const word of words) {
    if (wiktChecks.value[word] !== undefined) continue;
    try {
      const res = await fetch(`/api/wikt-check?word=${encodeURIComponent(word)}`);
      wiktChecks.value = { ...wiktChecks.value, [word]: await res.json() };
    } catch {
      wiktChecks.value = { ...wiktChecks.value, [word]: { inPipeline: false, file: null, wiktEntries: [] } };
    }
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function typeLabel(type: string): string {
  return type === "missing_word" ? "Missing" : type === "incorrect_data" ? "Incorrect" : type;
}

function openWord(file: string) {
  router.push({ path: "/words", query: { open: file } });
}

onMounted(fetchReports);
</script>

<style scoped>
.reports-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}
.reports-header h1 {
  margin: 0;
}
.refresh-btn {
  padding: 0.4rem 1rem;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background var(--admin-transition);
}
.refresh-btn:hover:not(:disabled) { background: var(--admin-subtle); }
.refresh-btn:disabled { opacity: 0.5; cursor: default; }

.reports-error {
  background: #fce4ec;
  color: #c62828;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.reports-empty {
  color: var(--admin-text-muted);
  font-style: italic;
  padding: 2rem 0;
}

.reports-summary {
  font-size: 0.85rem;
  color: var(--admin-text-secondary);
  margin-bottom: 0.75rem;
}

.reports-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--admin-shadow-sm);
  font-size: 0.85rem;
}

.reports-table th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  background: var(--admin-bg);
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--admin-text-medium);
  border-bottom: 1px solid var(--admin-border);
}

.reports-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--admin-subtle);
  vertical-align: top;
}

.reports-table tbody tr:hover {
  background: #f9f9ff;
}

.cell-time {
  white-space: nowrap;
  color: var(--admin-text-secondary);
  font-size: 0.8rem;
}
.cell-word { font-weight: 600; }
.cell-file a {
  color: var(--admin-primary);
  text-decoration: none;
  font-size: 0.8rem;
}
.cell-file a:hover { text-decoration: underline; }
.cell-na { color: #ccc; }
.cell-details {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--admin-text-medium);
}

.type-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.type-missing_word { background: #e3f2fd; color: var(--admin-primary-dark); }
.type-incorrect_data { background: #fff3e0; color: #e65100; }

.version-tag {
  font-size: 0.7rem;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--admin-subtle);
  color: var(--admin-text-secondary);
  font-family: monospace;
}
.version-tag.db { background: #e8f5e9; color: #2e7d32; margin-left: 4px; }

.wikt-loading { color: #bbb; font-size: 0.8rem; }
.wikt-in-pipeline { color: #2e7d32; font-size: 0.8rem; text-decoration: none; }
.wikt-in-pipeline:hover { text-decoration: underline; }
.wikt-found { display: flex; flex-direction: column; gap: 1px; }
.wikt-found-label { font-size: 0.68rem; font-weight: 600; color: var(--admin-primary-dark); text-transform: uppercase; letter-spacing: 0.03em; }
.wikt-found-entry { font-size: 0.8rem; color: #333; }
.wikt-absent { color: #bbb; font-size: 0.8rem; font-style: italic; }
.wikt-found-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 3px; }
.add-word-error { font-size: 0.72rem; color: #c62828; }
</style>
