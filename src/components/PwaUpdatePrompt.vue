<template>
  <div v-if="needRefresh" class="update-toast">
    <span>{{ t('pwa.updateAvailable') }}</span>
    <button class="update-toast-btn" @click="updateSW()">{{ t('pwa.reload') }}</button>
    <button class="update-toast-dismiss" @click="close()">{{ t('pwa.dismiss') }}</button>
  </div>
</template>

<script lang="ts">
import { defineComponent, watch } from "vue";
import { useRegisterSW } from "virtual:pwa-register/vue";
import { t } from "../js/i18n.js";
import { swUpdatePending } from "../utils/db-update-state.js";

export default defineComponent({
  setup() {
    const { needRefresh, updateServiceWorker } = useRegisterSW();

    // Sync to shared state so SearchPage can suppress DB download prompt
    watch(needRefresh, (v) => { swUpdatePending.value = v; }, { immediate: true });

    return {
      needRefresh,
      updateSW: () => updateServiceWorker(),
      close: () => { needRefresh.value = false; },
      t,
    };
  },
});
</script>
