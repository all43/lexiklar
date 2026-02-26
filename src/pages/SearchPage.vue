<template>
  <f7-page name="search">
    <f7-navbar title="Lexiklar" />
    <f7-searchbar
      search-container=".search-results"
      search-in=".item-title"
      :disable-button="true"
      placeholder="Wort suchen..."
    />

    <f7-list class="search-results searchbar-found" media-list>
      <f7-list-item
        v-for="word in sampleWords"
        :key="word.file"
        :title="word.lemma"
        :subtitle="word.glossEn || ''"
        :after="word.pos"
        :badge="word.gender || ''"
        :badge-color="genderColor(word.gender)"
        :link="`/word/${word.posDir}/${word.file}/`"
      />
    </f7-list>

    <f7-block class="searchbar-not-found">
      <p>No words found.</p>
    </f7-block>
  </f7-page>
</template>

<script>
export default {
  data() {
    return {
      // Hardcoded sample data for scaffold verification.
      // Will be replaced by SQLite search in a future step.
      sampleWords: [
        { lemma: "Arzt", pos: "NOUN", gender: "M", posDir: "nouns", file: "Arzt", glossEn: null },
        { lemma: "Tisch", pos: "NOUN", gender: "M", posDir: "nouns", file: "Tisch", glossEn: null },
        { lemma: "Bank", pos: "NOUN", gender: "F", posDir: "nouns", file: "Bank_geldinstitut", glossEn: null },
        { lemma: "Bank", pos: "NOUN", gender: "F", posDir: "nouns", file: "Bank_sitz", glossEn: null },
        { lemma: "Hoffnung", pos: "NOUN", gender: "F", posDir: "nouns", file: "Hoffnung", glossEn: null },
        { lemma: "Kind", pos: "NOUN", gender: "N", posDir: "nouns", file: "Kind", glossEn: null },
        { lemma: "Mädchen", pos: "NOUN", gender: "N", posDir: "nouns", file: "Mädchen", glossEn: null },
        { lemma: "laufen", pos: "VERB", gender: null, posDir: "verbs", file: "laufen", glossEn: null },
        { lemma: "ankommen", pos: "VERB", gender: null, posDir: "verbs", file: "ankommen", glossEn: null },
        { lemma: "schnell", pos: "ADJ", gender: null, posDir: "adjectives", file: "schnell", glossEn: null },
        { lemma: "gut", pos: "ADJ", gender: null, posDir: "adjectives", file: "gut", glossEn: null },
      ],
    };
  },
  mounted() {
    this.loadGlosses();
  },
  methods: {
    genderColor(gender) {
      if (gender === "M") return "blue";
      if (gender === "F") return "pink";
      if (gender === "N") return "green";
      return "";
    },
    async loadGlosses() {
      const fetches = this.sampleWords.map(async (word) => {
        try {
          const res = await fetch(`/data/words/${word.posDir}/${word.file}.json`, { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          // Use first sense's gloss_en as the primary translation
          const firstGloss = (data.senses || []).find((s) => s.gloss_en);
          if (firstGloss) {
            word.glossEn = firstGloss.gloss_en;
          }
        } catch {
          // Silently skip — gloss just won't appear
        }
      });
      await Promise.all(fetches);
    },
  },
};
</script>
