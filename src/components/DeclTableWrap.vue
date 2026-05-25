<template>
  <div class="decl-table-wrap scroll-fade" :style="fadeStyle" :class="{ 'is-scrollable': isScrollable }">
    <div class="decl-table-scroll" ref="scrollEl">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useScrollFade } from "../composables/useScrollFade.js";

const scrollEl = ref<HTMLElement | null>(null);
const { fadeStyle, isScrollable } = useScrollFade(scrollEl);
</script>
