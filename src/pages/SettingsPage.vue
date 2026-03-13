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
  </f7-page>
</template>

<script>
import { f7 } from "framework7-vue";
import { applyTheme, THEME_KEY } from "../js/theme.js";
import { t, setLocale, getLocale, LANGUAGE_KEY } from "../js/i18n.js";

const THEME_OPTIONS = [
  { value: "auto", labelKey: "settings.themeAuto" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

const LANG_OPTIONS = [
  { value: "auto", labelKey: "settings.langAuto" },
  { value: "en", labelKey: "settings.langEnglish" },
  { value: "de", labelKey: "settings.langGerman" },
];

export default {
  data() {
    return {
      theme: localStorage.getItem(THEME_KEY) || "auto",
      language: getLocale(),
      themeOptions: THEME_OPTIONS,
      langOptions: LANG_OPTIONS,
    };
  },
  computed: {
    t() { return t; },
  },
  methods: {
    setTheme(value) {
      this.theme = value;
      localStorage.setItem(THEME_KEY, value);
      applyTheme(value);
    },
    setLanguage(value) {
      this.language = value;
      setLocale(value);
    },
    confirmClear() {
      f7.dialog.confirm(
        t("settings.clearConfirmMsg"),
        t("settings.clearConfirmTitle"),
        () => {
          localStorage.removeItem("lexiklar_recents");
          localStorage.removeItem("lexiklar_view_counts");
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
          localStorage.removeItem("lexiklar_favorites");
          f7.toast
            .create({ text: t("settings.clearFavoritesDone"), closeTimeout: 2000, position: "center" })
            .open();
        },
      );
    },
  },
};
</script>
