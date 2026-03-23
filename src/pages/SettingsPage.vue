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
    </f7-list>
    <f7-block-footer class="padding-horizontal">
      {{ t('settings.clearFooter') }}
    </f7-block-footer>

    <f7-block-title>{{ t('settings.dataSources') }}</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item title="German Wiktionary (via Kaikki.org)" after="CC BY-SA 4.0" />
      <f7-list-item title="Leipzig Corpora" after="CC BY 4.0" />
      <f7-list-item title="SUBTLEX-DE" after="CC BY 4.0" />
      <f7-list-item title="OpenSubtitles" after="CC BY 4.0" />
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
    </f7-list>
  </f7-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { f7 } from "framework7-vue";
import { applyTheme, THEME_KEY, type ThemeValue } from "../js/theme.js";
import { t, setLocale, getLocale, LANGUAGE_KEY, type LanguagePreference } from "../js/i18n.js";
import { getCached, setItem, removeItem } from "../utils/storage.js";
import { getDbVersion, checkForUpdates, applyUpdate as applyDbUpdate, type UpdateInfo } from "../utils/db.js";

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

export const SHOW_ARTICLES_KEY = "lexiklar_show_articles";

type UpdateState = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "applying" | "done" | "error";

export default defineComponent({
  data() {
    return {
      theme: getCached(THEME_KEY) || "auto",
      language: getLocale(),
      themeOptions: THEME_OPTIONS,
      langOptions: LANG_OPTIONS,
      showArticles: getCached(SHOW_ARTICLES_KEY) !== "0",
      dbVersion: null as string | null,
      dbBuiltAt: null as string | null,
      updateState: "idle" as UpdateState,
      updateInfo: null as UpdateInfo | null,
      appVersion: __APP_VERSION__,
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
    try {
      const { version, builtAt } = await getDbVersion();
      this.dbVersion = version;
      this.dbBuiltAt = builtAt;
    } catch {
      // DB not ready yet
    }
  },
  methods: {
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
      this.updateState = this.updateInfo.type === "patch" ? "applying" : "downloading";
      const result = await applyDbUpdate(this.updateInfo);
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
  },
});
</script>
