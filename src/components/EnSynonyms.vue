<template>
  <span v-if="display.length" class="en-synonyms">({{ display.join(', ') }})</span>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";

/**
 * Shows up to 2 English search synonyms for a sense.
 * Filters out duplicates of gloss_en, prefers single words over phrases,
 * and excludes terms already shown by previous senses.
 */
export default defineComponent({
  name: "EnSynonyms",
  props: {
    synonyms: { type: Array as PropType<string[]>, default: () => [] },
    glossEn: { type: String, default: "" },
    exclude: { type: Set as unknown as PropType<Set<string>>, default: () => new Set() },
  },
  computed: {
    display(): string[] {
      if (!this.synonyms.length) return [];
      const gloss = this.glossEn.toLowerCase();
      const filtered = this.synonyms.filter(
        (s) => s.toLowerCase() !== gloss && !this.exclude.has(s.toLowerCase()),
      );
      if (!filtered.length) return [];
      const singles = filtered.filter((s) => !s.includes(" "));
      const multi = filtered.filter((s) => s.includes(" "));
      return [...singles, ...multi].slice(0, 2);
    },
  },
});
</script>

<style scoped>
.en-synonyms {
  font-size: 0.82em;
  color: var(--f7-list-item-footer-text-color);
  font-weight: 400;
}
</style>
