<template>
  <span class="list-item-pos">{{ pos }}</span>
  <f7-badge v-if="pluralDominant" color="orange" class="list-item-badge">Pl.</f7-badge>
  <f7-badge v-else-if="gender" :color="genderColor(gender)" class="list-item-badge">{{ gender }}</f7-badge>
</template>

<script setup lang="ts">
import { genderColor } from "../utils/word-list.js";

defineProps<{
  pos: string;
  gender?: string | null;
  pluralDominant?: boolean;
}>();
</script>

<style>
/* POS label in the after slot */
.list-item-pos {
  color: var(--f7-list-item-footer-text-color);
  font-size: var(--f7-list-item-footer-font-size, 12px);
}

/* Gender / Pl. badge sits right after the POS label */
.list-item-badge {
  margin-left: 5px;
}
</style>
