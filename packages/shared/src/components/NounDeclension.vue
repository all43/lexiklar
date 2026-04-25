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
      <div v-if="word.gender_rule && !word.gender_rule.is_false_match" class="noun-rule-hint noun-rule-hint--with-link">
        <span :class="word.gender_rule.is_exception ? 'noun-rule-exception' : 'noun-rule-match'">
          {{ ruleText }}
        </span>
        <a href="#" class="noun-rule-ref-link" @click.prevent>{{ t('grammar.allGenderRules') }}</a>
      </div>
      <div v-if="word.gender_rule && word.gender_rule.is_false_match" class="noun-rule-hint">
        <span class="noun-rule-false-match">{{ falseMatchText }}</span>
      </div>
      <div v-if="word.is_singular_only" class="noun-rule-hint">
        <span class="noun-rule-match">{{ t('noun.singularetantum') }}</span>
      </div>
    </div>

    <!-- Declension table -->
    <div v-if="word.case_forms" class="decl-table-wrap scroll-fade" :style="tableStyle">
    <div class="decl-table-scroll" ref="tableEl">
    <table class="decl-table" aria-label="Deklination">
      <thead>
        <tr>
          <th class="decl-case-header" scope="col"></th>
          <th v-if="hasSingular" class="decl-num-header" scope="col" :class="{ 'decl-num-header--dim': word.is_plural_only }">{{ t('noun.singular') }}</th>
          <th class="decl-num-header" scope="col" :class="{ 'decl-num-header--dim': word.is_singular_only }">{{ t('noun.plural') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in cases" :key="c.key">
          <th class="decl-case" scope="row">{{ c.label }}</th>
          <td v-if="hasSingular" class="decl-form" :class="{ 'decl-form--dim': word.is_plural_only }">
            <template v-if="shouldStack('singular', c.key)">
              <div v-for="form in allForms('singular', c.key)" :key="form" class="decl-form-row">
                <span :class="`decl-article gender-${genderClass}`">{{ singularArticles[c.key] + ' ' }}</span>{{ form }}
              </div>
            </template>
            <template v-else>
              <span :class="`decl-article gender-${genderClass}`">{{ singularArticles[c.key] + ' ' }}</span><template v-if="isNDeclension && nDeclEnding(c.key)"><span class="decl-stem">{{ nDeclStem(c.key) }}</span><span class="decl-ending">{{ nDeclEnding(c.key) }}</span></template><template v-else>{{ allForms('singular', c.key).join(' / ') || '—' }}</template>
            </template>
          </td>
          <td class="decl-form" :class="{ 'decl-form--dim': word.is_singular_only }">
            <template v-if="hasPlural && shouldStack('plural', c.key)">
              <div v-for="form in allForms('plural', c.key)" :key="form" class="decl-form-row">
                <span class="decl-article decl-article--plural">{{ pluralArticles[c.key] + ' ' }}</span>{{ form }}
              </div>
            </template>
            <template v-else-if="hasPlural">
              <span class="decl-article decl-article--plural">{{ pluralArticles[c.key] + ' ' }}</span><template v-if="umlautSplit(c.key)">{{ umlautSplit(c.key)!.before }}<span class="decl-umlaut">{{ umlautSplit(c.key)!.umlaut }}</span>{{ umlautSplit(c.key)!.after }}</template><span v-else>{{ allForms('plural', c.key).join(' / ') || '—' }}</span>
            </template>
            <span v-else class="decl-no-plural">—</span>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "@app/js/i18n.js";
import { useScrollFade } from "@app/composables/useScrollFade.js";
import { splitUmlaut, type UmlautSplit } from "@app/utils/umlaut.js";
import type { NounWord, CaseRow } from "@types/word.js";

type Gender = "M" | "F" | "N";

const SINGULAR_ARTICLES: Record<Gender, CaseRow> = {
  M: { nom: "der", acc: "den", dat: "dem", gen: "des" },
  F: { nom: "die", acc: "die", dat: "der", gen: "der" },
  N: { nom: "das", acc: "das", dat: "dem", gen: "des" },
};

const PLURAL_ARTICLES: CaseRow = { nom: "die", acc: "die", dat: "den", gen: "der" };

const props = defineProps<{
  word: NounWord;
}>();

const tableEl = ref<HTMLElement | null>(null);
const { fadeStyle: tableStyle } = useScrollFade(tableEl);

const cases = [
  { key: "nom" as const, label: "Nom." },
  { key: "acc" as const, label: "Akk." },
  { key: "dat" as const, label: "Dat." },
  { key: "gen" as const, label: "Gen." },
];

const genderClass = computed(() => (props.word.gender || "").toLowerCase());

const isNDeclension = computed(() => {
  if (props.word.gender !== "M") return false;
  const s = props.word.case_forms?.singular;
  if (!s?.nom || !s?.acc) return false;
  return s.acc !== s.nom && s.acc === s.dat && s.acc === s.gen;
});

const singularArticles = computed((): CaseRow =>
  SINGULAR_ARTICLES[props.word.gender] || SINGULAR_ARTICLES["M"]
);

const pluralArticles = computed(() => PLURAL_ARTICLES);

const hasSingular = computed(() => {
  const s = props.word.case_forms?.singular;
  return !!s && Object.values(s).some(Boolean);
});

const hasPlural = computed(() => {
  const p = props.word.case_forms?.plural;
  return !!p && Object.values(p).some(Boolean);
});

const ruleText = computed(() => {
  const rule = props.word.gender_rule;
  if (!rule) return "";
  const desc = t(`noun.rule.${rule.rule_id}`);
  return rule.is_exception ? `${t("noun.exception")}${desc}` : desc;
});

const falseMatchText = computed(() => {
  const rule = props.word.gender_rule;
  if (!rule) return "";
  const suffix = rule.rule_id.replace("suffix_", "");
  return t("noun.falseMatch").replace("{suffix}", `-${suffix}`);
});

function allForms(num: "singular" | "plural", caseKey: keyof CaseRow): string[] {
  const primary = props.word.case_forms?.[num]?.[caseKey];
  const alts = props.word.case_forms_alt?.[num]?.[caseKey] ?? [];
  return [primary, ...alts].filter(Boolean) as string[];
}

function shouldStack(num: "singular" | "plural", caseKey: keyof CaseRow): boolean {
  const forms = allForms(num, caseKey);
  if (forms.length <= 1) return false;
  const alts = props.word.case_forms_alt?.[num]?.[caseKey] ?? [];
  return alts.length > 1 || (forms[0]?.length ?? 0) > 12;
}

function nDeclEnding(caseKey: "nom" | "acc" | "dat" | "gen"): string {
  const nom = props.word.case_forms?.singular?.nom;
  const form = props.word.case_forms?.singular?.[caseKey];
  if (!nom || !form || !form.startsWith(nom)) return "";
  return form.slice(nom.length);
}

function nDeclStem(caseKey: "nom" | "acc" | "dat" | "gen"): string {
  const nom = props.word.case_forms?.singular?.nom || "";
  const form = props.word.case_forms?.singular?.[caseKey] || "";
  if (!form.startsWith(nom)) return form;
  return nom;
}

function umlautSplit(caseKey: "nom" | "acc" | "dat" | "gen"): UmlautSplit | null {
  const singNom = props.word.case_forms?.singular?.nom;
  const pluralForm = props.word.case_forms?.plural?.[caseKey];
  if (!singNom || !pluralForm) return null;
  return splitUmlaut(singNom, pluralForm);
}
</script>

<style scoped>
.decl-table-wrap {
  margin: 0 -16px;
}
.decl-form-row {
  line-height: 1.5;
}
.decl-ending {
  color: var(--color-rule-match);
  font-weight: 600;
}
.decl-stem {
  font-weight: 500;
}
.decl-umlaut {
  color: var(--color-vowel-change);
  font-weight: 600;
}
</style>
