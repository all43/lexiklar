<template>
  <f7-block class="false-friend-block">
    <div class="false-friend-header">
      <span class="false-friend-icon">⚠</span>
      <span class="false-friend-title">{{ t('word.falseFriendTitle') }}</span>
      <span class="false-friend-en-word">»{{ ff.en_word }}«</span>
    </div>
    <table class="false-friend-table">
      <thead>
        <tr>
          <th>{{ t('word.falseFriendIfMeant') }}</th>
          <th>{{ t('word.falseFriendUseInstead') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in ff.meanings" :key="i">
          <td class="false-friend-en">{{ row.en }}</td>
          <td class="false-friend-de">
            <template v-if="row.de.length === 0">
              <span class="false-friend-self">{{ currentWord }} ✓</span>
            </template>
            <template v-else>
              <span
                v-for="(lemma, j) in row.de"
                :key="lemma"
              ><span
                  class="false-friend-link"
                  @click="$emit('navigate', lemma)"
                >{{ lemma }}</span><span v-if="j < row.de.length - 1"> · </span></span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </f7-block>
</template>

<script setup lang="ts">
import { t } from "../js/i18n.js";
import type { FalseFriendEn } from "../../types/word.js";

defineProps<{
  ff: FalseFriendEn;
  currentWord: string;
}>();

defineEmits<{
  navigate: [lemma: string];
}>();
</script>

<style scoped>
.false-friend-block {
  margin-top: 0;
  padding-top: 0.5em;
  padding-bottom: 0.5em;
}
.false-friend-header {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  margin-bottom: 0.5em;
}
.false-friend-icon {
  color: var(--color-rule-exception);
  font-size: 1em;
}
.false-friend-title {
  font-weight: 600;
  font-size: 0.9em;
}
.false-friend-en-word {
  font-size: 0.85em;
  color: var(--f7-list-item-footer-text-color);
}
.false-friend-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88em;
}
.false-friend-table th {
  text-align: left;
  font-weight: 500;
  color: var(--f7-list-item-footer-text-color);
  padding: 0 0.5em 0.25em 0;
  white-space: nowrap;
}
.false-friend-table td {
  padding: 0.2em 0.5em 0.2em 0;
  vertical-align: top;
}
.false-friend-en {
  color: var(--f7-list-item-subtitle-text-color);
  width: 50%;
}
.false-friend-self {
  color: var(--f7-theme-color);
  font-weight: 500;
}
.false-friend-link {
  color: var(--f7-theme-color);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}
</style>
