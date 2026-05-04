<template>
  <span class="gloss-text">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.type === 'text'">{{ seg.text }}</span>
      <mark
        v-else-if="seg.type === 'self_ref'"
        class="example-highlight"
      >{{ seg.text }}</mark>
      <a
        v-else-if="seg.type === 'superscript_ref'"
        href="#"
        class="sense-ref sense-ref--super"
        @click.prevent="emit('sense-ref', seg.senseNumber)"
      ><sup>{{ seg.text }}</sup></a>
      <a
        v-else-if="seg.type === 'inline_ref'"
        href="#"
        :class="['sense-ref', seg.hasDisplayText ? 'sense-ref--word' : 'sense-ref--inline']"
        @click.prevent="emit('sense-ref', seg.senseNumber)"
      >{{ seg.text }}</a>
      <a
        v-else-if="seg.type === 'cross_ref'"
        href="#"
        :class="['sense-ref', seg.hasDisplayText ? 'sense-ref--word' : 'sense-ref--cross']"
        @click.prevent="emit('cross-ref', seg.filePath, seg.senseNumber)"
      >{{ seg.text }}</a>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { parseReferences, hasReferences } from "@app/utils/references.js";
import type { GlossSegment } from "@types/references.js";

interface SelfRefSegment {
  type: "self_ref";
  text: string;
}

const props = defineProps<{
  gloss: string;
  selfPath?: string | null;
}>();

const emit = defineEmits(["sense-ref", "cross-ref"]);

const displayGloss = computed(() =>
  props.gloss.replace(
    /^([123])\. (Person )/,
    (_, n: string, rest: string) =>
      (["", "erste", "zweite", "dritte"] as const)[+n] + " " + rest
  )
);

const segments = computed((): (GlossSegment | SelfRefSegment)[] => {
  if (!hasReferences(displayGloss.value)) {
    return [{ type: "text", text: displayGloss.value }];
  }
  const segs = parseReferences(displayGloss.value);
  if (!props.selfPath) return segs;
  return segs.map((seg) =>
    seg.type === "cross_ref" && seg.filePath === props.selfPath
      ? { type: "self_ref" as const, text: seg.text }
      : seg
  );
});
</script>
