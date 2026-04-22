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

<script setup lang="ts">
import { onMounted } from "vue";
import { f7 } from "framework7-vue";
import routes from "./js/routes.js";
import { initTheme } from "./js/theme.js";
import { t } from "./js/i18n.js";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapApp, type URLOpenListenerEvent } from "@capacitor/app";
import PwaUpdatePrompt from "./components/PwaUpdatePrompt.vue";
import DbUpdatePrompt from "./components/DbUpdatePrompt.vue";
import { searchQuery } from "./utils/search-state.js";

const isWeb = !Capacitor.isNativePlatform();

const f7params = {
  name: "Lexiklar",
  theme: "auto" as const,
  routes,
};

onMounted(() => {
  initTheme();
  SplashScreen.hide();

  // Deep link: switch to favorites tab if landing on /favorites/
  if (isWeb && window.location.pathname === "/favorites/") {
    f7.tab.show("#tab-favorites");
  }

  // Native deep links: lexiklar://word/nouns/Tisch/?section=grammar
  // Universal links: https://lexiklar.app/word/nouns/Tisch/?section=grammar
  // new URL() treats the first path segment as host for custom schemes, so strip manually.
  if (!isWeb) {
    CapApp.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
      let pathAndSearch: string;
      if (event.url.startsWith("https://lexiklar.app")) {
        const u = new URL(event.url);
        pathAndSearch = u.pathname + u.search;
      } else {
        pathAndSearch = event.url.replace(/^lexiklar:\/\/\/?/, "/");
      }
      const qIdx = pathAndSearch.indexOf("?");
      const path = qIdx >= 0 ? pathAndSearch.slice(0, qIdx) : pathAndSearch;
      const search = qIdx >= 0 ? pathAndSearch.slice(qIdx) : "";

      if (path === "/favorites/" || path === "/favorites") {
        f7.tab.show("#tab-favorites");
      } else if (path.startsWith("/word/") || path.startsWith("/search/")) {
        f7.tab.show("#tab-search");
        const view = f7.views.get("#tab-search");
        view?.router.navigate(path + search);
      }
    });
  }

  // Tap on already-active tab: go back if deep, or clear search if has query.
  // F7's touch handling suppresses click events on the tabbar on touch devices,
  // so we listen to touchend (with a tap guard) + click (for desktop).
  const tabbar = document.querySelector('.tabbar');
  let touchMoved = false;

  const handleTabReselect = (e: Event) => {
    const link = (e.target as HTMLElement).closest('.tab-link-active');
    if (!link) return;
    const viewId = link.getAttribute('data-tab');
    if (!viewId) return;
    const view = f7.views.get(viewId);
    if (!view?.router) return;

    if (view.router.history.length > 1) {
      view.router.back();
    } else if (viewId === '#tab-search' && searchQuery.value) {
      const sb = f7.searchbar.get('#tab-search .searchbar');
      sb?.clear();
      sb?.disable();
    }
  };

  tabbar?.addEventListener('touchstart', () => { touchMoved = false; });
  tabbar?.addEventListener('touchmove', () => { touchMoved = true; });
  tabbar?.addEventListener('touchend', (e) => {
    if (touchMoved) return;
    touchMoved = true; // block follow-up click on hybrid touch+mouse devices
    handleTabReselect(e);
  });
  tabbar?.addEventListener('click', (e) => {
    if (touchMoved) return;
    handleTabReselect(e);
  });
});
</script>
