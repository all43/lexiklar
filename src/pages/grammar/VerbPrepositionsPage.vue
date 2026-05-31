<template>
  <f7-page name="grammar-verb-prepositions">
    <f7-navbar :title="t('grammar.verbPrepositionsTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.verbPrepositionsTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.verbPrepositionsDesc') }}</p>
    </f7-block>

    <!-- How it works -->
    <f7-block-title>{{ t('grammar.vpHowItWorks') }}</f7-block-title>
    <f7-block class="vp-block">
      <div class="vp-rule-card">
        <div class="vp-rule-example">
          <strong>warten</strong> + <strong>auf</strong> + Akkusativ
        </div>
        <div class="vp-rule-desc">{{ t('grammar.vpHowItWorksDesc') }}</div>
      </div>
    </f7-block>

    <!-- Verb groups by preposition -->
    <template v-for="group in PREP_GROUPS" :key="group.prep + group.case">
      <f7-block-title>{{ group.prep }} <span class="vp-case-label">{{ group.case }}</span></f7-block-title>
      <f7-block class="vp-block">
        <div class="vp-verb-list">
          <div v-for="v in group.verbs" :key="v.base + v.en" class="vp-verb-item" :class="{ 'vp-transparent': v.transparent }">
            <div class="vp-verb-header">
              <f7-link :href="`/word/verbs/${v.base}/`" class="vp-verb-link">{{ v.verb }}</f7-link>
              <span class="vp-verb-en">{{ v.en }}</span>
            </div>
            <div v-if="v.alsoWith" class="vp-also-with">↳ {{ v.alsoWith }}</div>
            <div class="vp-verb-ex">{{ v.example.de }}</div>
            <div class="vp-verb-ex-en">{{ v.example.en }}</div>
          </div>
        </div>
      </f7-block>
    </template>

    <!-- Different preposition = different meaning -->
    <f7-block-title>{{ t('grammar.vpDualPreps') }}</f7-block-title>
    <f7-block class="vp-block">
      <p class="vp-dual-desc">{{ t('grammar.vpDualPrepsDesc') }}</p>
      <div class="vp-dual-list">
        <div v-for="d in DUAL_PREPS" :key="d.verb" class="vp-dual-item">
          <div class="vp-dual-header">
            <f7-link :href="`/word/verbs/${d.base}/`" class="vp-verb-link">{{ d.verb }}</f7-link>
          </div>
          <div class="vp-dual-row">
            <span class="vp-dual-prep">{{ d.prep1 }}</span>
            <span class="vp-dual-meaning">{{ d.en1 }}</span>
          </div>
          <div class="vp-dual-row">
            <span class="vp-dual-prep">{{ d.prep2 }}</span>
            <span class="vp-dual-meaning">{{ d.en2 }}</span>
          </div>
        </div>
      </div>
    </f7-block>

    <!-- See also -->
    <f7-block-title>{{ t('grammar.vpSeeAlso') }}</f7-block-title>
    <f7-block class="vp-block">
      <div class="vp-see-also">
        <div class="vp-see-also-item">
          <f7-link href="/grammar/proadverb/" class="vp-see-also-link">{{ t('grammar.proadverb') }} →</f7-link>
          <div class="vp-see-also-hint">{{ t('grammar.vpProadverbHint') }}</div>
        </div>
        <div class="vp-see-also-item">
          <f7-link href="/grammar/cases/" class="vp-see-also-link">{{ t('grammar.cases') }} →</f7-link>
          <div class="vp-see-also-hint">{{ t('grammar.vpCasesHint') }}</div>
        </div>
      </div>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import verbPrepsData from "../../../data/rules/verb-prepositions.json";

const props = defineProps<{ f7route: { url: string } }>();

interface VerbEntry {
  verb: string;
  base: string;
  en: string;
  example: { de: string; en: string };
  transparent?: boolean;
  alsoWith?: string;
}

interface PrepGroup {
  prep: string;
  case: string;
  verbs: VerbEntry[];
}

const CASE_LABELS: Record<string, string> = { Akk: "+ Akkusativ", Dat: "+ Dativ" };

const PREP_GROUPS: PrepGroup[] = (() => {
  const groups: PrepGroup[] = [];
  const map = new Map<string, PrepGroup>();
  for (const e of verbPrepsData.entries) {
    const key = `${e.prep}|${e.case}`;
    let g = map.get(key);
    if (!g) {
      g = { prep: e.prep, case: CASE_LABELS[e.case] || `+ ${e.case}`, verbs: [] };
      map.set(key, g);
      groups.push(g);
    }
    g.verbs.push(e);
  }
  return groups;
})();

const DUAL_PREPS = [
  { verb: "sich freuen", base: "freuen", prep1: "auf + Akk", en1: "to look forward to (future)", prep2: "über + Akk", en2: "to be happy about (present/past)" },
  { verb: "bestehen", base: "bestehen", prep1: "auf + Akk", en1: "to insist on", prep2: "aus + Dat", en2: "to consist of" },
  { verb: "leiden", base: "leiden", prep1: "an + Dat", en1: "to suffer from (illness)", prep2: "unter + Dat", en2: "to suffer from (conditions/pressure)" },
  { verb: "kämpfen", base: "kämpfen", prep1: "gegen + Akk", en1: "to fight against", prep2: "um + Akk", en2: "to fight for" },
];
</script>

<style scoped>
.vp-block {
  padding-top: 0;
}

/* How it works */
.vp-rule-card {
  padding: 10px 0;
}

.vp-rule-example {
  font-size: 15px;
}

.vp-rule-desc {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 4px;
}

/* Case label in section headers */
.vp-case-label {
  font-weight: 400;
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

/* Verb list */
.vp-verb-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.vp-verb-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.vp-verb-item:last-child {
  border-bottom: none;
}

.vp-verb-header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 6px;
}

.vp-verb-link {
  font-weight: 600;
  font-size: 15px;
}

.vp-verb-en {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

.vp-also-with {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
  padding-left: 2px;
}

.vp-verb-ex {
  font-size: 13px;
  font-style: italic;
  margin-top: 3px;
  color: var(--f7-text-color);
}

.vp-verb-ex-en {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
}

/* Transparent entries (predictable from English) */
.vp-transparent .vp-verb-link {
  font-weight: 400;
}
.vp-transparent .vp-verb-en,
.vp-transparent .vp-verb-ex,
.vp-transparent .vp-verb-ex-en {
  opacity: 0.7;
}

/* Dual prepositions */
.vp-dual-desc {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
  margin: 0 0 8px;
}

.vp-dual-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.vp-dual-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.vp-dual-item:last-child {
  border-bottom: none;
}

.vp-dual-header {
  margin-bottom: 4px;
}

.vp-dual-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
}

.vp-dual-prep {
  font-weight: 600;
  font-size: 13px;
  min-width: 90px;
}

.vp-dual-meaning {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

/* See also */
.vp-see-also {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vp-see-also-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vp-see-also-link {
  font-weight: 600;
  font-size: 15px;
}

.vp-see-also-hint {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
}
</style>
