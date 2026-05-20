<template>
  <div v-if="visible" class="update-toast">
    <template v-if="state === 'available'">
      <span>{{ t('appUpdate.available') }}<span v-if="sizeLabel" class="update-toast-size"> ({{ sizeLabel }})</span></span>
      <button class="update-toast-btn" @click="download()">{{ t('appUpdate.download') }}</button>
      <button class="update-toast-dismiss" @click="dismiss()">{{ t('appUpdate.later') }}</button>
    </template>
    <template v-else-if="state === 'downloading'">
      <span style="flex: 1">
        {{ t('appUpdate.downloading') }}
        <f7-progressbar :progress="-1" />
      </span>
    </template>
    <template v-else-if="state === 'ready'">
      <span>{{ t('appUpdate.ready') }}</span>
      <button class="update-toast-btn" @click="restart()">{{ t('appUpdate.restart') }}</button>
      <button class="update-toast-dismiss" @click="dismiss()">{{ t('appUpdate.later') }}</button>
    </template>
    <template v-else-if="state === 'error'">
      <span>{{ t('appUpdate.failed') }}</span>
      <button class="update-toast-dismiss" @click="dismiss()">OK</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { pendingAppUpdate, downloadAndApplyAppUpdate, reloadApp } from "../utils/live-update.js";
import { t } from "../js/i18n.js";
import { BYTES_PER_KB, BYTES_PER_MB, FILE_SIZE_DECIMAL_PLACES } from "../utils/ui-constants.js";

type State = "available" | "downloading" | "ready" | "error";

const state = ref<State>("available");
const dismissed = ref(false);

const visible = computed(() => {
  if (dismissed.value) return false;
  return pendingAppUpdate.value?.available === true;
});

const sizeLabel = computed(() => {
  const bytes = pendingAppUpdate.value?.size;
  if (!bytes) return "";
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(0)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(FILE_SIZE_DECIMAL_PLACES)} MB`;
});

watch(pendingAppUpdate, (val) => {
  if (val?.available) {
    state.value = "available";
    dismissed.value = false;
  }
});

async function download() {
  const info = pendingAppUpdate.value;
  if (!info) return;
  state.value = "downloading";
  const result = await downloadAndApplyAppUpdate(info);
  if (result.ok) {
    state.value = "ready";
  } else {
    state.value = "error";
  }
}

async function restart() {
  await reloadApp();
}

function dismiss() {
  dismissed.value = true;
}
</script>
