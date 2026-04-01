<template>
  <f7-block class="confusable-block">
    <template v-for="(pair, i) in pairs" :key="i">
      <div :class="['confusable-header', i > 0 && 'confusable-header--extra']">
        <span class="confusable-icon">↔</span>
        <span class="confusable-title">{{ t('word.confusableTitle') }}</span>
        <span class="confusable-en-word">»{{ pair.en_word }}«</span>
      </div>
      <div class="confusable-row">
        <span class="confusable-word--current">{{ currentWord }}</span>
        <span class="confusable-sep">—</span>
        <span class="confusable-note">{{ pair.this_note }}</span>
      </div>
      <div class="confusable-row">
        <span class="confusable-link" @click="$emit('navigate', pair.other)">{{ pair.other }}</span>
        <span class="confusable-sep">—</span>
        <span class="confusable-note">{{ pair.other_note }}</span>
      </div>
    </template>
  </f7-block>
</template>

<script setup lang="ts">
import { t } from "../js/i18n.js";
import type { ConfusablePair } from "../../types/word.js";

defineProps<{
  pairs: ConfusablePair[];
  currentWord: string;
}>();

defineEmits<{
  navigate: [lemma: string];
}>();
</script>

<style scoped>
.confusable-block {
  margin-top: 0;
  padding-top: 0.5em;
  padding-bottom: 0.5em;
}
.confusable-header {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  margin-bottom: 0.4em;
}
.confusable-header--extra {
  margin-top: 0.6em;
}
.confusable-icon {
  color: var(--f7-theme-color);
  font-size: 1em;
}
.confusable-title {
  font-weight: 600;
  font-size: 0.9em;
}
.confusable-en-word {
  font-size: 0.85em;
  color: var(--f7-list-item-footer-text-color);
}
.confusable-row {
  display: flex;
  align-items: baseline;
  gap: 0.35em;
  font-size: 0.88em;
  line-height: 1.6;
}
.confusable-word--current {
  font-weight: 600;
  white-space: nowrap;
}
.confusable-sep {
  color: var(--f7-list-item-footer-text-color);
  flex-shrink: 0;
}
.confusable-note {
  color: var(--f7-list-item-subtitle-text-color);
}
.confusable-link {
  color: var(--f7-theme-color);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  white-space: nowrap;
}
</style>
