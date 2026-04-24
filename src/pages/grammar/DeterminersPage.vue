<template>
  <f7-page name="grammar-determiners">
    <f7-navbar :title="t('grammar.determinersTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.determinersTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.determinersDesc') }}</p>
    </f7-block>

    <template v-for="paradigm in paradigms" :key="paradigm.lemma">
      <f7-block-title>
        <f7-link :href="`/search/${paradigm.lemma}/`" class="det-page-lemma">{{ paradigm.lemma }}</f7-link>
      </f7-block-title>
      <f7-block class="det-page-block">
        <div class="decl-table-wrap scroll-fade" :style="getScrollStyle(paradigm.lemma)" :class="{ 'is-scrollable': isScrollable(paradigm.lemma) }">
          <div class="decl-table-scroll" :ref="(el) => setRef(paradigm.lemma, el as HTMLElement | null)">
            <table class="decl-table det-page-table">
              <thead>
                <tr>
                  <th class="decl-case-header"></th>
                  <th class="decl-num-header gender-m">M</th>
                  <th class="decl-num-header gender-f">F</th>
                  <th class="decl-num-header gender-n">N</th>
                  <th v-if="paradigm.forms.plural" class="decl-num-header">Pl.</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in CASES" :key="c.key">
                  <td class="decl-case">{{ c.label }}</td>
                  <td class="decl-form"><span class="gender-m">{{ paradigm.forms.masc[c.key] }}</span></td>
                  <td class="decl-form"><span class="gender-f">{{ paradigm.forms.fem[c.key] }}</span></td>
                  <td class="decl-form"><span class="gender-n">{{ paradigm.forms.neut[c.key] }}</span></td>
                  <td v-if="paradigm.forms.plural" class="decl-form">{{ paradigm.forms.plural?.[c.key] ?? '—' }}</td>
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
import { ref, type Ref } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import { useScrollFade } from "../../composables/useScrollFade.js";

const props = defineProps<{ f7route: { url: string } }>();
import paradigmsData from "../../../data/rules/determiner-declensions.json";

type CaseKey = "nom" | "acc" | "dat" | "gen";
type GenderForms = Record<CaseKey, string>;

interface DeterminerParadigm {
  lemma: string;
  forms: {
    masc: GenderForms;
    fem: GenderForms;
    neut: GenderForms;
    plural: GenderForms | null;
  };
}

const paradigms = paradigmsData.paradigms as DeterminerParadigm[];

const CASES = [
  { key: "nom" as CaseKey, label: "Nom." },
  { key: "acc" as CaseKey, label: "Akk." },
  { key: "dat" as CaseKey, label: "Dat." },
  { key: "gen" as CaseKey, label: "Gen." },
];

// Per-paradigm scroll fade — build refs map up-front with proper typing
const elRefs: Record<string, Ref<HTMLElement | null>> = Object.fromEntries(
  paradigms.map((p) => [p.lemma, ref<HTMLElement | null>(null)])
);

function setRef(lemma: string, el: Element | null) {
  if (elRefs[lemma]) elRefs[lemma].value = el as HTMLElement | null;
}

const fades = Object.fromEntries(
  Object.entries(elRefs).map(([k, r]) => [k, useScrollFade(r)])
);

function getScrollStyle(lemma: string) { return fades[lemma]?.fadeStyle.value ?? {}; }
function isScrollable(lemma: string) { return fades[lemma]?.isScrollable.value ?? false; }

</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

.det-page-block {
  padding-top: 0;
}

.det-page-lemma {
  font-weight: 700;
  font-size: 17px;
}

.det-page-table th,
.det-page-table td {
  text-align: center;
}
.det-page-table td:first-child {
  text-align: left;
}
</style>
