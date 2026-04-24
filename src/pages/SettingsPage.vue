<template>
  <f7-page name="settings">
    <f7-navbar :title="t('settings.title')" />

    <f7-list inset strong-ios outline-ios>
      <f7-list-item @click="openGrammar" link="#" :title="t('settings.grammarReference')" />
    </f7-list>

    <f7-block-title>{{ t('settings.appearance') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item
        v-for="opt in THEME_OPTIONS"
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
    <f7-list inset strong-ios outline-ios>
      <f7-list-item :title="t('settings.showGrammarTags')">
        <template #after>
          <f7-toggle :checked="showGrammarTags" @toggle:change="setShowGrammarTags" />
        </template>
      </f7-list-item>
    </f7-list>
    <f7-block-footer class="padding-horizontal">
      {{ t('settings.showGrammarTagsFooter') }}
    </f7-block-footer>

    <f7-block-title>{{ t('settings.searchBarPosition') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item
        v-for="opt in SEARCH_BAR_POSITION_OPTIONS"
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
        v-for="opt in LANG_OPTIONS"
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
      <f7-list-item v-if="updateState === 'idle'" link @click="checkUpdates" :title="t('settings.checkUpdates')" />
      <f7-list-item v-else-if="updateState === 'checking'" :title="t('settings.checking')" />
      <f7-list-item v-else-if="updateState === 'up-to-date'" :title="t('settings.upToDate')" />
      <f7-list-item v-else-if="updateState === 'available'" link @click="applyUpdate">
        <template #title>
          {{ updateInfo?.type === 'full' ? t('settings.updateAvailableFull') : t('settings.updateAvailable') }}
          <span v-if="updateInfo?.size" class="text-color-gray">&nbsp;{{ formatSize(updateInfo.size) }}</span>
        </template>
      </f7-list-item>
      <f7-list-item v-else-if="updateState === 'downloading'">
        <template #title>
          <span>{{ t('settings.downloading') }}<span v-if="updateProgress > 0" class="text-color-gray">&nbsp;{{ updateProgress }}%</span></span>
        </template>
      </f7-list-item>
      <f7-list-item v-else-if="updateState === 'applying'" :title="t('settings.applying')" />
      <f7-list-item v-else-if="updateState === 'done'" :title="t('settings.updateDone')" />
      <f7-list-item v-else-if="updateState === 'error'" :title="t('settings.updateFailed')" />
      <f7-list-item v-if="appUpdateState === 'available'" link @click="downloadAppUpdate" :title="t('settings.appUpdateAvailable')" />
      <f7-list-item v-else-if="appUpdateState === 'downloading'" :title="t('settings.appUpdateDownloading')" />
      <f7-list-item v-else-if="appUpdateState === 'ready'" link @click="restartApp" :title="t('settings.appUpdateRestart')" />
      <f7-list-item v-else-if="appUpdateState === 'error'" :title="t('settings.updateFailed')" />
    </f7-list>
  </f7-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { f7 } from "framework7-vue";
import { applyTheme, THEME_KEY, type ThemeValue } from "../js/theme.js";
import { t, setLocale, getLocale, LANGUAGE_KEY, type LanguagePreference } from "../js/i18n.js";
import { getCached, setItem, removeItem, SHOW_ARTICLES_KEY, CONDENSED_GRAMMAR_KEY, SEARCH_BAR_POSITION_KEY, AUTO_CHECK_UPDATES_KEY, SHOW_GRAMMAR_TAGS_KEY, type SearchBarPosition } from "../utils/storage.js";
import { Capacitor } from "@capacitor/core";
import { getDbVersion, checkForUpdates, applyUpdate as applyDbUpdate, cacheClear, cacheSize, type UpdateInfo } from "../utils/db.js";
import { dbReady, dbDownloadNeeded } from "../utils/db-update-state.js";
import { pendingAppUpdate, checkAppUpdate, downloadAndApplyAppUpdate, reloadApp as liveReloadApp, type AppUpdateInfo } from "../utils/live-update.js";
import { BYTES_PER_KB, BYTES_PER_MB, FILE_SIZE_DECIMAL_PLACES } from "../utils/ui-constants.js";
import { TOAST_AUTO_DISMISS_MS } from "../utils/time-constants.js";

function openGrammar() {
  f7.tab.show("#tab-search");
  f7.views.get("#tab-search")?.router.navigate("/grammar/");
}

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

type UpdateState = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "applying" | "done" | "error";

const theme = ref(getCached(THEME_KEY) || "auto");
const language = ref(getLocale());
const searchBarPosition = ref<SearchBarPosition>((getCached(SEARCH_BAR_POSITION_KEY) || "auto") as SearchBarPosition);
const showArticles = ref(getCached(SHOW_ARTICLES_KEY) !== "0");
const condensedGrammar = ref(getCached(CONDENSED_GRAMMAR_KEY) === "1");
const showGrammarTags = ref(getCached(SHOW_GRAMMAR_TAGS_KEY) === "1");
const autoCheckUpdates = ref(getCached(AUTO_CHECK_UPDATES_KEY) !== "0");
const dbVersion = ref<string | null>(null);
const dbBuiltAt = ref<string | null>(null);
const updateState = ref<UpdateState>("idle");
const updateInfo = ref<UpdateInfo | null>(null);
const updateProgress = ref(0);
const appVersion = __APP_VERSION__;
const appUpdateState = ref<"idle" | "available" | "downloading" | "ready" | "error">("idle");
const isWeb = !Capacitor.isNativePlatform();
const dbCacheSize = ref<number | null>(null);

const dbVersionDisplay = computed(() => {
  if (!dbVersion.value) return "...";
  const hash = dbVersion.value.slice(0, 8);
  const date = dbBuiltAt.value?.slice(0, 10) || "";
  return date ? `${hash} \u00B7 ${date}` : hash;
});

async function loadDbVersion() {
  try {
    const info = await getDbVersion();
    dbVersion.value = info.version;
    dbBuiltAt.value = info.builtAt;
  } catch {
    // DB not ready yet
  }
}

function formatSize(bytes: number | undefined | null): string {
  if (!bytes) return "";
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(0)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(FILE_SIZE_DECIMAL_PLACES)} MB`;
}

async function checkUpdates() {
  updateState.value = "checking";

  let dbResult: Awaited<ReturnType<typeof checkForUpdates>> = null;
  let appResult: Awaited<ReturnType<typeof checkAppUpdate>> = null;
  try {
    const results = await Promise.race([
      Promise.all([checkForUpdates(), checkAppUpdate()]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);
    [dbResult, appResult] = results;
  } catch {
    updateState.value = "error";
    f7.toast.create({ text: t("settings.updateFailed"), closeTimeout: TOAST_AUTO_DISMISS_MS, position: "center" }).open();
    setTimeout(() => { updateState.value = "idle"; }, TOAST_AUTO_DISMISS_MS);
    return;
  }

  // Handle app update result
  if (appResult?.available) {
    pendingAppUpdate.value = appResult;
    appUpdateState.value = "available";
  }

  // Handle DB update result
  if (!dbResult) {
    if (!appResult?.available) {
      updateState.value = "error";
      f7.toast.create({ text: t("settings.updateFailed"), closeTimeout: TOAST_AUTO_DISMISS_MS, position: "center" }).open();
      setTimeout(() => { updateState.value = "idle"; }, TOAST_AUTO_DISMISS_MS);
    } else {
      updateState.value = "idle";
    }
    return;
  }
  if (!dbResult.available) {
    updateState.value = appResult?.available ? "idle" : "up-to-date";
    if (!appResult?.available) setTimeout(() => { updateState.value = "idle"; }, TOAST_AUTO_DISMISS_MS);
    return;
  }
  updateInfo.value = dbResult;
  updateState.value = "available";
}

async function applyUpdate() {
  if (!updateInfo.value) return;
  updateState.value = "downloading";
  updateProgress.value = 0;
  const result = await applyDbUpdate(updateInfo.value, (loaded, total) => {
    updateProgress.value = total ? Math.round((loaded / total) * 100) : 0;
  }, () => {
    updateState.value = "applying";
  });
  if (result.ok) {
    dbVersion.value = updateInfo.value.targetVersion || null;
    dbBuiltAt.value = updateInfo.value.builtAt || null;
    updateState.value = "done";
    f7.toast.create({ text: t("settings.updateDone"), closeTimeout: 2000, position: "center" }).open();
  } else {
    updateState.value = "error";
    f7.toast.create({ text: `${t("settings.updateFailed")}: ${result.error}`, closeTimeout: TOAST_AUTO_DISMISS_MS, position: "center" }).open();
    setTimeout(() => { updateState.value = "idle"; }, TOAST_AUTO_DISMISS_MS);
  }
}

async function downloadAppUpdate() {
  const info = pendingAppUpdate.value;
  if (!info) return;
  appUpdateState.value = "downloading";
  const result = await downloadAndApplyAppUpdate(info);
  if (result.ok) {
    appUpdateState.value = "ready";
  } else {
    appUpdateState.value = "error";
    f7.toast.create({ text: `${t("settings.updateFailed")}: ${result.error}`, closeTimeout: TOAST_AUTO_DISMISS_MS, position: "center" }).open();
    setTimeout(() => { appUpdateState.value = "idle"; }, TOAST_AUTO_DISMISS_MS);
  }
}

async function restartApp() {
  await liveReloadApp();
}

function setTheme(value: ThemeValue) {
  theme.value = value;
  setItem(THEME_KEY, value);
  applyTheme(value);
}

function setLanguage(value: LanguagePreference) {
  language.value = value;
  setLocale(value);
}

function setShowArticles(value: boolean) {
  showArticles.value = value;
  setItem(SHOW_ARTICLES_KEY, value ? "1" : "0");
}

function setCondensedGrammar(value: boolean) {
  condensedGrammar.value = value;
  setItem(CONDENSED_GRAMMAR_KEY, value ? "1" : "0");
}

function setShowGrammarTags(value: boolean) {
  showGrammarTags.value = value;
  setItem(SHOW_GRAMMAR_TAGS_KEY, value ? "1" : "0");
}

function setSearchBarPosition(value: SearchBarPosition) {
  searchBarPosition.value = value;
  setItem(SEARCH_BAR_POSITION_KEY, value);
}

function setAutoCheckUpdates(value: boolean) {
  autoCheckUpdates.value = value;
  setItem(AUTO_CHECK_UPDATES_KEY, value ? "1" : "0");
}

function confirmClear() {
  f7.dialog.confirm(
    t("settings.clearConfirmMsg"),
    t("settings.clearConfirmTitle"),
    () => {
      removeItem("lexiklar_recents");
      removeItem("lexiklar_view_counts");
      removeItem("lexiklar_phrase_terms");
      f7.toast.create({ text: t("settings.clearDone"), closeTimeout: 2000, position: "center" }).open();
    },
  );
}

function confirmClearFavorites() {
  f7.dialog.confirm(
    t("settings.clearFavoritesMsg"),
    t("settings.clearFavoritesTitle"),
    () => {
      removeItem("lexiklar_favorites");
      f7.toast.create({ text: t("settings.clearFavoritesDone"), closeTimeout: 2000, position: "center" }).open();
    },
  );
}

function confirmClearCache() {
  f7.dialog.confirm(
    t("settings.clearCacheMsg"),
    t("settings.clearCacheTitle"),
    async () => {
      await cacheClear();
      dbReady.value = false;
      dbDownloadNeeded.value = true;
      dbVersion.value = null;
      dbBuiltAt.value = null;
      dbCacheSize.value = null;
      f7.toast.create({ text: t("settings.clearCacheDone"), closeTimeout: 2000, position: "center" }).open();
    },
  );
}

// Re-fetch version when DB becomes ready (e.g. after initial download)
watch(dbReady, (ready) => {
  if (ready) loadDbVersion();
});

onMounted(() => {
  loadDbVersion();
  if (isWeb) {
    cacheSize().then((size) => { dbCacheSize.value = size; });
  }
  if (pendingAppUpdate.value?.available) {
    appUpdateState.value = "available";
  }
});
</script>
