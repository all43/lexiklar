<template>
  <div v-if="visible" class="update-toast">
    <template v-if="state === 'available'">
      <span>{{ t('dbUpdate.available') }}<span v-if="sizeLabel" class="update-toast-size"> ({{ sizeLabel }})</span></span>
      <button class="update-toast-btn" @click="applyNow()">{{ t('dbUpdate.update') }}</button>
      <button class="update-toast-dismiss" @click="dismiss()">{{ t('dbUpdate.later') }}</button>
    </template>
    <template v-else-if="state === 'downloading'">
      <span style="flex: 1">
        {{ t('dbUpdate.downloading') }}
        <f7-progressbar :progress="progress" />
      </span>
    </template>
    <template v-else-if="state === 'applying'">
      <span style="flex: 1">
        {{ t('dbUpdate.applying') }}
        <f7-progressbar :progress="-1" />
      </span>
    </template>
    <template v-else-if="state === 'done'">
      <span>{{ t('dbUpdate.done') }}</span>
      <button class="update-toast-dismiss" @click="dismiss()">OK</button>
    </template>
    <template v-else-if="state === 'error'">
      <span>{{ t('dbUpdate.failed') }}</span>
      <button class="update-toast-dismiss" @click="dismiss()">OK</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { pendingDbUpdate } from "../utils/db-update-state.js";
import { applyUpdate } from "../utils/db.js";
import { t } from "../js/i18n.js";
import { BYTES_PER_KB, BYTES_PER_MB, FILE_SIZE_DECIMAL_PLACES } from "../utils/ui-constants.js";
import { TOAST_AUTO_DISMISS_MS } from "../utils/time-constants.js";

type State = "available" | "downloading" | "applying" | "done" | "error";

const state = ref<State>("available");
const progress = ref(0);
const dismissed = ref(false);

const visible = computed(() => {
  if (dismissed.value) return false;
  return pendingDbUpdate.value !== null;
});

const sizeLabel = computed(() => {
  const bytes = pendingDbUpdate.value?.size;
  if (!bytes) return "";
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(0)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(FILE_SIZE_DECIMAL_PLACES)} MB`;
});

// Reset state when a new update becomes available
watch(pendingDbUpdate, (val) => {
  if (val) {
    state.value = "available";
    dismissed.value = false;
  }
});

async function applyNow() {
  const update = pendingDbUpdate.value;
  if (!update) return;
  state.value = "downloading";
  progress.value = 0;
  const result = await applyUpdate(update, (loaded, total) => {
    progress.value = total ? Math.round((loaded / total) * 100) : 0;
  }, () => {
    // Called when download is done, before applying
    state.value = "applying";
  });
  if (result.ok) {
    state.value = "done";
    pendingDbUpdate.value = null;
    setTimeout(() => { dismissed.value = true; }, TOAST_AUTO_DISMISS_MS);
  } else {
    state.value = "error";
  }
}

function dismiss() {
  dismissed.value = true;
  if (state.value === "error") {
    pendingDbUpdate.value = null;
  }
}
</script>
