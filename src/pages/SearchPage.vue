<template>
  <f7-page name="search" with-subnavbar>
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

    <f7-block-title v-if="!searchQuery && results.length">Recently Visited</f7-block-title>

    <!--
      Virtual list: only renders visible items — safe for large result sets.
      vlData.items is the visible slice; vl.replaceAllItems() feeds new results
      into an already-mounted list without tearing it down.
    -->
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

    <f7-block v-else-if="!loading && searchQuery">
      <p>No words found.</p>
    </f7-block>

    <f7-block v-else-if="!loading && !searchQuery">
      <p style="color: var(--f7-list-item-footer-text-color);">Start typing to search for a German word or English meaning.</p>
    </f7-block>

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
  searchByVerbForm,
  getRelatedWords,
} from "../utils/db.js";

const RECENTS_KEY = "lexiklar_recents";

export default {
  data() {
    return {
      results: [],
      vlData: { items: [], topPosition: 0 },
      vl: null,          // framework7 virtual list instance
      searchQuery: "",
      loading: true,
      debounceTimer: null,
    };
  },

  computed: {
    // Results array with a stable numeric index for VL absolute positioning
    vlItems() {
      return this.results.map((item, i) => ({ ...item, index: i }));
    },
    // Params passed to F7 on initial VL mount — items reflect current results
    vlParams() {
      return {
        items: this.vlItems,
        renderExternal: this.renderExternal,
        // Height varies: items with a subtitle (gloss_en or matched verb form)
        // render taller than items without. Measured in browser; iOS estimates
        // match F7's standard single/two-line media list item heights.
        height: (item) => {
          const hasSub = item.glossEn?.length > 0 || !!item.matchedForm;
          return theme.ios ? (hasSub ? 63 : 44) : (hasSub ? 69 : 48);
        },
      };
    },
  },

  methods: {
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

    // Called by F7 whenever it needs to (re)render the visible slice.
    // Stores the VL instance on first call; keeps vlData in sync for v-for.
    renderExternal(vl, vlData) {
      this.vl = vl;
      this.vlData = vlData;
    },

    async search(q) {
      this.loading = true;
      const seen = new Set();
      const results = [];

      // German lemma search (prefix match)
      const lemmaHits = await searchByLemma(q);
      for (const r of lemmaHits) {
        seen.add(r.file);
        results.push(r);
      }

      // English gloss search
      const enHits = await searchByGlossEn(q);
      for (const r of enHits) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          results.push(r);
        }
      }

      // Verb form search (exact match on conjugated form)
      const verbHits = await searchByVerbForm(q);
      for (const r of verbHits) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          results.push({ ...r, matchedForm: q });
        }
      }

      this.results = results;
      this.loading = false;
    },

    async loadRecentWords() {
      this.loading = true;
      try {
        const stored = localStorage.getItem(RECENTS_KEY);
        const fileKeys = stored ? JSON.parse(stored) : [];
        if (fileKeys.length) {
          const words = await getRelatedWords(fileKeys);
          // Restore recency order (SQL IN clause doesn't preserve input order)
          const orderMap = new Map(fileKeys.map((f, i) => [f, i]));
          words.sort(
            (a, b) => (orderMap.get(a.file) ?? 999) - (orderMap.get(b.file) ?? 999),
          );
          this.results = words;
        } else {
          this.results = [];
        }
      } catch {
        this.results = [];
      }
      this.loading = false;
    },
  },

  watch: {
    searchQuery(q) {
      clearTimeout(this.debounceTimer);
      if (!q.trim()) {
        this.loadRecentWords();
        return;
      }
      this.debounceTimer = setTimeout(() => this.search(q.trim()), 150);
    },
    // When results go empty the f7-list is destroyed by v-if; clear the stale
    // VL reference so the next non-empty result mounts a fresh VL from vlParams
    // instead of calling replaceAllItems() on a detached (destroyed) instance.
    // A stale vl.replaceAllItems() call can fire its own renderExternal callback
    // asynchronously (RAF), overwriting this.vl/vlData after the fresh VL has
    // already set them correctly — causing a blank list or stuck spinner.
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

  async mounted() {
    await this.loadRecentWords();
  },
};
</script>
