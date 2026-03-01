<template>
  <f7-page name="search">
    <f7-navbar title="Lexiklar" />
    <f7-searchbar
      custom-search
      :disable-button="false"
      placeholder="Wort oder Bedeutung suchen..."
      @searchbar:search="onSearch"
      @searchbar:clear="onClear"
    />

    <f7-block-title v-if="!searchQuery && results.length">Recently Visited</f7-block-title>

    <f7-list v-if="results.length > 0" class="search-results" media-list>
      <f7-list-item
        v-for="word in results"
        :key="word.file"
        :title="word.lemma"
        :subtitle="word.matchedForm ? `← ${word.matchedForm}` : (word.glossEn[0] || '')"
        :after="word.pos"
        :badge="word.gender || ''"
        :badge-color="genderColor(word.gender)"
        :link="`/word/${word.file}/`"
      />
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
      searchQuery: "",
      loading: true,
      debounceTimer: null,
    };
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
  async mounted() {
    await this.loadRecentWords();
  },
};
</script>
