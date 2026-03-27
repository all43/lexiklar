<template>
  <f7-app v-bind="f7params">
    <PwaUpdatePrompt v-if="isWeb" />
    <DbUpdatePrompt />

    <f7-views tabs>
      <!-- Tabbar at the bottom -->
      <f7-toolbar tabbar icons bottom>
        <f7-toolbar-pane>
          <f7-link tab-link="#tab-search" tab-link-active icon-f7="search" :text="t('tab.search')" />
          <f7-link tab-link="#tab-favorites" icon-f7="star" :text="t('tab.favorites')" />
          <f7-link tab-link="#tab-settings" icon-f7="gear" :text="t('tab.settings')" />
        </f7-toolbar-pane>
      </f7-toolbar>

      <!-- Tab views — each has its own navigation stack -->
      <!-- browserHistory only on web: capacitor://localhost scheme breaks F7's history detection -->
      <f7-view id="tab-search" tab tab-active url="/" main :animate="true"
        v-bind="isWeb ? { browserHistory: true, browserHistoryInitialMatch: true, browserHistorySeparator: '' } : {}" />
      <f7-view id="tab-favorites" tab url="/favorites/" :animate="true" />
      <f7-view id="tab-settings" tab url="/settings/" :animate="true" />
    </f7-views>

  </f7-app>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import routes from "./js/routes.js";
import { initTheme } from "./js/theme.js";
import { t } from "./js/i18n.js";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from '@capacitor/splash-screen';
import PwaUpdatePrompt from "./components/PwaUpdatePrompt.vue";
import DbUpdatePrompt from "./components/DbUpdatePrompt.vue";
import { dbReady } from "./utils/db-update-state.js";

export default defineComponent({
  components: { PwaUpdatePrompt, DbUpdatePrompt },
  data() {
    return {
      isWeb: !Capacitor.isNativePlatform(),
      f7params: {
        name: "Lexiklar",
        theme: "auto" as const,
        routes,
      },
    };
  },
  computed: {
    t() { return t; },
    dbIsReady() { return dbReady.value; },
  },
  mounted() {
    initTheme();
    // hide splash screen
    SplashScreen.hide();
  },
});
</script>
