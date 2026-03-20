<template>
  <div class="noun-declension">
    <!-- Pluraletantum hint -->
    <div v-if="word.is_plural_only" class="noun-rule-hint">
      <span class="noun-rule-match">{{ t('noun.pluraletantum') }}</span>
    </div>

    <!-- Gender rule hint -->
    <div v-else-if="word.gender_rule || word.is_singular_only || word.plural_dominant || isNDeclension" class="noun-rule-hints">
      <div v-if="isNDeclension" class="noun-rule-hint">
        <span class="noun-rule-match">{{ t('noun.nDeklination') }}</span>
      </div>
      <div v-if="word.plural_dominant" class="noun-rule-hint">
        <span class="noun-rule-match">{{ t('noun.usuallyPlural') }}</span>
      </div>
      <div v-if="word.gender_rule" class="noun-rule-hint">
        <span :class="word.gender_rule.is_exception ? 'noun-rule-exception' : 'noun-rule-match'">
          {{ ruleText }}
        </span>
      </div>
      <div v-if="word.is_singular_only" class="noun-rule-hint">
        <span class="noun-rule-match">{{ t('noun.singularetantum') }}</span>
      </div>
    </div>

    <!-- Declension table -->
    <table v-if="word.case_forms" class="decl-table">
      <thead>
        <tr>
          <th class="decl-case-header"></th>
          <th v-if="hasSingular" class="decl-num-header" :class="{ 'decl-num-header--dim': word.is_plural_only }">{{ t('noun.singular') }}</th>
          <th class="decl-num-header" :class="{ 'decl-num-header--dim': word.is_singular_only }">{{ t('noun.plural') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in cases" :key="c.key">
          <td class="decl-case">{{ c.label }}</td>
          <td v-if="hasSingular" class="decl-form" :class="{ 'decl-form--dim': word.is_plural_only }">
            <span :class="`decl-article gender-${genderClass}`">{{ singularArticles[c.key] }}</span>
            {{ word.case_forms.singular[c.key] || '—' }}
          </td>
          <td class="decl-form" :class="{ 'decl-form--dim': word.is_singular_only }">
            <span v-if="hasPlural" class="decl-article decl-article--plural">{{ pluralArticles[c.key] }}</span>
            <span v-if="hasPlural">{{ word.case_forms.plural[c.key] || '—' }}</span>
            <span v-else class="decl-no-plural">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { t } from "../js/i18n.js";
import type { NounWord, CaseRow } from "../../types/word.js";

type Gender = "M" | "F" | "N";

const SINGULAR_ARTICLES: Record<Gender, CaseRow> = {
  M: { nom: "der", acc: "den", dat: "dem", gen: "des" },
  F: { nom: "die", acc: "die", dat: "der", gen: "der" },
  N: { nom: "das", acc: "das", dat: "dem", gen: "des" },
};

const PLURAL_ARTICLES: CaseRow = { nom: "die", acc: "die", dat: "den", gen: "der" };


export default defineComponent({
  props: {
    word: { type: Object as PropType<NounWord>, required: true },
  },
  computed: {
    t() { return t; },
    genderClass(): string {
      return (this.word.gender || "").toLowerCase();
    },
    isNDeclension(): boolean {
      if (this.word.gender !== "M") return false;
      const s = this.word.case_forms?.singular;
      if (!s?.nom || !s?.acc) return false;
      return s.acc !== s.nom && s.acc === s.dat && s.acc === s.gen;
    },
    cases() {
      return [
        { key: "nom" as const, label: "Nom." },
        { key: "acc" as const, label: "Akk." },
        { key: "dat" as const, label: "Dat." },
        { key: "gen" as const, label: "Gen." },
      ];
    },
    singularArticles(): CaseRow {
      return SINGULAR_ARTICLES[this.word.gender] || SINGULAR_ARTICLES["M"];
    },
    pluralArticles(): CaseRow {
      return PLURAL_ARTICLES;
    },
    hasSingular(): boolean {
      const s = this.word.case_forms?.singular;
      return !!s && Object.values(s).some(Boolean);
    },
    hasPlural(): boolean {
      const p = this.word.case_forms?.plural;
      return !!p && Object.values(p).some(Boolean);
    },
    ruleText(): string {
      const rule = this.word.gender_rule;
      if (!rule) return "";
      const desc = t(`noun.rule.${rule.rule_id}`);
      return rule.is_exception ? `${t("noun.exception")}${desc}` : desc;
    },
  },
});
</script>
