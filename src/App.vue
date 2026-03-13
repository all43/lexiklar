<template>
  <f7-app v-bind="f7params">

    <f7-views tabs>
      <!-- Tabbar at the bottom -->
      <f7-toolbar tabbar icons bottom>
        <f7-link tab-link="#tab-search" tab-link-active icon-f7="search" :text="t('tab.search')" />
        <f7-link tab-link="#tab-favorites" icon-f7="star" :text="t('tab.favorites')" />
        <f7-link tab-link="#tab-settings" icon-f7="gear" :text="t('tab.settings')" />
      </f7-toolbar>

      <!-- Tab views — each has its own navigation stack -->
      <!-- browser-history-initial-match only on the main view; applying it globally breaks tab switching -->
      <f7-view id="tab-search" tab tab-active url="/" main :animate="true"
        browser-history browser-history-initial-match browser-history-separator="" />
      <f7-view id="tab-favorites" tab url="/favorites/" :animate="true" />
      <f7-view id="tab-settings" tab url="/settings/" :animate="true" />
    </f7-views>

  </f7-app>
</template>

<script>
import routes from "./js/routes.js";
import { initTheme } from "./js/theme.js";
import { t } from "./js/i18n.js";

export default {
  data() {
    return {
      f7params: {
        name: "Lexiklar",
        theme: "auto",
        routes,
      },
    };
  },
  computed: {
    t() { return t; },
  },
  mounted() {
    initTheme();
  },
};
</script>
