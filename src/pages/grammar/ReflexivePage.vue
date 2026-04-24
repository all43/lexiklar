<template>
  <f7-page name="grammar-reflexive">
    <f7-navbar :title="t('grammar.reflexiveTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.reflexiveTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.reflexiveDesc') }}</p>
    </f7-block>

    <!-- Reflexive pronoun table -->
    <f7-block-title>{{ t('grammar.reflexivePronouns') }}</f7-block-title>
    <f7-block class="reflex-block">
      <div class="decl-table-wrap scroll-fade" :style="fadeStyle" :class="{ 'is-scrollable': isScrollable }">
        <div class="decl-table-scroll" ref="tableEl">
          <table class="decl-table reflex-table">
            <thead>
              <tr>
                <th class="decl-case-header"></th>
                <th class="decl-num-header">{{ t('grammar.accusativeShort') }}</th>
                <th class="decl-num-header">{{ t('grammar.dativeShort') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in PRONOUNS" :key="row.person">
                <td class="decl-case">{{ row.person }}</td>
                <td class="decl-form reflex-form" :class="{ 'reflex-same': row.acc === row.dat }">{{ row.acc }}</td>
                <td class="decl-form reflex-form" :class="{ 'reflex-same': row.acc === row.dat }">{{ row.dat }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </f7-block>

    <!-- Common reflexive verbs -->
    <f7-block-title>{{ t('grammar.commonReflexiveVerbs') }}</f7-block-title>
    <f7-block class="reflex-verb-block">
      <div class="reflex-verb-list">
        <div v-for="v in REFLEXIVE_VERBS" :key="v.verb" class="reflex-verb-item">
          <f7-link :href="`/word/verbs/${v.base}/`" class="reflex-verb-link">sich {{ v.verb }}</f7-link>
          <span v-if="v.prep" class="reflex-verb-prep"> ({{ v.prep }})</span>
          <span class="reflex-verb-en">{{ v.en }}</span>
        </div>
      </div>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import { useScrollFade } from "../../composables/useScrollFade.js";

const props = defineProps<{ f7route: { url: string } }>();

const tableEl = ref<HTMLElement | null>(null);
const { fadeStyle, isScrollable } = useScrollFade(tableEl);

const PRONOUNS = [
  { person: "ich",     acc: "mich", dat: "mir"  },
  { person: "du",      acc: "dich", dat: "dir"  },
  { person: "er/sie/es", acc: "sich", dat: "sich" },
  { person: "wir",     acc: "uns",  dat: "uns"  },
  { person: "ihr",     acc: "euch", dat: "euch" },
  { person: "sie/Sie", acc: "sich", dat: "sich" },
];

const REFLEXIVE_VERBS = [
  { verb: "erinnern",     base: "erinnern",    prep: "an",   en: "to remember" },
  { verb: "freuen",       base: "freuen",       prep: "auf/über", en: "to be happy about" },
  { verb: "interessieren",base: "interessieren",prep: "für", en: "to be interested in" },
  { verb: "kümmern",      base: "kümmern",      prep: "um",   en: "to take care of" },
  { verb: "befinden",     base: "befinden",     prep: null,   en: "to be (located)" },
  { verb: "fühlen",       base: "fühlen",       prep: null,   en: "to feel" },
  { verb: "vorstellen",   base: "vorstellen",   prep: null,   en: "to introduce oneself" },
  { verb: "setzen",       base: "setzen",       prep: null,   en: "to sit down" },
  { verb: "legen",        base: "legen",        prep: null,   en: "to lie down" },
  { verb: "waschen",      base: "waschen",      prep: null,   en: "to wash oneself" },
  { verb: "anziehen",     base: "anziehen",     prep: null,   en: "to get dressed" },
  { verb: "beeilen",      base: "beeilen",      prep: null,   en: "to hurry" },
  { verb: "erholen",      base: "erholen",      prep: null,   en: "to recover / relax" },
  { verb: "irren",        base: "irren",        prep: null,   en: "to be mistaken" },
  { verb: "ärgern",       base: "ärgern",       prep: "über", en: "to be annoyed at" },
  { verb: "gewöhnen",     base: "gewöhnen",     prep: "an",   en: "to get used to" },
  { verb: "entscheiden",  base: "entscheiden",  prep: null,   en: "to decide" },
  { verb: "bewerben",     base: "bewerben",     prep: "um",   en: "to apply (for)" },
  { verb: "verabschieden",base: "verabschieden",prep: null,   en: "to say goodbye" },
  { verb: "verlieben",    base: "verlieben",    prep: "in",   en: "to fall in love with" },
  { verb: "konzentrieren",base: "konzentrieren",prep: "auf",  en: "to concentrate on" },
  { verb: "wundern",      base: "wundern",      prep: "über", en: "to be surprised at" },
  { verb: "treffen",      base: "treffen",      prep: "mit",  en: "to meet (with)" },
  { verb: "streiten",     base: "streiten",     prep: "mit",  en: "to argue with" },
  { verb: "verabreden",   base: "verabreden",   prep: "mit",  en: "to arrange to meet" },
  { verb: "handeln",      base: "handeln",      prep: "um",   en: "to be about" },
  { verb: "verhalten",    base: "verhalten",    prep: null,   en: "to behave" },
  { verb: "entschuldigen",base: "entschuldigen",prep: null,   en: "to apologize" },
  { verb: "bedanken",     base: "bedanken",     prep: "bei",  en: "to thank" },
  { verb: "beschweren",   base: "beschweren",   prep: "über", en: "to complain about" },
];
</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

.reflex-block {
  padding-top: 0;
}

.reflex-table th,
.reflex-table td {
  text-align: center;
}
.reflex-table td:first-child {
  text-align: left;
}

.reflex-form {
  font-weight: 600;
}

.reflex-same {
  color: var(--f7-block-footer-text-color);
}

.reflex-verb-block {
  padding-top: 0;
}

.reflex-verb-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reflex-verb-item {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 6px;
}

.reflex-verb-link {
  font-weight: 600;
  font-size: 15px;
}

.reflex-verb-prep {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

.reflex-verb-en {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}
</style>
