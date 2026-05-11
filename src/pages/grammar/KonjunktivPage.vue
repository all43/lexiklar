<template>
  <f7-page name="grammar-konjunktiv">
    <f7-navbar :title="t('grammar.konjunktivTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.konjunktivTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.konjunktivDesc') }}</p>
    </f7-block>

    <!-- Overview: K1 vs K2 at a glance -->
    <f7-block class="konj-block">
      <div class="konj-comparison">
        <div class="konj-card" :class="{ 'konj-card-active': view === 'k2' }">
          <div class="konj-card-header">
            <a class="konj-anchor-link" @click.prevent="view = 'k2'">Konjunktiv II</a>
          </div>
          <div class="konj-card-use">{{ t('grammar.konj2Purpose') }}</div>
          <div class="konj-card-example">
            <em>Wenn ich reich <strong>wäre</strong>, <strong>würde</strong> ich reisen.</em>
          </div>
        </div>
        <div class="konj-card" :class="{ 'konj-card-active': view === 'k1' }">
          <div class="konj-card-header">
            <a class="konj-anchor-link" @click.prevent="view = 'k1'">Konjunktiv I</a>
          </div>
          <div class="konj-card-use">{{ t('grammar.konj1Purpose') }}</div>
          <div class="konj-card-example">
            <em>Er sagt, er <strong>sei</strong> krank.</em>
          </div>
        </div>
      </div>
    </f7-block>

    <!-- Tab toggle -->
    <f7-block class="view-toggle-block">
      <f7-segmented strong>
        <f7-button :active="view === 'k2'" @click="view = 'k2'">Konjunktiv II</f7-button>
        <f7-button :active="view === 'k1'" @click="view = 'k1'">Konjunktiv I</f7-button>
      </f7-segmented>
    </f7-block>

    <!-- ===== Konjunktiv II ===== -->
    <template v-if="view === 'k2'">
    <f7-block-title medium>Konjunktiv II</f7-block-title>
    <f7-block class="konj-block">
      <p class="konj-usage">{{ t('grammar.konj2Desc') }}</p>
    </f7-block>

    <!-- K2 Formation -->
    <f7-block-title>{{ t('grammar.konj2Formation') }}</f7-block-title>
    <f7-block class="konj-block">
      <p class="konj-note" v-html="t('grammar.konj2FormationNote')"></p>
      <div
        class="decl-table-wrap scroll-fade"
        :style="k2Fade.fadeStyle.value"
        :class="{ 'is-scrollable': k2Fade.isScrollable.value }"
      >
        <div class="decl-table-scroll" ref="k2El">
          <table class="decl-table konj-table">
            <thead>
              <tr>
                <th class="decl-case-header"></th>
                <th v-for="v in K2_VERBS" :key="v.verb" class="decl-num-header konj-verb-header">
                  <f7-link :href="`/word/verbs/${v.verb}/`" class="konj-header-link">{{ v.verb }}</f7-link>
                  <span class="konj-verb-type">{{ v.type }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in PERSONS" :key="p">
                <td class="decl-case">{{ p }}</td>
                <td v-for="v in K2_VERBS" :key="v.verb" class="decl-form konj-cell" v-html="v.k2[p]"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </f7-block>

    <!-- würde + Infinitiv -->
    <f7-block-title id="wuerde">{{ t('grammar.konj2Wuerde') }}</f7-block-title>
    <f7-block class="konj-block">
      <p class="konj-note" v-html="t('grammar.konj2WuerdeNote')"></p>
      <div
        class="decl-table-wrap scroll-fade"
        :style="wuerdeFade.fadeStyle.value"
        :class="{ 'is-scrollable': wuerdeFade.isScrollable.value }"
      >
        <div class="decl-table-scroll" ref="wuerdeEl">
          <table class="decl-table konj-table">
            <thead>
              <tr>
                <th class="decl-case-header"></th>
                <th class="decl-num-header konj-verb-header">
                  <f7-link href="/word/verbs/werden/" class="konj-header-link">würde</f7-link>
                  <span class="konj-verb-type">+ Infinitiv</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in PERSONS" :key="p">
                <td class="decl-case">{{ p }}</td>
                <td class="decl-form konj-cell" v-html="WUERDE[p]"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </f7-block>

    <!-- K2 Usage -->
    <f7-block-title>{{ t('grammar.konj2Usage') }}</f7-block-title>
    <f7-block class="konj-block">
      <div class="konj-usage-list">
        <div v-for="u in K2_USAGES" :key="u.key" class="konj-usage-item">
          <div class="konj-usage-label">{{ t(u.key) }}</div>
          <div class="konj-usage-example"><em v-html="u.example"></em></div>
        </div>
      </div>
    </f7-block>

    </template><!-- /k2 -->

    <!-- ===== Konjunktiv I ===== -->
    <template v-if="view === 'k1'">
    <f7-block-title medium>Konjunktiv I</f7-block-title>
    <f7-block class="konj-block">
      <p class="konj-usage">{{ t('grammar.konj1Desc') }}</p>
    </f7-block>

    <!-- K1 Formation -->
    <f7-block-title>{{ t('grammar.konj1Formation') }}</f7-block-title>
    <f7-block class="konj-block">
      <p class="konj-note" v-html="t('grammar.konj1FormationNote')"></p>
      <div
        class="decl-table-wrap scroll-fade"
        :style="k1Fade.fadeStyle.value"
        :class="{ 'is-scrollable': k1Fade.isScrollable.value }"
      >
        <div class="decl-table-scroll" ref="k1El">
          <table class="decl-table konj-table">
            <thead>
              <tr>
                <th class="decl-case-header"></th>
                <th v-for="v in K1_VERBS" :key="v.verb" class="decl-num-header konj-verb-header">
                  <f7-link :href="`/word/verbs/${v.verb}/`" class="konj-header-link">{{ v.verb }}</f7-link>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in PERSONS" :key="p">
                <td class="decl-case">{{ p }}</td>
                <td v-for="v in K1_VERBS" :key="v.verb" class="decl-form konj-cell" v-html="v.k1[p]"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </f7-block>

    <!-- K1 replacement rule -->
    <f7-block-title>{{ t('grammar.konj1Replacement') }}</f7-block-title>
    <f7-block class="konj-block">
      <p class="konj-note" v-html="t('grammar.konj1ReplacementNote')"></p>
      <div class="konj-replace-example">
        <div class="konj-replace-row">
          <span class="konj-replace-label konj-replace-clash">K1 = Indikativ</span>
          <span class="konj-replace-text">Er sagt, sie <s>haben</s> keine Zeit.</span>
        </div>
        <div class="konj-replace-row">
          <span class="konj-replace-label konj-replace-fix">{{ t('grammar.konj1UseK2') }}</span>
          <span class="konj-replace-text">Er sagt, sie <strong>hätten</strong> keine Zeit.</span>
        </div>
      </div>
    </f7-block>

    <!-- K1 Usage -->
    <f7-block-title>{{ t('grammar.konj1Usage') }}</f7-block-title>
    <f7-block class="konj-block">
      <div class="konj-usage-list">
        <div v-for="u in K1_USAGES" :key="u.key" class="konj-usage-item">
          <div class="konj-usage-label">{{ t(u.key) }}</div>
          <div class="konj-usage-example"><em v-html="u.example"></em></div>
        </div>
      </div>
    </f7-block>
    </template><!-- /k1 -->
  </f7-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import { useScrollFade } from "../../composables/useScrollFade.js";

const props = defineProps<{ f7route: { url: string } }>();

const view = ref<'k2' | 'k1'>('k2');

type Person = "ich" | "du" | "er/sie/es" | "wir" | "ihr" | "sie/Sie";
const PERSONS: Person[] = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];

interface VerbK2 {
  verb: string;
  type: string;
  k2: Record<Person, string>;
}

const K2_VERBS: VerbK2[] = [
  {
    verb: "haben",
    type: "Hilfsverb",
    k2: {
      "ich": "<strong>hätte</strong>", "du": "<strong>hättest</strong>", "er/sie/es": "<strong>hätte</strong>",
      "wir": "<strong>hätten</strong>", "ihr": "<strong>hättet</strong>", "sie/Sie": "<strong>hätten</strong>",
    },
  },
  {
    verb: "sein",
    type: "Hilfsverb",
    k2: {
      "ich": "<strong>wäre</strong>", "du": "<strong>wärst</strong>", "er/sie/es": "<strong>wäre</strong>",
      "wir": "<strong>wären</strong>", "ihr": "<strong>wärt</strong>", "sie/Sie": "<strong>wären</strong>",
    },
  },
  {
    verb: "können",
    type: "Modalverb",
    k2: {
      "ich": "<strong>könnte</strong>", "du": "<strong>könntest</strong>", "er/sie/es": "<strong>könnte</strong>",
      "wir": "<strong>könnten</strong>", "ihr": "<strong>könntet</strong>", "sie/Sie": "<strong>könnten</strong>",
    },
  },
  {
    verb: "müssen",
    type: "Modalverb",
    k2: {
      "ich": "<strong>müsste</strong>", "du": "<strong>müsstest</strong>", "er/sie/es": "<strong>müsste</strong>",
      "wir": "<strong>müssten</strong>", "ihr": "<strong>müsstet</strong>", "sie/Sie": "<strong>müssten</strong>",
    },
  },
];

const WUERDE: Record<Person, string> = {
  "ich": "<em>würde</em> machen", "du": "<em>würdest</em> machen", "er/sie/es": "<em>würde</em> machen",
  "wir": "<em>würden</em> machen", "ihr": "<em>würdet</em> machen", "sie/Sie": "<em>würden</em> machen",
};

interface VerbK1 {
  verb: string;
  k1: Record<Person, string>;
}

const K1_VERBS: VerbK1[] = [
  {
    verb: "sein",
    k1: {
      "ich": "<strong>sei</strong>", "du": "<strong>seist</strong>", "er/sie/es": "<strong>sei</strong>",
      "wir": "<strong>seien</strong>", "ihr": "<strong>seiet</strong>", "sie/Sie": "<strong>seien</strong>",
    },
  },
  {
    verb: "haben",
    k1: {
      "ich": "habe", "du": "<strong>habest</strong>", "er/sie/es": "<strong>habe</strong>",
      "wir": "haben", "ihr": "<strong>habet</strong>", "sie/Sie": "haben",
    },
  },
  {
    verb: "kommen",
    k1: {
      "ich": "komme", "du": "<strong>kommest</strong>", "er/sie/es": "<strong>komme</strong>",
      "wir": "kommen", "ihr": "<strong>kommet</strong>", "sie/Sie": "kommen",
    },
  },
];

const K2_USAGES = [
  { key: "grammar.konj2UsageUnreal", example: "Wenn ich Zeit <strong>hätte</strong>, <strong>würde</strong> ich kommen." },
  { key: "grammar.konj2UsagePolite", example: "<strong>Könnten</strong> Sie mir bitte helfen?" },
  { key: "grammar.konj2UsageWish", example: "Ich <strong>wünschte</strong>, es <strong>wäre</strong> Sommer." },
  { key: "grammar.konj2UsageAdvice", example: "An deiner Stelle <strong>würde</strong> ich zum Arzt gehen." },
];

const K1_USAGES = [
  { key: "grammar.konj1UsageSpeech", example: "Er sagt, er <strong>sei</strong> müde." },
  { key: "grammar.konj1UsageNews", example: "Die Regierung <strong>habe</strong> den Plan bestätigt." },
  { key: "grammar.konj1UsageFixed", example: "Es <strong>lebe</strong> die Freiheit! / Man <strong>nehme</strong> 200g Mehl." },
];

const k2El = ref<HTMLElement | null>(null);
const k2Fade = useScrollFade(k2El);
const wuerdeEl = ref<HTMLElement | null>(null);
const wuerdeFade = useScrollFade(wuerdeEl);
const k1El = ref<HTMLElement | null>(null);
const k1Fade = useScrollFade(k1El);
</script>

<style scoped>
.konj-block {
  padding-top: 0;
}

.konj-note {
  color: var(--f7-block-footer-text-color);
  font-size: 13px;
  margin: 0 0 8px;
}

.konj-usage {
  color: var(--f7-block-footer-text-color);
  font-size: 13px;
  font-style: italic;
  margin: 0;
}

/* Overview comparison cards */
.konj-comparison {
  display: flex;
  gap: 10px;
}

.konj-card {
  flex: 1;
  border-radius: 8px;
  padding: 12px;
  background: var(--f7-list-bg-color);
  border: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}

.konj-card-active {
  border-color: var(--f7-theme-color);
}

.konj-card-header {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 4px;
}

.konj-anchor-link {
  color: inherit;
  cursor: pointer;
}

.konj-anchor-link:active {
  opacity: 0.6;
}

.konj-card-use {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-bottom: 8px;
}

.konj-card-example {
  font-size: 13px;
}

.konj-card-example strong {
  color: var(--f7-theme-color);
}

/* View toggle */
.view-toggle-block {
  padding-top: 0;
  padding-bottom: 0;
}

/* Verb tables */
.konj-verb-header {
  min-width: 100px;
}

.konj-header-link {
  display: block;
  font-weight: 600;
  font-size: 13px;
}

.konj-verb-type {
  display: block;
  font-size: 10px;
  font-weight: 400;
  opacity: 0.55;
  font-style: italic;
}

.konj-table th,
.konj-table td {
  text-align: center;
}

.konj-table td:first-child {
  text-align: left;
}

.konj-cell {
  font-size: 13px;
  white-space: nowrap;
}

.konj-cell :deep(strong) {
  color: var(--f7-theme-color);
}

.konj-cell :deep(em) {
  font-style: normal;
  color: var(--f7-theme-color);
}

/* Usage list */
.konj-usage-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.konj-usage-item {
  border-left: 3px solid var(--f7-theme-color);
  padding-left: 10px;
}

.konj-usage-label {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 2px;
}

.konj-usage-example {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

.konj-usage-example :deep(strong) {
  color: var(--f7-theme-color);
  font-weight: 600;
}

/* K1 replacement rule */
.konj-replace-example {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.konj-replace-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.konj-replace-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}

.konj-replace-clash {
  background: rgba(255, 152, 0, 0.15);
  color: var(--color-rule-exception);
}

.konj-replace-text s {
  color: var(--color-rule-exception);
  text-decoration: line-through;
}

.konj-replace-fix {
  background: rgba(76, 175, 80, 0.15);
  color: var(--color-rule-match);
}

.konj-replace-text strong {
  color: var(--f7-theme-color);
}
</style>
