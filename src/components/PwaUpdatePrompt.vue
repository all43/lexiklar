<template>
  <div v-if="needRefresh" class="pwa-update-toast">
    <span>{{ t('pwa.updateAvailable') }}</span>
    <button class="pwa-update-btn" @click="updateSW()">{{ t('pwa.reload') }}</button>
    <button class="pwa-update-dismiss" @click="close()">{{ t('pwa.dismiss') }}</button>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useRegisterSW } from "virtual:pwa-register/vue";
import { t } from "../js/i18n.js";

export default defineComponent({
  setup() {
    const { needRefresh, updateServiceWorker } = useRegisterSW();
    const show = ref(true);

    return {
      needRefresh: needRefresh,
      updateSW: () => updateServiceWorker(),
      close: () => { needRefresh.value = false; },
      t,
    };
  },
});
</script>

<style scoped>
.pwa-update-toast {
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

.pwa-update-toast span {
  flex: 1;
}

.pwa-update-btn {
  background: var(--f7-theme-color, #007aff);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.pwa-update-dismiss {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.7;
  font-size: 14px;
  cursor: pointer;
  padding: 6px 8px;
}
</style>
