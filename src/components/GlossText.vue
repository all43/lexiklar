<template>
  <span class="gloss-text">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.type === 'text'">{{ seg.text }}</span>
      <a
        v-else-if="seg.type === 'superscript_ref'"
        href="#"
        class="sense-ref sense-ref--super"
        @click.prevent="$emit('sense-ref', seg.senseNumber)"
      ><sup>{{ seg.text }}</sup></a>
      <a
        v-else-if="seg.type === 'inline_ref'"
        href="#"
        :class="['sense-ref', seg.hasDisplayText ? 'sense-ref--word' : 'sense-ref--inline']"
        @click.prevent="$emit('sense-ref', seg.senseNumber)"
      >{{ seg.text }}</a>
      <a
        v-else-if="seg.type === 'cross_ref'"
        href="#"
        :class="['sense-ref', seg.hasDisplayText ? 'sense-ref--word' : 'sense-ref--cross']"
        @click.prevent="$emit('cross-ref', seg.filePath, seg.senseNumber)"
      >{{ seg.text }}</a>
    </template>
  </span>
</template>

<script>
import { parseReferences, hasReferences } from "../utils/references.js";

export default {
  props: {
    gloss: { type: String, required: true },
  },
  emits: ["sense-ref", "cross-ref"],
  computed: {
    segments() {
      if (!hasReferences(this.gloss)) {
        return [{ type: "text", text: this.gloss }];
      }
      return parseReferences(this.gloss);
    },
  },
};
</script>
