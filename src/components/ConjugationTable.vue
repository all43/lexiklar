<template>
  <table class="conj-table">
    <tbody>
      <tr v-for="(person, idx) in personLabels" :key="idx">
        <td class="conj-person">{{ person }}</td>
        <td class="conj-form">{{ forms[personKeys[idx]] || '—' }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script>
export default {
  props: {
    forms: { type: Object, required: true },
    imperative: { type: Boolean, default: false },
  },
  computed: {
    personKeys() {
      return this.imperative
        ? ["du", "ihr", "Sie"]
        : ["ich", "du", "er", "wir", "ihr", "sie"];
    },
    personLabels() {
      return this.imperative
        ? ["du", "ihr", "Sie"]
        : ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];
    },
  },
};
</script>
