<template>
  <f7-page name="grammar-cases">
    <f7-navbar :title="t('grammar.casesTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.casesTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.casesDesc') }}</p>
    </f7-block>

    <!-- Four cases -->
    <f7-block class="cases-block">
      <div v-for="c in CASES" :key="c.key" class="case-card">
        <div class="case-name">{{ t(c.nameKey) }}</div>
        <div class="case-question">{{ t(c.questionKey) }}</div>
        <div class="case-role">{{ t(c.roleKey) }}</div>
      </div>
    </f7-block>

    <!-- View toggle -->
    <f7-block class="view-toggle-block">
      <f7-segmented strong>
        <f7-button :active="view === 'list'"    @click="view = 'list'"   >{{ t('grammar.casesListView') }}</f7-button>
        <f7-button :active="view === 'diagram'" @click="view = 'diagram'">{{ t('grammar.casesDiagramView') }}</f7-button>
      </f7-segmented>
    </f7-block>

    <!-- List view -->
    <template v-if="view === 'list'">
      <f7-block-title>{{ t('grammar.prepAccOnly') }}</f7-block-title>
      <f7-block class="prep-block">
        <div class="prep-group">
          <div v-for="item in prepositions.accusative" :key="item.prep" class="prep-item">
            <f7-link :href="`/word/prepositions/${item.prep}/`" class="prep-word">{{ item.prep }}</f7-link>
            <span class="prep-en">{{ item.en }}</span>
          </div>
        </div>
      </f7-block>

      <f7-block-title>{{ t('grammar.prepDatOnly') }}</f7-block-title>
      <f7-block class="prep-block">
        <div class="prep-group">
          <div v-for="item in prepositions.dative" :key="item.prep" class="prep-item">
            <f7-link :href="`/word/prepositions/${item.prep}/`" class="prep-word">{{ item.prep }}</f7-link>
            <span class="prep-en">{{ item.en }}</span>
          </div>
        </div>
      </f7-block>

      <f7-block-title>{{ t('grammar.prepTwoWay') }}</f7-block-title>
      <f7-block class="prep-block">
        <div class="prep-two-way-notes">
          <div class="prep-two-way-note prep-two-way-acc">{{ t('grammar.prepTwoWayAccNote') }}</div>
          <div class="prep-two-way-note prep-two-way-dat">{{ t('grammar.prepTwoWayDatNote') }}</div>
        </div>
        <div class="prep-group">
          <div v-for="item in prepositions.two_way" :key="item.prep" class="prep-item">
            <f7-link :href="`/word/prepositions/${item.prep}/`" class="prep-word">{{ item.prep }}</f7-link>
            <span class="prep-en">{{ item.en }}</span>
          </div>
        </div>
      </f7-block>
    </template>

    <!-- Diagram (bubble cluster) view -->
    <div v-else class="venn-outer">
      <div class="venn-bg venn-bg-left"></div>
      <div class="venn-bg venn-bg-right"></div>

      <div class="venn-col venn-col-left">
        <div class="venn-label venn-label-acc">Wohin? → Akk.</div>
        <div v-for="item in prepositions.accusative" :key="item.prep" class="venn-row">
          <f7-link :href="`/word/prepositions/${item.prep}/`" class="venn-word">{{ item.prep }}</f7-link>
          <span class="venn-meaning">{{ item.en }}</span>
        </div>
      </div>
      <div class="venn-col venn-col-center">
        <div class="venn-label venn-label-both">Akk. + Dat.</div>
        <div v-for="item in prepositions.two_way" :key="item.prep" class="venn-row">
          <f7-link :href="`/word/prepositions/${item.prep}/`" class="venn-word">{{ item.prep }}</f7-link>
          <span class="venn-meaning">{{ item.en }}</span>
        </div>
      </div>
      <div class="venn-col venn-col-right">
        <div class="venn-label venn-label-dat">Wo? → Dat.</div>
        <div v-for="item in prepositions.dative" :key="item.prep" class="venn-row">
          <f7-link :href="`/word/prepositions/${item.prep}/`" class="venn-word">{{ item.prep }}</f7-link>
          <span class="venn-meaning">{{ item.en }}</span>
        </div>
      </div>
    </div>
  </f7-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import prepData from "../../../data/rules/prepositions.json";

const props = defineProps<{ f7route: { url: string } }>();

const prepositions = prepData as {
  accusative: { prep: string; en: string }[];
  dative: { prep: string; en: string }[];
  two_way: { prep: string; en: string }[];
};

const view = ref<'list' | 'diagram'>('list');

const CASES = [
  { key: "nom", nameKey: "grammar.nominative", questionKey: "grammar.nominativeQ", roleKey: "grammar.nominativeRole" },
  { key: "acc", nameKey: "grammar.accusative", questionKey: "grammar.accusativeQ", roleKey: "grammar.accusativeRole" },
  { key: "dat", nameKey: "grammar.dative",     questionKey: "grammar.dativeQ",     roleKey: "grammar.dativeRole" },
  { key: "gen", nameKey: "grammar.genitive",   questionKey: "grammar.genitiveQ",   roleKey: "grammar.genitiveRole" },
];
</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

.cases-block {
  padding-top: 0;
}

.case-card {
  padding: 12px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.case-card:last-child {
  border-bottom: none;
}

.case-name {
  font-weight: 700;
  font-size: 16px;
}

.case-question {
  font-size: 14px;
  font-weight: 600;
  color: var(--f7-theme-color);
  margin-top: 2px;
}

.case-role {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
}

/* View toggle */
.view-toggle-block {
  padding-top: 0;
  padding-bottom: 0;
}

/* List view */
.prep-block {
  padding-top: 0;
}

.prep-two-way-notes {
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.prep-two-way-note {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  display: inline-block;
}

.prep-two-way-acc {
  background: color-mix(in srgb, var(--color-gender-m) 15%, transparent);
  color: var(--color-gender-m);
}

.prep-two-way-dat {
  background: color-mix(in srgb, var(--color-gender-n) 15%, transparent);
  color: var(--color-gender-n);
}

.prep-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.prep-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 52px;
}

.prep-word {
  font-weight: 600;
  font-size: 15px;
}

.prep-en {
  font-size: 11px;
  color: var(--f7-block-footer-text-color);
  text-align: center;
  margin-top: 1px;
}

/* Bubble cluster view */
.venn-outer {
  display: flex;
  justify-content: center;
  position: relative;
  margin: 8px 16px 24px;
}

.venn-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  width: calc(200% / 3);
  border-radius: 20px;
  pointer-events: none;
}
.venn-bg-left {
  left: 0;
  background: color-mix(in srgb, var(--color-gender-m) 14%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--color-gender-m) 35%, transparent);
}
.venn-bg-right {
  right: 0;
  background: color-mix(in srgb, var(--color-gender-n) 14%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--color-gender-n) 35%, transparent);
}

.venn-col {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 8px;
  gap: 8px;
  min-width: 0;
  flex: 1 1 0;
}
.venn-col-center {
  z-index: 2;
}

.venn-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
  white-space: nowrap;
}
.venn-label-acc  { color: var(--color-gender-m); }
.venn-label-dat  { color: var(--color-gender-n); }
.venn-label-both { color: var(--f7-block-footer-text-color); }

.venn-word {
  font-weight: 600;
  font-size: 12px;
  text-align: center;
  line-height: 1.35;
}

.venn-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}

.venn-meaning {
  display: none;
  font-size: 11px;
  color: var(--f7-block-footer-text-color);
}

@media (min-width: 768px) {
  .venn-meaning {
    display: inline;
  }
}
</style>
