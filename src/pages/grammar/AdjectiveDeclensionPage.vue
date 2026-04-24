<template>
  <f7-page name="grammar-adjective-declension">
    <f7-navbar :title="t('grammar.adjectiveDeclensionTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.adjectiveDeclensionTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.adjDeclDesc') }}</p>
    </f7-block>

    <template v-for="cls in CLASSES" :key="cls.key">
      <f7-block-title>{{ t(cls.labelKey) }}</f7-block-title>
      <f7-block class="adj-ref-block">
        <p class="adj-ref-why">{{ t(cls.whyKey) }}</p>
        <div class="decl-table-wrap scroll-fade" :style="scrollFade[cls.key]" :class="{ 'is-scrollable': scrollable[cls.key] }">
          <div class="decl-table-scroll" :ref="(el) => setRef(cls.key, el as HTMLElement | null)">
            <table class="decl-table adj-ref-table">
              <thead>
                <tr>
                  <th class="decl-case-header"></th>
                  <th class="decl-num-header gender-m">M</th>
                  <th class="decl-num-header gender-f">F</th>
                  <th class="decl-num-header gender-n">N</th>
                  <th class="decl-num-header">Pl.</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in CASES" :key="c.key">
                  <td class="decl-case">{{ c.label }}</td>
                  <td class="decl-form adj-ref-ending">{{ endings[cls.key].masc[c.key] }}</td>
                  <td class="decl-form adj-ref-ending">{{ endings[cls.key].fem[c.key] }}</td>
                  <td class="decl-form adj-ref-ending">{{ endings[cls.key].neut[c.key] }}</td>
                  <td class="decl-form adj-ref-ending">{{ endings[cls.key].plural[c.key] }}</td>
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
import { ref, computed, type Ref } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import { useScrollFade } from "../../composables/useScrollFade.js";

const props = defineProps<{ f7route: { url: string } }>();
import adjEndingsData from "../../../data/rules/adj-endings.json";

type CaseKey = "nom" | "acc" | "dat" | "gen";
type GenderKey = "masc" | "fem" | "neut" | "plural";
type EndingsRow = Record<CaseKey, string>;
type EndingsClass = Record<GenderKey, EndingsRow>;

const CLASSES = [
  { key: "weak",   labelKey: "grammar.adjWeak",   whyKey: "grammar.adjWeakWhy" },
  { key: "mixed",  labelKey: "grammar.adjMixed",  whyKey: "grammar.adjMixedWhy" },
  { key: "strong", labelKey: "grammar.adjStrong", whyKey: "grammar.adjStrongWhy" },
] as const;

const CASES = [
  { key: "nom" as CaseKey, label: "Nom." },
  { key: "acc" as CaseKey, label: "Akk." },
  { key: "dat" as CaseKey, label: "Dat." },
  { key: "gen" as CaseKey, label: "Gen." },
];

const endings = adjEndingsData as unknown as Record<string, EndingsClass>;

// Per-class scroll fade refs — three fixed classes, no dynamic ref map needed
const weakEl   = ref<HTMLElement | null>(null);
const mixedEl  = ref<HTMLElement | null>(null);
const strongEl = ref<HTMLElement | null>(null);

const elRefsMap: Record<string, Ref<HTMLElement | null>> = {
  weak: weakEl, mixed: mixedEl, strong: strongEl,
};

function setRef(key: string, el: Element | null) {
  elRefsMap[key].value = el as HTMLElement | null;
}

const fades = Object.fromEntries(
  Object.entries(elRefsMap).map(([k, r]) => [k, useScrollFade(r)])
);

const scrollFade = computed(() =>
  Object.fromEntries(Object.entries(fades).map(([k, f]) => [k, f.fadeStyle.value]))
);
const scrollable = computed(() =>
  Object.fromEntries(Object.entries(fades).map(([k, f]) => [k, f.isScrollable.value]))
);
</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

.adj-ref-block {
  padding-top: 0;
}

.adj-ref-why {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
  margin: 0 0 10px;
}

.adj-ref-ending {
  font-weight: 600;
  color: var(--f7-theme-color);
  text-align: center;
}

.adj-ref-table th,
.adj-ref-table td {
  text-align: center;
}
.adj-ref-table td:first-child {
  text-align: left;
}
</style>
