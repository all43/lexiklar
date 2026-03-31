<template>
  <div class="adj-declension">
    <!-- Indeclinable hint -->
    <div v-if="word.is_indeclinable" class="noun-rule-hint">
      <span class="noun-rule-match">{{ t('adj.indeclinable') }}</span>
    </div>

    <!-- Comparison scale: Positiv → Komparativ → Superlativ -->
    <!-- Normal case: this word is the Positiv (has comparative/superlative fields) -->
    <div v-if="word.comparative || word.superlative" class="adj-scale-wrap">
      <div class="adj-scale-title">{{ t('adj.steigerung') }}</div>
      <div class="adj-scale">
        <div v-if="word.antonym" class="adj-scale-node adj-scale-tappable" :class="{ 'adj-scale-antonym-negative': word.antonym.negative }" @click="emit('compare-navigate', word.antonym!.word)">
          <div class="adj-scale-dot" :class="{ 'adj-scale-dot-antonym-negative': word.antonym.negative }"></div>
          <div class="adj-scale-form" :class="{ 'adj-scale-form-antonym-negative': word.antonym.negative }">{{ word.antonym.word }}</div>
          <div class="adj-scale-label">Gegenteil</div>
        </div>
        <div v-if="word.antonym" class="adj-scale-connector"></div>
        <div v-if="!word.antonym && positiveCounterpart" class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', positiveCounterpart!.word)">
          <div class="adj-scale-dot"></div>
          <div class="adj-scale-form">{{ positiveCounterpart!.word }}</div>
          <div class="adj-scale-label">Gegenteil</div>
        </div>
        <div v-if="!word.antonym && positiveCounterpart" class="adj-scale-connector"></div>
        <div class="adj-scale-node adj-scale-active">
          <div class="adj-scale-dot adj-scale-dot-active"></div>
          <div class="adj-scale-form adj-scale-form-active">{{ word.word }}</div>
          <div class="adj-scale-label">Positiv</div>
        </div>
        <div v-if="word.comparative" class="adj-scale-connector"></div>
        <div v-if="word.comparative" class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', word.comparative!)">
          <div class="adj-scale-dot"></div>
          <div class="adj-scale-form">{{ word.comparative }}</div>
          <div class="adj-scale-label">Komparativ</div>
        </div>
        <div v-if="word.superlative" class="adj-scale-connector"></div>
        <div v-if="word.superlative" class="adj-scale-node">
          <div class="adj-scale-dot"></div>
          <div class="adj-scale-form">{{ word.superlative }}</div>
          <div class="adj-scale-label">Superlativ</div>
        </div>
      </div>
    </div>
    <!-- Inverse case: this word IS the comparative of another adjective (e.g. besser → gut) -->
    <div v-else-if="baseWord" class="adj-scale-wrap">
      <div class="adj-scale-title">{{ t('adj.steigerung') }}</div>
      <div class="adj-scale">
        <div v-if="baseWord!.antonym" class="adj-scale-node adj-scale-tappable" :class="{ 'adj-scale-antonym-negative': baseWord!.antonym!.negative }" @click="emit('compare-navigate', baseWord!.antonym!.word)">
          <div class="adj-scale-dot" :class="{ 'adj-scale-dot-antonym-negative': baseWord!.antonym!.negative }"></div>
          <div class="adj-scale-form" :class="{ 'adj-scale-form-antonym-negative': baseWord!.antonym!.negative }">{{ baseWord!.antonym!.word }}</div>
          <div class="adj-scale-label">Gegenteil</div>
        </div>
        <div v-if="baseWord!.antonym" class="adj-scale-connector"></div>
        <div class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', baseWord!.word)">
          <div class="adj-scale-dot"></div>
          <div class="adj-scale-form">{{ baseWord!.word }}</div>
          <div class="adj-scale-label">Positiv</div>
        </div>
        <div class="adj-scale-connector"></div>
        <div class="adj-scale-node adj-scale-active">
          <div class="adj-scale-dot adj-scale-dot-active"></div>
          <div class="adj-scale-form adj-scale-form-active">{{ word.word }}</div>
          <div class="adj-scale-label">Komparativ</div>
        </div>
        <div v-if="baseWord!.superlative" class="adj-scale-connector"></div>
        <div v-if="baseWord!.superlative" class="adj-scale-node">
          <div class="adj-scale-dot"></div>
          <div class="adj-scale-form">{{ baseWord!.superlative }}</div>
          <div class="adj-scale-label">Superlativ</div>
        </div>
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
              <span v-if="nouns.M"><span class="gender-m">der</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.M }}</span>
              <span v-if="nouns.M && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F"><span class="gender-f">die</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.F }}</span>
              <span v-if="(nouns.M || nouns.F) && nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N"><span class="gender-n">das</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.N }}</span>
            </div>
          </div>

          <div v-if="nouns.M" class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.accSgMascEn') }}</span>
            <div class="adj-cond-examples">
              <span><span class="gender-m">den</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.M }}</span>
              <span v-if="nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F"><span class="gender-f">die</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.F }}</span>
              <span v-if="nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N"><span class="gender-n">das</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> {{ nouns.N }}</span>
            </div>
          </div>

          <div class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.restAlwaysEn') }}</span>
            <div class="adj-cond-examples">
              <span v-if="nouns.M"><span class="gender-m">dem</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.M }}</span>
              <span v-if="nouns.M && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F"><span class="gender-f">der</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> {{ nouns.F }}</span>
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
              <span><span class="gender-m">ein</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">er</span> {{ nouns.M }}</span>
            </div>
          </div>

          <div v-if="nouns.N" class="adj-cond-rule">
            <span class="adj-cond-label">{{ t('adj.neutNomAcc') }} → -es</span>
            <div class="adj-cond-examples">
              <span><span class="gender-n">ein</span> <span class="decl-stem">{{ stem }}</span><span class="decl-ending">es</span> {{ nouns.N }}</span>
            </div>
          </div>

          <div class="adj-cond-why">{{ t('adj.afterIndefiniteWhy') }}</div>
        </div>

        <!-- Strong: ohne Artikel -->
        <div class="adj-cond-section">
          <div class="adj-cond-header">{{ t('adj.withoutArticle') }}</div>

          <div class="adj-cond-rule">
            <div class="adj-cond-examples">
              <span v-if="nouns.M"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">er</span> <span class="gender-m">{{ nouns.M }}</span></span>
              <span v-if="nouns.M && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">e</span> <span class="gender-f">{{ nouns.F }}</span></span>
              <span v-if="(nouns.M || nouns.F) && nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">es</span> <span class="gender-n">{{ nouns.N }}</span></span>
            </div>
          </div>

          <div class="adj-cond-rule">
            <div class="adj-cond-examples">
              <span v-if="nouns.M"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">en</span> <span class="gender-m">{{ nouns.M }}</span> <span class="adj-cond-case">(Akk.)</span></span>
              <span v-if="nouns.M && nouns.N" class="adj-cond-sep">·</span>
              <span v-if="nouns.N"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">em</span> <span class="gender-n">{{ nouns.N }}</span> <span class="adj-cond-case">(Dat.)</span></span>
              <span v-if="(nouns.M || nouns.N) && nouns.F" class="adj-cond-sep">·</span>
              <span v-if="nouns.F"><span class="decl-stem">{{ stem }}</span><span class="decl-ending">er</span> <span class="gender-f">{{ nouns.F }}</span> <span class="adj-cond-case">(Dat.)</span></span>
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
              <th class="decl-num-header gender-m">M</th>
              <th class="decl-num-header gender-f">F</th>
              <th class="decl-num-header gender-n">N</th>
              <th class="decl-num-header">Pl.</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in CASES" :key="c.key">
              <td class="decl-case">{{ c.label }}</td>
              <td v-for="g in GENDERS" :key="g" class="decl-form">
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

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "../js/i18n.js";
import { getCached, CONDENSED_GRAMMAR_KEY } from "../utils/storage.js";
import adjEndings from "../../data/rules/adj-endings.json";
import type { AdjectiveWord, AdjEndingsTable } from "../../types/word.js";

const emit = defineEmits<{
  (e: "compare-navigate", term: string): void;
}>();

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

const props = defineProps<{
  word: AdjectiveWord;
  baseWord?: { word: string; superlative: string | null; antonym: { word: string; negative?: boolean } | null } | null;
  positiveCounterpart?: { word: string } | null;
}>();

const activeTab = ref<DeclType>("strong");
const viewMode = ref<ViewMode>(getCached(CONDENSED_GRAMMAR_KEY) === "1" ? "rules" : "table");

const stem = computed(() => props.word.declension_stem || props.word.word);

const nouns = computed(() => {
  const c = props.word.collocation_nouns;
  if (!c) return { M: "Tag", F: "Sache", N: "Ergebnis", Pl: "Dinge" };
  return {
    M: c.M === null ? null : (c.M || "Tag"),
    F: c.F === null ? null : (c.F || "Sache"),
    N: c.N === null ? null : (c.N || "Ergebnis"),
    Pl: c.Pl === null ? null : (c.Pl || "Dinge"),
  };
});

function getEnding(type: DeclType, gender: typeof GENDERS[number], caseKey: "nom" | "acc" | "dat" | "gen"): string {
  return typedEndings[type]?.[gender]?.[caseKey] ?? "";
}

function getForm(type: DeclType, gender: typeof GENDERS[number], caseKey: "nom" | "acc" | "dat" | "gen"): string {
  if (props.word.declension_regular) {
    return stem.value + getEnding(type, gender, caseKey);
  } else {
    return props.word.declension?.[type]?.[gender]?.[caseKey] || "\u2014";
  }
}
</script>

<style scoped>
.adj-scale-wrap {
  padding: 14px var(--f7-block-padding-horizontal, 16px) 20px;
}

.adj-scale-title {
  font-size: var(--f7-list-item-footer-font-size, 12px);
  color: var(--f7-list-item-footer-text-color);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}

.adj-scale {
  display: flex;
  align-items: flex-start;
}

.adj-scale-connector {
  flex: 1;
  height: 2px;
  background: rgba(0, 0, 0, 0.2);
  margin-top: 8px;
  min-width: 12px;
}

.dark .adj-scale-connector {
  background: rgba(255, 255, 255, 0.2);
}

.adj-scale-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  max-width: 90px;
}

.adj-scale-tappable {
  cursor: pointer;
}

.adj-scale-tappable:active .adj-scale-dot {
  opacity: 0.6;
}

.adj-scale-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: transparent;
  border: 2px solid rgba(0, 0, 0, 0.25);
  margin-bottom: 5px;
  flex-shrink: 0;
}

.dark .adj-scale-dot {
  border-color: rgba(255, 255, 255, 0.3);
}

.adj-scale-dot-active {
  background: var(--f7-theme-color);
  border-color: var(--f7-theme-color);
}

.adj-scale-tappable .adj-scale-dot {
  border-color: var(--f7-theme-color);
}

.adj-scale-dot-antonym-negative {
  border-color: var(--color-rule-exception, #ff9800) !important;
}

.adj-scale-form-antonym-negative {
  color: var(--color-rule-exception, #ff9800) !important;
  text-decoration-color: color-mix(in srgb, var(--color-rule-exception, #ff9800) 40%, transparent) !important;
}

.adj-scale-form {
  font-size: 15px;
  font-weight: 500;
  text-align: center;
  word-break: break-word;
  hyphens: auto;
  line-height: 1.2;
  color: var(--f7-list-item-title-text-color);
}

.adj-scale-form-active {
  color: var(--f7-theme-color);
}

.adj-scale-tappable .adj-scale-form {
  color: var(--f7-theme-color);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--f7-theme-color) 40%, transparent);
  text-underline-offset: 2px;
  text-decoration-style: dashed;
}

.adj-scale-label {
  font-size: 11px;
  color: var(--f7-list-item-footer-text-color);
  text-align: center;
  margin-top: 2px;
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
