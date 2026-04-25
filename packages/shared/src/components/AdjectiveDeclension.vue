<template>
  <div class="adj-declension">
    <!-- Indeclinable hint -->
    <div v-if="word.is_indeclinable" class="noun-rule-hint">
      <span class="noun-rule-match">{{ t('adj.indeclinable') }}</span>
    </div>

    <!-- Comparison scale: Positiv → Komparativ → Superlativ -->
    <div v-if="word.comparative || word.superlative" class="adj-scale-wrap scroll-fade" :style="fadeStyle" :class="{ 'is-scrollable': isScrollable }">
      <div class="adj-scale-title">{{ t('adj.steigerung') }}</div>
      <div class="adj-scale-row">
        <div class="adj-scale-bg-line"></div>
        <div class="adj-scale" ref="scaleEl">
          <div v-if="word.antonym" class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', word.antonym!.word)">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot" :class="{ 'adj-scale-dot-antonym-negative': word.antonym.negative }"></div></div>
            <div class="adj-scale-form" :class="{ 'adj-scale-form-antonym-negative': word.antonym.negative }">{{ word.antonym.word }}</div>
            <div class="adj-scale-label">Gegenteil</div>
          </div>
          <div v-if="positiveCounterpart && word.superlative" class="adj-scale-node">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot"></div></div>
            <div class="adj-scale-form">{{ word.superlative }}</div>
            <div class="adj-scale-label">Superlativ</div>
          </div>
          <div v-if="positiveCounterpart && word.comparative" class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', word.comparative!)">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot"></div></div>
            <div class="adj-scale-form">{{ word.comparative }}</div>
            <div class="adj-scale-label">Komparativ</div>
          </div>
          <div class="adj-scale-node adj-scale-active">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot adj-scale-dot-active"></div></div>
            <div class="adj-scale-form adj-scale-form-active">{{ word.word }}</div>
            <div class="adj-scale-label">Positiv</div>
          </div>
          <div v-if="!positiveCounterpart && word.comparative" class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', word.comparative!)">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot"></div></div>
            <div class="adj-scale-form">{{ word.comparative }}</div>
            <div class="adj-scale-label">Komparativ</div>
          </div>
          <div v-if="!positiveCounterpart && word.superlative" class="adj-scale-node">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot"></div></div>
            <div class="adj-scale-form">{{ word.superlative }}</div>
            <div class="adj-scale-label">Superlativ</div>
          </div>
          <div v-if="positiveCounterpart" class="adj-scale-node adj-scale-tappable adj-scale-positive" @click="emit('compare-navigate', positiveCounterpart!.word)">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot adj-scale-dot-positive"></div></div>
            <div class="adj-scale-form adj-scale-form-positive">{{ positiveCounterpart!.word }}</div>
            <div class="adj-scale-label">Gegenteil</div>
          </div>
        </div>
      </div>
    </div>
    <!-- Inverse case: this word IS the comparative of another adjective -->
    <div v-else-if="baseWord" class="adj-scale-wrap scroll-fade" :style="fadeStyle" :class="{ 'is-scrollable': isScrollable }">
      <div class="adj-scale-title">{{ t('adj.steigerung') }}</div>
      <div class="adj-scale-row">
        <div class="adj-scale-bg-line"></div>
        <div class="adj-scale" ref="scaleEl">
          <div v-if="baseWord!.antonym" class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', baseWord!.antonym!.word)">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot" :class="{ 'adj-scale-dot-antonym-negative': baseWord!.antonym!.negative }"></div></div>
            <div class="adj-scale-form" :class="{ 'adj-scale-form-antonym-negative': baseWord!.antonym!.negative }">{{ baseWord!.antonym!.word }}</div>
            <div class="adj-scale-label">Gegenteil</div>
          </div>
          <div class="adj-scale-node adj-scale-tappable" @click="emit('compare-navigate', baseWord!.word)">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot"></div></div>
            <div class="adj-scale-form">{{ baseWord!.word }}</div>
            <div class="adj-scale-label">Positiv</div>
          </div>
          <div class="adj-scale-node adj-scale-active">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot adj-scale-dot-active"></div></div>
            <div class="adj-scale-form adj-scale-form-active">{{ word.word }}</div>
            <div class="adj-scale-label">Komparativ</div>
          </div>
          <div v-if="baseWord!.superlative" class="adj-scale-node">
            <div class="adj-scale-dot-wrap"><div class="adj-scale-dot"></div></div>
            <div class="adj-scale-form">{{ baseWord!.superlative }}</div>
            <div class="adj-scale-label">Superlativ</div>
          </div>
        </div>
      </div>
    </div>

    <template v-if="!word.is_indeclinable">

      <!-- In-page view switch (regular adjectives only) -->
      <div v-if="word.declension_regular" class="segmented adj-view-switch">
        <button :class="{ active: viewMode === 'rules' }" @click="viewMode = 'rules'">{{ t('adj.viewRules') }}</button>
        <button :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">{{ t('adj.viewTable') }}</button>
      </div>

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
        <div class="segmented adj-tabs">
          <button :class="{ active: activeTab === 'strong' }" @click="activeTab = 'strong'">Stark</button>
          <button :class="{ active: activeTab === 'weak' }" @click="activeTab = 'weak'">Schwach</button>
          <button :class="{ active: activeTab === 'mixed' }" @click="activeTab = 'mixed'">Gemischt</button>
        </div>

        <div class="decl-table-wrap adj-decl-wrap scroll-fade" :style="tableStyle">
        <div class="decl-table-scroll" ref="tableEl">
        <table class="decl-table adj-decl-table" aria-label="Adjektivdeklination">
          <thead>
            <tr>
              <th class="decl-case-header" scope="col"></th>
              <th class="decl-num-header gender-m" scope="col">M</th>
              <th class="decl-num-header gender-f" scope="col">F</th>
              <th class="decl-num-header gender-n" scope="col">N</th>
              <th class="decl-num-header" scope="col">Pl.</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in CASES" :key="c.key">
              <th class="decl-case" scope="row">{{ c.label }}</th>
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
        </div>
        </div>
      </template>

    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "@app/js/i18n.js";
import { getCached, CONDENSED_GRAMMAR_KEY } from "@app/utils/storage.js";
import { useScrollFade } from "@app/composables/useScrollFade.js";
import adjEndings from "@data/rules/adj-endings.json";
import type { AdjectiveWord, AdjEndingsTable } from "@types/word.js";

const scaleEl = ref<HTMLElement | null>(null);
const { fadeStyle, isScrollable } = useScrollFade(scaleEl);

const tableEl = ref<HTMLElement | null>(null);
const { fadeStyle: tableStyle } = useScrollFade(tableEl);

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
  initialView?: ViewMode | null;
}>();

const activeTab = ref<DeclType>("strong");
const viewMode = ref<ViewMode>(props.initialView ?? (getCached(CONDENSED_GRAMMAR_KEY) === "1" ? "rules" : "table"));

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
