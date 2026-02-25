<template>
  <f7-page name="word">
    <f7-navbar :title="word ? word.word : 'Loading...'" back-link="Back" />

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>

    <template v-else-if="word">
      <!-- Header: word + pronunciation -->
      <f7-block strong>
        <h1 style="margin: 0;">
          <span v-if="word.article" :class="`gender-${word.gender?.toLowerCase()}`">
            {{ word.article }}
          </span>
          {{ word.word }}
        </h1>
        <p v-if="word.sounds && word.sounds.length" class="ipa">
          {{ word.sounds[0].ipa }}
        </p>
        <p>
          <f7-badge :color="posColor">{{ word.pos }}</f7-badge>
          <span v-if="word.frequency"> · #{{ word.frequency }}</span>
        </p>
      </f7-block>

      <!-- Senses -->
      <f7-block-title>Meanings</f7-block-title>
      <f7-list>
        <f7-list-item
          v-for="(sense, idx) in word.senses"
          :key="idx"
          :id="`sense-${idx + 1}`"
          :header="`${idx + 1}.`"
          :footer="sense.gloss_en || ''"
        >
          <template #title>
            <GlossText :gloss="sense.gloss" @sense-ref="scrollToSense" />
          </template>
        </f7-list-item>
      </f7-list>

      <!-- Grammar placeholder -->
      <f7-block-title>Grammar</f7-block-title>
      <f7-block>
        <p><em>Grammar tables coming soon.</em></p>
      </f7-block>
    </template>

    <f7-block v-else>
      <p>Word not found.</p>
    </f7-block>
  </f7-page>
</template>

<script>
import GlossText from "../components/GlossText.vue";

export default {
  components: { GlossText },
  props: {
    f7route: Object,
  },
  data() {
    return {
      word: null,
      loading: true,
    };
  },
  computed: {
    posColor() {
      if (!this.word) return "gray";
      if (this.word.pos === "noun") return "blue";
      if (this.word.pos === "verb") return "orange";
      if (this.word.pos === "adjective") return "green";
      return "gray";
    },
  },
  methods: {
    scrollToSense(senseNumber) {
      const el = document.getElementById(`sense-${senseNumber}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("sense-highlight");
      setTimeout(() => el.classList.remove("sense-highlight"), 1500);
    },
  },
  async mounted() {
    const { pos, file } = this.f7route.params;
    try {
      const resp = await fetch(`/data/words/${pos}/${file}.json`, { cache: "no-store" });
      if (resp.ok) {
        this.word = await resp.json();
      }
    } catch (err) {
      console.error("Failed to load word:", err);
    } finally {
      this.loading = false;
    }
  },
};
</script>
