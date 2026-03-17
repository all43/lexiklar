<template>
  <div class="adj-declension">
    <!-- Indeclinable hint -->
    <div v-if="word.is_indeclinable" class="noun-rule-hint">
      <span class="noun-rule-match">{{ t('adj.indeclinable') }}</span>
    </div>

    <!-- Comparative / Superlative -->
    <div v-if="word.comparative || word.superlative" class="adj-comparison">
      <div v-if="word.comparative" class="adj-comp-row">
        <span class="adj-comp-label">Komparativ</span>
        <span class="adj-comp-form">{{ word.comparative }}</span>
      </div>
      <div v-if="word.superlative" class="adj-comp-row">
        <span class="adj-comp-label">Superlativ</span>
        <span class="adj-comp-form">{{ word.superlative }}</span>
      </div>
    </div>

    <!-- Declension tabs -->
    <template v-if="!word.is_indeclinable">
      <f7-segmented strong tag="p" class="adj-tabs">
        <f7-button :active="activeTab === 'strong'" @click="activeTab = 'strong'">Stark</f7-button>
        <f7-button :active="activeTab === 'weak'" @click="activeTab = 'weak'">Schwach</f7-button>
        <f7-button :active="activeTab === 'mixed'" @click="activeTab = 'mixed'">Gemischt</f7-button>
      </f7-segmented>

      <table class="decl-table adj-decl-table">
        <thead>
          <tr>
            <th class="decl-case-header"></th>
            <th class="decl-num-header">M</th>
            <th class="decl-num-header">F</th>
            <th class="decl-num-header">N</th>
            <th class="decl-num-header">Pl.</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cases" :key="c.key">
            <td class="decl-case">{{ c.label }}</td>
            <td v-for="g in genders" :key="g" class="decl-form">
              {{ getForm(activeTab, g, c.key) }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { t } from "../js/i18n.js";
import adjEndings from "../../data/rules/adj-endings.json";
import type { AdjectiveWord, AdjEndingsTable } from "../../types/word.js";

type DeclType = "strong" | "weak" | "mixed";

const typedEndings = adjEndings as AdjEndingsTable;

const GENDERS = ["masc", "fem", "neut", "plural"] as const;

const CASES = [
  { key: "nom" as const, label: "Nom." },
  { key: "acc" as const, label: "Akk." },
  { key: "dat" as const, label: "Dat." },
  { key: "gen" as const, label: "Gen." },
];

export default defineComponent({
  props: {
    word: { type: Object as PropType<AdjectiveWord>, required: true },
  },
  data() {
    return {
      activeTab: "strong" as DeclType,
    };
  },
  computed: {
    t() { return t; },
    cases() { return CASES; },
    genders() { return GENDERS; },
  },
  methods: {
    getForm(type: DeclType, gender: typeof GENDERS[number], caseKey: "nom" | "acc" | "dat" | "gen"): string {
      if (this.word.declension_regular) {
        const stem = this.word.declension_stem || this.word.word;
        const ending = typedEndings[type]?.[gender]?.[caseKey] ?? "";
        return stem + ending;
      } else {
        return this.word.declension?.[type]?.[gender]?.[caseKey] || "\u2014";
      }
    },
  },
});
</script>

<style scoped>
.adj-comparison {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px var(--f7-block-padding-horizontal, 16px) 12px;
}

.adj-comp-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.adj-comp-label {
  font-size: var(--f7-list-item-footer-font-size, 12px);
  color: var(--f7-list-item-footer-text-color);
  min-width: 80px;
  flex-shrink: 0;
}

.adj-comp-form {
  font-size: var(--f7-list-item-title-font-size, 17px);
  font-weight: 500;
}

.adj-tabs {
  margin: 0 var(--f7-block-padding-horizontal, 16px) 8px;
}

.adj-decl-table {
  width: calc(100% - 2 * var(--f7-block-padding-horizontal, 16px));
  margin: 0 var(--f7-block-padding-horizontal, 16px);
}

.adj-decl-table .decl-num-header {
  width: 22%;
}
</style>
