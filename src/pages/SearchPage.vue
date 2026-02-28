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
        :subtitle="word.matchedForm ? `← ${word.matchedForm}` : (word.glossEn[0] || '')"
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
import { computeAllForms } from "../utils/verb-forms.js";

export default {
  data() {
    return {
      allWords: [],
      searchQuery: "",
      loading: true,
      verbFormsMap: null,
    };
  },
  computed: {
    filteredWords() {
      if (!this.searchQuery.trim()) return this.allWords;
      const q = this.searchQuery.toLowerCase().trim();

      const results = [];
      const seen = new Set();

      for (const w of this.allWords) {
        const key = w.posDir + "/" + w.file;
        // German: substring match on lemma
        if (w.lemma.toLowerCase().includes(q)) {
          results.push(w);
          seen.add(key);
          continue;
        }
        // English: word-prefix match
        const enMatch = w.glossEn.some((g) =>
          g
            .toLowerCase()
            .split(/[\s,();/]+/)
            .some((word) => word.startsWith(q)),
        );
        if (enMatch) {
          results.push(w);
          seen.add(key);
        }
      }

      // Verb form search via reverse lookup
      if (this.verbFormsMap) {
        const matches = this.verbFormsMap.get(q);
        if (matches) {
          for (const match of matches) {
            const key = match.posDir + "/" + match.file;
            if (seen.has(key)) continue;
            const entry = this.allWords.find(
              (w) => w.posDir === match.posDir && w.file === match.file,
            );
            if (entry) {
              results.push({ ...entry, matchedForm: q });
              seen.add(key);
            }
          }
        }
      }

      return results;
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
      const [manifestRes, endingsRes] = await Promise.all([
        fetch("/data/search-manifest.json", { cache: "default" }),
        fetch("/data/rules/verb-endings.json", { cache: "default" }),
      ]);

      if (manifestRes.ok) this.allWords = await manifestRes.json();

      // Build verb forms reverse lookup map
      if (endingsRes.ok) {
        const endings = await endingsRes.json();
        const formsMap = new Map();

        for (const entry of this.allWords) {
          if (entry.pos !== "VERB") continue;
          if (!entry.conjugation_class || entry.conjugation_class === "irregular") continue;
          if (!entry.stems) continue;

          const verbObj = {
            word: entry.lemma,
            conjugation_class: entry.conjugation_class,
            stems: entry.stems,
            past_participle: entry.past_participle,
            separable: entry.separable,
            prefix: entry.prefix,
          };

          const forms = computeAllForms(verbObj, endings);
          for (const form of forms) {
            // Skip infinitive — already matched by lemma search
            if (form === entry.lemma.toLowerCase()) continue;
            if (!formsMap.has(form)) formsMap.set(form, []);
            formsMap.get(form).push({
              posDir: entry.posDir,
              file: entry.file,
            });
          }
        }

        this.verbFormsMap = formsMap;
      }
    } catch (err) {
      console.error("Failed to load search data:", err);
    } finally {
      this.loading = false;
    }
  },
};
</script>
