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
        <template v-for="(sense, idx) in word.senses" :key="idx">
          <!-- Sense row -->
          <f7-list-item
            :id="`sense-${idx + 1}`"
            :header="`${idx + 1}.`"
            :footer="sense.gloss_en || ''"
          >
            <template #title>
              <GlossText
                :gloss="sense.gloss"
                @sense-ref="scrollToSense"
                @cross-ref="handleCrossRef"
              />
            </template>
          </f7-list-item>

          <!-- Examples for this sense -->
          <li
            v-for="ex in getSenseExamples(sense)"
            :key="ex.id"
            class="example-item"
          >
            <div class="item-content">
              <div class="item-inner example-inner">
                <GlossText
                  :gloss="ex.text"
                  @sense-ref="scrollToSense"
                  @cross-ref="handleCrossRef"
                  class="example-text"
                />
                <div v-if="ex.translation" class="example-translation">
                  {{ ex.translation }}
                </div>
              </div>
            </div>
          </li>
        </template>
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
    f7router: Object,
  },
  data() {
    return {
      word: null,
      examples: {},
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

    handleCrossRef(filePath, senseNumber) {
      // filePath format: "nouns/Tisch" → /word/nouns/Tisch/
      const url = `/word/${filePath}/`;
      const fullUrl = senseNumber ? `${url}?sense=${senseNumber}` : url;
      // $f7router is injected by F7 on route components; fall back to current view router
      this.f7router.navigate(fullUrl);
    },

    getSenseExamples(sense) {
      if (!sense.example_ids || !sense.example_ids.length) return [];
      return sense.example_ids
        .map((id) => {
          const ex = this.examples[id];
          return ex ? { id, ...ex } : null;
        })
        .filter(Boolean);
    },
  },
  async mounted() {
    const { pos, file } = this.f7route.params;
    const targetSense = parseInt(this.f7route.query?.sense, 10) || null;

    try {
      const [wordResp, exResp] = await Promise.all([
        fetch(`/data/words/${pos}/${file}.json`, { cache: "no-store" }),
        fetch(`/data/examples.json`, { cache: "no-store" }),
      ]);
      if (wordResp.ok) this.word = await wordResp.json();
      if (exResp.ok) this.examples = await exResp.json();
    } catch (err) {
      console.error("Failed to load word:", err);
    } finally {
      this.loading = false;
      if (targetSense) {
        await this.$nextTick();
        this.scrollToSense(targetSense);
      }
    }
  },
};
</script>
