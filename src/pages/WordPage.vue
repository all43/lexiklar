<template>
  <f7-page name="word">
    <f7-navbar :title="word ? (word.plural_dominant ? word.plural_form : word.word) : 'Loading...'" back-link="Back">
      <f7-nav-right>
        <f7-link
          v-if="word && isInHistory"
          icon-f7="clock_badge_xmark"
          icon-size="20"
          tooltip="Remove from history"
          @click="removeFromHistory"
        />
      </f7-nav-right>
    </f7-navbar>

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>

    <template v-else-if="word">
      <!-- Header: word + pronunciation -->
      <f7-block strong>
        <h1 style="margin: 0;">
          <span v-if="word.plural_dominant" class="gender-f">die</span>
          <span v-else-if="word.article" :class="`gender-${word.gender?.toLowerCase()}`">{{ word.article }}</span>
          {{ word.plural_dominant ? word.plural_form : word.word }}
        </h1>
        <p v-if="word.plural_dominant" style="margin: 2px 0 0; font-size: 0.85em; color: var(--f7-list-item-footer-text-color);">
          singular:
          <span :class="`gender-${word.gender?.toLowerCase()}`">{{ word.article }}</span>
          {{ word.word }}
        </p>
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
          <li :id="`sense-${idx + 1}`" class="sense-item">
            <div class="item-content">
              <div class="item-inner sense-inner">
                <div class="sense-gloss-row">
                  <span class="sense-num">{{ idx + 1 }}.</span>
                  <div class="sense-gloss-wrap">
                    <div class="sense-primary-row">
                      <span class="sense-primary">{{ sense.gloss_en || sense.gloss }}</span>
                    </div>
                    <div
                      v-if="sense.gloss_en"
                      class="sense-secondary-row"
                    >
                      <GlossText
                        :gloss="sense.gloss"
                        @sense-ref="scrollToSense"
                        @cross-ref="handleCrossRef"
                        class="sense-secondary"
                      />
                      <span
                        v-if="sense.gloss_en_full"
                        class="tooltip-init sense-info-icon"
                        :data-tooltip="sense.gloss_en_full"
                      >ⓘ</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </li>

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

      <!-- Synonyms & Antonyms -->
      <template v-if="word._synonyms?.length || word._antonyms?.length">
        <f7-block-title>Synonyms &amp; Antonyms</f7-block-title>
        <f7-block class="syn-ant-block">
          <div v-if="word._synonyms?.length" class="syn-ant-row">
            <span class="syn-ant-label">≈</span>
            <f7-chip
              v-for="syn in word._synonyms"
              :key="syn"
              :text="syn"
              class="syn-chip"
              @click="searchWord(syn)"
            />
          </div>
          <div v-if="word._antonyms?.length" class="syn-ant-row">
            <span class="syn-ant-label">≠</span>
            <f7-chip
              v-for="ant in word._antonyms"
              :key="ant"
              :text="ant"
              class="ant-chip"
              @click="searchWord(ant)"
            />
          </div>
        </f7-block>
      </template>

      <!-- Usage Note -->
      <f7-block v-if="word.plural_only_note" class="usage-note-block">
        <p class="usage-note-text">{{ word.plural_only_note }}</p>
      </f7-block>

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

      <!-- Related Words -->
      <template v-if="relatedGroups.length">
        <f7-block-title>Related Words</f7-block-title>
        <f7-list>
          <template v-for="group in relatedGroups" :key="group.type">
            <f7-list-item group-title :title="group.label" />
            <f7-list-item
              v-for="rel in group.items"
              :key="rel.file"
              :title="rel.displayTitle"
              :footer="rel.glossText"
              :link="`/word/${rel.file}/`"
            />
          </template>
        </f7-list>
      </template>

      <!-- Grammar -->
      <template v-if="word.pos === 'verb'">
        <f7-block-title>Conjugation</f7-block-title>
        <VerbConjugation :verb="word" />
      </template>
      <template v-else-if="word.pos === 'noun' || word.pos === 'proper noun'">
        <f7-block-title>Declension</f7-block-title>
        <NounDeclension :word="word" />
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
import NounDeclension from "../components/NounDeclension.vue";
import { getWord, getExamples, getRelatedWords, searchByLemma } from "../utils/db.js";
import { f7 } from "framework7-vue/bundle";

export default {
  components: { GlossText, VerbConjugation, NounDeclension },
  props: {
    f7route: Object,
    f7router: Object,
  },
  data() {
    return {
      word: null,
      examples: {},
      relatedWords: [],
      loading: true,
      preview: null,
      inHistory: false,       // whether this word is currently in the user's history
    };
  },
  computed: {
    isInHistory() {
      return this.inHistory;
    },
    posColor() {
      return this.getPosColor(this.word?.pos);
    },
    previewPosColor() {
      return this.getPosColor(this.preview?.pos);
    },
    relatedGroups() {
      if (!this.word?.related || !this.relatedWords.length) return [];

      const typeLabels = {
        feminine_form: "Feminine Form",
        masculine_form: "Masculine Form",
        antonym: "Antonyms",
        synonym: "Synonyms",
        same_stem: "Same Stem",
        derived: "Derived Words",
        derived_from: "Derived From",
        compound: "Compound Verbs",
        base_verb: "Base Verb",
      };
      const typeOrder = ["feminine_form", "masculine_form", "antonym", "synonym", "same_stem", "derived_from", "derived", "base_verb", "compound"];

      // Build file → display info lookup
      const infoMap = {};
      for (const rw of this.relatedWords) {
        infoMap[rw.file] = rw;
      }

      // Group by type
      const groups = {};
      for (const rel of this.word.related) {
        const info = infoMap[rel.file];
        if (!info) continue;
        if (!groups[rel.type]) groups[rel.type] = [];

        // Build display title: article + word for nouns, just word for others
        let displayTitle = info.lemma;
        if ((info.pos === "noun" || info.pos === "proper noun") && info.gender) {
          const articles = { M: "der", F: "die", N: "das" };
          const art = articles[info.gender];
          if (art) displayTitle = `${art} ${info.lemma}`;
        }

        // First English gloss as subtitle
        const glossText = info.glossEn?.length ? info.glossEn[0] : "";

        groups[rel.type].push({
          file: rel.file,
          displayTitle,
          glossText,
          pos: info.pos,
        });
      }

      // Return ordered groups
      return typeOrder
        .filter((type) => groups[type])
        .map((type) => ({
          type,
          label: typeLabels[type] || type,
          items: groups[type],
        }));
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
    removeFromHistory() {
      const { pos, file } = this.f7route.params;
      const fileKey = `${pos}/${file}`;
      try {
        // Remove from recents list
        const recents = JSON.parse(localStorage.getItem("lexiklar_recents") || "[]");
        localStorage.setItem(
          "lexiklar_recents",
          JSON.stringify(recents.filter((f) => f !== fileKey)),
        );
        // Remove view count
        const counts = JSON.parse(localStorage.getItem("lexiklar_view_counts") || "{}");
        delete counts[fileKey];
        localStorage.setItem("lexiklar_view_counts", JSON.stringify(counts));
        this.inHistory = false;
      } catch {
        // silently skip
      }
    },

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
        "proper noun": "blue",
      };
      return colors[pos] || "gray";
    },

    async searchWord(lemma) {
      // Look up the tapped synonym/antonym. If it resolves to exactly one word
      // in the DB, navigate directly to its card. Otherwise fall back to going
      // back so the user can type it manually in the searchbar.
      try {
        const hits = await searchByLemma(lemma);
        const exact = hits.filter(
          (h) => h.lemma.toLowerCase() === lemma.toLowerCase(),
        );
        if (exact.length === 1) {
          this.f7router.navigate(`/word/${exact[0].file}/`);
          return;
        }
      } catch {
        // ignore lookup errors
      }
      this.f7router.back();
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
        const data = await getWord(filePath);
        if (!data) throw new Error("Not found");
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
        // Fallback: navigate directly if preview data can't be loaded
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
  beforeUnmount() {
    this.$el.querySelectorAll(".tooltip-init").forEach((el) => {
      if (el.f7Tooltip) el.f7Tooltip.destroy();
    });
  },
  async mounted() {
    const { pos, file } = this.f7route.params;
    const targetSense = parseInt(this.f7route.query?.sense, 10) || null;

    try {
      this.word = await getWord(`${pos}/${file}`);

      // Track this visit in recent words + view counts
      if (this.word) {
        try {
          const RECENTS_KEY = "lexiklar_recents";
          const COUNTS_KEY = "lexiklar_view_counts";
          const fileKey = `${pos}/${file}`;

          // Update recents list (most recent first, max 100)
          const stored = localStorage.getItem(RECENTS_KEY);
          const recents = stored ? JSON.parse(stored) : [];
          const filtered = recents.filter((f) => f !== fileKey);
          filtered.unshift(fileKey);
          localStorage.setItem(
            RECENTS_KEY,
            JSON.stringify(filtered.slice(0, 100)),
          );

          // Increment view count
          const counts = JSON.parse(localStorage.getItem(COUNTS_KEY) || "{}");
          counts[fileKey] = (counts[fileKey] || 0) + 1;
          localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));

          this.inHistory = true;
        } catch {
          // localStorage unavailable — silently skip
        }
      }

      // Load only the examples this word needs
      const ids = [];
      for (const s of this.word?.senses || []) {
        if (s.example_ids) ids.push(...s.example_ids);
      }
      if (this.word?.expression_ids) ids.push(...this.word.expression_ids);
      if (ids.length) this.examples = await getExamples(ids);

      // Load related word display info
      if (this.word?.related?.length) {
        const fileKeys = this.word.related.map((r) => r.file);
        this.relatedWords = await getRelatedWords(fileKeys);
      }
    } catch (err) {
      console.error("Failed to load word:", err);
    } finally {
      this.loading = false;
      await this.$nextTick();
      if (targetSense) this.scrollToSense(targetSense);
      // Mirror what F7's pageInit does for tooltip-init elements
      this.$el.querySelectorAll(".tooltip-init").forEach((el) => {
        const text = el.dataset.tooltip;
        if (text && !el.f7Tooltip) f7.tooltip.create({ targetEl: el, text });
      });
    }
  },
};
</script>

<style scoped>
.sense-inner {
  flex-direction: column;
  align-items: flex-start;
  padding-top: 10px;
  padding-bottom: 10px;
}

.sense-gloss-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.sense-num {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--f7-list-item-footer-text-color);
  flex-shrink: 0;
}

.sense-gloss-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sense-primary-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sense-secondary-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sense-primary {
  font-size: var(--f7-list-item-title-font-size, 17px);
  flex: 1;
}

.sense-info-icon {
  font-size: 0.85em;
  line-height: 1;
  color: var(--f7-list-item-footer-text-color);
  flex-shrink: 0;
  opacity: 0.7;
}



.sense-secondary {
  font-size: var(--f7-list-item-footer-font-size, 12px);
  color: var(--f7-list-item-footer-text-color);
}

.syn-ant-block {
  padding-top: 4px;
  padding-bottom: 4px;
}

.syn-ant-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.syn-ant-row:last-child {
  margin-bottom: 0;
}

.syn-ant-label {
  font-size: 1.1em;
  font-weight: 600;
  color: var(--f7-list-item-footer-text-color);
  min-width: 18px;
}

.syn-chip {
  cursor: pointer;
}

.ant-chip {
  cursor: pointer;
  --f7-chip-bg-color: rgba(255, 59, 48, 0.12);
  --f7-chip-text-color: rgb(255, 59, 48);
}
</style>
