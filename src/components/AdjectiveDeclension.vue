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

    <template v-if="!word.is_indeclinable">

      <!-- In-page view switch (regular adjectives only) -->
      <f7-segmented v-if="word.declension_regular" strong tag="p" class="adj-view-switch">
        <f7-button :active="viewMode === 'rules'" @click="viewMode = 'rules'">{{ t('adj.viewRules') }}</f7-button>
        <f7-button :active="viewMode === 'table'" @click="viewMode = 'table'">{{ t('adj.viewTable') }}</f7-button>
      </f7-segmented>

      <!-- ===== Condensed rules view (regular adjectives only) ===== -->
      <template v-if="viewMode === 'rules' && word.declension_regular">

        <!-- Weak: nach der/die/das -->
        <div class="adj-cond-section">
          <div class="adj-cond-header">{{ t('adj.afterDefinite') }}</div>

          <div class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.nomSg') }} → -e</span>
            <div class="adj-cond-examples">
              <span v-if="nouns.M">der <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.M }}</span>
              <span v-if="nouns.M && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F">die <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.F }}</span>
              <span v-if="(nouns.M || nouns.F) && nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N">das <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.N }}</span>
            </div>
          </div>

          <div v-if="nouns.M" class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.accSgMascEn') }}</span>
            <div class="adj-cond-examples">
              <span>den <span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.M }}</span>
              <span v-if="nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F">die <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.F }}</span>
              <span v-if="nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N">das <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.N }}</span>
            </div>
          </div>

          <div class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.restAlwaysEn') }}</span>
            <div class="adj-cond-examples">
              <span v-if="nouns.M">dem <span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.M }}</span>
              <span v-if="nouns.M && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F">der <span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.F }}</span>
              <span v-if="(nouns.M || nouns.F) && nouns.Pl" class="adj-cond-sep">·</span>
              <span v-if="nouns.Pl">die <span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.Pl }}</span>
            </div>
          </div>

          <div class="adj-cond-why">{{ t('adj.afterDefiniteWhy') }}</div>
        </div>

        <!-- Mixed: nach ein/kein/mein -->
        <div class="adj-cond-section">
          <div class="adj-cond-header">{{ t('adj.afterIndefinite') }}</div>

          <div class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.mixedExceptWhere') }}</span>
          </div>

          <div v-if="nouns.M" class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.mascNom') }} → -er</span>
            <div class="adj-cond-examples">
              <span>ein <span class="decl-stem">{{ stem }}</span><span class="decl-ending">er</span> {{ nouns.M }}</span>
            </div>
          </div>

          <div v-if="nouns.N" class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.neutNomAcc') }} → -es</span>
            <div class="adj-cond-examples">
              <span>ein <span class="decl-stem">{{ stem }}</span><span class="decl-ending">es</span> {{ nouns.N }}</span>
            </div>
          </div>

          <div class="adj-cond-why">{{ t('adj.afterIndefiniteWhy') }}</div>
        </div>

        <!-- Strong: ohne Artikel -->
        <div class="adj-cond-section">
          <div class="adj-cond-header">{{ t('adj.withoutArticle') }}</div>

          <div class="adj-cond-rule">
            <div class="adj-cond-examples">
              <span v-if="nouns.M"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">er</span> {{ nouns.M }}</span>
              <span v-if="nouns.M && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.F }}</span>
              <span v-if="(nouns.M || nouns.F) && nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">es</span> {{ nouns.N }}</span>
            </div>
          </div>

          <div class="adj-cond-rule">
            <div class="adj-cond-examples">
              <span v-if="nouns.M"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.M }} <span class="adj-cond-case">(Akk.)</span></span>
              <span v-if="nouns.M && nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">em</span> {{ nouns.N }} <span class="adj-cond-case">(Dat.)</span></span>
              <span v-if="(nouns.M || nouns.N) && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">er</span> {{ nouns.F }} <span class="adj-cond-case">(Dat.)</span></span>
            </div>
          </div>

          <div class="adj-cond-why">{{ t('adj.withoutArticleWhy') }}</div>
        </div>

      </template>

      <!-- ===== Full table view ===== -->
      <template v-else>
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
                <template v-if="word.declension_regular">
                  <span class="decl-stem">{{ stem }}</span><span class="decl-ending">{{ getEnding(activeTab, g, c.key) }}</span>
                </template>
                <template v-else>
                  {{ getForm(activeTab, g, c.key) }}
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { t } from "../js/i18n.js";
import { getCached } from "../utils/storage.js";
import { CONDENSED_GRAMMAR_KEY } from "../pages/SettingsPage.vue";
import adjEndings from "../../data/rules/adj-endings.json";
import type { AdjectiveWord, AdjEndingsTable } from "../../types/word.js";

type DeclType = "strong" | "weak" | "mixed";
type ViewMode = "rules" | "table";

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
      viewMode: (getCached(CONDENSED_GRAMMAR_KEY) === "1" ? "rules" : "table") as ViewMode,
    };
  },
  computed: {
    t() { return t; },
    cases() { return CASES; },
    genders() { return GENDERS; },
    stem(): string {
      return this.word.declension_stem || this.word.word;
    },
    nouns(): { M: string | null; F: string | null; N: string | null; Pl: string | null } {
      const c = this.word.collocation_nouns;
      if (!c) return { M: "Tag", F: "Sache", N: "Ergebnis", Pl: "Dinge" };
      return {
        M: c.M === null ? null : (c.M || "Tag"),
        F: c.F === null ? null : (c.F || "Sache"),
        N: c.N === null ? null : (c.N || "Ergebnis"),
        Pl: c.Pl === null ? null : (c.Pl || "Dinge"),
      };
    },
  },
  methods: {
    getEnding(type: DeclType, gender: typeof GENDERS[number], caseKey: "nom" | "acc" | "dat" | "gen"): string {
      return typedEndings[type]?.[gender]?.[caseKey] ?? "";
    },
    getForm(type: DeclType, gender: typeof GENDERS[number], caseKey: "nom" | "acc" | "dat" | "gen"): string {
      if (this.word.declension_regular) {
        return this.stem + this.getEnding(type, gender, caseKey);
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

.adj-view-switch {
  margin: 0 var(--f7-block-padding-horizontal, 16px) 12px;
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

/* Ending highlighting */
.decl-ending {
  color: var(--f7-theme-color);
  font-weight: 600;
}

.decl-stem {
  font-weight: 500;
}

/* Condensed view */
.adj-cond-section {
  padding: 0 var(--f7-block-padding-horizontal, 16px);
  margin-bottom: 16px;
}

.adj-cond-header {
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 8px;
  color: var(--f7-list-item-title-text-color);
}

.adj-cond-rule {
  margin-bottom: 6px;
}

.adj-cond-label {
  display: block;
  font-size: 12px;
  color: var(--f7-list-item-footer-text-color);
  margin-bottom: 2px;
}

.adj-cond-examples {
  font-size: 15px;
  line-height: 1.6;
}

.adj-cond-sep {
  color: var(--f7-list-item-footer-text-color);
  margin: 0 4px;
}

.adj-cond-case {
  font-size: 12px;
  color: var(--f7-list-item-footer-text-color);
}

.adj-cond-why {
  font-size: 12px;
  font-style: italic;
  color: var(--f7-list-item-footer-text-color);
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--f7-list-item-border-color, rgba(0, 0, 0, 0.1));
}
</style>
