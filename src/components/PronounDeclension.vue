<template>
  <div class="pronoun-declension">
    <template v-if="isPersonalPronoun">
      <div class="decl-table-wrap pronoun-decl-wrap scroll-fade" :style="tableStyle">
      <div class="decl-table-scroll" ref="tableEl">
      <table class="decl-table pronoun-decl-table" aria-label="Personalpronomen">
        <thead>
          <tr>
            <th class="decl-case-header pronoun-label-header" scope="col"></th>
            <th class="decl-num-header" scope="col">Nom.</th>
            <th class="decl-num-header" scope="col">Akk.</th>
            <th class="decl-num-header" scope="col">Dat.</th>
            <th class="decl-num-header" scope="col">Gen.</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in PERSONAL_PRONOUNS" :key="row.label">
            <th class="decl-case pronoun-label" scope="row">{{ row.label }}</th>
            <td
              v-for="col in CASES"
              :key="col"
              class="decl-form"
              :class="{ 'pronoun-cell--active': row[col] === word.word }"
            >{{ row[col] }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      </div>
    </template>
    <f7-block v-else>
      <p><em>{{ t('word.grammarSoon') }}</em></p>
    </f7-block>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "../js/i18n.js";
import { useScrollFade } from "../composables/useScrollFade.js";
import type { GenericWord } from "../../types/word.js";

type Case = "nom" | "akk" | "dat" | "gen";

interface PronounRow {
  label: string;
  nom: string;
  akk: string;
  dat: string;
  gen: string;
}

const PERSONAL_PRONOUNS: PronounRow[] = [
  { label: "1. Sg.",    nom: "ich", akk: "mich",   dat: "mir",   gen: "meiner" },
  { label: "2. Sg.",    nom: "du",  akk: "dich",   dat: "dir",   gen: "deiner" },
  { label: "3. Sg. m",  nom: "er",  akk: "ihn",    dat: "ihm",   gen: "seiner" },
  { label: "3. Sg. f",  nom: "sie", akk: "sie",    dat: "ihr",   gen: "ihrer"  },
  { label: "3. Sg. n",  nom: "es",  akk: "es",     dat: "ihm",   gen: "seiner" },
  { label: "1. Pl.",    nom: "wir", akk: "uns",    dat: "uns",   gen: "unser"  },
  { label: "2. Pl.",    nom: "ihr", akk: "euch",   dat: "euch",  gen: "euer"   },
  { label: "3. Pl.",    nom: "sie", akk: "sie",    dat: "ihnen", gen: "ihrer"  },
  { label: "Höfl.",     nom: "Sie", akk: "Sie",    dat: "Ihnen", gen: "Ihrer"  },
];

const CASES: Case[] = ["nom", "akk", "dat", "gen"];

const ALL_PERSONAL_FORMS = new Set(
  PERSONAL_PRONOUNS.flatMap((r) => CASES.map((c) => r[c]))
);

const props = defineProps<{
  word: GenericWord;
}>();

const isPersonalPronoun = computed(() => ALL_PERSONAL_FORMS.has(props.word.word));

const tableEl = ref<HTMLElement | null>(null);
const { fadeStyle: tableStyle } = useScrollFade(tableEl);
</script>

<style scoped>
.pronoun-label-header {
  width: 56px;
}
.pronoun-label {
  font-size: 0.78em;
  white-space: nowrap;
}
.pronoun-cell--active {
  color: var(--f7-theme-color);
  font-weight: 700;
  background-color: color-mix(in srgb, var(--f7-theme-color) 12%, transparent);
  border-radius: 4px;
}
</style>
