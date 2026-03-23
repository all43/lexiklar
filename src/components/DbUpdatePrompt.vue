<template>
  <div v-if="visible" class="db-update-toast">
    <template v-if="state === 'available'">
      <span>{{ t('dbUpdate.available') }}</span>
      <button class="db-update-btn" @click="applyNow()">{{ t('dbUpdate.update') }}</button>
      <button class="db-update-dismiss" @click="dismiss()">{{ t('dbUpdate.later') }}</button>
    </template>
    <template v-else-if="state === 'applying'">
      <span>{{ t('dbUpdate.applying') }}</span>
    </template>
    <template v-else-if="state === 'done'">
      <span>{{ t('dbUpdate.done') }}</span>
      <button class="db-update-btn" @click="reload()">{{ t('pwa.reload') }}</button>
    </template>
    <template v-else-if="state === 'error'">
      <span>{{ t('dbUpdate.failed') }}</span>
      <button class="db-update-dismiss" @click="dismiss()">OK</button>
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
    const dismissed = ref(false);

    const visible = computed(() => {
      if (dismissed.value) return false;
      return pendingDbUpdate.value !== null;
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
      const result = await applyUpdate(update);
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

    return { visible, state, applyNow, dismiss, reload, t };
  },
});
</script>

<style scoped>
.db-update-toast {
  position: fixed;
  bottom: calc(var(--f7-toolbar-height, 44px) + env(safe-area-inset-bottom, 0px) + 12px);
  left: 12px;
  right: 12px;
  background: var(--f7-bars-bg-color, #333);
  color: var(--f7-bars-text-color, #fff);
  padding: 12px 16px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 99999;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  font-size: 14px;
}

.db-update-toast span {
  flex: 1;
}

.db-update-btn {
  background: var(--f7-theme-color, #007aff);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.db-update-dismiss {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.7;
  font-size: 14px;
  cursor: pointer;
  padding: 6px 8px;
}
</style>
