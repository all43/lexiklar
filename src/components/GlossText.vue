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

<script lang="ts">
import { defineComponent } from "vue";
import { parseReferences, hasReferences } from "../utils/references.js";
import type { GlossSegment } from "../../types/references.js";

interface SelfRefSegment {
  type: "self_ref";
  text: string;
}

export default defineComponent({
  props: {
    gloss: { type: String, required: true },
    selfPath: { type: String, default: null },
  },
  emits: ["sense-ref", "cross-ref"],
  computed: {
    displayGloss(): string {
      // "2. Person Singular …" → "zweite Person Singular …"
      // The number denotes grammatical person, not a list index.
      return this.gloss.replace(
        /^([123])\. (Person )/,
        (_, n: string, rest: string) =>
          (["", "erste", "zweite", "dritte"] as const)[+n] + " " + rest
      );
    },
    segments(): (GlossSegment | SelfRefSegment)[] {
      if (!hasReferences(this.displayGloss)) {
        return [{ type: "text", text: this.displayGloss }];
      }
      const segs = parseReferences(this.displayGloss);
      if (!this.selfPath) return segs;
      return segs.map((seg) =>
        seg.type === "cross_ref" && seg.filePath === this.selfPath
          ? { type: "self_ref" as const, text: seg.text }
          : seg
      );
    },
  },
});
</script>
