<template>
  <span class="list-item-pos">{{ pos }}</span>
  <f7-badge v-if="pluralDominant" color="orange" class="list-item-badge">Pl.</f7-badge>
  <f7-badge v-else-if="gender" :color="genderColor(gender)" class="list-item-badge">{{ gender }}</f7-badge>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export function genderColor(gender: string): string {
  if (gender === "M") return "blue";
  if (gender === "F") return "pink";
  if (gender === "N") return "green";
  return "";
}

export function wordListTitle(
  item: { pluralDominant?: boolean; pluralForm?: string | null; lemma: string; gender?: string | null },
  showArticles: boolean,
): string {
  const base = item.pluralDominant ? item.pluralForm : item.lemma;
  if (showArticles && item.gender && !item.pluralDominant) {
    const article = item.gender === "M" ? "der" : item.gender === "F" ? "die" : "das";
    return `${article} ${base}`;
  }
  return base || "";
}

export default defineComponent({
  props: {
    pos: { type: String, required: true },
    gender: { type: String as () => string | null, default: null },
    pluralDominant: { type: Boolean, default: false },
  },
  methods: { genderColor },
});
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
