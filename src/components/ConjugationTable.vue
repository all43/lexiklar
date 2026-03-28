<template>
  <table class="conj-table">
    <tbody>
      <tr v-for="(person, idx) in personLabels" :key="idx">
        <td class="conj-person">{{ person }}</td>
        <td class="conj-form">{{ (forms as unknown as Record<string, string>)[personKeys[idx]] || '—' }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PersonForms, ImperativeForms } from "../../types/word.js";

const props = defineProps<{
  forms: PersonForms | ImperativeForms;
  imperative?: boolean;
}>();

const personKeys = computed(() =>
  props.imperative
    ? ["du", "ihr", "Sie"]
    : ["ich", "du", "er", "wir", "ihr", "sie"]
);

const personLabels = computed(() =>
  props.imperative
    ? ["du", "ihr", "Sie"]
    : ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"]
);
</script>
