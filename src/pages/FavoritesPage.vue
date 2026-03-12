<template>
  <f7-page name="favorites">
    <f7-navbar :title="t('favorites.title')" />
    <f7-block>
      <p>{{ t('favorites.empty') }}</p>
    </f7-block>
  </f7-page>
</template>

<script>
import { t } from "../js/i18n.js";

export default {
  computed: {
    t() { return t; },
  },
};
</script>
