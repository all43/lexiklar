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

    <!-- Prepositions -->
    <f7-block-title>{{ t('grammar.prepAccOnly') }}</f7-block-title>
    <f7-block class="prep-block">
      <div class="prep-group">
        <div v-for="item in prepositions.accusative" :key="item.prep" class="prep-item">
          <f7-link :href="`/search/${item.prep}/`" class="prep-word">{{ item.prep }}</f7-link>
          <span class="prep-en">{{ item.en }}</span>
        </div>
      </div>
    </f7-block>

    <f7-block-title>{{ t('grammar.prepDatOnly') }}</f7-block-title>
    <f7-block class="prep-block">
      <div class="prep-group">
        <div v-for="item in prepositions.dative" :key="item.prep" class="prep-item">
          <f7-link :href="`/search/${item.prep}/`" class="prep-word">{{ item.prep }}</f7-link>
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
          <f7-link :href="`/search/${item.prep}/`" class="prep-word">{{ item.prep }}</f7-link>
          <span class="prep-en">{{ item.en }}</span>
        </div>
      </div>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import prepData from "../../../data/rules/prepositions.json";

const props = defineProps<{ f7route: { url: string } }>();

const prepositions = prepData as {
  accusative: { prep: string; en: string }[];
  dative: { prep: string; en: string }[];
  two_way: { prep: string; en: string }[];
};

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
</style>
