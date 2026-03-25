<template>
  <div v-if="visible" class="update-toast">
    <template v-if="state === 'available'">
      <span>{{ t('dbUpdate.available') }}<span v-if="sizeLabel" class="update-toast-size"> ({{ sizeLabel }})</span></span>
      <button class="update-toast-btn" @click="applyNow()">{{ t('dbUpdate.update') }}</button>
      <button class="update-toast-dismiss" @click="dismiss()">{{ t('dbUpdate.later') }}</button>
    </template>
    <template v-else-if="state === 'applying'">
      <span style="flex: 1">
        {{ t('dbUpdate.applying') }}
        <f7-progressbar :progress="progress" />
      </span>
    </template>
    <template v-else-if="state === 'done'">
      <span>{{ t('dbUpdate.done') }}</span>
      <button class="update-toast-btn" @click="reload()">{{ t('pwa.reload') }}</button>
    </template>
    <template v-else-if="state === 'error'">
      <span>{{ t('dbUpdate.failed') }}</span>
      <button class="update-toast-dismiss" @click="dismiss()">OK</button>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch } from "vue";
import { pendingDbUpdate } from "../utils/db-update-state.js";
import { applyUpdate } from "../utils/db.js";
import { t } from "../js/i18n.js";

type State = "available" | "applying" | "done" | "error";

export default defineComponent({
  setup() {
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
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      state.value = "applying";
      progress.value = 0;
      const result = await applyUpdate(update, (loaded, total) => {
        progress.value = total ? Math.round((loaded / total) * 100) : 0;
      });
      if (result.ok) {
        state.value = "done";
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

    function reload() {
      window.location.reload();
    }

    return { visible, state, progress, sizeLabel, applyNow, dismiss, reload, t };
  },
});
</script>
