<template>
  <f7-page name="search" :with-subnavbar="searchBarMode === 'subnavbar'" :class="{ 'page-searchbar-bottom': searchBarMode === 'bottom' }" @page:tabshow="onPageVisible" @page:afterin="onPageVisible">
    <f7-navbar title="Lexiklar">
      <f7-subnavbar v-if="searchBarMode === 'subnavbar' && isDbReady" :inner="false">
        <f7-searchbar
          custom-search
          :disable-button-text="t('search.cancel')"
          :placeholder="t('search.placeholder')"
          @searchbar:search="onSearch"
          @searchbar:clear="onClear"
        />
      </f7-subnavbar>
    </f7-navbar>

    <!-- ═══ DB not loaded ═══ -->
    <f7-block v-if="!isDbReady && !loading && !isSwUpdatePending" class="text-align-center db-error-block">
      <!-- Download prompt (DB not bundled on web) -->
      <template v-if="isDbDownloadNeeded && !dbDownloading">
        <p><b>{{ t('db.downloadTitle') }}</b></p>
        <p class="text-secondary">{{ t('db.downloadHint', { size: dbDownloadSizeLabel }) }}</p>
        <p v-if="dbDownloadError" class="text-color-red">{{ dbDownloadError }}</p>
        <f7-button fill @click="startDownload">{{ t('db.download') }}</f7-button>
      </template>
      <!-- Download in progress -->
      <template v-else-if="dbDownloading">
        <p><b>{{ t('db.downloading') }}</b></p>
        <f7-progressbar :progress="dbDownloadProgress" />
      </template>
      <!-- Download failed or other error -->
      <template v-else>
        <p><b>{{ t('db.notLoaded') }}</b></p>
        <p class="text-secondary">{{ t('db.notLoadedHint') }}</p>
        <f7-button fill @click="reload">{{ t('db.reload') }}</f7-button>
      </template>
    </f7-block>

    <!-- ═══ Search results (VL) — shown when a query is active ═══ -->
    <template v-else-if="searchQuery.length >= 2 || searchQuery.toLowerCase() === 'i'">
      <!-- Phrase suggestions from sequential searches -->
      <template v-if="phraseMatches.length">
        <f7-block-title>{{ t('search.matchingExpressions') }}</f7-block-title>
        <f7-list class="phrase-matches" media-list>
          <f7-list-item
            v-for="item in visiblePhrases"
            :key="item.file"
            :subtitle="item.glossEn?.[0] ?? ''"
            :link="`/word/${item.file}/`"
          >
            <template #title>
              <span v-html="highlightPhraseWords(item.lemma)"></span>
            </template>
            <template #after>
              <WordListBadges :pos="item.pos" />
            </template>
          </f7-list-item>
          <f7-list-button
            v-if="hiddenPhrasesCount > 0"
            :title="t('search.showMorePhrases').replace('{n}', String(hiddenPhrasesCount))"
            @click="phrasesExpanded = true"
          />
        </f7-list>
      </template>

      <f7-block-title v-if="phraseMatches.length && results.length > 0">{{ t('search.searchResults') }}</f7-block-title>
      <f7-list
        v-if="results.length > 0"
        class="search-results"
        media-list
        virtual-list
        :virtual-list-params="vlParams"
      >
        <ul>
          <f7-list-item
            v-for="item in vlData.items"
            :key="item.file"
            :title="itemTitle(item)"
            :subtitle="itemSubtitle(item)"
            :link="`/word/${item.file}/`"
            :style="`top: ${vlData.topPosition}px`"
            :virtual-list-index="item.index"
          >
            <template #after>
              <WordListBadges :pos="item.pos" :gender="item.gender" :plural-dominant="item.pluralDominant" />
            </template>
          </f7-list-item>
        </ul>
      </f7-list>
      <f7-list v-if="results.length > 0 && searchQuery.length >= 3" inset>
        <f7-list-button :title="t('report.notFound')" @click="reportMissing" />
      </f7-list>

      <f7-block v-if="!loading && results.length === 0">
        <p>{{ t('search.noResults') }}</p>
      </f7-block>
      <template v-if="!loading && results.length === 0 && suggestions.length > 0">
        <f7-block-title>{{ t('search.didYouMean') }}</f7-block-title>
        <f7-list inset media-list>
          <f7-list-item
            v-for="item in suggestions"
            :key="item.file"
            :title="itemTitle(item)"
            :subtitle="item.glossEn?.[0] ?? ''"
            :link="`/word/${item.file}/`"
          >
            <template #after>
              <WordListBadges :pos="item.pos" :gender="item.gender" :plural-dominant="item.pluralDominant" />
            </template>
          </f7-list-item>
        </f7-list>
      </template>
      <f7-list v-if="!loading && results.length === 0 && searchQuery.length >= 3" inset>
        <f7-list-button :title="t('report.missingWord').replace('{word}', searchQuery)" @click="reportMissing" />
      </f7-list>
    </template>

    <!-- ═══ Short query tip — shown for single char (except "i") ═══ -->
    <template v-else-if="searchQuery.length === 1">
      <f7-block>
        <p class="text-secondary">{{ t('search.typeMoreChars') }}</p>
      </f7-block>
    </template>

    <!-- ═══ Home screen — shown when no query ═══ -->
    <template v-else-if="isDbReady && !loading">
      <!-- Frequently Viewed -->
      <template v-if="freqWords.length">
        <f7-block-title>{{ t('search.frequentlyViewed') }}</f7-block-title>
        <f7-list class="home-list" media-list>
          <f7-list-item
            v-for="item in freqWords"
            :key="item.file"
            :title="itemTitle(item)"
            :subtitle="item.glossEn?.[0] ?? ''"
            :link="`/word/${item.file}/`"
          >
            <template #after>
              <WordListBadges :pos="item.pos" :gender="item.gender" :plural-dominant="item.pluralDominant" />
            </template>
          </f7-list-item>
        </f7-list>
      </template>

      <!-- Recently Visited (excludes items already in Frequently Viewed) -->
      <template v-if="recentWords.length">
        <f7-block-title>{{ t('search.recentlyVisited') }}</f7-block-title>
        <f7-list class="home-list" media-list>
          <f7-list-item
            v-for="item in recentWords"
            :key="item.file"
            :title="itemTitle(item)"
            :subtitle="item.glossEn?.[0] ?? ''"
            :link="`/word/${item.file}/`"
          >
            <template #after>
              <WordListBadges :pos="item.pos" :gender="item.gender" :plural-dominant="item.pluralDominant" />
            </template>
          </f7-list-item>
        </f7-list>
      </template>

      <!-- Empty state -->
      <f7-block v-if="!freqWords.length && !recentWords.length">
        <p class="text-secondary">{{ t('search.emptyHint') }}</p>
      </f7-block>
    </template>

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>

    <f7-subnavbar v-if="searchBarMode === 'bottom' && isDbReady" :inner="false" class="searchbar-bottom-toolbar">
      <f7-searchbar
        custom-search
        :disable-button-text="t('search.cancel')"
        :placeholder="t('search.placeholder')"
        @searchbar:search="onSearch"
        @searchbar:clear="onClear"
      />
    </f7-subnavbar>
  </f7-page>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { f7, theme as f7theme } from "framework7-vue";
import { t } from "../js/i18n.js";
import { submitReport } from "../utils/report.js";
import { isIOS26Plus } from "../utils/device.js";
import { getCached, setItem, SHOW_ARTICLES_KEY, SEARCH_BAR_POSITION_KEY, type SearchBarPosition } from "../utils/storage.js";
import type { SearchResult } from "../../types/search.js";
import WordListBadges from "../components/WordListBadges.vue";
import { wordListTitle, stripArticle, isArticle } from "../utils/word-list.js";
import {
  searchByLemma,
  searchByGlossEn,
  searchByWordForm,
  searchPhrasesByWords,
  getRelatedWords,
  getSuggestions,
  foldUmlauts,
  downloadDb,
} from "../utils/db.js";
import { dbReady, dbDownloadNeeded, dbDownloadSize, swUpdatePending } from "../utils/db-update-state.js";

interface SearchResultWithForm extends SearchResult {
  matchedForm?: string;
  articleMismatch?: string; // the wrong article the user typed (e.g. "der")
  index?: number;
}

interface VLData {
  items: SearchResultWithForm[];
  topPosition: number;
}

interface PhraseTerm {
  term: string;
  ts: number;
}

const RECENTS_KEY = "lexiklar_recents";
const COUNTS_KEY = "lexiklar_view_counts";
const PHRASE_TERMS_KEY = "lexiklar_phrase_terms";
const HOME_FREQ_COUNT = 5;
const HOME_RECENT_COUNT = 5;
const PHRASE_TERM_MAX_AGE_MS = 5 * 60 * 1000;

function loadPhraseTerms(): PhraseTerm[] {
  try {
    const raw = JSON.parse(getCached(PHRASE_TERMS_KEY) || "[]");
    if (raw.length && typeof raw[0] === "string") return [];
    return raw as PhraseTerm[];
  } catch { return []; }
}

// --- Reactive state ---
const results = ref<SearchResultWithForm[]>([]);
const suggestions = ref<SearchResult[]>([]);
const phraseMatches = ref<SearchResult[]>([]);
const phrasesExpanded = ref(false);
const phraseTerms = ref(loadPhraseTerms());
const matchedTerms = ref<string[]>([]);
const vlData = ref<VLData>({ items: [], topPosition: 0 });
let vl: unknown = null;
const searchQuery = ref("");
const freqWords = ref<SearchResult[]>([]);
const recentWords = ref<SearchResult[]>([]);
const loading = ref(true);
const dbDownloading = ref(false);
const dbDownloadProgress = ref(0);
const dbDownloadError = ref("");
const SEARCH_DEBOUNCE_MS = 300;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchGen = 0;
const showArticles = ref(getCached(SHOW_ARTICLES_KEY) !== "0");
const searchBarPosition = ref<SearchBarPosition>((getCached(SEARCH_BAR_POSITION_KEY) || "auto") as SearchBarPosition);

// --- Computed ---
const isDbReady = computed(() => dbReady.value);
const isDbDownloadNeeded = computed(() => dbDownloadNeeded.value);
const isSwUpdatePending = computed(() => swUpdatePending.value);
const dbDownloadSizeLabel = computed(() =>
  dbDownloadSize.value ? `${(dbDownloadSize.value / (1024 * 1024)).toFixed(0)} MB` : "~50 MB",
);

const searchBarMode = computed((): "subnavbar" | "bottom" => {
  if (searchBarPosition.value === "bottom") return "bottom";
  if (searchBarPosition.value === "top") return "subnavbar";
  return isIOS26Plus() ? "bottom" : "subnavbar";
});

const visiblePhrases = computed(() =>
  phrasesExpanded.value ? phraseMatches.value : phraseMatches.value.slice(0, 3)
);

const hiddenPhrasesCount = computed(() =>
  phraseMatches.value.length - visiblePhrases.value.length
);

const vlItems = computed(() =>
  results.value.map((item, i) => ({ ...item, index: i }))
);

const vlParams = computed(() => ({
  items: vlItems.value,
  renderExternal: renderExternal,
  height: (item: SearchResultWithForm) => {
    const hasSub = (item.glossEn?.length ?? 0) > 0 || !!item.matchedForm;
    return f7theme.ios ? (hasSub ? 63 : 44) : (hasSub ? 69 : 48);
  },
}));

// --- Methods ---
function reload() {
  window.location.reload();
}

async function startDownload() {
  dbDownloading.value = true;
  dbDownloadProgress.value = 0;
  dbDownloadError.value = "";
  try {
    await downloadDb((loaded, total) => {
      dbDownloadProgress.value = Math.round((loaded / total) * 100);
    });
    dbReady.value = true;
    dbDownloadNeeded.value = false;
    dbDownloading.value = false;
    loadHomeScreen();
  } catch (err) {
    console.error("DB download failed:", err);
    dbDownloading.value = false;
    const msg = (err as Error).message || "";
    dbDownloadError.value = msg.includes("Failed to fetch")
      ? t("db.downloadFailed")
      : msg || t("db.downloadFailed");
  }
}

function onPageVisible() {
  showArticles.value = getCached(SHOW_ARTICLES_KEY) !== "0";
  searchBarPosition.value = (getCached(SEARCH_BAR_POSITION_KEY) || "auto") as SearchBarPosition;
  phraseTerms.value = loadPhraseTerms();
  if (!searchQuery.value) loadHomeScreen();
}

function onSearch(searchbarOrQuery: unknown, query?: string) {
  searchQuery.value = (typeof searchbarOrQuery === "string" ? searchbarOrQuery : query) || "";
}

function onClear() {
  searchQuery.value = "";
}

function itemSubtitle(item: SearchResultWithForm): string {
  const displayTitle = item.pluralDominant ? item.pluralForm : item.lemma;
  if (item.matchedForm && item.matchedForm.toLowerCase() !== displayTitle?.toLowerCase()) {
    return `\u2190 ${item.matchedForm}`;
  }
  if (item.articleMismatch && item.gender) {
    const correct = item.gender === "M" ? "der" : item.gender === "F" ? "die" : "das";
    return t("search.articleMismatch", { wrong: item.articleMismatch, correct });
  }
  return item.glossEn?.[0] || "";
}

function itemTitle(item: SearchResultWithForm): string {
  return wordListTitle(item, showArticles.value);
}

function renderExternal(vlInstance: unknown, data: VLData) {
  vl = vlInstance;
  vlData.value = data;
}

function highlightPhraseWords(lemma: string): string {
  if (!matchedTerms.value.length) return lemma;
  const termsLower = matchedTerms.value.map(t => t.toLowerCase());
  const termsFolded = matchedTerms.value.map(t => foldUmlauts(t));
  return lemma.split(/(\s+)/).map(token => {
    if (/^\s+$/.test(token)) return token;
    const lower = token.toLowerCase();
    const folded = foldUmlauts(token);
    const matches = termsLower.includes(lower) || termsFolded.includes(folded);
    return matches ? `<b style="color: var(--f7-theme-color)">${token}</b>` : token;
  }).join("");
}

async function search(q: string, gen: number) {
  if (q.length < 2) {
    if (q.toLowerCase() === "i") {
      const hits = await searchByLemma("ich");
      if (gen !== searchGen) return;
      results.value = hits.filter(r => r.lemma.toLowerCase() === "ich");
    } else {
      results.value = [];
    }
    suggestions.value = [];
    phraseMatches.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  const qLower = q.toLowerCase();
  const qFolded = foldUmlauts(q);
  const artInfo = stripArticle(q);

  const searches: [Promise<SearchResult[]>, Promise<SearchResult[]>, Promise<SearchResult[]>, Promise<SearchResult[]>] = [
    searchByWordForm(q),
    searchByLemma(q),
    searchByGlossEn(q),
    artInfo ? searchByLemma(artInfo.remainder) : Promise.resolve([]),
  ];
  const [formHits, lemmaHits, enHits, artLemmaHits] = await Promise.all(searches);

  const seen = new Set<string>();
  const res: SearchResultWithForm[] = [];

  for (const r of formHits) {
    seen.add(r.file);
    res.push({ ...r, matchedForm: q });
  }

  const lemmaExact: SearchResult[] = [];
  const lemmaRest: SearchResult[] = [];
  for (const r of lemmaHits) {
    if (seen.has(r.file)) continue;
    const lemmaLower = r.lemma.toLowerCase();
    if (lemmaLower === qLower || foldUmlauts(r.lemma) === qFolded) lemmaExact.push(r);
    else lemmaRest.push(r);
  }

  const enExact: SearchResult[] = [];
  const enRest: SearchResult[] = [];
  for (const r of enHits) {
    if (seen.has(r.file)) continue;
    if (r.glossEn?.some(g => g.toLowerCase() === qLower)) enExact.push(r);
    else enRest.push(r);
  }

  // Article-stripped results: gender-matching first, then mismatching
  const artMatch: SearchResultWithForm[] = [];
  const artMismatch: SearchResultWithForm[] = [];
  if (artInfo && artLemmaHits.length) {
    for (const r of artLemmaHits) {
      if (seen.has(r.file)) continue;
      const genderMatches = r.gender
        ? artInfo.genders.includes(r.gender) || (artInfo.article === "die" && r.pluralDominant)
        : false;
      if (genderMatches) {
        artMatch.push(r);
      } else {
        artMismatch.push({ ...r, articleMismatch: artInfo.article });
      }
    }
  }

  // Merge: form hits → article-matching nouns → exact lemma/en → article-mismatching → prefix matches
  for (const r of artMatch) {
    if (!seen.has(r.file)) { seen.add(r.file); res.push(r); }
  }

  const exactMerged = [...lemmaExact, ...enExact]
    .sort((a, b) => (a.frequency ?? 999999) - (b.frequency ?? 999999));
  for (const r of exactMerged) {
    if (!seen.has(r.file)) {
      seen.add(r.file);
      res.push(r);
    }
  }

  for (const r of artMismatch) {
    if (!seen.has(r.file)) { seen.add(r.file); res.push(r); }
  }

  for (const r of lemmaRest) {
    if (!seen.has(r.file)) {
      seen.add(r.file);
      res.push(r);
    }
  }

  for (const r of enRest) {
    if (!seen.has(r.file)) {
      seen.add(r.file);
      res.push(r);
    }
  }

  if (gen !== searchGen) return;
  results.value = res;

  if (res.length === 0 && q.length >= 3) {
    const sugQ = artInfo ? artInfo.remainder : q;
    suggestions.value = await getSuggestions(sugQ);
  } else {
    suggestions.value = [];
  }

  if (gen !== searchGen) return;
  const bestMatch = lemmaExact[0] || (artMatch[0] || artMismatch[0]) || formHits[0];
  if (bestMatch) {
    addPhraseTerm(bestMatch.lemma);
  }

  await findPhraseMatches(artInfo ? artInfo.remainder : q, seen);
  if (gen !== searchGen) return;
  loading.value = false;
}

function addPhraseTerm(lemma: string) {
  if (lemma.length < 3 || isArticle(lemma)) return;
  const now = Date.now();
  phraseTerms.value = phraseTerms.value.filter(
    e => e.term.toLowerCase() !== lemma.toLowerCase(),
  );
  phraseTerms.value.push({ term: lemma, ts: now });
  if (phraseTerms.value.length > 10) phraseTerms.value = phraseTerms.value.slice(-10);
  setItem(PHRASE_TERMS_KEY, JSON.stringify(phraseTerms.value));
}

function recentPhraseTermStrings(): string[] {
  const cutoff = Date.now() - PHRASE_TERM_MAX_AGE_MS;
  return phraseTerms.value
    .filter(e => e.ts >= cutoff)
    .slice(-3)
    .map(e => e.term);
}

async function findPhraseMatches(q: string, alreadySeen: Set<string>) {
  phraseMatches.value = [];
  matchedTerms.value = [];
  phrasesExpanded.value = false;

  const queryTokens = q.split(/[\s,]+/).filter(t => t.length >= 3);

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of [...recentPhraseTermStrings(), ...queryTokens]) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      terms.push(t);
    }
  }
  if (terms.length < 2) return;

  const phraseHits = await searchPhrasesByWords(terms);
  const filtered: SearchResult[] = [];
  const usedTerms = new Set<string>();
  for (const r of phraseHits) {
    if (alreadySeen.has(r.file)) continue;
    const phraseWords = r.lemma.toLowerCase().split(/\s+/);
    const phraseWordsFolded = phraseWords.map(w => foldUmlauts(w));
    const hits = terms.filter(t => {
      const tLower = t.toLowerCase();
      const tFolded = foldUmlauts(t);
      return phraseWords.includes(tLower) || phraseWordsFolded.includes(tFolded);
    });
    if (hits.length >= 2) {
      filtered.push(r);
      for (const h of hits) usedTerms.add(h);
    }
  }
  if (!filtered.length) return;

  phraseMatches.value = filtered;
  matchedTerms.value = [...usedTerms];
}

function reportMissing() {
  const word = searchQuery.value;
  f7.dialog.create({
    title: t("report.missingWord").replace("{word}", word),
    text: t("report.details"),
    content: '<div class="dialog-input-field input"><input type="text" class="dialog-input"></div>',
    buttons: [
      { text: t("report.cancel"), keyCodes: [27] },
      // @ts-expect-error — F7 DialogButton type is incomplete
      { text: t("report.send"), bold: true, close: false },
    ],
    onClick(dialog: { $el: { find(sel: string): { val(): string } }; close(): void }, index: number) {
      if (index === 0) return;
      const details = dialog.$el.find(".dialog-input").val();
      dialog.close();
      submitReport({ type: "missing_word", word, details }).then((result) => {
        f7.toast.create({
          text: result.ok ? t("report.success") : t("report.error"),
          closeTimeout: 2000,
          position: "center",
        }).open();
      });
    },
  }).open();
}

async function loadHomeScreen(gen = 0) {
  if (!isDbReady.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const counts: Record<string, number> = JSON.parse(getCached(COUNTS_KEY) || "{}");
    const freqKeys = Object.entries(counts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, HOME_FREQ_COUNT)
      .map(([file]) => file);

    const freqSet = new Set(freqKeys);
    const stored = getCached(RECENTS_KEY);
    const allRecents: string[] = stored ? JSON.parse(stored) : [];
    const recentKeys = allRecents
      .filter((f) => !freqSet.has(f))
      .slice(0, HOME_RECENT_COUNT);

    const allKeys = [...freqKeys, ...recentKeys];
    if (!allKeys.length) {
      freqWords.value = [];
      recentWords.value = [];
      loading.value = false;
      return;
    }

    const words = await getRelatedWords(allKeys);
    if (gen && gen !== searchGen) return;
    const infoMap = new Map(words.map((w) => [w.file, w]));

    freqWords.value = freqKeys
      .map((f) => infoMap.get(f))
      .filter((w): w is SearchResult => !!w);
    recentWords.value = recentKeys
      .map((f) => infoMap.get(f))
      .filter((w): w is SearchResult => !!w);
  } catch {
    freqWords.value = [];
    recentWords.value = [];
  }
  if (gen && gen !== searchGen) return;
  loading.value = false;
}

// --- Watchers ---
watch(searchQuery, (q) => {
  if (!isDbReady.value) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  const trimmed = q.trim();
  const gen = ++searchGen;
  if (!trimmed || (trimmed.length < 2 && trimmed.toLowerCase() !== "i")) {
    results.value = [];
    suggestions.value = [];
    phraseMatches.value = [];
    loadHomeScreen(gen);
    return;
  }
  results.value = [];
  suggestions.value = [];
  phraseMatches.value = [];
  loading.value = true;
  debounceTimer = setTimeout(() => search(trimmed, gen), SEARCH_DEBOUNCE_MS);
});

watch(results, (newResults) => {
  if (!newResults.length) {
    vl = null;
    return;
  }
  if (!vl) return;
  (vl as { replaceAllItems(items: SearchResultWithForm[]): void }).replaceAllItems(
    newResults.map((item, i) => ({ ...item, index: i })),
  );
});
</script>

<style scoped>
/* Phrase match section — subtle background to distinguish from regular results */
.phrase-matches {
  --f7-list-bg-color: color-mix(in srgb, var(--f7-theme-color) 5%, var(--f7-page-bg-color));
}
.db-error-block {
  padding-top: 30vh;
}
.db-error-block .button {
  max-width: 200px;
  margin: 16px auto 0;
}
</style>
