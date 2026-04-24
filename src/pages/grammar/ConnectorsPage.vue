<template>
  <f7-page name="grammar-connectors">
    <f7-navbar :title="t('grammar.connectorsTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.connectorsTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.connectorsDesc') }}</p>
    </f7-block>

    <!-- Word order reference -->
    <f7-block-title>{{ t('grammar.connectorsWordOrder') }}</f7-block-title>
    <f7-block class="wo-block">
      <div class="wo-list">
        <div class="wo-card">
          <div class="wo-type">{{ t('grammar.connectorsCoord') }}</div>
          <div class="wo-rule">{{ t('grammar.connectorsWordOrderCoordRule') }}</div>
          <div class="wo-example">Ich bleibe, <strong>denn</strong> ich bin krank.</div>
        </div>
        <div class="wo-card">
          <div class="wo-type">{{ t('grammar.connectorsSub') }}</div>
          <div class="wo-rule">{{ t('grammar.connectorsWordOrderSubRule') }}</div>
          <div class="wo-example">Ich bleibe, <strong>weil</strong> ich krank <strong>bin</strong>.</div>
        </div>
        <div class="wo-card">
          <div class="wo-type">{{ t('grammar.connectorsAdv') }}</div>
          <div class="wo-rule">{{ t('grammar.connectorsWordOrderAdvRule') }}</div>
          <div class="wo-example"><strong>Deshalb</strong> bleibe ich zu Hause.</div>
        </div>
      </div>
    </f7-block>

    <!-- View toggle -->
    <f7-block class="view-toggle-block">
      <f7-segmented strong>
        <f7-button :active="view === 'meaning'" @click="view = 'meaning'">{{ t('grammar.connectorsByMeaning') }}</f7-button>
        <f7-button :active="view === 'type'"    @click="view = 'type'"   >{{ t('grammar.connectorsByType') }}</f7-button>
      </f7-segmented>
    </f7-block>

    <!-- Connector groups -->
    <template v-for="group in displayedGroups" :key="group.titleKey">
      <f7-block-title>{{ t(group.titleKey) }}</f7-block-title>
      <f7-block class="conn-block">
        <div class="conn-list">
          <div v-for="c in group.items" :key="c.word + c.path" class="conn-item">
            <div class="conn-header">
              <f7-link :href="`/word/${c.path}/`" class="conn-word">{{ c.word }}</f7-link>
              <span class="conn-badge">{{ typeLabel(c.type) }}<template v-if="c.caseLabel"> {{ c.caseLabel }}</template></span>
              <span class="conn-en">{{ c.en }}</span>
              <span v-if="c.formal" class="conn-formal">({{ t('grammar.connectorsFormal') }})</span>
              <span v-if="c.sameAs" class="conn-same-as">= {{ c.sameAs }}</span>
              <span v-if="view === 'type'" class="conn-meaning-tag">{{ t(MEANING_KEY[c.meaning]) }}</span>
            </div>
            <div class="conn-example-de">{{ c.example.de }}</div>
            <div class="conn-example-en">{{ c.example.en }}</div>
            <div v-if="c.note" class="conn-note">{{ c.note }}</div>
          </div>
        </div>
      </f7-block>
    </template>

    <!-- nämlich callout -->
    <f7-block-title>{{ t('grammar.connectorsNämlich') }}</f7-block-title>
    <f7-block class="conn-block">
      <p class="nämlich-desc">{{ t('grammar.connectorsNämlichDesc') }}</p>
      <div class="nämlich-examples">
        <div class="nämlich-wrong">✗ <em>Nämlich</em> bin ich krank.</div>
        <div class="nämlich-right">✓ Ich bin <em>nämlich</em> krank.</div>
        <div class="nämlich-right">✓ Ich bleibe zu Hause. Ich bin <em>nämlich</em> krank.</div>
      </div>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";

const props = defineProps<{ f7route: { url: string } }>();

interface Connector {
  word: string;
  /** posDir/file path for direct word page link, e.g. "conjunctions/weil_konjunktion" */
  path: string;
  type: 'coord' | 'sub' | 'adv' | 'prep';
  caseLabel?: string;
  meaning: 'cause' | 'consequence' | 'concession';
  en: string;
  sameAs?: string;
  formal?: boolean;
  example: { de: string; en: string };
  note?: string;
}

interface ConnectorGroup {
  titleKey: string;
  items: Connector[];
}

const TYPE_KEYS: Record<string, string> = {
  coord: 'grammar.connectorsCoord',
  sub:   'grammar.connectorsSub',
  adv:   'grammar.connectorsAdv',
  prep:  'grammar.connectorsPrep',
};

const MEANING_KEY: Record<string, string> = {
  cause:       'grammar.connectorsMeaningCause',
  consequence: 'grammar.connectorsMeaningConsequence',
  concession:  'grammar.connectorsMeaningConcession',
};

function typeLabel(type: string): string {
  return t(TYPE_KEYS[type] ?? type);
}

const view = ref<'meaning' | 'type'>('meaning');

const CAUSE: Connector[] = [
  {
    word: "weil",
    path: "conjunctions/weil_konjunktion",
    type: "sub",
    meaning: "cause",
    en: "because",
    example: { de: "Ich bleibe zu Hause, weil ich krank bin.", en: "I'm staying home because I'm sick." },
  },
  {
    word: "da",
    path: "conjunctions/da",
    type: "sub",
    meaning: "cause",
    en: "since / as",
    formal: true,
    example: { de: "Da ich krank bin, bleibe ich zu Hause.", en: "Since I'm sick, I'm staying home." },
    note: "More formal than weil; usually starts the clause.",
  },
  {
    word: "denn",
    path: "conjunctions/denn",
    type: "coord",
    meaning: "cause",
    en: "for / because",
    example: { de: "Ich bleibe zu Hause, denn ich bin krank.", en: "I'm staying home, for I'm sick." },
  },
  {
    word: "wegen",
    path: "prepositions/wegen",
    type: "prep",
    caseLabel: "+ Gen.",
    meaning: "cause",
    en: "because of",
    example: { de: "Wegen der Krankheit bleibe ich zu Hause.", en: "Because of the illness I'm staying home." },
  },
  {
    word: "aufgrund",
    path: "prepositions/aufgrund",
    type: "prep",
    caseLabel: "+ Gen.",
    meaning: "cause",
    en: "due to",
    formal: true,
    example: { de: "Aufgrund des Wetters blieb ich zu Hause.", en: "Due to the weather I stayed home." },
  },
];

const CONSEQUENCE: Connector[] = [
  {
    word: "deshalb",
    path: "conjunctions/deshalb",
    type: "adv",
    meaning: "consequence",
    en: "therefore",
    example: { de: "Ich bin krank. Deshalb bleibe ich zu Hause.", en: "I'm sick. That's why I'm staying home." },
  },
  {
    word: "deswegen",
    path: "adverbs/deswegen",
    type: "adv",
    meaning: "consequence",
    en: "therefore",
    sameAs: "deshalb",
    example: { de: "Ich bin krank. Deswegen bleibe ich zu Hause.", en: "I'm sick. Therefore I'm staying home." },
  },
  {
    word: "daher",
    path: "adverbs/daher",
    type: "adv",
    meaning: "consequence",
    en: "hence",
    sameAs: "deshalb",
    formal: true,
    example: { de: "Ich bin krank. Daher bleibe ich zu Hause.", en: "I'm sick. Hence I'm staying home." },
  },
  {
    word: "darum",
    path: "adverbs/darum",
    type: "adv",
    meaning: "consequence",
    en: "that's why",
    sameAs: "deshalb",
    example: { de: "Ich bin krank. Darum bleibe ich zu Hause.", en: "I'm sick. That's why I'm staying home." },
  },
  {
    word: "also",
    path: "adverbs/also",
    type: "adv",
    meaning: "consequence",
    en: "so",
    example: { de: "Ich bin krank, also bleibe ich zu Hause.", en: "I'm sick, so I'm staying home." },
  },
  {
    word: "folglich",
    path: "conjunctions/folglich",
    type: "adv",
    meaning: "consequence",
    en: "consequently",
    formal: true,
    example: { de: "Ich bin krank. Folglich bleibe ich zu Hause.", en: "I'm sick. Consequently I'm staying home." },
  },
];

const CONCESSION: Connector[] = [
  {
    word: "obwohl",
    path: "conjunctions/obwohl",
    type: "sub",
    meaning: "concession",
    en: "although",
    example: { de: "Ich gehe aus, obwohl ich krank bin.", en: "I'm going out although I'm sick." },
  },
  {
    word: "obgleich",
    path: "conjunctions/obgleich",
    type: "sub",
    meaning: "concession",
    en: "although",
    sameAs: "obwohl",
    formal: true,
    example: { de: "Ich gehe aus, obgleich ich krank bin.", en: "I'm going out although I'm sick." },
  },
  {
    word: "trotzdem",
    path: "conjunctions/trotzdem",
    type: "adv",
    meaning: "concession",
    en: "nevertheless",
    example: { de: "Ich bin krank. Trotzdem gehe ich aus.", en: "I'm sick. Nevertheless I'm going out." },
  },
  {
    word: "dennoch",
    path: "adverbs/dennoch",
    type: "adv",
    meaning: "concession",
    en: "nevertheless",
    sameAs: "trotzdem",
    formal: true,
    example: { de: "Ich bin krank. Dennoch gehe ich aus.", en: "I'm sick. Nevertheless I'm going out." },
  },
  {
    word: "jedoch",
    path: "adverbs/jedoch",
    type: "adv",
    meaning: "concession",
    en: "however",
    formal: true,
    example: { de: "Ich bin krank. Jedoch gehe ich aus.", en: "I'm sick. However I'm going out." },
  },
  {
    word: "aber",
    path: "conjunctions/aber",
    type: "coord",
    meaning: "concession",
    en: "but",
    example: { de: "Ich bin krank, aber ich gehe aus.", en: "I'm sick, but I'm going out." },
  },
  {
    word: "trotz",
    path: "prepositions/trotz",
    type: "prep",
    caseLabel: "+ Gen.",
    meaning: "concession",
    en: "despite",
    example: { de: "Trotz der Krankheit gehe ich aus.", en: "Despite the illness I'm going out." },
  },
];

const ALL_CONNECTORS = [...CAUSE, ...CONSEQUENCE, ...CONCESSION];

const MEANING_GROUPS = computed<ConnectorGroup[]>(() => [
  { titleKey: 'grammar.connectorsCause',       items: CAUSE },
  { titleKey: 'grammar.connectorsConsequence', items: CONSEQUENCE },
  { titleKey: 'grammar.connectorsConcession',  items: CONCESSION },
]);

const TYPE_GROUPS = computed<ConnectorGroup[]>(() => [
  { titleKey: 'grammar.connectorsSub',   items: ALL_CONNECTORS.filter(c => c.type === 'sub') },
  { titleKey: 'grammar.connectorsCoord', items: ALL_CONNECTORS.filter(c => c.type === 'coord') },
  { titleKey: 'grammar.connectorsAdv',   items: ALL_CONNECTORS.filter(c => c.type === 'adv') },
  { titleKey: 'grammar.connectorsPrep',  items: ALL_CONNECTORS.filter(c => c.type === 'prep') },
]);

const displayedGroups = computed(() =>
  view.value === 'meaning' ? MEANING_GROUPS.value : TYPE_GROUPS.value
);
</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

/* Word order section */
.wo-block {
  padding-top: 0;
}

.wo-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.wo-card {
  padding: 10px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.wo-card:last-child {
  border-bottom: none;
}

.wo-type {
  font-weight: 700;
  font-size: 15px;
}

.wo-rule {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
}

.wo-example {
  font-size: 14px;
  font-style: italic;
  margin-top: 4px;
  color: var(--f7-text-color);
}

/* View toggle */
.view-toggle-block {
  padding-top: 0;
  padding-bottom: 0;
}

/* Connector groups */
.conn-block {
  padding-top: 0;
}

.conn-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.conn-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.conn-item:last-child {
  border-bottom: none;
}

.conn-header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 6px;
}

.conn-word {
  font-weight: 700;
  font-size: 16px;
}

.conn-badge {
  font-size: 11px;
  color: var(--f7-block-footer-text-color);
  border: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.2));
  border-radius: 4px;
  padding: 1px 4px;
  white-space: nowrap;
}

.conn-en {
  font-size: 14px;
  color: var(--f7-block-footer-text-color);
  font-style: italic;
}

.conn-formal {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  opacity: 0.7;
}

.conn-same-as {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  opacity: 0.7;
}

.conn-meaning-tag {
  font-size: 11px;
  color: var(--f7-theme-color);
  border: 1px solid var(--f7-theme-color);
  border-radius: 4px;
  padding: 1px 4px;
  white-space: nowrap;
  opacity: 0.8;
}

.conn-example-de {
  font-size: 13px;
  font-style: italic;
  margin-top: 4px;
  color: var(--f7-text-color);
}

.conn-example-en {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
}

.conn-note {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 3px;
  font-style: italic;
}

/* nämlich callout */
.nämlich-desc {
  font-size: 14px;
  color: var(--f7-block-footer-text-color);
  margin: 0 0 10px;
}

.nämlich-examples {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}

.nämlich-wrong {
  color: var(--color-vowel-change, #d32f2f);
}

.nämlich-right {
  color: var(--color-rule-match, #4caf50);
}
</style>
