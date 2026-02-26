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

    <f7-list v-if="filteredWords.length > 0" class="search-results" media-list>
      <f7-list-item
        v-for="word in filteredWords"
        :key="word.posDir + '/' + word.file"
        :title="word.lemma"
        :subtitle="word.glossEn[0] || ''"
        :after="word.pos"
        :badge="word.gender || ''"
        :badge-color="genderColor(word.gender)"
        :link="`/word/${word.posDir}/${word.file}/`"
      />
    </f7-list>

    <f7-block v-else-if="searchQuery && !loading">
      <p>No words found.</p>
    </f7-block>

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>
  </f7-page>
</template>

<script>
export default {
  data() {
    return {
      allWords: [],
      searchQuery: "",
      loading: true,
    };
  },
  computed: {
    filteredWords() {
      if (!this.searchQuery.trim()) return this.allWords;
      const q = this.searchQuery.toLowerCase().trim();
      return this.allWords.filter((w) => {
        // German: substring match on lemma (handles partial German input)
        if (w.lemma.toLowerCase().includes(q)) return true;
        // English: word-prefix match so "table" matches "table" but not "acceptable"
        return w.glossEn.some((g) =>
          g
            .toLowerCase()
            .split(/[\s,();/]+/)
            .some((word) => word.startsWith(q))
        );
      });
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
  },
  async mounted() {
    try {
      const res = await fetch("/data/search-manifest.json", {
        cache: "default",
      });
      if (res.ok) this.allWords = await res.json();
    } catch (err) {
      console.error("Failed to load search manifest:", err);
    } finally {
      this.loading = false;
    }
  },
};
</script>
