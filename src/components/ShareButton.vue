<template>
  <f7-link
    icon-f7="square_arrow_up"
    icon-size="20"
    data-tooltip-no-touch
    :data-tooltip="t('word.share')"
    @click="share"
  />
</template>

<script setup lang="ts">
import { Share } from "@capacitor/share";
import { t } from "../js/i18n.js";
import { APP_BASE_URL } from "../utils/app-constants.js";

const props = defineProps<{ title: string; path: string }>();

async function share() {
  try {
    await Share.share({ title: props.title, url: `${APP_BASE_URL}${props.path}` });
  } catch (e) {
    if (e instanceof Error && e.name !== "AbortError") throw e;
  }
}
</script>
