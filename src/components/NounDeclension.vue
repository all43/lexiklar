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

<script>
import { t } from "../js/i18n.js";

const SINGULAR_ARTICLES = {
  M: { nom: "der", acc: "den", dat: "dem", gen: "des" },
  F: { nom: "die", acc: "die", dat: "der", gen: "der" },
  N: { nom: "das", acc: "das", dat: "dem", gen: "des" },
};

const PLURAL_ARTICLES = { nom: "die", acc: "die", dat: "den", gen: "der" };

const RULE_DESCRIPTIONS = {
  suffix_ung:              "-ung → always feminine",
  suffix_heit:             "-heit → always feminine",
  suffix_keit:             "-keit → always feminine",
  suffix_chen:             "-chen → always neuter",
  suffix_lein:             "-lein → always neuter",
  suffix_schaft:           "-schaft → nearly always feminine",
  suffix_tion:             "-tion → nearly always feminine",
  suffix_sion:             "-sion → nearly always feminine",
  suffix_taet:             "-tät → nearly always feminine",
  suffix_ismus:            "-ismus → nearly always masculine",
  suffix_ist:              "-ist → nearly always masculine",
  suffix_ling:             "-ling → nearly always masculine",
  suffix_tum:              "-tum → usually neuter",
  suffix_or:               "-or → usually masculine",
  suffix_ei:               "-ei → usually feminine",
  suffix_anz:              "-anz → usually feminine",
  suffix_enz:              "-enz → usually feminine",
  nominalized_infinitive:  "nominalized infinitive → always neuter",
  suffix_ment:             "-ment → often neuter",
  suffix_um:               "-um → often neuter",
  suffix_ie:               "-ie → often feminine",
  suffix_ik:               "-ik → often feminine",
  suffix_ur:               "-ur → often feminine",
  suffix_eur:              "-eur → often masculine",
};

export default {
  props: {
    word: { type: Object, required: true },
  },
  computed: {
    t() { return t; },
    genderClass() {
      return (this.word.gender || "").toLowerCase();
    },
    isNDeclension() {
      if (this.word.gender !== "M") return false;
      const s = this.word.case_forms?.singular;
      if (!s?.nom || !s?.acc) return false;
      return s.acc !== s.nom && s.acc === s.dat && s.acc === s.gen;
    },
    cases() {
      return [
        { key: "nom", label: "Nom." },
        { key: "acc", label: "Akk." },
        { key: "dat", label: "Dat." },
        { key: "gen", label: "Gen." },
      ];
    },
    singularArticles() {
      return SINGULAR_ARTICLES[this.word.gender] || SINGULAR_ARTICLES["M"];
    },
    pluralArticles() {
      return PLURAL_ARTICLES;
    },
    hasSingular() {
      const s = this.word.case_forms?.singular;
      return s && Object.values(s).some(Boolean);
    },
    hasPlural() {
      const p = this.word.case_forms?.plural;
      return p && Object.values(p).some(Boolean);
    },
    ruleText() {
      const rule = this.word.gender_rule;
      if (!rule) return "";
      const desc = RULE_DESCRIPTIONS[rule.rule_id] || rule.rule_id;
      return rule.is_exception ? `${t("noun.exception")}${desc}` : desc;
    },
  },
};
</script>
