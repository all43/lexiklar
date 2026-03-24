<template>
  <f7-page name="word">
    <f7-navbar :title="word ? (word.plural_dominant ? word.plural_form : word.word) : t('word.loading')" back-link>
      <f7-nav-right>
        <f7-link
          v-if="word"
          icon-f7="flag"
          icon-size="18"
          :tooltip="t('report.incorrectData')"
          @click="reportIssue('top')"
        />
        <f7-link
          v-if="word"
          :icon-f7="isFavorite ? 'star_fill' : 'star'"
          icon-size="20"
          :tooltip="isFavorite ? t('word.removeFavorite') : t('word.addFavorite')"
          @click="toggleFavorite"
        />
        <f7-link
          v-if="word && isInHistory"
          icon-f7="xmark_circle"
          icon-size="20"
          :tooltip="t('word.removeHistory')"
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
          <span v-if="word.plural_dominant" class="gender-f">{{ 'die ' }}</span>
          <span v-else-if="word.article" :class="`gender-${word.gender?.toLowerCase()}`">{{ word.article + ' ' }}</span>
          <!-- Separable verb: show prefix|stem -->
          <template v-if="word.separable && word.prefix">
            <span class="verb-prefix">{{ word.prefix }}</span><verb-sep-pipe />{{ word.word.slice(word.prefix.length) }}
          </template>
          <template v-else>{{ word.plural_dominant ? word.plural_form : word.word }}</template>
          <!-- Oscillating verb badge -->
          <sup v-if="word.oscillating_verb" class="oscillating-badge" :title="t('word.oscillatingVerb')">⇄</sup>
        </h1>
        <p v-if="word.plural_dominant" style="margin: 2px 0 0; font-size: 0.85em; color: var(--f7-list-item-footer-text-color);">
          {{ t('word.singular') }}
          <span :class="`gender-${word.gender?.toLowerCase()}`">{{ word.article }}</span>
          {{ word.word }}
        </p>
        <p v-if="word.sounds && word.sounds.length" class="ipa">
          {{ word.sounds[0].ipa }}
        </p>
        <!-- Oscillating verb note -->
        <p v-if="word.oscillating_verb" class="oscillating-note">
          {{ word.separable ? t('word.oscillatingNoteSep') : t('word.oscillatingNoteInsep') }}
        </p>
        <p>
          <f7-badge :color="posColor">{{ word.pos }}</f7-badge>
          <span v-if="word.frequency"> · #{{ word.frequency }}</span>
        </p>
      </f7-block>

      <!-- Compound breakdown -->
      <template v-if="compoundParts.length">
        <f7-block-title>{{ t('word.compound') }}</f7-block-title>
        <f7-block class="compound-block">
          <div class="compound-parts">
            <template v-for="(part, idx) in compoundParts" :key="idx">
              <span v-if="idx > 0" class="compound-plus">+</span>
              <span
                class="compound-part"
                :class="{ 'compound-part-linked': part.file }"
                @click="part.file && f7router.navigate(`/word/${part.file}/`)"
              >
                <strong>{{ part.lemma }}</strong>
                <span v-if="part.glossEn" class="compound-gloss">({{ part.glossEn }})</span>
              </span>
            </template>
          </div>
        </f7-block>
      </template>

      <!-- Senses -->
      <div class="block-title meanings-header">
        <span>{{ t('word.meanings') }}</span>
        <a v-if="word.pos === 'verb' || word.pos === 'noun' || word.pos === 'proper noun' || word.pos === 'adjective' || word.pos === 'pronoun' || word.pos === 'determiner' || word.pos === 'numeral'" class="grammar-jump" @click.prevent="scrollToGrammar">{{ word.pos === 'verb' ? t('word.conjugation') : (word.pos === 'noun' || word.pos === 'proper noun') ? t('word.declension') : t('word.grammar') }} ↓</a>
      </div>
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
            v-for="ex in getSenseExamples(sense, idx)"
            :key="ex.id"
            class="example-item"
          >
            <div class="item-content">
              <div class="item-inner example-inner">
                <GlossText
                  :gloss="ex.text"
                  :self-path="ex.selfPath"
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
          <!-- Show more examples -->
          <li
            v-if="getSenseExampleTotal(sense) > 2 && !expandedSenses.includes(idx)"
            class="example-show-more"
            @click="expandSense(idx)"
          >
            <div class="item-content">
              <div class="item-inner">
                + {{ getSenseExampleTotal(sense) - 2 }} {{ t('word.more') }}
              </div>
            </div>
          </li>
          <!-- Sense-level synonyms & antonyms -->
          <li v-if="getSenseSynonyms(sense).length || getSenseAntonyms(sense).length" class="sense-syn-ant-item">
            <div v-if="getSenseSynonyms(sense).length" class="sense-syn-row">
              <span class="sense-syn-label">≈</span>
              <f7-chip
                v-for="r in getSenseSynonyms(sense)"
                :key="r.file"
                :text="r.lemma"
                class="syn-chip"
                @click="f7router.navigate(`/word/${r.file}/`)"
              />
            </div>
            <div v-if="getSenseAntonyms(sense).length" class="sense-syn-row">
              <span class="sense-syn-label">≠</span>
              <f7-chip
                v-for="r in getSenseAntonyms(sense)"
                :key="r.file"
                :text="r.lemma"
                class="ant-chip"
                @click="f7router.navigate(`/word/${r.file}/`)"
              />
            </div>
          </li>
        </template>
      </f7-list>

      <!-- Synonyms & Antonyms (dead: _synonyms/_antonyms stripped from DB; handled via related_words) -->
      <template v-if="word._synonyms?.length || word._antonyms?.length">
        <f7-block-title>{{ t('word.synonymsAntonyms') }}</f7-block-title>
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
        <f7-block-title>{{ t('word.expressions') }}</f7-block-title>
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
                    >{{ t('word.proverb') }}</f7-badge>
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
        <f7-block-title
          :class="{ 'syn-ant-title--collapsible': relatedTotal > 3 }"
          @click="relatedTotal > 3 && (relatedExpanded = !relatedExpanded)"
        >
          {{ t('word.relatedWords') }}
          <span v-if="relatedTotal > 3" class="syn-ant-toggle">{{ relatedExpanded ? '▲' : '▼' }}</span>
        </f7-block-title>
        <f7-list v-if="relatedExpanded || relatedTotal <= 3">
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
        <div class="block-title meanings-header" id="word-grammar">
          <span>{{ t('word.conjugation') }}</span>
          <a class="grammar-jump" @click.prevent="scrollToTop">↑ {{ t('word.meanings') }}</a>
        </div>
        <VerbConjugation :verb="word" />
      </template>
      <template v-else-if="word.pos === 'noun' || word.pos === 'proper noun'">
        <div class="block-title meanings-header" id="word-grammar">
          <span>{{ t('word.declension') }}</span>
          <a class="grammar-jump" @click.prevent="scrollToTop">↑ {{ t('word.meanings') }}</a>
        </div>
        <NounDeclension :word="(word as NounWord)" />
      </template>
      <template v-else-if="word.pos === 'adjective'">
        <div class="block-title meanings-header" id="word-grammar">
          <span>{{ t('word.grammar') }}</span>
          <a class="grammar-jump" @click.prevent="scrollToTop">↑ {{ t('word.meanings') }}</a>
        </div>
        <AdjectiveDeclension :word="word" />
      </template>
      <template v-else-if="word.pos === 'pronoun' || word.pos === 'determiner' || word.pos === 'numeral'">
        <div class="block-title meanings-header" id="word-grammar">
          <span>{{ t('word.grammar') }}</span>
          <a class="grammar-jump" @click.prevent="scrollToTop">↑ {{ t('word.meanings') }}</a>
        </div>
        <PronounDeclension v-if="word.pos === 'pronoun'" :word="word" />
        <f7-block v-else>
          <p><em>{{ t('word.grammarSoon') }}</em></p>
        </f7-block>
      </template>

      <!-- Report issue -->
      <f7-block-footer class="padding-horizontal text-align-center margin-top margin-bottom-large">
        <f7-link @click="reportIssue('bottom')" class="text-color-gray">{{ t('report.incorrectData') }}</f7-link>
      </f7-block-footer>
    </template>

    <f7-block v-else>
      <p>{{ t('word.notFound') }}</p>
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
            >{{ preview.article + ' ' }}</span><strong>{{ preview.word }}</strong>
            <f7-badge :color="previewPosColor" class="word-preview-badge">{{ preview.pos }}</f7-badge>
          </div>
        </div>
        <!-- Multiple senses listed when no specific sense was pinned -->
        <template v-if="!preview.senseExplicit && preview.senseCount > 1">
          <div
            v-for="(s, i) in preview.senses.slice(0, 3)"
            :key="i"
            class="word-preview-sense"
          >
            <span class="word-preview-sense-num">{{ i + 1 }}.</span>
            <span class="word-preview-primary">{{ s.glossEn || s.gloss }}</span>
          </div>
          <div v-if="preview.senseCount > 3" class="word-preview-more">
            + {{ preview.senseCount - 3 }} {{ t('word.more') }}
          </div>
        </template>
        <!-- Single sense shown when a specific sense was explicitly linked -->
        <div v-else class="word-preview-sense">
          <span class="word-preview-sense-num">{{ preview.senseNumber }}.</span>
          <div class="word-preview-sense-gloss">
            <span class="word-preview-primary">{{ preview.senseGlossEn || preview.senseGloss }}</span>
            <span v-if="preview.senseGlossEn" class="word-preview-secondary">{{ preview.senseGloss }}</span>
          </div>
        </div>
        <f7-button fill large class="word-preview-btn" @click="navigateToPreview">
          {{ t('word.openCard') }}
        </f7-button>
      </div>
    </f7-sheet>
  </f7-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlossText from "../components/GlossText.vue";
import VerbConjugation from "../components/VerbConjugation.vue";
import NounDeclension from "../components/NounDeclension.vue";
import AdjectiveDeclension from "../components/AdjectiveDeclension.vue";
import PronounDeclension from "../components/PronounDeclension.vue";
import VerbSepPipe from "../components/VerbSepPipe.vue";
import { getWord, getExamples, getRelatedWords, searchByLemma } from "../utils/db.js";
import { submitReport } from "../utils/report.js";
import { f7 } from "framework7-vue/bundle";
import { t } from "../js/i18n.js";
import { getCached, setItem } from "../utils/storage.js";
import { stripOuterQuotes } from "../utils/text.js";
import type { Word, Sense, VerbWord, NounWord, AdjectiveWord } from "../../types/word.js";
import type { Example } from "../../types/example.js";
import type { SearchResult } from "../../types/search.js";

interface PreviewSense {
  gloss: string;
  glossEn: string | null;
}

interface PreviewData {
  filePath: string;
  senseNumber: number;
  senseCount: number;
  senseExplicit: boolean;
  senses: PreviewSense[];
  word: string;
  article: string | null;
  gender: string | null;
  pos: string;
  senseGloss: string;
  senseGlossEn: string | null;
}

interface RelatedRef {
  file: string;
  type: string;
}

interface CompoundPart {
  lemma: string;
  file: string | null;
  glossEn: string | null;
}

interface RelatedGroupItem {
  file: string;
  displayTitle: string;
  glossText: string;
  pos: string;
}

interface RelatedGroup {
  type: string;
  label: string;
  items: RelatedGroupItem[];
}

interface ExpressionItem {
  id: string;
  text: string;
  type?: string;
  note?: string;
  translation: string | null;
  ref: string | null;
}

const POS_COLORS: Record<string, string> = {
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

export default defineComponent({
  components: { GlossText, VerbConjugation, NounDeclension, AdjectiveDeclension, VerbSepPipe, PronounDeclension },
  props: {
    f7route: { type: Object, default: null },
    f7router: { type: Object, default: null },
  },
  data() {
    return {
      word: null as Word | null,
      examples: {} as Record<string, Example>,
      relatedWords: [] as SearchResult[],
      loading: true,
      preview: null as PreviewData | null,
      expandedSenses: [] as number[],
      relatedExpanded: false,
      inHistory: false,
      isFavorite: false,
    };
  },
  computed: {
    t() { return t; },
    isInHistory(): boolean {
      return this.inHistory;
    },
    posColor(): string {
      return this.getPosColor(this.word?.pos);
    },
    previewPosColor(): string {
      return this.getPosColor(this.preview?.pos);
    },
    compoundParts(): CompoundPart[] {
      const w = this.word as Record<string, unknown> | null;
      if (!w?.compound_parts) return [];

      // Build file→result map, then resolve compound_part entries in order (first homonym wins).
      const fileMap: Record<string, SearchResult> = {};
      for (const rw of this.relatedWords) fileMap[rw.file] = rw;

      const compPartFiles = ((w.related as RelatedRef[] | undefined) || [])
        .filter((r) => r.type === "compound_part")
        .map((r) => r.file);

      const infoMap: Record<string, SearchResult> = {};
      for (const fileKey of compPartFiles) {
        const rw = fileMap[fileKey];
        if (rw && !(rw.lemma.toLowerCase() in infoMap)) {
          infoMap[rw.lemma] = rw;
          infoMap[rw.lemma.toLowerCase()] = rw;
        }
      }
      // Fallback: any relatedWord not already covered (e.g. verbs with no homonyms)
      for (const rw of this.relatedWords) {
        if (!(rw.lemma.toLowerCase() in infoMap)) {
          infoMap[rw.lemma] = rw;
          infoMap[rw.lemma.toLowerCase()] = rw;
        }
      }

      return (w.compound_parts as string[]).map((lemma: string) => {
        const info = infoMap[lemma] || infoMap[lemma.toLowerCase()];
        return {
          lemma,
          file: info?.file || null,
          glossEn: info?.glossEn?.[0] || null,
        };
      });
    },
    relatedGroups(): RelatedGroup[] {
      const w = this.word as Record<string, unknown> | null;
      if (!w?.related || !this.relatedWords.length) return [];

      const typeLabels: Record<string, string> = {
        feminine_form: t("related.feminineForm"),
        masculine_form: t("related.masculineForm"),
        antonym: t("related.antonyms"),
        synonym: t("related.synonyms"),
        same_stem: t("related.sameStem"),
        derived: t("related.derived"),
        derived_from: t("related.derivedFrom"),
        compound: t("related.compoundVerbs"),
        base_verb: t("related.baseVerb"),
        compound_of: t("related.compoundOf"),
      };
      const typeOrder = ["feminine_form", "masculine_form", "antonym", "synonym", "same_stem", "derived_from", "derived", "base_verb", "compound", "compound_of"];

      const infoMap: Record<string, SearchResult> = {};
      for (const rw of this.relatedWords) {
        infoMap[rw.file] = rw;
      }

      const groups: Record<string, RelatedGroupItem[]> = {};
      for (const rel of w.related as RelatedRef[]) {
        const info = infoMap[rel.file];
        if (!info) continue;
        if (!groups[rel.type]) groups[rel.type] = [];

        let displayTitle = info.lemma;
        if ((info.pos === "noun" || info.pos === "proper noun") && info.gender) {
          const articles: Record<string, string> = { M: "der", F: "die", N: "das" };
          const art = articles[info.gender];
          if (art) displayTitle = `${art} ${info.lemma}`;
        }

        const glossText = info.glossEn?.length ? info.glossEn[0] : "";

        groups[rel.type].push({
          file: rel.file,
          displayTitle,
          glossText,
          pos: info.pos,
        });
      }

      return typeOrder
        .filter((type) => groups[type])
        .map((type) => ({
          type,
          label: typeLabels[type] || type,
          items: groups[type],
        }));
    },
    relatedTotal(): number {
      return this.relatedGroups.reduce((sum, g) => sum + g.items.length, 0);
    },
    relatedByLemma(): Record<string, SearchResult> {
      const map: Record<string, SearchResult> = {};
      for (const rw of this.relatedWords) map[rw.lemma] = rw;
      return map;
    },
    wordExpressions(): ExpressionItem[] {
      if (!this.word?.expression_ids) return [];
      return this.word.expression_ids
        .map((id: string): ExpressionItem | null => {
          const ex = this.examples[id] as Example & Record<string, unknown> | undefined;
          if (!ex) return null;
          const item: ExpressionItem = { id, text: ex.text, translation: ex.translation, ref: (ex.ref as string) || null };
          if (ex.type) item.type = ex.type as string;
          if (ex.note) item.note = ex.note as string;
          return item;
        })
        .filter((item): item is ExpressionItem => item !== null);
    },
  },
  methods: {
    toggleFavorite() {
      const { pos, file } = this.f7route.params as { pos: string; file: string };
      const fileKey = `${pos}/${file}`;
      try {
        const favs: string[] = JSON.parse(getCached("lexiklar_favorites") || "[]");
        if (this.isFavorite) {
          setItem("lexiklar_favorites", JSON.stringify(favs.filter((f) => f !== fileKey)));
          this.isFavorite = false;
        } else {
          favs.unshift(fileKey);
          setItem("lexiklar_favorites", JSON.stringify(favs));
          this.isFavorite = true;
        }
      } catch {
        // silently skip
      }
    },

    removeFromHistory() {
      f7.dialog.create({
        title: t("word.removeHistory"),
        text: t("word.removeHistoryConfirm"),
        buttons: [
          { text: t("report.cancel") },
          {
            text: t("favorites.remove"),
            strong: true,
            onClick: () => {
              const { pos, file } = this.f7route.params as { pos: string; file: string };
              const fileKey = `${pos}/${file}`;
              try {
                const recents: string[] = JSON.parse(getCached("lexiklar_recents") || "[]");
                setItem(
                  "lexiklar_recents",
                  JSON.stringify(recents.filter((f) => f !== fileKey)),
                );
                const counts: Record<string, number> = JSON.parse(getCached("lexiklar_view_counts") || "{}");
                delete counts[fileKey];
                setItem("lexiklar_view_counts", JSON.stringify(counts));
                // Remove lemma from phrase search terms
                const lemma = file.includes("_") ? file.split("_")[0] : file;
                try {
                  const raw = JSON.parse(getCached("lexiklar_phrase_terms") || "[]");
                  const terms: { term: string; ts: number }[] =
                    (raw.length && typeof raw[0] === "string") ? [] : raw;
                  const filtered2 = terms.filter(
                    (e: { term: string }) => e.term.toLowerCase() !== lemma.toLowerCase(),
                  );
                  if (filtered2.length !== terms.length) {
                    setItem("lexiklar_phrase_terms", JSON.stringify(filtered2));
                  }
                } catch { /* ignore */ }
                this.inHistory = false;
              } catch {
                // silently skip
              }
            },
          },
        ],
      }).open();
    },

    getPosColor(pos: string | undefined): string {
      return POS_COLORS[pos || ""] || "gray";
    },

    async searchWord(lemma: string) {
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

    scrollToSense(senseNumber: number) {
      const el = document.getElementById(`sense-${senseNumber}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("sense-highlight");
      setTimeout(() => el.classList.remove("sense-highlight"), 1500);
    },

    async handleCrossRef(filePath: string, senseNumber: number | null) {
      try {
        const data = await getWord(filePath);
        if (!data) throw new Error("Not found");
        const senseIdx = (senseNumber || 1) - 1;
        const sense = data.senses?.[senseIdx];
        this.preview = {
          filePath,
          senseNumber: senseNumber || 1,
          senseCount: data.senses?.length || 1,
          senseExplicit: senseNumber != null,
          senses: (data.senses || []).map((s) => ({ gloss: s.gloss, glossEn: s.gloss_en || null })),
          word: data.word,
          article: (data as unknown as Record<string, unknown>).article as string | null || null,
          gender: (data as unknown as Record<string, unknown>).gender as string | null || null,
          pos: data.pos,
          senseGloss: sense?.gloss || "",
          senseGlossEn: sense?.gloss_en || null,
        };
      } catch {
        const url = `/word/${filePath}/`;
        this.f7router.navigate(senseNumber ? `${url}?sense=${senseNumber}` : url);
      }
    },

    navigateToPreview() {
      if (!this.preview) return;
      const { filePath, senseNumber } = this.preview;
      this.preview = null;
      const url = `/word/${filePath}/`;
      this.f7router.navigate(senseNumber ? `${url}?sense=${senseNumber}` : url);
    },

    reportIssue(source: "top" | "bottom" = "bottom") {
      const { pos, file } = this.f7route.params as { pos: string; file: string };
      const fileKey = `${pos}/${file}`;
      const word = this.word?.word || file;
      f7.dialog.create({
        title: t("report.incorrectData"),
        text: t("report.details"),
        content: '<div class="dialog-input-field input"><input type="text" class="dialog-input"></div>',
        buttons: [
          { text: t("report.cancel"), keyCodes: [27] },
          // @ts-expect-error — F7 DialogButton type is incomplete
          { text: t("report.send"), bold: true, close: false },
        ],
        onClick(dialog: { $el: { find(sel: string): { val(): string } }; close(): void }, index: number) {
          if (index === 0) return;
          const details = dialog.$el.find(".dialog-input").val();
          dialog.close();
          submitReport({ type: "incorrect_data", word, details, file: fileKey, source }).then((result) => {
            f7.toast.create({
              text: result.ok ? t("report.success") : t("report.error"),
              closeTimeout: 2000,
              position: "center",
            }).open();
          });
        },
      }).open();
    },

    getSenseExamples(sense: Sense, senseIdx: number) {
      if (!sense.example_ids || !sense.example_ids.length) return [];
      const { pos, file } = this.f7route.params as { pos: string; file: string };
      const currentPath = `${pos}/${file}`;

      const all = sense.example_ids
        .map((id) => {
          const ex = this.examples[id] as Example & Record<string, unknown> | undefined;
          if (!ex) return null;
          const text = stripOuterQuotes((ex.text_linked as string) || ex.text);
          return { id, text, selfPath: currentPath, translation: ex.translation, sortLen: ex.text.length };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.sortLen - b.sortLen);

      if (this.expandedSenses.includes(senseIdx)) return all;
      return all.slice(0, 2);
    },

    getSenseExampleTotal(sense: Sense): number {
      return sense.example_ids?.filter((id) => !!this.examples[id]).length ?? 0;
    },

    expandSense(idx: number) {
      if (!this.expandedSenses.includes(idx)) this.expandedSenses.push(idx);
    },

    scrollToGrammar() {
      const el = document.getElementById("word-grammar");
      if (!el) return;
      const pageContent = el.closest(".page-content") as HTMLElement | null;
      if (!pageContent) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      const navbarHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--f7-navbar-height")) || 0;
      const marginTop = parseInt(getComputedStyle(el).marginTop) || 0;
      const target = pageContent.scrollTop + el.getBoundingClientRect().top - navbarHeight - marginTop - 8;
      pageContent.scrollTo({ top: target, behavior: "smooth" });
    },

    scrollToTop() {
      const pageContent = document.querySelector(".page-current .page-content") as HTMLElement | null;
      pageContent?.scrollTo({ top: 0, behavior: "smooth" });
    },

    getSenseSynonyms(sense: Sense): SearchResult[] {
      const words = sense.synonyms ?? [];
      if (!words.length) return [];
      const map = this.relatedByLemma;
      return words.map((w) => map[w]).filter((r): r is SearchResult => !!r);
    },

    getSenseAntonyms(sense: Sense): SearchResult[] {
      const words = sense.antonyms ?? [];
      if (!words.length) return [];
      const map = this.relatedByLemma;
      return words.map((w) => map[w]).filter((r): r is SearchResult => !!r);
    },
  },
  beforeUnmount() {
    (this.$el as HTMLElement).querySelectorAll(".tooltip-init").forEach((el) => {
      const htmlEl = el as HTMLElement & { f7Tooltip?: { destroy(): void } };
      if (htmlEl.f7Tooltip) htmlEl.f7Tooltip.destroy();
    });
  },
  async mounted() {
    const { pos, file } = this.f7route.params as { pos: string; file: string };
    const targetSense = parseInt(this.f7route.query?.sense as string, 10) || null;

    try {
      this.word = await getWord(`${pos}/${file}`) as (Word & Record<string, unknown>) | null;

      if (this.word) {
        try {
          const RECENTS_KEY = "lexiklar_recents";
          const COUNTS_KEY = "lexiklar_view_counts";
          const fileKey = `${pos}/${file}`;

          const stored = getCached(RECENTS_KEY);
          const recents: string[] = stored ? JSON.parse(stored) : [];
          const filtered = recents.filter((f) => f !== fileKey);
          filtered.unshift(fileKey);
          setItem(
            RECENTS_KEY,
            JSON.stringify(filtered.slice(0, 100)),
          );

          const counts: Record<string, number> = JSON.parse(getCached(COUNTS_KEY) || "{}");
          counts[fileKey] = (counts[fileKey] || 0) + 1;
          setItem(COUNTS_KEY, JSON.stringify(counts));

          // Track visited word for phrase discovery (timestamped)
          const PHRASE_TERMS_KEY = "lexiklar_phrase_terms";
          const lemma = file.includes("_") ? file.split("_")[0] : file;
          if (lemma.length >= 3) {
            try {
              const raw = JSON.parse(getCached(PHRASE_TERMS_KEY) || "[]");
              const terms: { term: string; ts: number }[] =
                (raw.length && typeof raw[0] === "string") ? [] : raw;
              const now = Date.now();
              const updated = terms.filter(
                (e: { term: string }) => e.term.toLowerCase() !== lemma.toLowerCase(),
              );
              updated.push({ term: lemma, ts: now });
              setItem(PHRASE_TERMS_KEY, JSON.stringify(updated.slice(-10)));
            } catch { /* ignore */ }
          }

          this.inHistory = true;

          const favs: string[] = JSON.parse(getCached("lexiklar_favorites") || "[]");
          this.isFavorite = favs.includes(fileKey);
        } catch {
          // storage unavailable — silently skip
        }
      }

      const ids: string[] = [];
      for (const s of this.word?.senses || []) {
        if (s.example_ids) ids.push(...s.example_ids);
      }
      if (this.word?.expression_ids) ids.push(...this.word.expression_ids);
      if (ids.length) this.examples = await getExamples(ids);

      const w = this.word as Record<string, unknown> | null;
      if (w?.related && (w.related as RelatedRef[]).length) {
        const fileKeys = (w.related as RelatedRef[]).map((r) => r.file);
        this.relatedWords = await getRelatedWords(fileKeys);
      }
    } catch (err) {
      console.error("Failed to load word:", err);
    } finally {
      this.loading = false;
      await this.$nextTick();
      if (targetSense) this.scrollToSense(targetSense);
      (this.$el as HTMLElement).querySelectorAll(".tooltip-init").forEach((el) => {
        const htmlEl = el as HTMLElement & { f7Tooltip?: unknown };
        const text = htmlEl.dataset.tooltip;
        if (text && !htmlEl.f7Tooltip) f7.tooltip.create({ targetEl: htmlEl, text });
      });
    }
  },
});
</script>

<style scoped>
/* Separable verb prefix split */
.verb-prefix {
  color: var(--f7-theme-color);
  font-weight: 700;
}
.oscillating-badge {
  font-size: 0.55em;
  font-weight: 400;
  color: var(--f7-theme-color);
  vertical-align: super;
  margin-left: 4px;
  cursor: default;
}
.oscillating-note {
  margin: 2px 0 0;
  font-size: 0.8em;
  font-style: italic;
  color: var(--f7-list-item-footer-text-color);
}

/* Compound breakdown */
.compound-block {
  padding-top: 4px;
  padding-bottom: 4px;
}
.compound-parts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.compound-plus {
  color: var(--f7-list-item-footer-text-color);
  font-size: 1.1em;
}
.compound-part-linked {
  color: var(--f7-theme-color);
  cursor: pointer;
}
.compound-gloss {
  font-size: 0.85em;
  color: var(--f7-list-item-footer-text-color);
  margin-left: 2px;
}

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
