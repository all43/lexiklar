<template>
  <f7-page name="search" :with-subnavbar="searchBarMode === 'subnavbar'" :class="{ 'page-searchbar-bottom': searchBarMode === 'bottom' }" @page:tabshow="onPageVisible" @page:afterin="onPageVisible">
    <f7-navbar title="Lexiklar">
      <f7-subnavbar v-if="searchBarMode === 'subnavbar' && dbReady" :inner="false">
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
    <f7-block v-if="!dbReady && !loading" class="text-align-center db-error-block">
      <!-- Download prompt (DB not bundled on web) -->
      <template v-if="dbDownloadNeeded && !dbDownloading">
        <p><b>{{ t('db.downloadTitle') }}</b></p>
        <p class="text-secondary">{{ t('db.downloadHint') }}</p>
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
    <template v-else-if="searchQuery">
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

      <f7-block v-else-if="!loading">
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

    <!-- ═══ Home screen — shown when no query ═══ -->
    <template v-else-if="dbReady && !loading">
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

    <f7-subnavbar v-if="searchBarMode === 'bottom' && dbReady" :inner="false" class="searchbar-bottom-toolbar">
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

<script lang="ts">
import { defineComponent } from "vue";
import { f7, theme as f7theme } from "framework7-vue";
import { t } from "../js/i18n.js";
import { submitReport } from "../utils/report.js";
import { SHOW_ARTICLES_KEY, SEARCH_BAR_POSITION_KEY, type SearchBarPosition } from "./SettingsPage.vue";
import { isIOS26Plus } from "../utils/device.js";
import { getCached, setItem } from "../utils/storage.js";
import type { SearchResult } from "../../types/search.js";
import WordListBadges from "../components/WordListBadges.vue";
import { wordListTitle } from "../components/WordListBadges.vue";
import {
  searchByLemma,
  searchByGlossEn,
  searchByWordForm,
  searchPhrasesByWords,
  getRelatedWords,
  getSuggestions,
  foldUmlauts,
} from "../utils/db.js";
import { dbReady, dbDownloadNeeded } from "../utils/db-update-state.js";
import { downloadDb } from "../utils/db.js";

interface SearchResultWithForm extends SearchResult {
  matchedForm?: string;
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
/** Only consider phrase terms from the last 5 minutes */
const PHRASE_TERM_MAX_AGE_MS = 5 * 60 * 1000;

function loadPhraseTerms(): PhraseTerm[] {
  try {
    const raw = JSON.parse(getCached(PHRASE_TERMS_KEY) || "[]");
    // Migration: old format was string[], new is {term,ts}[]
    if (raw.length && typeof raw[0] === "string") return [];
    return raw as PhraseTerm[];
  } catch { return []; }
}

export default defineComponent({
  components: { WordListBadges },
  data() {
    return {
      results: [] as SearchResultWithForm[],
      suggestions: [] as SearchResult[],
      phraseMatches: [] as SearchResult[],
      phrasesExpanded: false,
      phraseTerms: loadPhraseTerms(),
      matchedTerms: [] as string[],
      vlData: { items: [], topPosition: 0 } as VLData,
      vl: null as unknown,
      searchQuery: "",
      freqWords: [] as SearchResult[],
      recentWords: [] as SearchResult[],
      loading: true,
      dbDownloading: false,
      dbDownloadProgress: 0,
      dbDownloadError: "",
      debounceTimer: null as ReturnType<typeof setTimeout> | null,
      showArticles: getCached(SHOW_ARTICLES_KEY) !== "0",
      searchBarPosition: (getCached(SEARCH_BAR_POSITION_KEY) || "auto") as SearchBarPosition,
    };
  },

  computed: {
    t() { return t; },
    dbReady() { return dbReady.value; },
    dbDownloadNeeded() { return dbDownloadNeeded.value; },
    searchBarMode(): "subnavbar" | "bottom" {
      if (this.searchBarPosition === "bottom") return "bottom";
      if (this.searchBarPosition === "top") return "subnavbar";
      // auto: bottom on iOS 26+ (above floating glass tab bar), subnavbar elsewhere
      return isIOS26Plus() ? "bottom" : "subnavbar";
    },
    visiblePhrases(): SearchResult[] {
      if (this.phrasesExpanded) return this.phraseMatches;
      return this.phraseMatches.slice(0, 3);
    },
    hiddenPhrasesCount(): number {
      return this.phraseMatches.length - this.visiblePhrases.length;
    },
    vlItems(): SearchResultWithForm[] {
      return this.results.map((item, i) => ({ ...item, index: i }));
    },
    vlParams() {
      return {
        items: this.vlItems,
        renderExternal: this.renderExternal,
        height: (item: SearchResultWithForm) => {
          const hasSub = (item.glossEn?.length ?? 0) > 0 || !!item.matchedForm;
          return f7theme.ios ? (hasSub ? 63 : 44) : (hasSub ? 69 : 48);
        },
      };
    },
  },

  methods: {
    reload() {
      window.location.reload();
    },
    async startDownload() {
      this.dbDownloading = true;
      this.dbDownloadProgress = 0;
      this.dbDownloadError = "";
      try {
        await downloadDb((loaded, total) => {
          this.dbDownloadProgress = Math.round((loaded / total) * 100);
        });
        dbReady.value = true;
        dbDownloadNeeded.value = false;
        this.dbDownloading = false;
        this.loadHomeScreen();
      } catch (err) {
        console.error("DB download failed:", err);
        this.dbDownloading = false;
        const msg = (err as Error).message || "";
        this.dbDownloadError = msg.includes("Failed to fetch")
          ? t("db.downloadFailed")
          : msg || t("db.downloadFailed");
      }
    },
    onPageVisible() {
      this.showArticles = getCached(SHOW_ARTICLES_KEY) !== "0";
      this.searchBarPosition = (getCached(SEARCH_BAR_POSITION_KEY) || "auto") as SearchBarPosition;
      // Reload phrase terms from storage (may have been cleared from Settings or WordPage)
      this.phraseTerms = loadPhraseTerms();
      if (!this.searchQuery) this.loadHomeScreen();
    },
    onSearch(searchbarOrQuery: unknown, query?: string) {
      // Called either as (searchbar, query) from f7-searchbar or (query) from App-level event
      this.searchQuery = (typeof searchbarOrQuery === "string" ? searchbarOrQuery : query) || "";
    },
    onClear() {
      this.searchQuery = "";
    },
    itemSubtitle(item: SearchResultWithForm): string {
      const displayTitle = item.pluralDominant ? item.pluralForm : item.lemma;
      if (item.matchedForm && item.matchedForm.toLowerCase() !== displayTitle?.toLowerCase()) {
        return `\u2190 ${item.matchedForm}`;
      }
      return item.glossEn?.[0] || "";
    },

    itemTitle(item: SearchResultWithForm): string {
      return wordListTitle(item, this.showArticles);
    },

    renderExternal(vl: unknown, vlData: VLData) {
      this.vl = vl;
      this.vlData = vlData;
    },

    highlightPhraseWords(lemma: string): string {
      if (!this.matchedTerms.length) return lemma;
      const termsLower = this.matchedTerms.map(t => t.toLowerCase());
      const termsFolded = this.matchedTerms.map(t => foldUmlauts(t));
      // Split phrase into words, highlight those that exactly match a search term
      return lemma.split(/(\s+)/).map(token => {
        if (/^\s+$/.test(token)) return token;
        const lower = token.toLowerCase();
        const folded = foldUmlauts(token);
        const matches = termsLower.includes(lower) || termsFolded.includes(folded);
        return matches ? `<b style="color: var(--f7-theme-color)">${token}</b>` : token;
      }).join("");
    },

    async search(q: string) {
      this.loading = true;
      const qLower = q.toLowerCase();
      const qFolded = foldUmlauts(q);

      const [formHits, lemmaHits, enHits] = await Promise.all([
        searchByWordForm(q),
        searchByLemma(q),
        searchByGlossEn(q),
      ]);

      const seen = new Set<string>();
      const results: SearchResultWithForm[] = [];

      // 1. Form matches (inflected forms — always first)
      for (const r of formHits) {
        seen.add(r.file);
        results.push({ ...r, matchedForm: q });
      }

      // 2. Split lemma & English hits into exact vs rest
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

      // 3. Merge exact matches (German lemma + English gloss) by frequency
      const exactMerged = [...lemmaExact, ...enExact]
        .sort((a, b) => (a.frequency ?? 999999) - (b.frequency ?? 999999));
      for (const r of exactMerged) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          results.push(r);
        }
      }

      // 4. German lemma prefix matches
      for (const r of lemmaRest) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          results.push(r);
        }
      }

      // 5. Remaining English matches (en_terms exact + prefix)
      for (const r of enRest) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          results.push(r);
        }
      }

      this.results = results;

      if (results.length === 0 && q.length >= 3) {
        this.suggestions = await getSuggestions(q);
      } else {
        this.suggestions = [];
      }

      // Track resolved lemma as phrase term (not the raw query)
      // Prefer exact lemma match over form hit — "Tisch" should register as "Tisch" not "tischen"
      const bestMatch = lemmaExact[0] || formHits[0];
      if (bestMatch) {
        this.addPhraseTerm(bestMatch.lemma);
      }

      // Phrase discovery: require ≥2 distinct recent lemmas to match
      await this.findPhraseMatches(q, seen);

      this.loading = false;
    },

    addPhraseTerm(lemma: string) {
      if (lemma.length < 3) return;
      const now = Date.now();
      // Deduplicate by lemma (case-insensitive) — update timestamp if already present
      this.phraseTerms = this.phraseTerms.filter(
        e => e.term.toLowerCase() !== lemma.toLowerCase(),
      );
      this.phraseTerms.push({ term: lemma, ts: now });
      // Cap to 10 entries
      if (this.phraseTerms.length > 10) this.phraseTerms = this.phraseTerms.slice(-10);
      setItem(PHRASE_TERMS_KEY, JSON.stringify(this.phraseTerms));
    },

    recentPhraseTermStrings(): string[] {
      const cutoff = Date.now() - PHRASE_TERM_MAX_AGE_MS;
      return this.phraseTerms
        .filter(e => e.ts >= cutoff)
        .slice(-3)
        .map(e => e.term);
    },

    async findPhraseMatches(q: string, alreadySeen: Set<string>) {
      this.phraseMatches = [];
      this.matchedTerms = [];
      this.phrasesExpanded = false;

      // Tokenize multi-word queries (e.g. "Achse sein" or "Achse, sein")
      const queryTokens = q.split(/[\s,]+/).filter(t => t.length >= 3);

      // Merge query tokens with recent phrase terms, deduplicate
      const seen = new Set<string>();
      const terms: string[] = [];
      for (const t of [...this.recentPhraseTermStrings(), ...queryTokens]) {
        const key = t.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          terms.push(t);
        }
      }
      if (terms.length < 2) return;

      const phraseHits = await searchPhrasesByWords(terms);
      // Require ≥ 2 terms to match whole words in each phrase
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

      this.phraseMatches = filtered;
      this.matchedTerms = [...usedTerms];
    },

    reportMissing() {
      const word = this.searchQuery;
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
    },

    async loadHomeScreen() {
      if (!this.dbReady) {
        this.loading = false;
        return;
      }
      this.loading = true;
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
          this.freqWords = [];
          this.recentWords = [];
          this.loading = false;
          return;
        }

        const words = await getRelatedWords(allKeys);
        const infoMap = new Map(words.map((w) => [w.file, w]));

        this.freqWords = freqKeys
          .map((f) => infoMap.get(f))
          .filter((w): w is SearchResult => !!w);
        this.recentWords = recentKeys
          .map((f) => infoMap.get(f))
          .filter((w): w is SearchResult => !!w);
      } catch {
        this.freqWords = [];
        this.recentWords = [];
      }
      this.loading = false;
    },
  },


  watch: {
    searchQuery(q: string) {
      if (!this.dbReady) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      if (!q.trim()) {
        this.loadHomeScreen();
        return;
      }
      this.debounceTimer = setTimeout(() => this.search(q.trim()), 150);
    },
    results(newResults: SearchResultWithForm[]) {
      if (!newResults.length) {
        this.vl = null;
        return;
      }
      if (!this.vl) return;
      (this.vl as { replaceAllItems(items: SearchResultWithForm[]): void }).replaceAllItems(
        newResults.map((item, i) => ({ ...item, index: i })),
      );
    },
  },

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
