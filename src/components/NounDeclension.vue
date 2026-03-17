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

const RULE_DESCRIPTIONS: Record<string, string> = {
  suffix_ung:              "-ung \u2192 always feminine",
  suffix_heit:             "-heit \u2192 always feminine",
  suffix_keit:             "-keit \u2192 always feminine",
  suffix_chen:             "-chen \u2192 always neuter",
  suffix_lein:             "-lein \u2192 always neuter",
  suffix_schaft:           "-schaft \u2192 nearly always feminine",
  suffix_tion:             "-tion \u2192 nearly always feminine",
  suffix_sion:             "-sion \u2192 nearly always feminine",
  suffix_taet:             "-t\u00E4t \u2192 nearly always feminine",
  suffix_ismus:            "-ismus \u2192 nearly always masculine",
  suffix_ist:              "-ist \u2192 nearly always masculine",
  suffix_ling:             "-ling \u2192 nearly always masculine",
  suffix_tum:              "-tum \u2192 usually neuter",
  suffix_or:               "-or \u2192 usually masculine",
  suffix_ei:               "-ei \u2192 usually feminine",
  suffix_anz:              "-anz \u2192 usually feminine",
  suffix_enz:              "-enz \u2192 usually feminine",
  nominalized_infinitive:  "nominalized infinitive \u2192 always neuter",
  suffix_ment:             "-ment \u2192 often neuter",
  suffix_um:               "-um \u2192 often neuter",
  suffix_ie:               "-ie \u2192 often feminine",
  suffix_ik:               "-ik \u2192 often feminine",
  suffix_ur:               "-ur \u2192 often feminine",
  suffix_eur:              "-eur \u2192 often masculine",
};

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
      const desc = RULE_DESCRIPTIONS[rule.rule_id] || rule.rule_id;
      return rule.is_exception ? `${t("noun.exception")}${desc}` : desc;
    },
  },
});
</script>
