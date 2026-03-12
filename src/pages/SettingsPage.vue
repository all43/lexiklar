<template>
  <f7-page name="settings">
    <f7-navbar title="Settings" />

    <f7-block-title>Appearance</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-item
        v-for="opt in themeOptions"
        :key="opt.value"
        radio
        radio-icon="end"
        :title="opt.label"
        name="theme"
        :checked="theme === opt.value"
        @change="setTheme(opt.value)"
      />
    </f7-list>

    <f7-block-title>Data</f7-block-title>
    <f7-list inset strong-ios outline-ios>
      <f7-list-button title="Clear History" color="red" @click="confirmClear" />
    </f7-list>
    <f7-block-footer class="padding-horizontal">
      Removes all recently visited and frequently viewed words from the home screen.
    </f7-block-footer>
  </f7-page>
</template>

<script>
import { f7 } from "framework7-vue";
import { applyTheme, THEME_KEY } from "../js/theme.js";

const THEME_OPTIONS = [
  { value: "auto", label: "Auto (System)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default {
  data() {
    return {
      theme: localStorage.getItem(THEME_KEY) || "auto",
      themeOptions: THEME_OPTIONS,
    };
  },
  methods: {
    setTheme(value) {
      this.theme = value;
      localStorage.setItem(THEME_KEY, value);
      applyTheme(value);
    },
    confirmClear() {
      f7.dialog.confirm(
        "Clear all viewing history? This cannot be undone.",
        "Clear History",
        () => {
          localStorage.removeItem("lexiklar_recents");
          localStorage.removeItem("lexiklar_view_counts");
          f7.toast
            .create({ text: "History cleared", closeTimeout: 2000, position: "center" })
            .open();
        },
      );
    },
  },
};
</script>
