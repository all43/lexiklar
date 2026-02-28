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

      <!-- Expressions & Proverbs -->
      <template v-if="wordExpressions.length">
        <f7-block-title>Expressions</f7-block-title>
        <f7-list>
          <li
            v-for="expr in wordExpressions"
            :key="expr.id"
            class="expression-item"
            @click="expr.ref ? handleCrossRef(expr.ref, null) : null"
          >
            <div class="item-content">
              <div class="item-inner">
                <div class="item-title-row">
                  <div class="item-title">
                    <span :class="{'expression-link': expr.ref}">{{ expr.text }}</span>
                    <f7-badge
                      v-if="expr.type === 'proverb'"
                      color="gray"
                      class="expression-badge"
                    >proverb</f7-badge>
                  </div>
                </div>
                <div v-if="expr.translation || expr.note" class="item-footer expression-sub">
                  {{ expr.translation || expr.note }}
                </div>
              </div>
            </div>
          </li>
        </f7-list>
      </template>

      <!-- Grammar -->
      <template v-if="word.pos === 'verb'">
        <f7-block-title>Conjugation</f7-block-title>
        <VerbConjugation :verb="word" />
      </template>
      <template v-else>
        <f7-block-title>Grammar</f7-block-title>
        <f7-block>
          <p><em>Grammar tables coming soon.</em></p>
        </f7-block>
      </template>
    </template>

    <f7-block v-else>
      <p>Word not found.</p>
    </f7-block>

    <!-- Word preview sheet — slides up on cross-entry ref tap -->
    <f7-sheet
      class="word-preview-sheet"
      :opened="preview !== null"
      backdrop
      swipe-to-close
      @sheet:closed="preview = null"
    >
      <div class="swipe-handler" />
      <div v-if="preview" class="word-preview-content">
        <div class="word-preview-header">
          <div class="word-preview-title">
            <span
              v-if="preview.article"
              :class="`gender-${preview.gender?.toLowerCase()}`"
            >{{ preview.article }}</span>
            <strong>{{ preview.word }}</strong>
          </div>
          <f7-badge :color="previewPosColor">{{ preview.pos }}</f7-badge>
        </div>
        <div class="word-preview-sense">
          <span class="word-preview-sense-num">{{ preview.senseNumber }}.</span>
          <span>{{ preview.senseGloss }}</span>
        </div>
        <div v-if="preview.senseGlossEn" class="word-preview-trans">
          {{ preview.senseGlossEn }}
        </div>
        <f7-button fill large class="word-preview-btn" @click="navigateToPreview">
          Open word card
        </f7-button>
      </div>
    </f7-sheet>
  </f7-page>
</template>

<script>
import GlossText from "../components/GlossText.vue";
import VerbConjugation from "../components/VerbConjugation.vue";

export default {
  components: { GlossText, VerbConjugation },
  props: {
    f7route: Object,
    f7router: Object,
  },
  data() {
    return {
      word: null,
      examples: {},
      loading: true,
      preview: null,
    };
  },
  computed: {
    posColor() {
      return this.getPosColor(this.word?.pos);
    },
    previewPosColor() {
      return this.getPosColor(this.preview?.pos);
    },
    wordExpressions() {
      if (!this.word?.expression_ids) return [];
      return this.word.expression_ids
        .map((id) => {
          const ex = this.examples[id];
          if (!ex) return null;
          return { id, text: ex.text, type: ex.type, note: ex.note, translation: ex.translation, ref: ex.ref || null };
        })
        .filter(Boolean);
    },
  },
  methods: {
    getPosColor(pos) {
      const colors = {
        noun: "blue",
        verb: "orange",
        adjective: "green",
        phrase: "purple",
        adverb: "teal",
        preposition: "deeporange",
        conjunction: "pink",
        particle: "lime",
        interjection: "red",
        pronoun: "indigo",
        determiner: "cyan",
        numeral: "amber",
      };
      return colors[pos] || "gray";
    },

    scrollToSense(senseNumber) {
      const el = document.getElementById(`sense-${senseNumber}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("sense-highlight");
      setTimeout(() => el.classList.remove("sense-highlight"), 1500);
    },

    async handleCrossRef(filePath, senseNumber) {
      try {
        const resp = await fetch(`/data/words/${filePath}.json`, { cache: "default" });
        if (!resp.ok) throw new Error("Not found");
        const data = await resp.json();
        const senseIdx = (senseNumber || 1) - 1;
        const sense = data.senses?.[senseIdx];
        this.preview = {
          filePath,
          senseNumber: senseNumber || 1,
          word: data.word,
          article: data.article || null,
          gender: data.gender || null,
          pos: data.pos,
          senseGloss: sense?.gloss || "",
          senseGlossEn: sense?.gloss_en || null,
        };
      } catch {
        // Fallback: navigate directly if preview data can't be fetched
        const url = `/word/${filePath}/`;
        this.f7router.navigate(senseNumber ? `${url}?sense=${senseNumber}` : url);
      }
    },

    navigateToPreview() {
      const { filePath, senseNumber } = this.preview;
      this.preview = null;
      const url = `/word/${filePath}/`;
      this.f7router.navigate(senseNumber ? `${url}?sense=${senseNumber}` : url);
    },

    getSenseExamples(sense) {
      if (!sense.example_ids || !sense.example_ids.length) return [];
      const { pos, file } = this.f7route.params;
      const currentPath = `${pos}/${file}`;

      return sense.example_ids
        .map((id) => {
          const ex = this.examples[id];
          if (!ex) return null;

          // Prefer text_linked (with cross-refs) over plain text
          let displayText = ex.text_linked || ex.text;

          // Strip self-references: [[form|currentPath]] or [[form|currentPath#N]] → form
          if (displayText.includes(`|${currentPath}`)) {
            const escaped = currentPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            displayText = displayText.replace(
              new RegExp(`\\[\\[([^\\]|]+)\\|${escaped}(?:#\\d+)?\\]\\]`, "g"),
              "$1",
            );
          }

          return { id, text: displayText, translation: ex.translation };
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
