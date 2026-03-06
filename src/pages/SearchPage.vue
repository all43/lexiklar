<template>
  <f7-page name="search" with-subnavbar @page:tabshow="onPageVisible" @page:afterin="onPageVisible">
    <f7-navbar title="Lexiklar">
      <f7-subnavbar :inner="false">
        <f7-searchbar
          custom-search
          :disable-button="false"
          placeholder="Wort oder Bedeutung suchen..."
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
            :title="item.lemma"
            :subtitle="item.matchedForm ? `← ${item.matchedForm}` : (item.glossEn[0] || '')"
            :after="item.pos"
            :badge="item.gender || ''"
            :badge-color="genderColor(item.gender)"
            :link="`/word/${item.file}/`"
            :style="`top: ${vlData.topPosition}px`"
            :virtual-list-index="item.index"
          />
        </ul>
      </f7-list>

      <f7-block v-else-if="!loading">
        <p>No words found.</p>
      </f7-block>
    </template>

    <!-- ═══ Home screen — shown when no query ═══ -->
    <template v-else-if="!loading">
      <!-- Frequently Viewed -->
      <template v-if="freqWords.length">
        <f7-block-title>Frequently Viewed</f7-block-title>
        <f7-list class="home-list" media-list>
          <f7-list-item
            v-for="item in freqWords"
            :key="item.file"
            :title="item.lemma"
            :subtitle="item.glossEn[0] || ''"
            :after="item.pos"
            :badge="item.gender || ''"
            :badge-color="genderColor(item.gender)"
            :link="`/word/${item.file}/`"
          />
        </f7-list>
      </template>

      <!-- Recently Visited (excludes items already in Frequently Viewed) -->
      <template v-if="recentWords.length">
        <f7-block-title>Recently Visited</f7-block-title>
        <f7-list class="home-list" media-list>
          <f7-list-item
            v-for="item in recentWords"
            :key="item.file"
            :title="item.lemma"
            :subtitle="item.glossEn[0] || ''"
            :after="item.pos"
            :badge="item.gender || ''"
            :badge-color="genderColor(item.gender)"
            :link="`/word/${item.file}/`"
          />
        </f7-list>
      </template>

      <!-- Empty state -->
      <f7-block v-if="!freqWords.length && !recentWords.length">
        <p style="color: var(--f7-list-item-footer-text-color);">Start typing to search for a German word or English meaning.</p>
      </f7-block>
    </template>

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>
  </f7-page>
</template>

<script>
import { theme } from "framework7-vue";
import {
  searchByLemma,
  searchByGlossEn,
  searchByWordForm,
  getRelatedWords,
} from "../utils/db.js";

const RECENTS_KEY = "lexiklar_recents";
const COUNTS_KEY = "lexiklar_view_counts";
const HOME_FREQ_COUNT = 5;
const HOME_RECENT_COUNT = 5;

export default {
  data() {
    return {
      // Search mode
      results: [],
      vlData: { items: [], topPosition: 0 },
      vl: null,
      searchQuery: "",
      // Home screen mode
      freqWords: [],
      recentWords: [],
      // Shared
      loading: true,
      debounceTimer: null,
    };
  },

  computed: {
    vlItems() {
      return this.results.map((item, i) => ({ ...item, index: i }));
    },
    vlParams() {
      return {
        items: this.vlItems,
        renderExternal: this.renderExternal,
        height: (item) => {
          const hasSub = item.glossEn?.length > 0 || !!item.matchedForm;
          return theme.ios ? (hasSub ? 63 : 44) : (hasSub ? 69 : 48);
        },
      };
    },
  },

  methods: {
    onPageVisible() {
      // Reload home screen whenever page becomes visible:
      // - initial load (page:afterin on mount)
      // - navigating back from a word page (page:afterin)
      // - switching tabs (page:tabshow)
      if (!this.searchQuery) this.loadHomeScreen();
    },
    onSearch(searchbar, query) {
      this.searchQuery = query || "";
    },
    onClear() {
      this.searchQuery = "";
    },
    genderColor(gender) {
      if (gender === "M") return "blue";
      if (gender === "F") return "pink";
      if (gender === "N") return "green";
      return "";
    },

    renderExternal(vl, vlData) {
      this.vl = vl;
      this.vlData = vlData;
    },

    async search(q) {
      this.loading = true;
      const seen = new Set();
      const results = [];

      // 1. Lemma prefix match (highest priority)
      const lemmaHits = await searchByLemma(q);
      for (const r of lemmaHits) {
        seen.add(r.file);
        results.push(r);
      }

      // 2. Word form match — nouns + verbs (e.g., "Schuhe" → Schuh, "lief" → laufen)
      const formHits = await searchByWordForm(q);
      for (const r of formHits) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          results.push({ ...r, matchedForm: q });
        }
      }

      // 3. English gloss match (lower priority than inflected forms)
      const enHits = await searchByGlossEn(q);
      for (const r of enHits) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          results.push(r);
        }
      }

      this.results = results;
      this.loading = false;
    },

    async loadHomeScreen() {
      this.loading = true;
      try {
        // 1. Build frequency-sorted list
        const counts = JSON.parse(localStorage.getItem(COUNTS_KEY) || "{}");
        const freqKeys = Object.entries(counts)
          .filter(([, count]) => count >= 2) // need at least 2 views to qualify
          .sort((a, b) => b[1] - a[1])
          .slice(0, HOME_FREQ_COUNT)
          .map(([file]) => file);

        // 2. Build recents list, excluding items already in freq
        const freqSet = new Set(freqKeys);
        const stored = localStorage.getItem(RECENTS_KEY);
        const allRecents = stored ? JSON.parse(stored) : [];
        const recentKeys = allRecents
          .filter((f) => !freqSet.has(f))
          .slice(0, HOME_RECENT_COUNT);

        // 3. Batch-load all word metadata in one query
        const allKeys = [...freqKeys, ...recentKeys];
        if (!allKeys.length) {
          this.freqWords = [];
          this.recentWords = [];
          this.loading = false;
          return;
        }

        const words = await getRelatedWords(allKeys);
        const infoMap = new Map(words.map((w) => [w.file, w]));

        // 4. Build display arrays preserving sort order
        this.freqWords = freqKeys
          .map((f) => infoMap.get(f))
          .filter(Boolean);
        this.recentWords = recentKeys
          .map((f) => infoMap.get(f))
          .filter(Boolean);
      } catch {
        this.freqWords = [];
        this.recentWords = [];
      }
      this.loading = false;
    },
  },

  watch: {
    searchQuery(q) {
      clearTimeout(this.debounceTimer);
      if (!q.trim()) {
        this.loadHomeScreen();
        return;
      }
      this.debounceTimer = setTimeout(() => this.search(q.trim()), 150);
    },
    // VL lifecycle: clear stale reference when results empty (v-if destroys list)
    results(newResults) {
      if (!newResults.length) {
        this.vl = null;
        return;
      }
      if (!this.vl) return;
      this.vl.replaceAllItems(
        newResults.map((item, i) => ({ ...item, index: i })),
      );
    },
  },

};
</script>
