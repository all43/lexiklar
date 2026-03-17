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

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { PersonForms, ImperativeForms } from "../../types/word.js";

export default defineComponent({
  props: {
    forms: { type: Object as PropType<PersonForms | ImperativeForms>, required: true },
    imperative: { type: Boolean, default: false },
  },
  computed: {
    personKeys(): string[] {
      return this.imperative
        ? ["du", "ihr", "Sie"]
        : ["ich", "du", "er", "wir", "ihr", "sie"];
    },
    personLabels(): string[] {
      return this.imperative
        ? ["du", "ihr", "Sie"]
        : ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];
    },
  },
});
</script>
