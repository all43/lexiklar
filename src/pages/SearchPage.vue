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
import { getCached } from "../utils/storage.js";
import type { SearchResult } from "../../types/search.js";
import {
  searchByLemma,
  searchByGlossEn,
  searchByWordForm,
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

const RECENTS_KEY = "lexiklar_recents";
const COUNTS_KEY = "lexiklar_view_counts";
const HOME_FREQ_COUNT = 5;
const HOME_RECENT_COUNT = 5;

export default defineComponent({
  data() {
    return {
      results: [] as SearchResultWithForm[],
      suggestions: [] as SearchResult[],
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

      this.loading = false;
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
</style>
