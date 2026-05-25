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
        <DeclTableWrap>
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
        </DeclTableWrap>
      </f7-block>
    </template>
  </f7-page>
</template>

<script setup lang="ts">
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import DeclTableWrap from "../../components/DeclTableWrap.vue";

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
</script>

<style scoped>
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
