<template>
  <f7-page name="search" with-subnavbar @page:tabshow="onPageVisible" @page:afterin="onPageVisible">
    <f7-navbar title="Lexiklar">
      <f7-subnavbar :inner="false">
        <f7-searchbar
          custom-search
          :disable-button="false"
          :placeholder="t('search.placeholder')"
          @searchbar:search="onSearch"
          @searchbar:clear="onClear"
        />
      </f7-subnavbar>
    </f7-navbar>

    <!-- ═══ Search results (VL) — shown when a query is active ═══ -->
    <template v-if="searchQuery">
      <!-- Phrase suggestions from sequential searches -->
      <template v-if="phraseMatches.length">
        <f7-block-title>{{ t('search.matchingPhrases') }}</f7-block-title>
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
              <span class="list-item-pos">{{ item.pos }}</span>
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
              <span class="list-item-pos">{{ item.pos }}</span>
              <f7-badge v-if="item.pluralDominant" color="orange" class="list-item-badge">Pl.</f7-badge>
              <f7-badge v-else-if="item.gender" :color="genderColor(item.gender)" class="list-item-badge">{{ item.gender }}</f7-badge>
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
              <span class="list-item-pos">{{ item.pos }}</span>
              <f7-badge v-if="item.gender" :color="genderColor(item.gender)" class="list-item-badge">{{ item.gender }}</f7-badge>
            </template>
          </f7-list-item>
        </f7-list>
      </template>
      <f7-list v-if="!loading && results.length === 0 && searchQuery.length >= 3" inset>
        <f7-list-button :title="t('report.missingWord').replace('{word}', searchQuery)" @click="reportMissing" />
      </f7-list>
    </template>

    <!-- ═══ Home screen — shown when no query ═══ -->
    <template v-else-if="!loading">
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
              <span class="list-item-pos">{{ item.pos }}</span>
              <f7-badge v-if="item.pluralDominant" color="orange" class="list-item-badge">Pl.</f7-badge>
              <f7-badge v-else-if="item.gender" :color="genderColor(item.gender)" class="list-item-badge">{{ item.gender }}</f7-badge>
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
              <span class="list-item-pos">{{ item.pos }}</span>
              <f7-badge v-if="item.pluralDominant" color="orange" class="list-item-badge">Pl.</f7-badge>
              <f7-badge v-else-if="item.gender" :color="genderColor(item.gender)" class="list-item-badge">{{ item.gender }}</f7-badge>
            </template>
          </f7-list-item>
        </f7-list>
      </template>

      <!-- Empty state -->
      <f7-block v-if="!freqWords.length && !recentWords.length">
        <p style="color: var(--f7-list-item-footer-text-color);">{{ t('search.emptyHint') }}</p>
      </f7-block>
    </template>

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>
  </f7-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { f7, theme } from "framework7-vue";
import { t } from "../js/i18n.js";
import { submitReport } from "../utils/report.js";
import { SHOW_ARTICLES_KEY } from "./SettingsPage.vue";
import { getCached, setItem } from "../utils/storage.js";
import type { SearchResult } from "../../types/search.js";
import {
  searchByLemma,
  searchByGlossEn,
  searchByWordForm,
  searchPhrasesByWords,
  getRelatedWords,
  getSuggestions,
  foldUmlauts,
} from "../utils/db.js";

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
      debounceTimer: null as ReturnType<typeof setTimeout> | null,
      showArticles: getCached(SHOW_ARTICLES_KEY) !== "0",
    };
  },

  computed: {
    t() { return t; },
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
          return theme.ios ? (hasSub ? 63 : 44) : (hasSub ? 69 : 48);
        },
      };
    },
  },

  methods: {
    onPageVisible() {
      this.showArticles = getCached(SHOW_ARTICLES_KEY) !== "0";
      // Reload phrase terms from storage (may have been cleared from Settings or WordPage)
      this.phraseTerms = loadPhraseTerms();
      if (!this.searchQuery) this.loadHomeScreen();
    },
    onSearch(_searchbar: unknown, query: string) {
      this.searchQuery = query || "";
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

    genderColor(gender: string): string {
      if (gender === "M") return "blue";
      if (gender === "F") return "pink";
      if (gender === "N") return "green";
      return "";
    },
    itemTitle(item: SearchResultWithForm): string {
      const base = item.pluralDominant ? item.pluralForm : item.lemma;
      if (this.showArticles && item.gender && !item.pluralDominant) {
        const article = item.gender === "M" ? "der" : item.gender === "F" ? "die" : "das";
        return `${article} ${base}`;
      }
      return base || "";
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
        .map(e => e.term);
    },

    async findPhraseMatches(_q: string, alreadySeen: Set<string>) {
      this.phraseMatches = [];
      this.matchedTerms = [];
      this.phrasesExpanded = false;

      // Require ≥2 distinct recent lemmas to search for phrases
      const terms = this.recentPhraseTermStrings();
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
/* POS label in the after slot */
.list-item-pos {
  color: var(--f7-list-item-footer-text-color);
  font-size: var(--f7-list-item-footer-font-size, 12px);
}

/* Gender / Pl. badge sits right after the POS label */
.list-item-badge {
  margin-left: 5px;
}

/* Phrase match section — subtle background to distinguish from regular results */
.phrase-matches {
  --f7-list-bg-color: color-mix(in srgb, var(--f7-theme-color) 5%, var(--f7-page-bg-color));
}
</style>
