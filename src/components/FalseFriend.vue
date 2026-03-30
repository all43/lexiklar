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
