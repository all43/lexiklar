<template>
  <div v-if="conjugation" class="verb-conjugation">
    <!-- Metadata chips -->
    <div class="verb-meta">
      <f7-badge v-if="verb.auxiliary" color="blue">{{ auxLabel }}</f7-badge>
      <f7-badge v-if="verb.separable" color="orange">trennbar</f7-badge>
      <f7-badge v-if="verb.reflexive === 'mandatory'" color="purple">sich</f7-badge>
      <f7-badge v-if="verb.reflexive === 'optional'" color="purple">sich (opt.)</f7-badge>
      <f7-badge color="gray">{{ classLabel }}</f7-badge>
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
    <f7-segmented strong tag="p" class="verb-tabs">
      <f7-button :active="tab === 'ind'" @click="tab = 'ind'">Indikativ</f7-button>
      <f7-button :active="tab === 'konj'" @click="tab = 'konj'">Konjunktiv</f7-button>
      <f7-button :active="tab === 'other'" @click="tab = 'other'">Weitere</f7-button>
    </f7-segmented>

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
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import ConjugationTable from "./ConjugationTable.vue";
import { computeConjugation } from "../utils/verb-forms.js";

let endingsCache = null;

export default {
  components: { ConjugationTable },
  props: {
    verb: { type: Object, required: true },
  },
  data() {
    return {
      tab: "ind",
      endings: null,
    };
  },
  computed: {
    auxLabel() {
      const a = this.verb.auxiliary;
      if (a === "both") return "sein/haben";
      return a;
    },
    classLabel() {
      const cls = this.verb.conjugation_class;
      const labels = { weak: "schwach", strong: "stark", mixed: "gemischt", irregular: "unregelmäßig" };
      return labels[cls] || cls;
    },
    conjugation() {
      if (this.verb.conjugation_class === "irregular") {
        return this.verb.conjugation;
      }
      if (!this.endings) return null;
      return computeConjugation(this.verb, this.endings);
    },
  },
  async mounted() {
    if (this.verb.conjugation_class === "irregular") return;
    if (endingsCache) {
      this.endings = endingsCache;
      return;
    }
    try {
      const resp = await fetch("/data/rules/verb-endings.json");
      if (resp.ok) {
        endingsCache = await resp.json();
        this.endings = endingsCache;
      }
    } catch (err) {
      console.error("Failed to load verb endings:", err);
    }
  },
};
</script>
