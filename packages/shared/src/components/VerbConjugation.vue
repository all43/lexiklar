<template>
  <div v-if="conjugation" class="verb-conjugation">
    <!-- Metadata chips -->
    <div class="verb-meta">
      <span v-if="verb.auxiliary" class="badge badge-blue">{{ auxLabel }}</span>
      <span v-if="verb.separable" class="badge badge-orange">trennbar</span>
      <span v-if="verb.reflexive === 'mandatory'" class="badge badge-purple">sich</span>
      <span v-if="verb.reflexive === 'optional'" class="badge badge-purple">sich (opt.)</span>
      <span class="badge badge-gray">{{ classLabel }}</span>
    </div>

    <!-- Principal parts -->
    <div class="verb-principal">
      <div class="verb-principal-item">
        <div class="verb-principal-label">Infinitiv</div>
        <div class="verb-principal-form">{{ verb.word }}</div>
      </div>
      <div class="verb-principal-item">
        <div class="verb-principal-label">Präteritum</div>
        <div class="verb-principal-form">{{ conjugation.preterite?.ich || '—' }}</div>
      </div>
      <div class="verb-principal-item">
        <div class="verb-principal-label">Partizip II</div>
        <div class="verb-principal-form">{{ conjugation.participle2 || '—' }}</div>
      </div>
    </div>

    <!-- Tense tabs -->
    <div class="segmented">
      <button :class="{ active: tab === 'ind' }" @click="tab = 'ind'">Indikativ</button>
      <button :class="{ active: tab === 'konj' }" @click="tab = 'konj'">Konjunktiv</button>
      <button :class="{ active: tab === 'other' }" @click="tab = 'other'">Weitere</button>
    </div>

    <!-- Indikativ -->
    <div v-if="tab === 'ind'">
      <div class="conj-tense-title">Präsens</div>
      <ConjugationTable :forms="conjugation.present" />
      <div class="conj-tense-title">Präteritum</div>
      <ConjugationTable :forms="conjugation.preterite" />
    </div>

    <!-- Konjunktiv -->
    <div v-if="tab === 'konj'">
      <div class="conj-tense-title">Konjunktiv I</div>
      <ConjugationTable :forms="conjugation.subjunctive1" />
      <div class="conj-tense-title">Konjunktiv II</div>
      <ConjugationTable :forms="conjugation.subjunctive2" />
    </div>

    <!-- Weitere -->
    <div v-if="tab === 'other'">
      <div class="conj-tense-title">Imperativ</div>
      <ConjugationTable :forms="conjugation.imperative" :imperative="true" />
      <div class="conj-tense-title">Partizipien</div>
      <table class="conj-table">
        <tbody>
          <tr>
            <td class="conj-person">Partizip I</td>
            <td class="conj-form">{{ conjugation.participle1 || '—' }}</td>
          </tr>
          <tr>
            <td class="conj-person">Partizip II</td>
            <td class="conj-form">{{ conjugation.participle2 || '—' }}</td>
          </tr>
          <tr v-if="verb.separable && verb.prefix">
            <td class="conj-person">{{ t('verb.zuInfinitive') }}</td>
            <td class="conj-form">{{ verb.prefix + 'zu' + verb.word.slice(verb.prefix.length) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import ConjugationTable from "./ConjugationTable.vue";
import { t } from "@app/js/i18n.js";
import type { VerbWord, ConjugationTable as ConjType } from "@types/word.js";

const CLASS_LABELS: Record<string, string> = {
  weak: "schwach",
  strong: "stark",
  mixed: "gemischt",
  irregular: "unregelm\u00E4\u00DFig",
};

const props = defineProps<{
  verb: VerbWord;
}>();

const tab = ref<"ind" | "konj" | "other">("ind");

const auxLabel = computed(() => {
  const a = props.verb.auxiliary;
  if (a === "both") return "sein/haben";
  return a || "";
});

const classLabel = computed(() =>
  CLASS_LABELS[props.verb.conjugation_class || ""] || props.verb.conjugation_class || ""
);

const conjugation = computed((): ConjType | undefined => props.verb.conjugation);
</script>
