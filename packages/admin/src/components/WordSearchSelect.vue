<template>
  <div class="wss" :class="{ open: showDropdown }">
    <input
      ref="inputEl"
      class="wss-input admin-text-input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.down.prevent="moveSelection(1)"
      @keydown.up.prevent="moveSelection(-1)"
      @keydown.enter.prevent="confirmSelection"
      @keydown.escape="close"
    />
    <div v-if="showDropdown && results.length" class="wss-dropdown">
      <div
        v-for="(r, i) in results"
        :key="r.pos + '/' + r.word"
        class="wss-option"
        :class="{ selected: i === selIndex }"
        @mousedown.prevent="pick(r)"
      >
        <span class="wss-word">{{ r.word }}</span>
        <span class="wss-pos">{{ r.pos }}</span>
        <span v-if="r.gloss_en" class="wss-gloss">{{ r.gloss_en }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

interface WordResult {
  pos: string;
  word: string;
  gloss_en?: string;
}

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "select", item: WordResult): void;
}>();

const inputEl = ref<HTMLInputElement | null>(null);
const results = ref<WordResult[]>([]);
const showDropdown = ref(false);
const selIndex = ref(-1);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  emit("update:modelValue", val);
  selIndex.value = -1;
  if (searchTimer) clearTimeout(searchTimer);
  if (val.length < 2) { results.value = []; return; }
  searchTimer = setTimeout(() => search(val), 200);
}

async function search(q: string) {
  try {
    const res = await fetch(`/api/search-words?q=${encodeURIComponent(q)}&limit=10`);
    results.value = await res.json();
    showDropdown.value = results.value.length > 0;
  } catch { results.value = []; }
}

function onFocus() {
  if (results.value.length) showDropdown.value = true;
}

function onBlur() {
  setTimeout(() => { showDropdown.value = false; }, 150);
}

function moveSelection(delta: number) {
  if (!results.value.length) return;
  selIndex.value = Math.max(-1, Math.min(results.value.length - 1, selIndex.value + delta));
}

function confirmSelection() {
  if (selIndex.value >= 0 && results.value[selIndex.value]) {
    pick(results.value[selIndex.value]);
  }
}

function pick(item: WordResult) {
  emit("update:modelValue", item.word);
  emit("select", item);
  showDropdown.value = false;
  results.value = [];
}

function close() {
  showDropdown.value = false;
}
</script>

<style scoped>
.wss {
  position: relative;
  display: inline-flex;
  flex: 1;
}
.wss-input { width: 100%; }
.wss-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid var(--admin-border-ui);
  border-radius: 0 0 6px 6px;
  box-shadow: var(--admin-shadow-md);
  max-height: 200px;
  overflow-y: auto;
  z-index: 100;
}
.wss-option {
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
}
.wss-option:hover, .wss-option.selected { background: var(--admin-primary-bg); }
.wss-word { font-weight: 600; }
.wss-pos { font-size: 0.7rem; color: var(--admin-text-muted); background: var(--admin-subtle); padding: 0 4px; border-radius: 4px; }
.wss-gloss { font-size: 0.7rem; color: var(--admin-text-secondary); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
