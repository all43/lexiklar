<template>
  <div class="proofread-page">
    <h1>Proofread</h1>

    <!-- Mode toggle -->
    <div class="mode-toggle">
      <button :class="{ active: mode === 'words' }" @click="switchMode('words')">Words</button>
      <button :class="{ active: mode === 'examples' }" @click="switchMode('examples')">Examples</button>
    </div>

    <!-- Stats bar -->
    <div v-if="stats" class="stats">
      <template v-if="mode === 'examples'">
        <div class="stat-card">
          <div class="stat-label">Examples proofread</div>
          <div class="stat-value">{{ stats.examples.proofread.toLocaleString() }} / {{ stats.examples.total.toLocaleString() }}</div>
          <div class="stat-pct">{{ exPct }}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Unproofread</div>
          <div class="stat-value">{{ stats.examples.unproofread.toLocaleString() }}</div>
        </div>
      </template>
      <template v-else>
        <div class="stat-card">
          <div class="stat-label">Words proofread (gloss)</div>
          <div class="stat-value">{{ stats.words.proofread_gloss.toLocaleString() }} / {{ stats.words.total.toLocaleString() }}</div>
          <div class="stat-pct">{{ wordPct }}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Unproofread</div>
          <div class="stat-value">{{ stats.words.unproofread_gloss.toLocaleString() }}</div>
        </div>
      </template>
      <div class="stat-card" v-if="stats.pendingResults > 0">
        <div class="stat-label">Pending results</div>
        <div class="stat-value">{{ stats.pendingResults }}</div>
      </div>
    </div>
    <div v-else-if="loadingStats" class="loading">Loading stats...</div>

    <!-- POS chips -->
    <div class="pos-chips">
      <button
        class="pos-chip"
        :class="{ active: activePosSet.size === 0 }"
        @click="clearPosFilter"
      >All</button>
      <button
        v-for="p in posList"
        :key="p"
        class="pos-chip"
        :class="{ active: activePosSet.has(p), content: contentPos.has(p) }"
        @click="togglePos(p)"
      >{{ p }}</button>
    </div>

    <!-- Word filter & user login -->
    <div class="filter-bar">
      <input
        v-model="wordFilter"
        class="filter-input"
        placeholder="Filter by word..."
        @keydown.enter="reload"
      />
      <button class="btn-filter" @click="reload" v-if="wordFilter.trim()">Filter</button>
      <button class="btn-filter btn-clear" @click="wordFilter = ''; reload()" v-if="wordFilter.trim()">Clear</button>
      <select v-if="mode === 'words'" v-model="wordQueueFilter" class="filter-select" @change="reload">
        <option value="">All words</option>
        <option value="unproofread_gloss">Unproofread gloss</option>
        <option value="unproofread_examples">Has unproofread examples</option>
      </select>
      <select v-if="mode === 'examples'" v-model="exQueueFilter" class="filter-select" @change="reload">
        <option value="">Unproofread</option>
        <option value="flagged">Flagged</option>
      </select>
      <input
        v-if="mode === 'examples'"
        v-model="userLogin"
        class="filter-input user-login-input"
        placeholder="Your username (for human verify)..."
        @change="() => localStorage.setItem('admin_user_login', userLogin)"
      />
    </div>

    <!-- ===================== WORDS MODE ===================== -->
    <template v-if="mode === 'words'">
      <div v-if="stats && stats.words.proofread_with_unproofread_ex > 0" class="hint-banner">
        Also {{ stats.words.proofread_with_unproofread_ex.toLocaleString() }} proofread words have unproofread examples.
        <a href="#" @click.prevent="switchMode('examples')">Switch to Examples</a> to review them.
      </div>

      <div v-if="loadingWords" class="loading">Loading words...</div>

      <div v-else-if="wordQueue.length === 0" class="empty-state">
        No words found{{ posLabel ? ` for ${posLabel}` : '' }}.
      </div>

      <div v-else class="word-list-queue">
        <div
          v-for="(w, i) in wordQueue"
          :key="w.pos + '/' + w.word"
          class="word-card"
        >
          <div class="word-card-main">
            <div class="word-card-left">
              <router-link :to="'/words?open=' + w.pos + '/' + w.word" class="word-card-name">{{ w.word }}</router-link>
              <span class="word-card-pos">{{ w.pos }}</span>
              <span class="word-card-zipf">{{ w.zipf.toFixed(1) }}</span>
              <span v-if="w.proofreadGloss" class="badge badge-proofread">proofread</span>
              <span v-else class="badge badge-unproofread">unproofread</span>
            </div>
            <div class="word-card-right">
              <span class="word-card-counter">{{ i + wordOffset + 1 }} / {{ wordTotal.toLocaleString() }}</span>
            </div>
          </div>
          <div v-if="w.gloss_en" class="word-card-gloss">{{ w.gloss_en }}</div>
          <div v-if="w.gloss_en_full" class="word-card-gloss-full">{{ w.gloss_en_full }}</div>
          <div class="word-card-footer">
            <span class="word-card-senses">{{ w.senseCount }} sense{{ w.senseCount !== 1 ? 's' : '' }}</span>
            <span class="word-card-ex-stats" :class="{ 'all-proofread': w.exampleStats.unproofread === 0 }">
              {{ w.exampleStats.proofread }} / {{ w.exampleStats.total }} examples proofread
            </span>
            <router-link
              v-if="w.exampleStats.unproofread > 0"
              :to="'/proofread?mode=examples&word=' + encodeURIComponent(w.word) + '&pos=' + w.pos"
              class="btn-review-examples"
            >Review {{ w.exampleStats.unproofread }} examples</router-link>
          </div>
        </div>
        <div v-if="wordHasMore" class="load-more">
          <button @click="loadMoreWords" :disabled="loadingWords">Load more...</button>
        </div>
      </div>
    </template>

    <!-- ===================== EXAMPLES MODE ===================== -->
    <template v-if="mode === 'examples'">
      <!-- Session stats -->
      <div class="session-stats" v-if="sessionVerified > 0 || sessionFlagged > 0 || sessionSkipped > 0">
        <span class="session-verified">Verified: {{ sessionVerified }}</span>
        <span class="session-flagged">Flagged: {{ sessionFlagged }}</span>
        <span class="session-skipped">Skipped: {{ sessionSkipped }}</span>
      </div>

      <div v-if="loadingQueue" class="loading">Loading examples...</div>

      <div v-else-if="queue.length === 0 && !loadingQueue" class="empty-state">
        No unproofread examples found{{ posLabel ? ` for ${posLabel}` : '' }}.
      </div>

      <div v-else-if="current" class="review-card">
        <div class="card-header">
          <div class="card-owner">
            <router-link :to="'/words?open=' + current.owner.pos + '/' + current.owner.word">
              {{ current.owner.word }}
            </router-link>
            <span class="owner-meta">({{ current.owner.pos }}, zipf {{ current.owner.zipf.toFixed(1) }})</span>
            <span v-if="current._flagged" class="badge badge-flagged" :title="current._flagged.reason || 'flagged'">
              flagged{{ current._flagged.reason ? ': ' + current._flagged.reason : '' }}
            </span>
          </div>
          <div class="card-position">
            {{ currentIdx + 1 }} / {{ queueTotal.toLocaleString() }}
            <span v-if="posLabel" class="pos-context">({{ posLabel }})</span>
          </div>
        </div>

        <!-- Edit mode -->
        <template v-if="editing">
          <ExampleEditor
            :exampleId="current.id"
            :text="current.text"
            :translation="current.translation"
            :annotations="current.annotations"
            @save="onEditorSave"
            @cancel="editing = false"
          />
        </template>

        <!-- Review mode -->
        <template v-else>
          <div class="card-body">
            <div class="example-text">{{ current.text }}</div>
            <div class="example-translation">{{ current.translation }}</div>

            <div v-if="current.senseContext.length > 0" class="sense-context">
              <div class="section-label">Sense disambiguation</div>
              <div v-for="sc in current.senseContext" :key="sc.form + sc.lemma" class="sense-entry">
                <div class="sense-form">
                  <strong>"{{ sc.form }}"</strong> &rarr; {{ sc.lemma }}
                  <span class="sense-hint" v-if="sc.gloss_hint">hint: "{{ sc.gloss_hint }}"</span>
                  <span class="sense-hint sense-hint-null" v-else>no hint</span>
                </div>
                <div class="sense-list">{{ sc.senses }}</div>
              </div>
            </div>

            <div v-if="current.annotations.length > 0" class="annotations-section">
              <div class="section-label">All annotations</div>
              <div class="annotation-pills">
                <span v-for="(ann, i) in current.annotations" :key="i" class="ann-pill">
                  {{ ann.form }}
                  <span class="ann-meta">{{ ann.lemma }} ({{ ann.pos }})</span>
                  <span v-if="ann.gloss_hint" class="ann-hint">{{ ann.gloss_hint }}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="card-actions">
            <button class="btn-verify" @click="() => verify('agent')" :disabled="acting">
              <span class="shortcut">Y</span> Verify (agent)
            </button>
            <button class="btn-verify-human" @click="verifyAsHuman" :disabled="acting || !userLogin.trim()">
              <span class="shortcut">H</span> Human ✓
            </button>
            <div class="flag-wrapper" @mouseleave="showFlagReason = false">
              <button class="btn-flag" @click="showFlagReason = !showFlagReason" :disabled="acting">
                <span class="shortcut">N</span> Flag
              </button>
              <div v-if="showFlagReason" class="flag-reason-popover">
                <div class="flag-reason-option" @click="flagWithReason('translation')">Translation</div>
                <div class="flag-reason-option" @click="flagWithReason('annotation')">Annotation</div>
                <div class="flag-reason-option" @click="flagWithReason('other')">Other</div>
              </div>
            </div>
            <button class="btn-edit" @click="editing = true">
              <span class="shortcut">E</span> Edit
            </button>
            <button class="btn-skip" @click="skip">
              <span class="shortcut">&rarr;</span> Skip
            </button>
            <button class="btn-back" @click="goBack" :disabled="currentIdx === 0">
              <span class="shortcut">&larr;</span> Back
            </button>
          </div>
        </template>
      </div>

      <!-- Flagged items -->
      <div v-if="flaggedList.length > 0" class="flagged-section">
        <div class="section-label">Flagged this session ({{ flaggedList.length }})</div>
        <div v-for="f in flaggedList" :key="f.id" class="flagged-item">
          <span class="flagged-id">{{ f.id.slice(0, 8) }}</span>
          <span class="flagged-text">{{ f.text.slice(0, 60) }}{{ f.text.length > 60 ? '...' : '' }}</span>
          <span v-if="f.reason" class="flagged-reason">{{ f.reason }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import ExampleEditor from "../components/ExampleEditor.vue";

interface ExOwner {
  word: string;
  pos: string;
  senseIdx: number;
  zipf: number;
}

interface SenseContext {
  form: string;
  lemma: string;
  gloss_hint: string | null;
  senses: string;
}

interface ExampleQueueItem {
  id: string;
  text: string;
  translation: string;
  annotations: { form: string; lemma: string; pos: string; gloss_hint: string | null; form_index?: number; form2?: string; form2_index?: number }[];
  owner: ExOwner;
  senseContext: SenseContext[];
  _flagged?: { date: string; reason?: string | null };
}

interface WordQueueItem {
  word: string;
  pos: string;
  zipf: number;
  gloss_en: string | null;
  gloss_en_full: string | null;
  senseCount: number;
  proofreadGloss: boolean;
  exampleStats: { total: number; proofread: number; unproofread: number };
}

interface Stats {
  examples: { total: number; proofread: number; unproofread: number };
  words: { total: number; proofread_gloss: number; unproofread_gloss: number; proofread_with_unproofread_ex: number };
  pendingResults: number;
}

const posList = [
  "nouns", "verbs", "adjectives", "adverbs", "prepositions",
  "conjunctions", "determiners", "pronouns", "phrases",
  "abbreviations", "interjections", "particles", "numerals",
];

const route = useRoute();
const router = useRouter();

const mode = ref<"words" | "examples">("words");
const stats = ref<Stats | null>(null);
const loadingStats = ref(true);
const userLogin = ref(localStorage.getItem("admin_user_login") || "");

const contentPos = new Set(["nouns", "verbs", "adjectives"]);
const activePosSet = reactive(new Set<string>());
const wordFilter = ref("");

// ---- Word mode state ----
const wordQueue = ref<WordQueueItem[]>([]);
const wordTotal = ref(0);
const wordOffset = ref(0);
const loadingWords = ref(false);
const wordQueueFilter = ref("unproofread_gloss");
const WORD_PAGE_SIZE = 30;

// ---- Example mode state ----
const queue = ref<ExampleQueueItem[]>([]);
const queueTotal = ref(0);
const currentIdx = ref(0);
const loadingQueue = ref(false);
const acting = ref(false);
const pageOffset = ref(0);
const EX_PAGE_SIZE = 50;

const sessionVerified = ref(0);
const sessionFlagged = ref(0);
const sessionSkipped = ref(0);
const flaggedList = ref<{ id: string; text: string; reason?: string }[]>([]);
const editing = ref(false);
const showFlagReason = ref(false);
const exQueueFilter = ref("");

// ---- Computed ----
const current = computed(() => queue.value[currentIdx.value] || null);
const exPct = computed(() =>
  stats.value ? Math.round((stats.value.examples.proofread / Math.max(stats.value.examples.total, 1)) * 100) : 0,
);
const wordPct = computed(() =>
  stats.value ? Math.round((stats.value.words.proofread_gloss / Math.max(stats.value.words.total, 1)) * 100) : 0,
);
const posLabel = computed(() => {
  if (activePosSet.size === 0) return "";
  return Array.from(activePosSet).join(", ");
});
const wordHasMore = computed(() => wordOffset.value + WORD_PAGE_SIZE < wordTotal.value);

// ---- Shared functions ----
function togglePos(p: string) {
  if (activePosSet.has(p)) activePosSet.delete(p);
  else activePosSet.add(p);
  reload();
}

function clearPosFilter() {
  activePosSet.clear();
  reload();
}

function switchMode(m: "words" | "examples") {
  if (mode.value === m) return;
  mode.value = m;
  router.replace({ query: { ...route.query, mode: m } });
  reload();
}

function reload() {
  if (mode.value === "words") {
    wordOffset.value = 0;
    wordQueue.value = [];
    loadWordQueue(0);
  } else {
    currentIdx.value = 0;
    pageOffset.value = 0;
    loadExampleQueue(0);
  }
}

async function loadStats() {
  loadingStats.value = true;
  try {
    const res = await fetch("/api/proofread/stats");
    stats.value = await res.json();
  } catch { /* ignore */ }
  loadingStats.value = false;
}

// ---- Word mode functions ----
async function loadWordQueue(offset = 0) {
  loadingWords.value = true;
  const params = new URLSearchParams({ limit: String(WORD_PAGE_SIZE), offset: String(offset) });
  if (activePosSet.size > 0) params.set("pos", Array.from(activePosSet).join(","));
  if (wordFilter.value.trim()) params.set("word", wordFilter.value.trim());
  if (wordQueueFilter.value) params.set("filter", wordQueueFilter.value);

  try {
    const res = await fetch("/api/proofread/word-queue?" + params);
    const data = await res.json();
    if (offset === 0) wordQueue.value = data.items;
    else wordQueue.value.push(...data.items);
    wordTotal.value = data.total;
    wordOffset.value = offset;
  } catch { /* ignore */ }
  loadingWords.value = false;
}

function loadMoreWords() {
  loadWordQueue(wordOffset.value + WORD_PAGE_SIZE);
}

// ---- Example mode functions ----
async function loadExampleQueue(offset = 0) {
  loadingQueue.value = true;
  const params = new URLSearchParams({ limit: String(EX_PAGE_SIZE), offset: String(offset) });
  if (activePosSet.size > 0) params.set("pos", Array.from(activePosSet).join(","));
  if (wordFilter.value.trim()) params.set("word", wordFilter.value.trim());
  if (exQueueFilter.value) params.set("filter", exQueueFilter.value);

  try {
    const res = await fetch("/api/proofread/example-queue?" + params);
    const data = await res.json();
    if (offset === 0) queue.value = data.items;
    else queue.value.push(...data.items);
    queueTotal.value = data.total;
    pageOffset.value = offset + data.items.length;
  } catch { /* ignore */ }
  loadingQueue.value = false;
}

async function verify(source: "agent" | "human" = "agent") {
  const item = current.value;
  if (!item || acting.value) return;
  if (source === "human" && !userLogin.value.trim()) {
    alert("Please set your username first");
    return;
  }
  acting.value = true;
  try {
    const res = await fetch(`/api/proofread/examples/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "verify",
        source,
        ...(source === "human" && { login: userLogin.value.trim() }),
      }),
    });
    if (res.ok) {
      sessionVerified.value++;
      queue.value.splice(currentIdx.value, 1);
      queueTotal.value--;
      if (currentIdx.value >= queue.value.length && queue.value.length > 0) {
        currentIdx.value = queue.value.length - 1;
      }
      maybeLoadMore();
    }
  } catch { /* ignore */ }
  acting.value = false;
}

async function verifyAsHuman() {
  verify("human");
}

async function flagWithReason(reason: string) {
  const item = current.value;
  if (!item || acting.value) return;
  showFlagReason.value = false;
  acting.value = true;
  try {
    await fetch(`/api/proofread/examples/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "flag", reason }),
    });
    sessionFlagged.value++;
    flaggedList.value.push({ id: item.id, text: item.text, reason });
    queue.value.splice(currentIdx.value, 1);
    queueTotal.value--;
    if (currentIdx.value >= queue.value.length && queue.value.length > 0) {
      currentIdx.value = queue.value.length - 1;
    }
    maybeLoadMore();
  } catch { /* ignore */ }
  acting.value = false;
}

function onEditorSave() {
  editing.value = false;
  sessionVerified.value++;
  queue.value.splice(currentIdx.value, 1);
  queueTotal.value--;
  if (currentIdx.value >= queue.value.length && queue.value.length > 0) {
    currentIdx.value = queue.value.length - 1;
  }
  maybeLoadMore();
}

function skip() {
  sessionSkipped.value++;
  if (currentIdx.value < queue.value.length - 1) {
    currentIdx.value++;
  }
  maybeLoadMore();
}

function goBack() {
  if (currentIdx.value > 0) currentIdx.value--;
}

function maybeLoadMore() {
  if (queue.value.length - currentIdx.value < 10 && pageOffset.value < queueTotal.value && !loadingQueue.value) {
    loadExampleQueue(pageOffset.value);
  }
}

function onKeydown(e: KeyboardEvent) {
  if (mode.value !== "examples") return;
  if (editing.value) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (e.key === "y" || e.key === "Y") { e.preventDefault(); verify(); }
  else if (e.key === "h" || e.key === "H") { e.preventDefault(); verifyAsHuman(); }
  else if (e.key === "n" || e.key === "N") { e.preventDefault(); showFlagReason.value = !showFlagReason.value; }
  else if (e.key === "e" || e.key === "E") { e.preventDefault(); editing.value = true; }
  else if (e.key === "ArrowRight") { e.preventDefault(); skip(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
  else if (e.key === "Escape") { showFlagReason.value = false; }
}

onMounted(() => {
  const qMode = route.query.mode;
  if (qMode === "examples" || qMode === "words") mode.value = qMode;

  const qPos = route.query.pos;
  const qWord = route.query.word;

  if (qPos && typeof qPos === "string") {
    qPos.split(",").map(s => s.trim()).filter(Boolean).forEach(p => activePosSet.add(p));
  } else if (!qWord) {
    contentPos.forEach(p => activePosSet.add(p));
  }

  if (qWord && typeof qWord === "string") {
    wordFilter.value = qWord;
  }

  loadStats();
  reload();
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<style scoped>
.proofread-page { max-width: 900px; }

/* Mode toggle */
.mode-toggle {
  display: inline-flex;
  border: 1px solid var(--admin-border-ui);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 1.25rem;
}

.mode-toggle button {
  padding: 8px 24px;
  border: none;
  background: white;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--admin-text-secondary);
  transition: all var(--admin-transition);
}

.mode-toggle button:not(:last-child) {
  border-right: 1px solid var(--admin-border-ui);
}

.mode-toggle button.active {
  background: var(--admin-primary);
  color: white;
}

.mode-toggle button:hover:not(.active) {
  background: var(--admin-subtle);
}

/* Stats */
.stats {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
}

.stat-card {
  background: white;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  min-width: 160px;
  box-shadow: var(--admin-shadow-sm);
}

.stat-label {
  font-size: 0.8rem;
  color: var(--admin-text-muted);
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.3rem;
  font-weight: 600;
}

.stat-pct {
  font-size: 0.85rem;
  color: var(--admin-text-secondary);
}

.loading {
  padding: 2rem;
  text-align: center;
  color: var(--admin-text-muted);
}

.empty-state {
  padding: 3rem;
  text-align: center;
  color: var(--admin-text-muted);
  background: white;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
}

/* POS chips */
.pos-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.pos-chip {
  padding: 4px 12px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 16px;
  background: white;
  cursor: pointer;
  font-size: 0.82rem;
  transition: all var(--admin-transition);
}

.pos-chip:hover { border-color: var(--admin-primary); }

.pos-chip.active {
  background: var(--admin-primary);
  color: white;
  border-color: var(--admin-primary);
}

.pos-chip.content:not(.active) {
  border-color: var(--admin-primary);
  color: var(--admin-primary);
}

.pos-context {
  font-size: 0.75rem;
  color: var(--admin-text-faint);
  margin-left: 0.25rem;
}

/* Filters */
.filter-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  align-items: center;
}

.filter-select {
  padding: 6px 8px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  font-size: 0.85rem;
}

.filter-input {
  padding: 6px 10px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  font-size: 0.85rem;
  width: 200px;
}

.filter-input:focus { border-color: var(--admin-primary); outline: none; }

.user-login-input {
  width: 220px !important;
  margin-left: auto;
}

.btn-filter {
  padding: 6px 12px;
  background: var(--admin-primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-filter:hover { background: var(--admin-primary-dark); }

/* Hint banner */
.hint-banner {
  padding: 0.6rem 1rem;
  background: #f0f7ff;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  font-size: 0.85rem;
  color: var(--admin-text-secondary);
  margin-bottom: 1rem;
}

.hint-banner a {
  color: var(--admin-primary);
  font-weight: 600;
  text-decoration: none;
}

.hint-banner a:hover { text-decoration: underline; }

/* ========= WORD MODE ========= */
.word-list-queue {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.word-card {
  background: white;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  box-shadow: var(--admin-shadow-sm);
}

.word-card-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.word-card-left {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.word-card-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--admin-primary);
  text-decoration: none;
}

.word-card-name:hover { text-decoration: underline; }

.word-card-pos {
  font-size: 0.75rem;
  color: var(--admin-text-muted);
  background: var(--admin-subtle);
  padding: 1px 8px;
  border-radius: 8px;
}

.word-card-zipf {
  font-size: 0.75rem;
  color: var(--admin-text-faint);
  font-family: monospace;
}

.word-card-counter {
  font-size: 0.8rem;
  color: var(--admin-text-faint);
}

.badge {
  font-size: 0.7rem;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.badge-proofread { background: #e8f5e9; color: #2e7d32; }
.badge-unproofread { background: #fff3e0; color: #e65100; }

.word-card-gloss {
  font-size: 0.9rem;
  color: var(--admin-primary);
}

.word-card-gloss-full {
  font-size: 0.82rem;
  color: var(--admin-text-secondary);
  font-style: italic;
}

.word-card-footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
  font-size: 0.8rem;
}

.word-card-senses {
  color: var(--admin-text-muted);
}

.word-card-ex-stats {
  color: var(--admin-text-secondary);
}

.word-card-ex-stats.all-proofread {
  color: #2e7d32;
}

.btn-review-examples {
  font-size: 0.75rem;
  padding: 2px 10px;
  border-radius: 10px;
  background: var(--admin-primary);
  color: white;
  text-decoration: none;
  font-weight: 500;
  transition: background var(--admin-transition);
  margin-left: auto;
}

.btn-review-examples:hover { background: var(--admin-primary-dark); }

.load-more {
  text-align: center;
  padding: 0.75rem;
}

.load-more button {
  padding: 6px 20px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
}

.load-more button:hover { background: var(--admin-subtle); }

/* ========= EXAMPLE MODE ========= */
.session-stats {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

.session-verified { color: #2e7d32; font-weight: 600; }
.session-flagged { color: #c62828; font-weight: 600; }
.session-skipped { color: var(--admin-text-muted); }

.review-card {
  background: white;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  box-shadow: var(--admin-shadow-sm);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--admin-subtle);
  border-bottom: 1px solid var(--admin-border);
}

.card-owner a {
  color: var(--admin-primary);
  text-decoration: none;
  font-weight: 600;
}

.card-owner a:hover { text-decoration: underline; }

.owner-meta {
  color: var(--admin-text-muted);
  font-size: 0.85rem;
  margin-left: 0.5rem;
}

.card-position {
  font-size: 0.85rem;
  color: var(--admin-text-muted);
}

.card-body { padding: 1.25rem; }

.example-text {
  font-size: 1.15rem;
  line-height: 1.6;
  margin-bottom: 0.5rem;
}

.example-translation {
  font-size: 1rem;
  color: var(--admin-text-secondary);
  font-style: italic;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--admin-subtle);
}

.section-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--admin-text-muted);
  margin-bottom: 0.5rem;
}

.sense-context { margin-bottom: 1rem; }

.sense-entry {
  margin-bottom: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #fafafa;
  border-radius: 4px;
  border-left: 3px solid var(--admin-primary);
}

.sense-form { margin-bottom: 0.25rem; }

.sense-hint {
  font-size: 0.85rem;
  color: var(--admin-text-secondary);
  margin-left: 0.5rem;
}

.sense-hint-null {
  color: var(--admin-text-faint);
  font-style: italic;
}

.sense-list {
  font-size: 0.85rem;
  color: var(--admin-text-medium);
}

.annotations-section { margin-bottom: 0.5rem; }

.annotation-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.ann-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 2px 8px;
  background: var(--admin-primary-bg);
  border-radius: 4px;
  font-size: 0.82rem;
}

.ann-meta {
  color: var(--admin-text-muted);
  font-size: 0.75rem;
}

.ann-hint {
  color: var(--admin-primary);
  font-size: 0.75rem;
  font-style: italic;
}

.card-actions {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--admin-border);
  background: var(--admin-subtle);
}

.card-actions button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--admin-transition);
}

.card-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-verify { background: #2e7d32; color: white; }
.btn-verify:hover:not(:disabled) { background: #1b5e20; }
.btn-verify-human { background: #1565c0; color: white; }
.btn-verify-human:hover:not(:disabled) { background: #0d47a1; }
.btn-flag { background: #c62828; color: white; }
.btn-flag:hover:not(:disabled) { background: #b71c1c; }
.btn-skip { background: #eee; color: #333; }
.btn-skip:hover { background: #ddd; }
.btn-back { background: #eee; color: #333; }
.btn-back:hover:not(:disabled) { background: #ddd; }

.shortcut {
  display: inline-block;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  padding: 0 4px;
  font-size: 0.75rem;
  font-weight: 700;
  margin-right: 4px;
  min-width: 18px;
  text-align: center;
}

.btn-edit { background: var(--admin-primary); color: white; }
.btn-edit:hover { background: var(--admin-primary-dark); }

.btn-skip .shortcut,
.btn-back .shortcut,
.btn-edit .shortcut {
  background: rgba(0, 0, 0, 0.08);
}

.btn-edit .shortcut {
  background: rgba(255, 255, 255, 0.3);
}

/* Flag reason popover */
.flag-wrapper { position: relative; }

.flag-reason-popover {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: white;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 50;
  min-width: 140px;
  margin-bottom: 4px;
}

.flag-reason-option {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.1s;
}

.flag-reason-option:hover { background: #ffebee; }

.flag-reason-option:first-child { border-radius: 6px 6px 0 0; }
.flag-reason-option:last-child { border-radius: 0 0 6px 6px; }

.badge-flagged {
  font-size: 0.7rem;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
  background: #ffebee;
  color: #c62828;
}

.flagged-section {
  margin-top: 2rem;
  padding: 1rem;
  background: #fff5f5;
  border: 1px solid #ffcdd2;
  border-radius: 8px;
}

.flagged-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.25rem 0;
  font-size: 0.85rem;
  border-bottom: 1px solid #ffebee;
}

.flagged-item:last-child { border-bottom: none; }

.flagged-id {
  font-family: monospace;
  color: var(--admin-text-muted);
  flex-shrink: 0;
}

.flagged-text {
  color: var(--admin-text-medium);
}

.flagged-reason {
  font-size: 0.7rem;
  color: #c62828;
  background: #ffebee;
  padding: 0 6px;
  border-radius: 8px;
  flex-shrink: 0;
}
</style>
