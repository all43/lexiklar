<template>
  <f7-page name="search">
    <f7-navbar title="Lexiklar" />
    <f7-searchbar
      search-container=".search-results"
      search-in=".item-title"
      :disable-button="true"
      placeholder="Wort suchen..."
    />

    <f7-list class="search-results searchbar-found">
      <f7-list-item
        v-for="word in sampleWords"
        :key="word.file"
        :title="word.lemma"
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
        { lemma: "Tisch", pos: "NOUN", gender: "M", posDir: "nouns", file: "Tisch" },
        { lemma: "Bank", pos: "NOUN", gender: "F", posDir: "nouns", file: "Bank_geldinstitut" },
        { lemma: "Bank", pos: "NOUN", gender: "F", posDir: "nouns", file: "Bank_sitz" },
        { lemma: "Hoffnung", pos: "NOUN", gender: "F", posDir: "nouns", file: "Hoffnung" },
        { lemma: "Kind", pos: "NOUN", gender: "N", posDir: "nouns", file: "Kind" },
        { lemma: "Mädchen", pos: "NOUN", gender: "N", posDir: "nouns", file: "Mädchen" },
        { lemma: "laufen", pos: "VERB", gender: null, posDir: "verbs", file: "laufen" },
        { lemma: "ankommen", pos: "VERB", gender: null, posDir: "verbs", file: "ankommen" },
        { lemma: "schnell", pos: "ADJ", gender: null, posDir: "adjectives", file: "schnell" },
        { lemma: "gut", pos: "ADJ", gender: null, posDir: "adjectives", file: "gut" },
      ],
    };
  },
  methods: {
    genderColor(gender) {
      if (gender === "M") return "blue";
      if (gender === "F") return "pink";
      if (gender === "N") return "green";
      return "";
    },
  },
};
</script>
