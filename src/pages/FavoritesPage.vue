<template>
  <f7-page name="favorites" @page:tabshow="loadFavorites" @page:afterin="loadFavorites">
    <f7-navbar :title="t('favorites.title')" />

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>

    <template v-else-if="words.length">
      <f7-list class="gloss-list" media-list>
        <f7-list-item
          v-for="item in words"
          :key="item.file"
          swipeout
          :title="itemTitle(item)"
          :subtitle="wordListGlosses(item)"
          :link="`/word/${item.file}/`"
          @swipeout:deleted="removeFavorite(item.file)"
        >
          <template #after>
            <WordListBadges :pos="item.pos" :gender="item.gender" :plural-dominant="item.pluralDominant" />
          </template>
          <f7-swipeout-actions right>
            <f7-swipeout-button delete>{{ t('favorites.remove') }}</f7-swipeout-button>
          </f7-swipeout-actions>
        </f7-list-item>
      </f7-list>
    </template>

    <f7-block v-else-if="!loading">
      <p class="text-secondary">{{ t('favorites.empty') }}</p>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getRelatedWords } from "../utils/db.js";
import { t } from "../js/i18n.js";
import { getCached, setItem, SHOW_ARTICLES_KEY } from "../utils/storage.js";
import { FAVORITES_KEY } from "../utils/storage-keys.js";
import type { SearchResult } from "../../types/search.js";
import WordListBadges from "../components/WordListBadges.vue";
import { wordListTitle, wordListGlosses } from "../utils/word-list.js";

const words = ref<SearchResult[]>([]);
const loading = ref(true);
const showArticles = ref(getCached(SHOW_ARTICLES_KEY) !== "0");

async function loadFavorites() {
  showArticles.value = getCached(SHOW_ARTICLES_KEY) !== "0";
  loading.value = true;
  try {
    const fileKeys: string[] = JSON.parse(getCached(FAVORITES_KEY) || "[]");
    if (!fileKeys.length) {
      words.value = [];
      loading.value = false;
      return;
    }
    const results = await getRelatedWords(fileKeys);
    const infoMap = new Map(results.map((w) => [w.file, w]));
    words.value = fileKeys.map((f) => infoMap.get(f)).filter((w): w is SearchResult => !!w);
  } catch {
    words.value = [];
  }
  loading.value = false;
}

function itemTitle(item: SearchResult): string {
  return wordListTitle(item, showArticles.value);
}

function removeFavorite(file: string) {
  try {
    const favs: string[] = JSON.parse(getCached(FAVORITES_KEY) || "[]");
    setItem(FAVORITES_KEY, JSON.stringify(favs.filter((f) => f !== file)));
    words.value = words.value.filter((w) => w.file !== file);
  } catch {
    // silently skip
  }
}

onMounted(() => loadFavorites());
</script>
