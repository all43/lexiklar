<template>
  <f7-page name="grammar-tenses">
    <f7-navbar :title="t('grammar.tensesTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.tensesTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.tensesDesc') }}</p>
    </f7-block>

    <!-- Overview table: ich-form for all 6 tenses -->
    <f7-block class="tenses-block">
      <div
        class="decl-table-wrap scroll-fade"
        :style="overviewFade.fadeStyle.value"
        :class="{ 'is-scrollable': overviewFade.isScrollable.value }"
      >
        <div class="decl-table-scroll" ref="overviewEl">
          <table class="decl-table tenses-overview-table">
            <thead>
              <tr>
                <th class="decl-case-header tenses-overview-tense-col"></th>
                <th class="decl-num-header tenses-verb-header">
                  <f7-link href="/word/verbs/machen/" class="tenses-header-link">machen</f7-link>
                  <span class="tenses-verb-type">{{ t('grammar.tensesWeak') }}</span>
                </th>
                <th class="decl-num-header tenses-verb-header">
                  <f7-link href="/word/verbs/fahren/" class="tenses-header-link">fahren</f7-link>
                  <span class="tenses-verb-type">{{ t('grammar.tensesStrong') }}</span>
                </th>
                <th class="decl-num-header tenses-verb-header">
                  <f7-link href="/word/verbs/sein/" class="tenses-header-link">sein</f7-link>
                  <span class="tenses-verb-type">{{ t('grammar.tensesIrregular') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tense in TENSES" :key="tense.key">
                <td class="decl-case tenses-overview-tense">
                  <a class="tenses-anchor-link" @click.prevent="scrollTo(tense.key)">
                    {{ tense.label }}
                    <span class="tenses-ich">(ich)</span>
                  </a>
                </td>
                <td class="decl-form tenses-cell" v-html="tense.machen['ich']"></td>
                <td class="decl-form tenses-cell" v-html="tense.fahren['ich']"></td>
                <td class="decl-form tenses-cell" v-html="tense.sein['ich']"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </f7-block>

    <f7-block-footer>{{ t('grammar.tensesAuxNote') }}</f7-block-footer>

    <!-- Formation sections -->
    <template v-for="(tense, i) in TENSES" :key="tense.key">
      <f7-block-title :id="`tense-${tense.key}`">{{ tense.label }}</f7-block-title>
      <f7-block class="tenses-block">
        <p class="tense-usage">{{ t(tense.usageKey) }}</p>
          <p class="tense-note" v-html="t(tense.formationKey)"></p>
        <div
          class="decl-table-wrap scroll-fade"
          :style="scrollFades[i].fadeStyle.value"
          :class="{ 'is-scrollable': scrollFades[i].isScrollable.value }"
        >
          <div class="decl-table-scroll" :ref="(el) => { tableEls[i].value = el as HTMLElement | null }">
            <table class="decl-table tenses-table">
              <thead>
                <tr>
                  <th class="decl-case-header"></th>
                  <th class="decl-num-header tenses-verb-header">
                    <f7-link href="/word/verbs/machen/" class="tenses-header-link">machen</f7-link>
                    <span class="tenses-verb-type">{{ t('grammar.tensesWeak') }}</span>
                  </th>
                  <th class="decl-num-header tenses-verb-header">
                    <f7-link href="/word/verbs/fahren/" class="tenses-header-link">fahren</f7-link>
                    <span class="tenses-verb-type">{{ t('grammar.tensesStrong') }}</span>
                  </th>
                  <th class="decl-num-header tenses-verb-header">
                    <f7-link href="/word/verbs/sein/" class="tenses-header-link">sein</f7-link>
                    <span class="tenses-verb-type">{{ t('grammar.tensesIrregular') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in PERSONS" :key="p">
                  <td class="decl-case">{{ p }}</td>
                  <td class="decl-form tenses-cell" v-html="tense.machen[p]"></td>
                  <td class="decl-form tenses-cell" v-html="tense.fahren[p]"></td>
                  <td class="decl-form tenses-cell" v-html="tense.sein[p]"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </f7-block>
    </template>
  </f7-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import { useScrollFade } from "../../composables/useScrollFade.js";

const props = defineProps<{ f7route: { url: string } }>();

type Person = "ich" | "du" | "er/sie/es" | "wir" | "ihr" | "sie/Sie";
const PERSONS: Person[] = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];

interface TenseData {
  key: string;
  label: string;
  formationKey: string;
  usageKey: string;
  machen: Record<Person, string>;
  fahren: Record<Person, string>;
  sein: Record<Person, string>;
}

const TENSES: TenseData[] = [
  {
    key: "präsens",
    label: "Präsens",
    formationKey: "grammar.tensesPrasensFormation",
    usageKey: "grammar.tensesPrasensUsage",
    machen: {
      "ich": "mache", "du": "machst", "er/sie/es": "macht",
      "wir": "machen", "ihr": "macht", "sie/Sie": "machen",
    },
    fahren: {
      "ich": "fahre", "du": "fährst", "er/sie/es": "fährt",
      "wir": "fahren", "ihr": "fahrt", "sie/Sie": "fahren",
    },
    sein: {
      "ich": "bin", "du": "bist", "er/sie/es": "ist",
      "wir": "sind", "ihr": "seid", "sie/Sie": "sind",
    },
  },
  {
    key: "präteritum",
    label: "Präteritum",
    formationKey: "grammar.tensesPreteritumFormation",
    usageKey: "grammar.tensesPreteritumUsage",
    machen: {
      "ich": "machte", "du": "machtest", "er/sie/es": "machte",
      "wir": "machten", "ihr": "machtet", "sie/Sie": "machten",
    },
    fahren: {
      "ich": "fuhr", "du": "fuhrst", "er/sie/es": "fuhr",
      "wir": "fuhren", "ihr": "fuhrt", "sie/Sie": "fuhren",
    },
    sein: {
      "ich": "war", "du": "warst", "er/sie/es": "war",
      "wir": "waren", "ihr": "wart", "sie/Sie": "waren",
    },
  },
  {
    key: "perfekt",
    label: "Perfekt",
    formationKey: "grammar.tensesPerfektFormation",
    usageKey: "grammar.tensesPerfektUsage",
    machen: {
      "ich": "<em>habe</em> gemacht", "du": "<em>hast</em> gemacht", "er/sie/es": "<em>hat</em> gemacht",
      "wir": "<em>haben</em> gemacht", "ihr": "<em>habt</em> gemacht", "sie/Sie": "<em>haben</em> gemacht",
    },
    fahren: {
      "ich": "<em>bin</em> gefahren", "du": "<em>bist</em> gefahren", "er/sie/es": "<em>ist</em> gefahren",
      "wir": "<em>sind</em> gefahren", "ihr": "<em>seid</em> gefahren", "sie/Sie": "<em>sind</em> gefahren",
    },
    sein: {
      "ich": "<em>bin</em> gewesen", "du": "<em>bist</em> gewesen", "er/sie/es": "<em>ist</em> gewesen",
      "wir": "<em>sind</em> gewesen", "ihr": "<em>seid</em> gewesen", "sie/Sie": "<em>sind</em> gewesen",
    },
  },
  {
    key: "plusquamperfekt",
    label: "Plusquamperfekt",
    formationKey: "grammar.tensesPlusquamperfektFormation",
    usageKey: "grammar.tensesPlusquamperfektUsage",
    machen: {
      "ich": "<em>hatte</em> gemacht", "du": "<em>hattest</em> gemacht", "er/sie/es": "<em>hatte</em> gemacht",
      "wir": "<em>hatten</em> gemacht", "ihr": "<em>hattet</em> gemacht", "sie/Sie": "<em>hatten</em> gemacht",
    },
    fahren: {
      "ich": "<em>war</em> gefahren", "du": "<em>warst</em> gefahren", "er/sie/es": "<em>war</em> gefahren",
      "wir": "<em>waren</em> gefahren", "ihr": "<em>wart</em> gefahren", "sie/Sie": "<em>waren</em> gefahren",
    },
    sein: {
      "ich": "<em>war</em> gewesen", "du": "<em>warst</em> gewesen", "er/sie/es": "<em>war</em> gewesen",
      "wir": "<em>waren</em> gewesen", "ihr": "<em>wart</em> gewesen", "sie/Sie": "<em>waren</em> gewesen",
    },
  },
  {
    key: "futur1",
    label: "Futur I",
    formationKey: "grammar.tensesFutur1Formation",
    usageKey: "grammar.tensesFutur1Usage",
    machen: {
      "ich": "<em>werde</em> machen", "du": "<em>wirst</em> machen", "er/sie/es": "<em>wird</em> machen",
      "wir": "<em>werden</em> machen", "ihr": "<em>werdet</em> machen", "sie/Sie": "<em>werden</em> machen",
    },
    fahren: {
      "ich": "<em>werde</em> fahren", "du": "<em>wirst</em> fahren", "er/sie/es": "<em>wird</em> fahren",
      "wir": "<em>werden</em> fahren", "ihr": "<em>werdet</em> fahren", "sie/Sie": "<em>werden</em> fahren",
    },
    sein: {
      "ich": "<em>werde</em> sein", "du": "<em>wirst</em> sein", "er/sie/es": "<em>wird</em> sein",
      "wir": "<em>werden</em> sein", "ihr": "<em>werdet</em> sein", "sie/Sie": "<em>werden</em> sein",
    },
  },
  {
    key: "futur2",
    label: "Futur II",
    formationKey: "grammar.tensesFutur2Formation",
    usageKey: "grammar.tensesFutur2Usage",
    machen: {
      "ich": "<em>werde</em> gemacht <em>haben</em>", "du": "<em>wirst</em> gemacht <em>haben</em>", "er/sie/es": "<em>wird</em> gemacht <em>haben</em>",
      "wir": "<em>werden</em> gemacht <em>haben</em>", "ihr": "<em>werdet</em> gemacht <em>haben</em>", "sie/Sie": "<em>werden</em> gemacht <em>haben</em>",
    },
    fahren: {
      "ich": "<em>werde</em> gefahren <em>sein</em>", "du": "<em>wirst</em> gefahren <em>sein</em>", "er/sie/es": "<em>wird</em> gefahren <em>sein</em>",
      "wir": "<em>werden</em> gefahren <em>sein</em>", "ihr": "<em>werdet</em> gefahren <em>sein</em>", "sie/Sie": "<em>werden</em> gefahren <em>sein</em>",
    },
    sein: {
      "ich": "<em>werde</em> gewesen <em>sein</em>", "du": "<em>wirst</em> gewesen <em>sein</em>", "er/sie/es": "<em>wird</em> gewesen <em>sein</em>",
      "wir": "<em>werden</em> gewesen <em>sein</em>", "ihr": "<em>werdet</em> gewesen <em>sein</em>", "sie/Sie": "<em>werden</em> gewesen <em>sein</em>",
    },
  },
];

function scrollTo(key: string) {
  const pageContent = document.querySelector(".page-current .page-content");
  const target = document.querySelector<HTMLElement>(`.page-current #tense-${key}`);
  if (!pageContent || !target) return;
  const offset = target.getBoundingClientRect().top - pageContent.getBoundingClientRect().top + pageContent.scrollTop - 8;
  pageContent.scrollTo({ top: offset, behavior: "smooth" });
}

// Overview scroll fade
const overviewEl = ref<HTMLElement | null>(null);
const overviewFade = useScrollFade(overviewEl);

// Per-tense scroll fades for formation sections
const tableEls = TENSES.map(() => ref<HTMLElement | null>(null));
const scrollFades = tableEls.map(el => useScrollFade(el));
</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

.tenses-block {
  padding-top: 0;
}

.tense-note {
  color: var(--f7-block-footer-text-color);
  font-size: 13px;
  margin: 0 0 4px;
}

.tense-usage {
  color: var(--f7-block-footer-text-color);
  font-size: 13px;
  font-style: italic;
  margin: 0 0 10px;
}

/* Overview table */
.tenses-overview-tense-col {
  min-width: 110px;
}

.tenses-overview-tense {
  white-space: nowrap;
}

.tenses-anchor-link {
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.tenses-anchor-link:active {
  opacity: 0.6;
}

.tenses-ich {
  font-size: 10px;
  opacity: 0.45;
  font-style: italic;
}

/* Shared table styles */
.tenses-verb-header {
  min-width: 110px;
}

.tenses-header-link {
  display: block;
  font-weight: 600;
  font-size: 13px;
}

.tenses-verb-type {
  display: block;
  font-size: 10px;
  font-weight: 400;
  opacity: 0.55;
  font-style: italic;
}

.tenses-table th,
.tenses-table td,
.tenses-overview-table th,
.tenses-overview-table td {
  text-align: center;
}

.tenses-table td:first-child,
.tenses-overview-table td:first-child {
  text-align: left;
}

.tenses-cell {
  font-size: 13px;
  white-space: nowrap;
}

.tenses-cell :deep(em) {
  font-style: normal;
  color: var(--f7-theme-color);
}
</style>
