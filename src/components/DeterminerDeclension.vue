<template>
  <div v-if="paradigm" class="det-declension">
    <div v-for="c in CASES" :key="c.key" class="det-cond-section">
      <div class="det-cond-case-label">{{ c.label }}</div>
      <div class="det-cond-examples">
        <template v-for="(g, gi) in visibleGenders" :key="g.key">
          <span v-if="gi > 0" class="det-cond-sep">·</span>
          <span class="det-phrase">
            <span
              :class="['det-article', g.colorClass, { 'det-article--active': isActive(getDetForm(g.key, c.key)) }]"
            >{{ getDetForm(g.key, c.key) }}</span>
            {{ ' ' }}{{ getAdjForm(g.key, c.key) }} {{ getNoun(g.key, c.key) }}
          </span>
        </template>
      </div>
    </div>

    <!-- Examples from inflected form stubs -->
    <template v-if="formExamples && formExamples.length">
      <div class="det-fe-title">Beispiele</div>
      <div v-for="fe in formExamples" :key="fe.form" class="det-fe-group">
        <div class="det-fe-label">
          <span :class="['det-article', getFormColorClass(fe.form)]">{{ fe.form }}</span>
        </div>
        <div v-for="(ex, i) in fe.examples" :key="i" class="det-fe-item">
          <div class="det-fe-text">{{ ex.text }}</div>
          <div v-if="ex.translation" class="det-fe-translation">{{ ex.translation }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import paradigmsData from "../../data/rules/determiner-declensions.json";
import adjEndingsData from "../../data/rules/adj-endings.json";
import type { GenericWord } from "../../types/word.js";
import type { AdjEndingsTable } from "../../types/word.js";
import type { Example } from "../../types/example.js";

const adjEndings = adjEndingsData as AdjEndingsTable;

interface Collocation {
  adj_stem: string;
  M: string; M_gen?: string;
  F: string;
  N: string; N_gen?: string;
  Pl?: string; Pl_dat?: string;
}

interface DeterminerParadigm {
  lemma: string;
  decl_class: "weak" | "mixed" | "strong";
  collocation: Collocation;
  forms: {
    masc:   { nom: string; acc: string; dat: string; gen: string };
    fem:    { nom: string; acc: string; dat: string; gen: string };
    neut:   { nom: string; acc: string; dat: string; gen: string };
    plural: { nom: string; acc: string; dat: string; gen: string } | null;
  };
  alt_forms?: string[];
}

interface FormExampleGroup {
  form: string;
  examples: Example[];
}

const CASES = [
  { key: "nom" as const, label: "Nom." },
  { key: "acc" as const, label: "Akk." },
  { key: "dat" as const, label: "Dat." },
  { key: "gen" as const, label: "Gen." },
];

const ALL_GENDERS = [
  { key: "masc",   colorClass: "gender-m" },
  { key: "fem",    colorClass: "gender-f" },
  { key: "neut",   colorClass: "gender-n" },
  { key: "plural", colorClass: ""         },
] as const;

const props = defineProps<{
  word: GenericWord;
  formExamples?: FormExampleGroup[];
}>();

const paradigm = computed<DeterminerParadigm | null>(() => {
  const target = (props.word as GenericWord & { base_lemma?: string }).base_lemma ?? props.word.word;
  return (paradigmsData.paradigms as DeterminerParadigm[]).find(p => p.lemma === target) ?? null;
});

const visibleGenders = computed(() =>
  ALL_GENDERS.filter(g => g.key !== "plural" || paradigm.value?.forms.plural != null)
);

function getDetForm(gender: typeof ALL_GENDERS[number]["key"], caseKey: typeof CASES[number]["key"]): string {
  if (!paradigm.value) return "";
  const row = paradigm.value.forms[gender];
  if (!row) return "";
  return row[caseKey];
}

function getAdjForm(gender: typeof ALL_GENDERS[number]["key"], caseKey: typeof CASES[number]["key"]): string {
  if (!paradigm.value) return "";
  const stem = paradigm.value.collocation.adj_stem;
  const adjGender = gender === "plural" ? "plural" : gender;
  const ending = adjEndings[paradigm.value.decl_class]?.[adjGender]?.[caseKey] ?? "";
  return stem + ending;
}

function getNoun(gender: typeof ALL_GENDERS[number]["key"], caseKey: typeof CASES[number]["key"]): string {
  if (!paradigm.value) return "";
  const c = paradigm.value.collocation;
  switch (gender) {
    case "masc":   return caseKey === "gen" ? (c.M_gen ?? c.M) : c.M;
    case "fem":    return c.F;
    case "neut":   return caseKey === "gen" ? (c.N_gen ?? c.N) : c.N;
    case "plural": return caseKey === "dat" ? (c.Pl_dat ?? c.Pl ?? "") : (c.Pl ?? "");
    default:       return "";
  }
}

function getFormColorClass(form: string): string {
  if (!paradigm.value) return "";
  const genderColors = { masc: "gender-m", fem: "gender-f", neut: "gender-n", plural: "" } as const;
  for (const [gender, forms] of Object.entries(paradigm.value.forms) as [keyof typeof genderColors, Record<string, string> | null][]) {
    if (!forms) continue;
    if (Object.values(forms).includes(form)) return genderColors[gender] ?? "";
  }
  return "";
}

function isActive(form: string): boolean {
  return form === props.word.word;
}
</script>

<style scoped>
.det-cond-section {
  padding: 0 var(--f7-block-padding-horizontal, 16px);
  margin-bottom: 14px;
}

.det-cond-case-label {
  font-size: 12px;
  color: var(--f7-list-item-footer-text-color);
  margin-bottom: 3px;
}

.det-cond-examples {
  font-size: 15px;
  line-height: 1.7;
}

.det-cond-sep {
  color: var(--f7-list-item-footer-text-color);
  margin: 0 5px;
}

.det-article {
  font-weight: 500;
}

.det-article--active {
  color: var(--f7-theme-color);
  font-weight: 700;
}

.det-fe-title {
  padding: 4px var(--f7-block-padding-horizontal, 16px) 0;
  font-size: 12px;
  color: var(--f7-list-item-footer-text-color);
  margin-bottom: 6px;
}

.det-fe-group {
  padding: 0 var(--f7-block-padding-horizontal, 16px);
  margin-bottom: 12px;
}

.det-fe-label {
  font-size: 13px;
  margin-bottom: 3px;
}

.det-fe-item {
  margin-bottom: 6px;
}

.det-fe-text {
  font-size: 14px;
}

.det-fe-translation {
  font-size: 13px;
  color: var(--f7-list-item-footer-text-color);
}
</style>
