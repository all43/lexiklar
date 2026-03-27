<template>
  <f7-page name="settings">
    <f7-navbar :title="t('settings.title')" />

    <f7-block-title>{{ t('settings.appearance') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item
        v-for="opt in themeOptions"
        :key="opt.value"
        radio
        radio-icon="end"
        :title="t(opt.labelKey)"
        name="theme"
        :checked="theme === opt.value"
        @change="setTheme(opt.value)"
      />
    </f7-list>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item :title="t('settings.showArticles')">
        <template #after>
          <f7-toggle :checked="showArticles" @toggle:change="setShowArticles" />
        </template>
      </f7-list-item>
    </f7-list>
    <f7-block-footer class="padding-horizontal">
      {{ t('settings.showArticlesFooter') }}
    </f7-block-footer>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item :title="t('settings.condensedGrammar')">
        <template #after>
          <f7-toggle :checked="condensedGrammar" @toggle:change="setCondensedGrammar" />
        </template>
      </f7-list-item>
    </f7-list>
    <f7-block-footer class="padding-horizontal">
      {{ t('settings.condensedGrammarFooter') }}
    </f7-block-footer>

    <f7-block-title>{{ t('settings.searchBarPosition') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item
        v-for="opt in searchBarPositionOptions"
        :key="opt.value"
        radio
        radio-icon="end"
        :title="t(opt.labelKey)"
        name="search-bar-position"
        :checked="searchBarPosition === opt.value"
        @change="setSearchBarPosition(opt.value)"
      />
    </f7-list>

    <f7-block-title>{{ t('settings.language') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item
        v-for="opt in langOptions"
        :key="opt.value"
        radio
        radio-icon="end"
        :title="t(opt.labelKey)"
        name="language"
        :checked="language === opt.value"
        @change="setLanguage(opt.value)"
      />
    </f7-list>

    <f7-block-title>{{ t('settings.data') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-button :title="t('settings.clearHistory')" color="red" @click="confirmClear" />
      <f7-list-button :title="t('settings.clearFavorites')" color="red" @click="confirmClearFavorites" />
      <f7-list-button v-if="isWeb && dbCacheSize" color="red" @click="confirmClearCache">
        {{ t('settings.clearCache') }}
        <span class="text-color-gray"> ({{ formatSize(dbCacheSize) }})</span>
      </f7-list-button>
    </f7-list>
    <f7-block-footer class="padding-horizontal">
      {{ t('settings.clearFooter') }}
    </f7-block-footer>

    <f7-block-title>{{ t('settings.dataSources') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item external link="https://de.wiktionary.org/" target="_blank" title="German Wiktionary" after="CC BY-SA 4.0" />
      <f7-list-item external link="https://kaikki.org/" target="_blank" title="Kaikki.org" after="(extraction)" />
      <f7-list-item external link="https://wortschatz-leipzig.de/en" target="_blank" title="Leipzig Corpora" after="CC BY 4.0" />
      <f7-list-item external link="https://osf.io/2e64j/" target="_blank" title="SUBTLEX-DE" after="CC BY 4.0" />
      <f7-list-item external link="https://github.com/hermitdave/FrequencyWords" target="_blank" title="OpenSubtitles" after="CC BY 4.0" />
    </f7-list>
    <f7-block-footer class="padding-horizontal">
      {{ t('settings.dataSourcesFooter') }}
    </f7-block-footer>

    <f7-block-title>{{ t('settings.about') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item>
        <template #title>
          <f7-link external href="privacy.html" target="_blank">{{ t('settings.privacyPolicy') }}</f7-link>
        </template>
      </f7-list-item>
      <f7-list-item
        :title="t('settings.dictionaryVersion')"
        :after="dbVersionDisplay"
      />
      <f7-list-item
        :title="t('settings.appVersion')"
        :after="appVersion"
      />
      <f7-list-item :title="t('settings.autoCheckUpdates')">
        <template #after>
          <f7-toggle :checked="autoCheckUpdates" @toggle:change="setAutoCheckUpdates" />
        </template>
      </f7-list-item>
      <f7-list-item v-if="updateState === 'idle'">
        <template #title>
          <f7-link @click="checkUpdates">{{ t('settings.checkUpdates') }}</f7-link>
        </template>
      </f7-list-item>
      <f7-list-item v-else-if="updateState === 'checking'" :title="t('settings.checking')" />
      <f7-list-item v-else-if="updateState === 'up-to-date'" :title="t('settings.upToDate')" />
      <f7-list-item v-else-if="updateState === 'available'">
        <template #title>
          <f7-link @click="applyUpdate">
            {{ t('settings.updateAvailable') }}
            <span v-if="updateInfo" class="text-color-gray"> {{ formatSize(updateInfo.size) }}</span>
          </f7-link>
        </template>
      </f7-list-item>
      <f7-list-item v-else-if="updateState === 'downloading'" :title="t('settings.downloading')" />
      <f7-list-item v-else-if="updateState === 'applying'" :title="t('settings.applying')" />
      <f7-list-item v-else-if="updateState === 'done'">
        <template #title>
          <f7-link @click="reloadApp">{{ t('settings.updateReload') }}</f7-link>
        </template>
      </f7-list-item>
      <f7-list-item v-else-if="updateState === 'error'" :title="t('settings.updateFailed')" />
      <f7-list-item v-if="appUpdateState === 'available'">
        <template #title>
          <f7-link @click="downloadAppUpdate">{{ t('settings.appUpdateAvailable') }}</f7-link>
        </template>
      </f7-list-item>
      <f7-list-item v-else-if="appUpdateState === 'downloading'" :title="t('settings.appUpdateDownloading')" />
      <f7-list-item v-else-if="appUpdateState === 'ready'">
        <template #title>
          <f7-link @click="restartApp">{{ t('settings.appUpdateRestart') }}</f7-link>
        </template>
      </f7-list-item>
      <f7-list-item v-else-if="appUpdateState === 'error'" :title="t('settings.updateFailed')" />
    </f7-list>
  </f7-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { f7 } from "framework7-vue";
import { applyTheme, THEME_KEY, type ThemeValue } from "../js/theme.js";
import { t, setLocale, getLocale, LANGUAGE_KEY, type LanguagePreference } from "../js/i18n.js";
import { getCached, setItem, removeItem } from "../utils/storage.js";
import { Capacitor } from "@capacitor/core";
import { getDbVersion, checkForUpdates, applyUpdate as applyDbUpdate, cacheClear, cacheSize, type UpdateInfo } from "../utils/db.js";
import { dbReady, dbDownloadNeeded } from "../utils/db-update-state.js";
import { pendingAppUpdate, downloadAndApplyAppUpdate, reloadApp as liveReloadApp, type AppUpdateInfo } from "../utils/live-update.js";

const THEME_OPTIONS = [
  { value: "auto" as const, labelKey: "settings.themeAuto" },
  { value: "light" as const, labelKey: "settings.themeLight" },
  { value: "dark" as const, labelKey: "settings.themeDark" },
];

const LANG_OPTIONS = [
  { value: "auto" as const, labelKey: "settings.langAuto" },
  { value: "en" as const, labelKey: "settings.langEnglish" },
  { value: "de" as const, labelKey: "settings.langGerman" },
];

const SEARCH_BAR_POSITION_OPTIONS = [
  { value: "auto" as const, labelKey: "settings.searchBarAuto" },
  { value: "top" as const, labelKey: "settings.searchBarTop" },
  { value: "bottom" as const, labelKey: "settings.searchBarBottom" },
];

export const SHOW_ARTICLES_KEY = "lexiklar_show_articles";
export const CONDENSED_GRAMMAR_KEY = "lexiklar_condensed_grammar";
export const SEARCH_BAR_POSITION_KEY = "lexiklar_search_position";
export const AUTO_CHECK_UPDATES_KEY = "lexiklar_auto_check_updates";
export type SearchBarPosition = "auto" | "top" | "bottom";

type UpdateState = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "applying" | "done" | "error";

export default defineComponent({
  data() {
    return {
      theme: getCached(THEME_KEY) || "auto",
      language: getLocale(),
      themeOptions: THEME_OPTIONS,
      langOptions: LANG_OPTIONS,
      searchBarPositionOptions: SEARCH_BAR_POSITION_OPTIONS,
      searchBarPosition: (getCached(SEARCH_BAR_POSITION_KEY) || "auto") as SearchBarPosition,
      showArticles: getCached(SHOW_ARTICLES_KEY) !== "0",
      condensedGrammar: getCached(CONDENSED_GRAMMAR_KEY) === "1",
      autoCheckUpdates: getCached(AUTO_CHECK_UPDATES_KEY) !== "0",
      dbVersion: null as string | null,
      dbBuiltAt: null as string | null,
      updateState: "idle" as UpdateState,
      updateInfo: null as UpdateInfo | null,
      appVersion: __APP_VERSION__,
      appUpdateState: "idle" as "idle" | "available" | "downloading" | "ready" | "error",
      isWeb: !Capacitor.isNativePlatform(),
      dbCacheSize: null as number | null,
    };
  },
  computed: {
    t() { return t; },
    dbVersionDisplay(): string {
      if (!this.dbVersion) return "...";
      const hash = this.dbVersion.slice(0, 8);
      const date = this.dbBuiltAt || "";
      return date ? `${hash} \u00B7 ${date}` : hash;
    },
  },
  async mounted() {
    this.loadDbVersion();
    if (this.isWeb) {
      cacheSize().then((size) => { this.dbCacheSize = size; });
    }
    // Re-fetch version when DB becomes ready (e.g. after initial download)
    this.$watch(() => dbReady.value, (ready) => {
      if (ready) this.loadDbVersion();
    });
    // Check if an app update was detected at startup
    if (pendingAppUpdate.value?.available) {
      this.appUpdateState = "available";
    }
  },
  methods: {
    async loadDbVersion() {
      try {
        const { version, builtAt } = await getDbVersion();
        this.dbVersion = version;
        this.dbBuiltAt = builtAt;
      } catch {
        // DB not ready yet
      }
    },
    formatSize(bytes: number | undefined): string {
      if (!bytes) return "";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    },
    async checkUpdates() {
      this.updateState = "checking";
      const result = await checkForUpdates();
      if (!result) {
        this.updateState = "error";
        setTimeout(() => { this.updateState = "idle"; }, 3000);
        return;
      }
      if (!result.available) {
        this.updateState = "up-to-date";
        setTimeout(() => { this.updateState = "idle"; }, 3000);
        return;
      }
      this.updateInfo = result;
      this.updateState = "available";
    },
    async applyUpdate() {
      if (!this.updateInfo) return;
      this.updateState = "downloading";
      const result = await applyDbUpdate(this.updateInfo, undefined, () => {
        this.updateState = "applying";
      });
      if (result.ok) {
        this.dbVersion = this.updateInfo.targetVersion || null;
        this.dbBuiltAt = this.updateInfo.builtAt || null;
        this.updateState = "done";
        f7.toast.create({ text: t("settings.updateDone"), closeTimeout: 2000, position: "center" }).open();
      } else {
        this.updateState = "error";
        f7.toast.create({ text: `${t("settings.updateFailed")}: ${result.error}`, closeTimeout: 3000, position: "center" }).open();
        setTimeout(() => { this.updateState = "idle"; }, 3000);
      }
    },
    reloadApp() {
      window.location.reload();
    },
    async downloadAppUpdate() {
      const info = pendingAppUpdate.value;
      if (!info) return;
      this.appUpdateState = "downloading";
      const result = await downloadAndApplyAppUpdate(info);
      if (result.ok) {
        this.appUpdateState = "ready";
      } else {
        this.appUpdateState = "error";
        f7.toast.create({ text: `${t("settings.updateFailed")}: ${result.error}`, closeTimeout: 3000, position: "center" }).open();
        setTimeout(() => { this.appUpdateState = "idle"; }, 3000);
      }
    },
    async restartApp() {
      await liveReloadApp();
    },
    setTheme(value: ThemeValue) {
      this.theme = value;
      setItem(THEME_KEY, value);
      applyTheme(value);
    },
    setLanguage(value: LanguagePreference) {
      this.language = value;
      setLocale(value);
    },
    setShowArticles(value: boolean) {
      this.showArticles = value;
      setItem(SHOW_ARTICLES_KEY, value ? "1" : "0");
    },
    setCondensedGrammar(value: boolean) {
      this.condensedGrammar = value;
      setItem(CONDENSED_GRAMMAR_KEY, value ? "1" : "0");
    },
    setSearchBarPosition(value: SearchBarPosition) {
      this.searchBarPosition = value;
      setItem(SEARCH_BAR_POSITION_KEY, value);
    },
    setAutoCheckUpdates(value: boolean) {
      this.autoCheckUpdates = value;
      setItem(AUTO_CHECK_UPDATES_KEY, value ? "1" : "0");
    },
    confirmClear() {
      f7.dialog.confirm(
        t("settings.clearConfirmMsg"),
        t("settings.clearConfirmTitle"),
        () => {
          removeItem("lexiklar_recents");
          removeItem("lexiklar_view_counts");
          removeItem("lexiklar_phrase_terms");
          f7.toast
            .create({ text: t("settings.clearDone"), closeTimeout: 2000, position: "center" })
            .open();
        },
      );
    },
    confirmClearFavorites() {
      f7.dialog.confirm(
        t("settings.clearFavoritesMsg"),
        t("settings.clearFavoritesTitle"),
        () => {
          removeItem("lexiklar_favorites");
          f7.toast
            .create({ text: t("settings.clearFavoritesDone"), closeTimeout: 2000, position: "center" })
            .open();
        },
      );
    },
    confirmClearCache() {
      f7.dialog.confirm(
        t("settings.clearCacheMsg"),
        t("settings.clearCacheTitle"),
        async () => {
          await cacheClear();
          dbReady.value = false;
          dbDownloadNeeded.value = true;
          this.dbVersion = null;
          this.dbBuiltAt = null;
          this.dbCacheSize = null;
          f7.toast
            .create({ text: t("settings.clearCacheDone"), closeTimeout: 2000, position: "center" })
            .open();
        },
      );
    },
  },
});
</script>
