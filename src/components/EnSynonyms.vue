<template>
  <span v-if="display.length" class="en-synonyms">({{ display.join(', ') }})</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "EnSynonyms" });

const props = defineProps<{
  synonyms?: string[];
  glossEn?: string;
  exclude?: Set<string>;
}>();

const display = computed(() => {
  const syns = props.synonyms ?? [];
  if (!syns.length) return [];
  const gloss = (props.glossEn ?? "").toLowerCase();
  const excl = props.exclude ?? new Set<string>();
  const filtered = syns.filter(
    (s) => s.toLowerCase() !== gloss && !excl.has(s.toLowerCase()),
  );
  if (!filtered.length) return [];
  const singles = filtered.filter((s) => !s.includes(" "));
  const multi = filtered.filter((s) => s.includes(" "));
  return [...singles, ...multi].slice(0, 2);
});
</script>

<style scoped>
.en-synonyms {
  font-size: 0.82em;
  color: var(--f7-list-item-footer-text-color);
  font-weight: 400;
}
</style>
