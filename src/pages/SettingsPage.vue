<template>
  <f7-page name="settings">
    <f7-navbar title="Settings" />

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

export default {
  methods: {
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
