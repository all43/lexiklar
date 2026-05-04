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
          <th>File</th>
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
            <a v-if="r.file" href="#" @click.prevent="openWord(r.file)">{{ r.file }}</a>
            <span v-else class="cell-na">—</span>
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

const router = useRouter();
const reports = ref<Report[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

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
  try {
    const res = await fetch("/api/reports");
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      error.value = data?.error || `HTTP ${res.status}`;
      return;
    }
    reports.value = await res.json();
  } catch (e: any) {
    error.value = e.message || "Failed to load reports";
  } finally {
    loading.value = false;
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
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.15s;
}
.refresh-btn:hover:not(:disabled) { background: #f0f0f0; }
.refresh-btn:disabled { opacity: 0.5; cursor: default; }

.reports-error {
  background: #fce4ec;
  color: #c62828;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.reports-empty {
  color: #888;
  font-style: italic;
  padding: 2rem 0;
}

.reports-summary {
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 0.75rem;
}

.reports-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-size: 0.85rem;
}

.reports-table th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  background: #f5f5f5;
  font-weight: 600;
  font-size: 0.8rem;
  color: #555;
  border-bottom: 1px solid #e0e0e0;
}

.reports-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: top;
}

.reports-table tbody tr:hover {
  background: #f9f9ff;
}

.cell-time {
  white-space: nowrap;
  color: #666;
  font-size: 0.8rem;
}
.cell-word { font-weight: 600; }
.cell-file a {
  color: #1a73e8;
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
  color: #555;
}

.type-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.type-missing_word { background: #e3f2fd; color: #1565c0; }
.type-incorrect_data { background: #fff3e0; color: #e65100; }

.version-tag {
  font-size: 0.7rem;
  padding: 1px 5px;
  border-radius: 4px;
  background: #f0f0f0;
  color: #666;
  font-family: monospace;
}
.version-tag.db { background: #e8f5e9; color: #2e7d32; margin-left: 4px; }
</style>
