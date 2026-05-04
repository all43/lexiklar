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
        <div v-for="(sense, i) in wordData.senses" :key="i" class="sense-card">
          <div class="sense-number">#{{ i + 1 }}</div>
          <div class="sense-body">
            <div class="sense-gloss">{{ sense.gloss }}</div>
            <div v-if="sense.gloss_en" class="sense-gloss-en">{{ sense.gloss_en }}</div>
            <div v-if="sense.gloss_en_full" class="sense-gloss-full">{{ sense.gloss_en_full }}</div>
            <div v-if="sense.tags?.length" class="sense-tags">
              <span v-for="tag in sense.tags" :key="tag" class="sense-tag">{{ tag }}</span>
            </div>
            <div v-if="sense.synonyms_en?.length" class="sense-synonyms">
              EN synonyms: {{ sense.synonyms_en.join(', ') }}
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
      </div>

      <!-- Grammar tab -->
      <div v-if="activeTab === 'Grammar'" class="tab-content">
        <NounDeclension v-if="wordData.pos === 'noun' && wordData.case_forms" :word="wordData" />
        <VerbConjugation v-if="wordData.pos === 'verb' && wordData.conjugation" :verb="wordData" />
        <AdjectiveDeclension v-if="wordData.pos === 'adjective'" :word="wordData" />
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

interface PosCount { pos: string; count: number }
interface WordListItem { pos: string; file: string; word: string; gloss_en?: string; zipf?: number; flags?: string[] }
interface ExampleData {
  text: string;
  translation?: string;
  annotations?: { form: string; lemma: string; pos: string; gloss_hint?: string | null }[];
}

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
  return false;
});
const detailTabs = computed(() => {
  const tabs = ["Senses"];
  if (hasGrammar.value) tabs.push("Grammar");
  tabs.push("Wiktionary", "JSON");
  return tabs;
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;

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
    flags: "true",
  });
  if (selectedPos.value) params.set("pos", selectedPos.value);
  if (searchQuery.value) params.set("q", searchQuery.value);

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

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

onMounted(async () => {
  const route = useRoute();
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
