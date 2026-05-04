<template>
  <div class="word-browser">
    <!-- Left: POS sidebar + word list -->
    <aside class="word-sidebar">
      <input
        v-model="searchQuery"
        class="search-input"
        type="search"
        placeholder="Search words…"
        @input="onSearch"
      />
      <div class="filter-bar">
        <div class="filter-toggles">
          <button
            v-for="f in FILTER_OPTIONS"
            :key="f.value"
            class="filter-btn"
            :class="[f.cls, { active: activeFilters.has(f.value) }]"
            @click="toggleFilter(f.value)"
            :title="f.label"
          >{{ f.short }}</button>
        </div>
        <select v-model="sortMode" class="sort-select" @change="fetchWordList(true)">
          <option value="alpha">A–Z</option>
          <option value="zipf">Zipf ↓</option>
          <option value="zipf-asc">Zipf ↑</option>
        </select>
      </div>
      <div class="pos-tabs">
        <button
          v-for="p in posList"
          :key="p.pos"
          class="pos-tab"
          :class="{ active: selectedPos === p.pos }"
          @click="selectPos(p.pos)"
        >
          {{ p.pos }} <span class="pos-count">{{ p.count }}</span>
        </button>
      </div>
      <div class="word-list" ref="wordListEl">
        <div
          v-for="item in wordItems"
          :key="item.pos + '/' + item.file"
          class="word-item"
          :class="{ active: selectedFile === item.pos + '/' + item.word }"
          @click="selectWord(item)"
        >
          <span class="word-name">
            {{ item.word }}
            <span v-if="item.flags?.includes('missing_en')" class="flag-dot flag-missing" title="Missing gloss_en"></span>
            <span v-if="item.flags?.includes('overrides')" class="flag-dot flag-override" title="Has _overrides"></span>
          </span>
          <span class="word-meta">
            <span v-if="sortMode.startsWith('zipf') && item.zipf" class="word-zipf-badge">{{ item.zipf }}</span>
            <span v-if="item.gloss_en" class="word-gloss-preview">{{ item.gloss_en }}</span>
            <span v-if="!selectedPos" class="word-pos-badge">{{ item.pos }}</span>
          </span>
        </div>
        <div v-if="wordItems.length === 0 && !loadingList" class="word-list-empty">
          No words found
        </div>
        <div v-if="hasMore" class="word-list-more">
          <button @click="loadMore">Load more…</button>
        </div>
      </div>
    </aside>

    <!-- Right: word detail -->
    <main class="word-detail" v-if="wordData">
      <header class="word-header">
        <h1>
          <span v-if="wordData.article" class="word-article" :class="genderClass">{{ wordData.article }}&nbsp;</span>{{ wordData.word }}
        </h1>
        <span class="word-pos-label">{{ wordData.pos }}</span>
        <span v-if="wordData.zipf" class="word-zipf">Zipf {{ wordData.zipf }}</span>
        <span v-if="wordData._proofread?.gloss_en" class="badge badge-proofread" title="gloss_en proofread">proofread</span>
        <span v-else class="badge badge-unproofread" title="gloss_en not proofread">unproofread</span>
        <span v-if="wordData._overrides" class="badge badge-override" title="Has _overrides">overrides</span>
        <span v-if="wordData._meta?.source === 'manual'" class="badge badge-manual" title="Manual entry">manual</span>
      </header>

      <!-- Tab bar -->
      <div class="detail-tabs">
        <button
          v-for="tab in detailTabs"
          :key="tab"
          class="detail-tab"
          :class="{ active: activeTab === tab }"
          @click="activeTab = tab"
        >{{ tab }}</button>
      </div>

      <!-- Senses tab -->
      <div v-if="activeTab === 'Senses'" class="tab-content">
        <div class="senses-toolbar">
          <label class="proofread-toggle">
            <input
              type="checkbox"
              :checked="wordData._proofread?.gloss_en"
              @change="toggleProofread('gloss_en', ($event.target as HTMLInputElement).checked)"
            />
            proofread (gloss_en)
          </label>
          <div class="llm-provider-bar">
            <select v-model="llmProvider" class="llm-select">
              <option v-for="p in providers" :key="p.name" :value="p.name" :disabled="!p.hasKey && p.name !== 'ollama' && p.name !== 'lm-studio'">
                {{ p.name }}{{ !p.hasKey && p.name !== 'ollama' && p.name !== 'lm-studio' ? ' (no key)' : '' }}
              </option>
            </select>
            <input v-model="llmModel" class="llm-model-input" placeholder="model (default)" />
          </div>
        </div>

        <div v-for="(sense, i) in wordData.senses" :key="i" class="sense-card">
          <div class="sense-number">#{{ i + 1 }}</div>
          <div class="sense-body">
            <div class="sense-gloss">{{ sense.gloss }}</div>

            <!-- gloss_en -->
            <div class="edit-row">
              <label class="edit-label">gloss_en</label>
              <input
                class="edit-input"
                :value="sense.gloss_en || ''"
                @change="updateSense(i, 'gloss_en', ($event.target as HTMLInputElement).value)"
              />
              <button class="btn-llm" @click="translateSense(i, 'short')" :disabled="translating[i]" title="LLM translate (short)">
                {{ translating[i] ? '…' : '⚡' }}
              </button>
            </div>

            <!-- gloss_en_full -->
            <div class="edit-row">
              <label class="edit-label">gloss_en_full</label>
              <input
                class="edit-input"
                :value="sense.gloss_en_full || ''"
                @change="updateSense(i, 'gloss_en_full', ($event.target as HTMLInputElement).value)"
              />
              <button class="btn-llm" @click="translateSense(i, 'full')" :disabled="translating[i]" title="LLM translate (full)">
                {{ translating[i] ? '…' : '⚡' }}
              </button>
            </div>

            <!-- synonyms_en -->
            <div class="edit-row">
              <label class="edit-label">synonyms_en</label>
              <input
                class="edit-input"
                :value="(sense.synonyms_en || []).join(', ')"
                @change="updateSense(i, 'synonyms_en', ($event.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()))"
                placeholder="comma-separated"
              />
            </div>

            <div v-if="sense.tags?.length" class="sense-tags">
              <span v-for="tag in sense.tags" :key="tag" class="sense-tag">{{ tag }}</span>
            </div>

            <!-- Examples -->
            <div v-if="sense.example_ids?.length" class="sense-examples">
              <div v-for="eid in sense.example_ids" :key="eid" class="example-card">
                <template v-if="examples[eid]">
                  <div class="example-text">{{ examples[eid].text }}</div>
                  <div v-if="examples[eid].translation" class="example-translation">{{ examples[eid].translation }}</div>
                  <div v-if="examples[eid].annotations?.length" class="example-annotations">
                    <span
                      v-for="(ann, j) in examples[eid].annotations"
                      :key="j"
                      class="annotation-pill"
                      :title="`${ann.lemma} (${ann.pos})${ann.gloss_hint ? ' — ' + ann.gloss_hint : ''}`"
                    >{{ ann.form }}</span>
                  </div>
                </template>
                <div v-else class="example-missing">{{ eid }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Save button -->
        <div class="save-bar" v-if="dirty">
          <button class="btn-save" @click="saveWord" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save changes' }}
          </button>
          <button class="btn-discard" @click="discardChanges">Discard</button>
          <span v-if="saveMsg" class="save-msg" :class="{ 'save-error': saveError }">{{ saveMsg }}</span>
        </div>
      </div>

      <!-- Grammar tab -->
      <div v-if="activeTab === 'Grammar'" class="tab-content">
        <NounDeclension v-if="wordData.pos === 'noun' && wordData.case_forms" :word="wordData" />
        <VerbConjugation v-if="wordData.pos === 'verb' && wordData.conjugation" :verb="wordData" />
        <AdjectiveDeclension v-if="wordData.pos === 'adjective'" :word="wordData" />
        <PronounDeclension v-if="wordData.pos === 'pronoun'" :word="wordData" />
        <DeterminerDeclension v-if="wordData.pos === 'determiner'" :word="wordData" />
        <div v-if="!hasGrammar" class="no-grammar">No grammar table for this POS.</div>
      </div>

      <!-- Wiktionary tab -->
      <div v-if="activeTab === 'Wiktionary'" class="tab-content">
        <div v-if="wiktLoading" class="wikt-loading">Looking up…</div>
        <div v-else-if="wiktEntries.length === 0" class="wikt-empty">
          No Wiktionary entry found. Make sure <code>data/raw/de-extract.jsonl</code> exists.
        </div>
        <div v-for="(entry, i) in wiktEntries" :key="i" class="wikt-entry">
          <div class="wikt-header">
            <strong>{{ entry.word }}</strong>
            <span class="wikt-pos">{{ entry.pos }}</span>
            <span v-if="entry.tags?.length" class="wikt-tags">{{ entry.tags.join(', ') }}</span>
          </div>
          <pre class="wikt-json">{{ formatJson(entry) }}</pre>
        </div>
      </div>

      <!-- JSON tab -->
      <div v-if="activeTab === 'JSON'" class="tab-content">
        <pre class="raw-json">{{ formatJson(wordData) }}</pre>
      </div>
    </main>

    <main v-else class="word-detail word-detail--empty">
      <p>Select a word from the list to view details.</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import NounDeclension from "@shared/components/NounDeclension.vue";
import VerbConjugation from "@shared/components/VerbConjugation.vue";
import AdjectiveDeclension from "@shared/components/AdjectiveDeclension.vue";
import PronounDeclension from "@shared/components/PronounDeclension.vue";
import DeterminerDeclension from "@shared/components/DeterminerDeclension.vue";

interface PosCount { pos: string; count: number }
interface WordListItem { pos: string; file: string; word: string; gloss_en?: string; zipf?: number; flags?: string[] }
interface ExampleData {
  text: string;
  translation?: string;
  annotations?: { form: string; lemma: string; pos: string; gloss_hint?: string | null }[];
}

const FILTER_OPTIONS = [
  { value: "unproofread", short: "Unpr", label: "Unproofread", cls: "filter-unproofread" },
  { value: "missing_en", short: "Miss", label: "Missing gloss_en", cls: "filter-missing" },
  { value: "overrides", short: "Ovr", label: "Has _overrides", cls: "filter-override" },
  { value: "manual", short: "Man", label: "Manual entry", cls: "filter-manual" },
] as const;

const searchQuery = ref("");
const selectedPos = ref<string | null>(null);
const selectedFile = ref<string | null>(null);
const posList = ref<PosCount[]>([]);
const wordItems = ref<WordListItem[]>([]);
const wordData = ref<any>(null);
const examples = ref<Record<string, ExampleData>>({});
const wiktEntries = ref<any[]>([]);
const wiktLoading = ref(false);
const loadingList = ref(false);
const activeTab = ref("Senses");
const listOffset = ref(0);
const listTotal = ref(0);
const PAGE_SIZE = 200;
const activeFilters = ref(new Set<string>());
const sortMode = ref("alpha");

// Editing state
const dirty = ref(false);
const saving = ref(false);
const saveMsg = ref("");
const saveError = ref(false);
const translating = ref<Record<number, boolean>>({});
const providers = ref<{ name: string; model: string; hasKey: boolean }[]>([]);
const llmProvider = ref("anthropic");
const llmModel = ref("");

const hasMore = computed(() => listOffset.value + PAGE_SIZE < listTotal.value);
const genderClass = computed(() => {
  const g = wordData.value?.gender;
  if (g === "M") return "gender-m";
  if (g === "F") return "gender-f";
  if (g === "N") return "gender-n";
  return "";
});
const hasGrammar = computed(() => {
  const w = wordData.value;
  if (!w) return false;
  if (w.pos === "noun" && w.case_forms) return true;
  if (w.pos === "verb" && w.conjugation) return true;
  if (w.pos === "adjective") return true;
  if (w.pos === "pronoun") return true;
  if (w.pos === "determiner") return true;
  return false;
});
const detailTabs = computed(() => {
  const tabs = ["Senses"];
  if (hasGrammar.value) tabs.push("Grammar");
  tabs.push("Wiktionary", "JSON");
  return tabs;
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function toggleFilter(flag: string) {
  const s = new Set(activeFilters.value);
  if (s.has(flag)) s.delete(flag); else s.add(flag);
  activeFilters.value = s;
  fetchWordList(true);
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => fetchWordList(true), 150);
}

async function fetchPosList() {
  const res = await fetch("/api/pos");
  posList.value = await res.json();
}

async function fetchWordList(reset = false) {
  if (reset) { listOffset.value = 0; wordItems.value = []; }
  loadingList.value = true;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(listOffset.value),
    sort: sortMode.value,
  });
  if (selectedPos.value) params.set("pos", selectedPos.value);
  if (searchQuery.value) params.set("q", searchQuery.value);
  if (activeFilters.value.size) params.set("filter", [...activeFilters.value].join(","));

  const res = await fetch(`/api/words?${params}`);
  const data = await res.json();
  listTotal.value = data.total;
  if (reset) wordItems.value = data.items;
  else wordItems.value = [...wordItems.value, ...data.items];
  loadingList.value = false;
}

function loadMore() {
  listOffset.value += PAGE_SIZE;
  fetchWordList(false);
}

function selectPos(pos: string) {
  selectedPos.value = selectedPos.value === pos ? null : pos;
  fetchWordList(true);
}

async function selectWord(item: WordListItem) {
  selectedFile.value = item.pos + "/" + item.word;
  activeTab.value = "Senses";
  wiktEntries.value = [];
  dirty.value = false;
  saveMsg.value = "";

  const res = await fetch(`/api/words/${item.pos}/${encodeURIComponent(item.word)}`);
  const data = await res.json();
  wordData.value = data.word;
  examples.value = data.examples || {};
}

async function fetchWiktionary() {
  if (!wordData.value) return;
  wiktLoading.value = true;
  const params = new URLSearchParams({
    word: wordData.value.word,
    exact: "true",
  });
  const posMap: Record<string, string> = {
    noun: "noun", verb: "verb", adjective: "adj",
    adverb: "adv", preposition: "prep",
  };
  if (posMap[wordData.value.pos]) params.set("pos", posMap[wordData.value.pos]);

  const res = await fetch(`/api/lookup?${params}`);
  const data = await res.json();
  wiktEntries.value = data.results || [];
  wiktLoading.value = false;
}

watch(activeTab, (tab) => {
  if (tab === "Wiktionary" && wiktEntries.value.length === 0 && !wiktLoading.value) {
    fetchWiktionary();
  }
});

function updateSense(index: number, field: string, value: any) {
  if (!wordData.value?.senses?.[index]) return;
  wordData.value.senses[index][field] = value;
  dirty.value = true;
  saveMsg.value = "";
}

function toggleProofread(field: string, checked: boolean) {
  if (!wordData.value) return;
  if (!wordData.value._proofread) wordData.value._proofread = {};
  wordData.value._proofread[field] = checked || undefined;
  dirty.value = true;
  saveMsg.value = "";
}

async function saveWord() {
  if (!wordData.value || !selectedFile.value) return;
  saving.value = true;
  saveMsg.value = "";
  saveError.value = false;

  const [pos, word] = selectedFile.value.split("/");
  const body: any = {
    senses: wordData.value.senses.map((s: any, i: number) => ({
      index: i,
      gloss_en: s.gloss_en,
      gloss_en_full: s.gloss_en_full,
      synonyms_en: s.synonyms_en,
    })),
    _proofread: wordData.value._proofread || {},
  };

  try {
    const res = await fetch(`/api/words/${pos}/${encodeURIComponent(word)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      dirty.value = false;
      saveMsg.value = "Saved";
    } else {
      saveError.value = true;
      saveMsg.value = data.error || "Save failed";
    }
  } catch (e: any) {
    saveError.value = true;
    saveMsg.value = e.message || "Save failed";
  } finally {
    saving.value = false;
  }
}

function discardChanges() {
  if (!selectedFile.value) return;
  const [pos, word] = selectedFile.value.split("/");
  selectWord({ pos, file: word + ".json", word });
  dirty.value = false;
  saveMsg.value = "";
}

async function translateSense(index: number, mode: "short" | "full") {
  if (!wordData.value?.senses?.[index]) return;
  const sense = wordData.value.senses[index];
  if (!sense.gloss) return;

  translating.value = { ...translating.value, [index]: true };
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: wordData.value.word,
        pos: wordData.value.pos,
        gloss: sense.gloss,
        mode,
        provider: llmProvider.value,
        model: llmModel.value || undefined,
        phrase_type: wordData.value.phrase_type,
      }),
    });
    const data = await res.json();
    if (data.translation) {
      const field = mode === "full" ? "gloss_en_full" : "gloss_en";
      sense[field] = data.translation;
      dirty.value = true;
      saveMsg.value = "";
    }
  } catch { /* ignore */ }
  finally {
    translating.value = { ...translating.value, [index]: false };
  }
}

async function fetchProviders() {
  try {
    const res = await fetch("/api/providers");
    providers.value = await res.json();
  } catch { /* ignore */ }
}

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

onMounted(async () => {
  const route = useRoute();
  fetchProviders();
  await fetchPosList();
  await fetchWordList(true);

  const open = route.query.open as string | undefined;
  if (open) {
    const slash = open.indexOf("/");
    if (slash > 0) {
      const pos = open.slice(0, slash);
      const word = open.slice(slash + 1);
      selectedPos.value = pos;
      await fetchWordList(true);
      selectWord({ pos, file: word + ".json", word });
    }
  }
});
</script>

<style scoped>
.word-browser {
  display: flex;
  gap: 1.5rem;
  height: calc(100vh - 80px);
  margin: -2rem -1.5rem;
  padding: 1rem 1.5rem;
}

/* Sidebar */
.word-sidebar {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: hidden;
}

.search-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s;
}
.search-input:focus { border-color: #1a73e8; }

.filter-bar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.filter-toggles {
  display: flex;
  gap: 3px;
  flex: 1;
}
.filter-btn {
  padding: 2px 7px;
  border: 1px solid #ddd;
  border-radius: 10px;
  background: white;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  color: #666;
}
.filter-btn:hover { background: #f0f0f0; }
.filter-btn.filter-unproofread.active { background: #fff3e0; border-color: #ffb74d; color: #e65100; }
.filter-btn.filter-missing.active { background: #ffebee; border-color: #ef9a9a; color: #c62828; }
.filter-btn.filter-override.active { background: #fce4ec; border-color: #f48fb1; color: #ad1457; }
.filter-btn.filter-manual.active { background: #e3f2fd; border-color: #90caf9; color: #1565c0; }

.sort-select {
  padding: 2px 4px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.7rem;
  background: white;
  color: #555;
  cursor: pointer;
  outline: none;
}

.pos-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pos-tab {
  padding: 2px 8px;
  border: 1px solid #ddd;
  border-radius: 12px;
  background: white;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.pos-tab:hover { background: #f0f0f0; }
.pos-tab.active { background: #1a73e8; color: white; border-color: #1a73e8; }
.pos-count { opacity: 0.6; margin-left: 2px; }

.word-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
}

.word-item {
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.85rem;
}
.word-item:hover { background: #f5f8ff; }
.word-item.active { background: #e8f0fe; font-weight: 600; }
.word-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
.word-meta { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 4px; }
.word-gloss-preview {
  font-size: 0.7rem;
  color: #888;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}
.word-pos-badge {
  font-size: 0.7rem;
  color: #888;
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
}
.flag-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.flag-missing { background: #d32f2f; }
.flag-override { background: #ff9800; }

.word-zipf-badge {
  font-size: 0.65rem;
  color: #999;
  font-family: monospace;
  flex-shrink: 0;
}

.word-list-empty, .word-list-more {
  padding: 1rem;
  text-align: center;
  color: #888;
  font-size: 0.85rem;
}
.word-list-more button {
  padding: 0.25rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

/* Detail */
.word-detail {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
.word-detail--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #888;
}

.word-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.badge {
  font-size: 0.7rem;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.badge-proofread { background: #e8f5e9; color: #2e7d32; }
.badge-unproofread { background: #fff3e0; color: #e65100; }
.badge-override { background: #fce4ec; color: #c62828; }
.badge-manual { background: #e3f2fd; color: #1565c0; }
.word-header h1 { font-size: 1.5rem; margin: 0; }
.word-article { font-weight: 400; }
.gender-m { color: var(--color-gender-m, #1976d2); }
.gender-f { color: var(--color-gender-f, #c2185b); }
.gender-n { color: var(--color-gender-n, #388e3c); }
.word-pos-label {
  background: #e8f0fe;
  color: #1a73e8;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
}
.word-zipf {
  font-size: 0.8rem;
  color: #888;
}

/* Tabs */
.detail-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #e0e0e0;
  margin-bottom: 1rem;
}
.detail-tab {
  padding: 0.5rem 1rem;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: #666;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.15s;
}
.detail-tab:hover { color: #1a73e8; }
.detail-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; font-weight: 600; }

.tab-content { min-height: 200px; }

/* Senses */
.sense-card {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f0f0f0;
}
.sense-number {
  color: #999;
  font-size: 0.8rem;
  font-weight: 600;
  flex-shrink: 0;
  padding-top: 2px;
}
.sense-body { flex: 1; min-width: 0; }
.sense-gloss { font-size: 0.9rem; color: #333; }
.sense-gloss-en { font-size: 0.9rem; color: #1a73e8; margin-top: 2px; }
.sense-gloss-full { font-size: 0.8rem; color: #666; font-style: italic; margin-top: 2px; }
.sense-tags { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.sense-tag {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 8px;
  background: #f5f0ff;
  color: #7c3aed;
}
.sense-synonyms { font-size: 0.8rem; color: #666; margin-top: 4px; }

/* Examples */
.sense-examples { margin-top: 0.5rem; }
.example-card {
  background: #fafafa;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-top: 0.35rem;
  font-size: 0.85rem;
}
.example-text { color: #1a1a1a; }
.example-translation { color: #666; font-style: italic; margin-top: 2px; }
.example-annotations { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.annotation-pill {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 8px;
  background: #e8f0fe;
  color: #1a73e8;
  cursor: help;
}
.example-missing { color: #ccc; font-size: 0.75rem; font-family: monospace; }

/* Editing */
.senses-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e0e0e0;
  gap: 0.75rem;
}
.proofread-toggle {
  font-size: 0.8rem;
  color: #555;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.proofread-toggle input { cursor: pointer; }
.llm-provider-bar {
  display: flex;
  gap: 4px;
  align-items: center;
}
.llm-select {
  padding: 2px 4px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.75rem;
  background: white;
}
.llm-model-input {
  width: 120px;
  padding: 2px 6px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.75rem;
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
}
.edit-label {
  font-size: 0.7rem;
  color: #999;
  width: 72px;
  flex-shrink: 0;
  text-align: right;
}
.edit-input {
  flex: 1;
  padding: 2px 6px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 0.82rem;
  outline: none;
  transition: border-color 0.15s;
}
.edit-input:focus { border-color: #1a73e8; }
.btn-llm {
  padding: 1px 6px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff8e1;
  cursor: pointer;
  font-size: 0.75rem;
  transition: background 0.15s;
  flex-shrink: 0;
}
.btn-llm:hover:not(:disabled) { background: #ffecb3; }
.btn-llm:disabled { opacity: 0.4; cursor: default; }

.save-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid #e0e0e0;
}
.btn-save {
  padding: 0.35rem 1rem;
  border: none;
  border-radius: 6px;
  background: #1a73e8;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.15s;
}
.btn-save:hover:not(:disabled) { background: #1565c0; }
.btn-save:disabled { opacity: 0.5; cursor: default; }
.btn-discard {
  padding: 0.35rem 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn-discard:hover { background: #f5f5f5; }
.save-msg { font-size: 0.8rem; color: #2e7d32; }
.save-msg.save-error { color: #c62828; }

/* Grammar */
.no-grammar { color: #888; font-style: italic; }

/* Wiktionary */
.wikt-loading, .wikt-empty { color: #888; font-style: italic; }
.wikt-entry { margin-bottom: 1.5rem; }
.wikt-header { display: flex; gap: 0.5rem; align-items: baseline; margin-bottom: 0.5rem; }
.wikt-pos { color: #1a73e8; font-size: 0.85rem; }
.wikt-tags { color: #888; font-size: 0.8rem; }
.wikt-json {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.75rem;
  overflow-x: auto;
  max-height: 600px;
  overflow-y: auto;
}

/* Raw JSON */
.raw-json {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.75rem;
  overflow-x: auto;
  max-height: 80vh;
  overflow-y: auto;
}
</style>
