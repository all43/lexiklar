<template>
  <div class="word-browser">
    <!-- Left: POS sidebar + word list -->
    <aside class="word-sidebar">
      <div class="search-row">
        <input
          v-model="searchQuery"
          class="search-input"
          type="search"
          placeholder="Search words…"
          @input="onSearch"
        />
        <select v-model="searchMode" class="search-mode-select" @change="onSearchModeChange">
          <option value="source">Source</option>
          <option value="db">App DB</option>
        </select>
      </div>
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
        <template v-if="searchMode === 'source'">
          <div v-if="loadingList && wordItems.length === 0" class="list-loading">
            <span class="spinner spinner--md"></span>
          </div>
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
              <span v-if="item.inDb === false" class="db-status db-status--out" title="Not in app DB">∅ not in DB</span>
              <span v-if="item.gloss_en" class="word-gloss-preview">{{ item.gloss_en }}</span>
              <span v-if="!selectedPos" class="word-pos-badge">{{ item.pos }}</span>
            </span>
          </div>
          <div v-if="wordItems.length === 0 && !loadingList" class="word-list-empty">
            No words found
            <div v-if="wiktChecking" class="wikt-checking">
              <span class="spinner spinner--sm"></span> Checking Wiktionary…
            </div>
            <div v-if="wiktHint" class="wikt-hint">
              <template v-if="wiktHint.wiktEntries.length">
                <span class="wikt-hint-label">In Wiktionary:</span>
                <span v-for="e in wiktHint.wiktEntries" :key="e.pos" class="wikt-hint-entry">
                  {{ e.pos }}<template v-if="e.tags.includes('masculine')"> M</template><template v-else-if="e.tags.includes('feminine')"> F</template><template v-else-if="e.tags.includes('neuter')"> N</template>
                  <template v-if="e.glosses.length"> — {{ e.glosses[0] }}</template>
                </span>
                <div class="wikt-hint-actions">
                  <button class="btn-add-word" @click="addWordFromWiktionary" :disabled="addingWord">
                    {{ addingWord ? 'Adding…' : '+ Add to pipeline' }}
                  </button>
                  <span v-if="addWordMsg" class="add-word-msg" :class="{ 'add-word-error': addWordError }">{{ addWordMsg }}</span>
                </div>
              </template>
              <template v-else>
                <span class="wikt-hint-none">Not in Wiktionary either</span>
              </template>
            </div>
          </div>
          <div v-if="loadingList && wordItems.length > 0" class="list-loading list-loading--more">
            <span class="spinner spinner--md"></span>
          </div>
          <div v-if="hasMore && !loadingList" class="word-list-more">
            <button @click="loadMore">Load more…</button>
          </div>
        </template>
        <template v-else>
          <div v-if="loadingDb && dbResults.length === 0" class="list-loading">
            <span class="spinner spinner--md"></span>
          </div>
          <div
            v-for="result in dbResults"
            :key="result.file"
            class="word-item"
            :class="{ active: selectedFile === result.file }"
            @click="selectDbResult(result)"
          >
            <span class="word-name">
              {{ result.lemma }}
              <span v-if="result.formMatch" class="flag-form" title="Matched via inflected form">~</span>
            </span>
            <span class="word-meta">
              <span v-if="result.gender" class="db-gender-badge" :class="`gender-${result.gender.toLowerCase()}`">{{ result.gender }}</span>
              <span v-if="result.frequency !== null" class="db-freq-badge">#{{ result.frequency }}</span>
              <span v-if="result.glossEn?.[0]" class="word-gloss-preview">{{ result.glossEn[0] }}</span>
              <span class="word-pos-badge">{{ result.pos }}</span>
            </span>
          </div>
          <div v-if="dbResults.length === 0 && !loadingDb" class="word-list-empty">
            {{ searchQuery ? 'No results' : 'Type to search' }}
          </div>
        </template>
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
                class="edit-input admin-text-input"
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
                class="edit-input admin-text-input"
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
                class="edit-input admin-text-input"
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

      <!-- Overrides tab -->
      <div v-if="activeTab === 'Overrides'" class="tab-content">
        <div class="ovr-section">
          <h3>Antonym</h3>
          <div class="ovr-row">
            <label class="ovr-label">word</label>
            <WordSearchSelect
              :modelValue="overrides.antonym?.word || ''"
              placeholder="Search word…"
              @update:modelValue="setOverride('antonym', { ...(overrides.antonym || {}), word: $event })"
              @select="setOverride('antonym', { ...(overrides.antonym || {}), word: $event.word })"
            />
            <label class="ovr-check">
              <input
                type="checkbox"
                :checked="overrides.antonym?.negative"
                @change="setOverride('antonym', { ...(overrides.antonym || {}), negative: ($event.target as HTMLInputElement).checked || undefined })"
              /> negative
            </label>
            <button v-if="overrides.antonym?.word" class="btn-ovr-clear" @click="clearOverride('antonym')">×</button>
          </div>
        </div>

        <div class="ovr-section">
          <h3>Confusable Pairs</h3>
          <div class="ovr-row">
            <label class="ovr-label">this_note</label>
            <input
              class="edit-input admin-text-input"
              :value="overrides.confusable_pairs?.this_note || ''"
              @change="setConfusableNote(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div v-for="(pair, pi) in (overrides.confusable_pairs?.pairs || [])" :key="pi" class="ovr-pair">
            <div class="ovr-row">
              <label class="ovr-label">en_word</label>
              <input
                class="edit-input admin-text-input"
                :value="pair.en_word"
                @change="updateConfusablePair(pi, 'en_word', ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="ovr-row">
              <label class="ovr-label">other</label>
              <WordSearchSelect
                :modelValue="pair.other"
                placeholder="Search word…"
                @update:modelValue="updateConfusablePair(pi, 'other', $event)"
                @select="updateConfusablePair(pi, 'other', $event.word)"
              />
              <button class="btn-ovr-clear" @click="removeConfusablePair(pi)">×</button>
            </div>
          </div>
          <button class="btn-ovr-add" @click="addConfusablePair">+ Add pair</button>
        </div>

        <div class="ovr-section">
          <h3>False Friend (EN)</h3>
          <div class="ovr-row">
            <label class="ovr-label">en_word</label>
            <input
              class="edit-input admin-text-input"
              :value="overrides.false_friend_en?.en_word || ''"
              @change="setFalseFriendField('en_word', ($event.target as HTMLInputElement).value)"
            />
            <button v-if="overrides.false_friend_en" class="btn-ovr-clear" @click="clearOverride('false_friend_en')">×</button>
          </div>
        </div>

        <div class="ovr-section">
          <h3>Sense Order</h3>
          <div class="ovr-row">
            <label class="ovr-label">first_sense</label>
            <input
              class="edit-input admin-text-input"
              :value="overrides.first_sense || ''"
              @change="setOverride('first_sense', ($event.target as HTMLInputElement).value || undefined)"
              placeholder="gloss_en value to show first"
            />
          </div>
        </div>

        <div class="ovr-section">
          <h3>Raw JSON</h3>
          <textarea
            class="ovr-json"
            :value="overridesJson"
            @change="onOverridesJsonChange(($event.target as HTMLTextAreaElement).value)"
          ></textarea>
          <div v-if="jsonError" class="ovr-json-error">{{ jsonError }}</div>
        </div>

        <div class="save-bar" v-if="dirty">
          <button class="btn-save" @click="saveWord" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save changes' }}
          </button>
          <button class="btn-discard" @click="discardChanges">Discard</button>
          <span v-if="saveMsg" class="save-msg" :class="{ 'save-error': saveError }">{{ saveMsg }}</span>
        </div>
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
import WordSearchSelect from "../components/WordSearchSelect.vue";

interface PosCount { pos: string; count: number }
interface WordListItem { pos: string; file: string; word: string; gloss_en?: string; zipf?: number; flags?: string[]; inDb?: boolean }
interface DbSearchResult { lemma: string; pos: string; gender: string | null; frequency: number | null; pluralForm: string | null; file: string; glossEn: string[]; formMatch?: boolean }
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
const searchMode = ref<"source" | "db">("source");
const dbResults = ref<DbSearchResult[]>([]);
const loadingDb = ref(false);
interface WiktHint { inPipeline: boolean; wiktEntries: { pos: string; tags: string[]; glosses: string[] }[] }
const wiktHint = ref<WiktHint | null>(null);
const wiktChecking = ref(false);
const addingWord = ref(false);
const addWordMsg = ref("");
const addWordError = ref(false);
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
const jsonError = ref("");

const overrides = computed(() => wordData.value?._overrides || {});
const overridesJson = computed(() => JSON.stringify(overrides.value, null, 2));

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
  tabs.push("Overrides", "Wiktionary", "JSON");
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
  if (searchMode.value === "db") {
    searchTimer = setTimeout(() => fetchDbSearch(), 150);
  } else {
    searchTimer = setTimeout(() => fetchWordList(true), 150);
  }
}

function onSearchModeChange() {
  if (searchMode.value === "db") {
    fetchDbSearch();
  } else {
    fetchWordList(true);
  }
}

async function fetchDbSearch() {
  if (!searchQuery.value) { dbResults.value = []; return; }
  loadingDb.value = true;
  try {
    const res = await fetch(`/api/db-search?q=${encodeURIComponent(searchQuery.value)}`);
    const data = await res.json();
    dbResults.value = data.results || [];
  } catch { dbResults.value = []; }
  finally { loadingDb.value = false; }
}

async function addWordFromWiktionary() {
  addingWord.value = true;
  addWordMsg.value = "";
  addWordError.value = false;
  try {
    const res = await fetch("/api/add-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: searchQuery.value }),
    });
    const data = await res.json();
    if (data.ok && data.file) {
      const slash = data.file.indexOf("/");
      const pos = data.file.slice(0, slash);
      const word = data.file.slice(slash + 1);
      wiktHint.value = null;
      await fetchWordList(true);
      selectWord({ pos, file: word + ".json", word });
    } else {
      addWordError.value = true;
      addWordMsg.value = data.error || "Failed — word may not exist in Wiktionary dump";
    }
  } catch (e: any) {
    addWordError.value = true;
    addWordMsg.value = e.message || "Network error";
  } finally {
    addingWord.value = false;
  }
}

function selectDbResult(result: DbSearchResult) {
  const slash = result.file.indexOf("/");
  const pos = result.file.slice(0, slash);
  const word = result.file.slice(slash + 1);
  selectWord({ pos, file: word + ".json", word });
}

async function fetchPosList() {
  const res = await fetch("/api/pos");
  posList.value = await res.json();
}

async function fetchWordList(reset = false) {
  if (reset) { listOffset.value = 0; wordItems.value = []; wiktHint.value = null; wiktChecking.value = false; }
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

  if (reset && data.total === 0 && searchQuery.value.length >= 2) {
    wiktChecking.value = true;
    wiktHint.value = null;
    try {
      const r = await fetch(`/api/wikt-check?word=${encodeURIComponent(searchQuery.value)}`);
      wiktHint.value = await r.json();
    } finally {
      wiktChecking.value = false;
    }
  }
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
    _overrides: wordData.value._overrides || {},
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

function ensureOverrides() {
  if (!wordData.value) return;
  if (!wordData.value._overrides) wordData.value._overrides = {};
}

function setOverride(key: string, value: any) {
  ensureOverrides();
  if (value === undefined || value === "" || (typeof value === "object" && value && !Object.values(value).some(Boolean))) {
    delete wordData.value._overrides[key];
  } else {
    wordData.value._overrides[key] = value;
  }
  dirty.value = true;
  saveMsg.value = "";
}

function clearOverride(key: string) {
  ensureOverrides();
  delete wordData.value._overrides[key];
  dirty.value = true;
  saveMsg.value = "";
}

function setConfusableNote(note: string) {
  ensureOverrides();
  const cp = wordData.value._overrides.confusable_pairs || { this_note: "", pairs: [] };
  cp.this_note = note;
  wordData.value._overrides.confusable_pairs = cp;
  dirty.value = true;
  saveMsg.value = "";
}

function updateConfusablePair(index: number, field: string, value: string) {
  ensureOverrides();
  const cp = wordData.value._overrides.confusable_pairs;
  if (!cp?.pairs?.[index]) return;
  cp.pairs[index][field] = value;
  dirty.value = true;
  saveMsg.value = "";
}

function addConfusablePair() {
  ensureOverrides();
  if (!wordData.value._overrides.confusable_pairs) {
    wordData.value._overrides.confusable_pairs = { this_note: "", pairs: [] };
  }
  wordData.value._overrides.confusable_pairs.pairs.push({ en_word: "", other: "" });
  dirty.value = true;
  saveMsg.value = "";
}

function removeConfusablePair(index: number) {
  const cp = wordData.value?._overrides?.confusable_pairs;
  if (!cp?.pairs) return;
  cp.pairs.splice(index, 1);
  if (!cp.pairs.length && !cp.this_note) clearOverride("confusable_pairs");
  dirty.value = true;
  saveMsg.value = "";
}

function setFalseFriendField(field: string, value: string) {
  ensureOverrides();
  if (!value && !overrides.value.false_friend_en) return;
  const ff = wordData.value._overrides.false_friend_en || { en_word: "", meanings: [] };
  (ff as any)[field] = value;
  wordData.value._overrides.false_friend_en = ff;
  dirty.value = true;
  saveMsg.value = "";
}

function onOverridesJsonChange(text: string) {
  jsonError.value = "";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      jsonError.value = "Must be a JSON object";
      return;
    }
    if (!wordData.value) return;
    wordData.value._overrides = parsed;
    dirty.value = true;
    saveMsg.value = "";
  } catch (e: any) {
    jsonError.value = e.message;
  }
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

.search-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.search-input {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--admin-transition);
}
.search-input:focus { border-color: var(--admin-primary); }

.search-mode-select {
  padding: 4px 5px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  font-size: 0.72rem;
  background: white;
  color: var(--admin-text-medium);
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}

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
  border: 1px solid var(--admin-border-ui);
  border-radius: 10px;
  background: white;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all var(--admin-transition);
  white-space: nowrap;
  color: var(--admin-text-secondary);
}
.filter-btn:hover { background: var(--admin-subtle); }
.filter-btn.filter-unproofread.active { background: #fff3e0; border-color: #ffb74d; color: #e65100; }
.filter-btn.filter-missing.active { background: #ffebee; border-color: #ef9a9a; color: #c62828; }
.filter-btn.filter-override.active { background: #fce4ec; border-color: #f48fb1; color: #ad1457; }
.filter-btn.filter-manual.active { background: #e3f2fd; border-color: #90caf9; color: var(--admin-primary-dark); }

.sort-select {
  padding: 2px 4px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  font-size: 0.7rem;
  background: white;
  color: var(--admin-text-medium);
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
  border: 1px solid var(--admin-border-ui);
  border-radius: 12px;
  background: white;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--admin-transition);
  white-space: nowrap;
}
.pos-tab:hover { background: var(--admin-subtle); }
.pos-tab.active { background: var(--admin-primary); color: white; border-color: var(--admin-primary); }
.pos-count { opacity: 0.6; margin-left: 2px; }

.word-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  background: white;
}

.word-item {
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--admin-subtle);
  font-size: 0.85rem;
}
.word-item:hover { background: #f5f8ff; }
.word-item.active { background: var(--admin-primary-bg); font-weight: 600; }
.word-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
.word-meta { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: 4px; }
.word-gloss-preview {
  font-size: 0.7rem;
  color: var(--admin-text-muted);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}
.word-pos-badge {
  font-size: 0.7rem;
  color: var(--admin-text-muted);
  background: var(--admin-subtle);
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
.db-status--out {
  font-size: 0.6rem;
  font-weight: 600;
  border-radius: 3px;
  padding: 0 4px;
  flex-shrink: 0;
  color: #e65100;
  background: #fff3e0;
}

.word-zipf-badge {
  font-size: 0.65rem;
  color: var(--admin-text-faint);
  font-family: monospace;
  flex-shrink: 0;
}

.db-gender-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 8px;
  flex-shrink: 0;
}
.db-gender-badge.gender-m { color: var(--color-gender-m, #1976d2); background: #e3f2fd; }
.db-gender-badge.gender-f { color: var(--color-gender-f, #c2185b); background: #fce4ec; }
.db-gender-badge.gender-n { color: var(--color-gender-n, #388e3c); background: #e8f5e9; }

.db-freq-badge {
  font-size: 0.6rem;
  color: #bbb;
  font-family: monospace;
  flex-shrink: 0;
}

.flag-form {
  font-size: 0.65rem;
  color: #aaa;
  font-style: italic;
}

.word-list-empty, .word-list-more {
  padding: 1rem;
  text-align: center;
  color: var(--admin-text-muted);
  font-size: 0.85rem;
}

.list-loading {
  display: flex;
  justify-content: center;
  padding: 1.25rem 0;
}
.list-loading--more {
  padding: 0.5rem 0;
  border-top: 1px solid var(--admin-subtle);
}

.wikt-checking {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--admin-text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
}

.wikt-hint {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  text-align: left;
  background: #f0f7ff;
  border: 1px solid var(--admin-primary-hover);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wikt-hint-label {
  font-weight: 600;
  color: var(--admin-primary-dark);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.wikt-hint-entry {
  color: #333;
}
.wikt-hint-none {
  color: #aaa;
  font-style: italic;
}
.wikt-hint-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 4px;
}
.add-word-msg { font-size: 0.72rem; color: #2e7d32; }
.add-word-msg.add-word-error { color: #c62828; }
.word-list-more button {
  padding: 0.25rem 1rem;
  border: 1px solid var(--admin-border-ui);
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
  color: var(--admin-text-muted);
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
.badge-manual { background: #e3f2fd; color: var(--admin-primary-dark); }
.word-header h1 { font-size: 1.5rem; margin: 0; }
.word-article { font-weight: 400; }
.word-pos-label {
  background: var(--admin-primary-bg);
  color: var(--admin-primary);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
}
.word-zipf {
  font-size: 0.8rem;
  color: var(--admin-text-muted);
}

/* Tabs */
.detail-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--admin-border);
  margin-bottom: 1rem;
}
.detail-tab {
  padding: 0.5rem 1rem;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--admin-text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all var(--admin-transition);
}
.detail-tab:hover { color: var(--admin-primary); }
.detail-tab.active { color: var(--admin-primary); border-bottom-color: var(--admin-primary); font-weight: 600; }

.tab-content { min-height: 200px; }

/* Senses */
.sense-card {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--admin-subtle);
}
.sense-number {
  color: var(--admin-text-faint);
  font-size: 0.8rem;
  font-weight: 600;
  flex-shrink: 0;
  padding-top: 2px;
}
.sense-body { flex: 1; min-width: 0; }
.sense-gloss { font-size: 0.9rem; color: #333; }
.sense-gloss-en { font-size: 0.9rem; color: var(--admin-primary); margin-top: 2px; }
.sense-gloss-full { font-size: 0.8rem; color: var(--admin-text-secondary); font-style: italic; margin-top: 2px; }
.sense-tags { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.sense-tag {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 8px;
  background: #f5f0ff;
  color: #7c3aed;
}
.sense-synonyms { font-size: 0.8rem; color: var(--admin-text-secondary); margin-top: 4px; }

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
.example-translation { color: var(--admin-text-secondary); font-style: italic; margin-top: 2px; }
.example-annotations { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.annotation-pill {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--admin-primary-bg);
  color: var(--admin-primary);
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
  border-bottom: 1px solid var(--admin-border);
  gap: 0.75rem;
}
.proofread-toggle {
  font-size: 0.8rem;
  color: var(--admin-text-medium);
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
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  font-size: 0.75rem;
  background: white;
}
.llm-model-input {
  width: 120px;
  padding: 2px 6px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  font-size: 0.75rem;
}

.edit-row, .ovr-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
}
.edit-label {
  font-size: 0.7rem;
  color: var(--admin-text-faint);
  width: 72px;
  flex-shrink: 0;
  text-align: right;
}
.edit-input { flex: 1; }
.btn-llm {
  padding: 1px 6px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  background: #fff8e1;
  cursor: pointer;
  font-size: 0.75rem;
  transition: background var(--admin-transition);
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
  border-top: 1px solid var(--admin-border);
}
.btn-save {
  padding: 0.35rem 1rem;
  border: none;
  border-radius: 6px;
  background: var(--admin-primary);
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background var(--admin-transition);
}
.btn-save:hover:not(:disabled) { background: var(--admin-primary-dark); }
.btn-save:disabled { opacity: 0.5; cursor: default; }
.btn-discard {
  padding: 0.35rem 1rem;
  border: 1px solid var(--admin-border-ui);
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn-discard:hover { background: var(--admin-bg); }
.save-msg { font-size: 0.8rem; color: #2e7d32; }
.save-msg.save-error { color: #c62828; }

/* Overrides */
.ovr-section {
  margin-bottom: 1.25rem;
}
.ovr-section h3 {
  font-size: 0.85rem;
  color: var(--admin-text-medium);
  margin-bottom: 0.4rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid #eee;
}
.ovr-label {
  font-size: 0.7rem;
  color: var(--admin-text-faint);
  width: 64px;
  flex-shrink: 0;
  text-align: right;
}
.ovr-check {
  font-size: 0.75rem;
  color: var(--admin-text-secondary);
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  cursor: pointer;
}
.ovr-pair {
  background: #fafafa;
  border-radius: 6px;
  padding: 4px 6px;
  margin-top: 4px;
}
.btn-ovr-clear {
  padding: 0 6px;
  border: 1px solid var(--admin-border-ui);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--admin-text-faint);
  line-height: 1.4;
}
.btn-ovr-clear:hover { color: #c62828; border-color: #ef9a9a; }
.btn-ovr-add {
  padding: 2px 10px;
  border: 1px dashed #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--admin-text-muted);
  margin-top: 4px;
}
.btn-ovr-add:hover { border-color: var(--admin-primary); color: var(--admin-primary); }
.ovr-json {
  width: 100%;
  min-height: 120px;
  padding: 0.5rem;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.75rem;
  resize: vertical;
  outline: none;
}
.ovr-json:focus { border-color: var(--admin-primary); }
.ovr-json-error {
  font-size: 0.75rem;
  color: #c62828;
  margin-top: 2px;
}

/* Grammar */
.no-grammar { color: var(--admin-text-muted); font-style: italic; }

/* Wiktionary */
.wikt-loading, .wikt-empty { color: var(--admin-text-muted); font-style: italic; }
.wikt-entry { margin-bottom: 1.5rem; }
.wikt-header { display: flex; gap: 0.5rem; align-items: baseline; margin-bottom: 0.5rem; }
.wikt-pos { color: var(--admin-primary); font-size: 0.85rem; }
.wikt-tags { color: var(--admin-text-muted); font-size: 0.8rem; }
.wikt-json, .raw-json {
  background: var(--admin-bg);
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.75rem;
  overflow: auto;
  max-height: 600px;
}
.raw-json { max-height: 80vh; }
</style>
