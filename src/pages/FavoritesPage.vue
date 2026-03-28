<template>
  <f7-page name="favorites" @page:tabshow="loadFavorites" @page:afterin="loadFavorites">
    <f7-navbar :title="t('favorites.title')" />

    <f7-block v-if="loading" class="text-align-center">
      <f7-preloader />
    </f7-block>

    <template v-else-if="words.length">
      <f7-list media-list>
        <f7-list-item
          v-for="item in words"
          :key="item.file"
          swipeout
          :title="itemTitle(item)"
          :subtitle="item.glossEn?.[0] ?? ''"
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

<script lang="ts">
import { defineComponent } from "vue";
import { getRelatedWords } from "../utils/db.js";
import { t } from "../js/i18n.js";
import { getCached, setItem } from "../utils/storage.js";
import type { SearchResult } from "../../types/search.js";
import WordListBadges from "../components/WordListBadges.vue";
import { wordListTitle } from "../components/WordListBadges.vue";
import { SHOW_ARTICLES_KEY } from "../utils/storage.js";

const FAVORITES_KEY = "lexiklar_favorites";

export default defineComponent({
  components: { WordListBadges },
  data() {
    return {
      words: [] as SearchResult[],
      loading: true,
      showArticles: getCached(SHOW_ARTICLES_KEY) !== "0",
    };
  },
  computed: {
    t() { return t; },
  },
  async mounted() {
    await this.loadFavorites();
  },
  methods: {
    async loadFavorites() {
      this.showArticles = getCached(SHOW_ARTICLES_KEY) !== "0";
      this.loading = true;
      try {
        const fileKeys: string[] = JSON.parse(getCached(FAVORITES_KEY) || "[]");
        if (!fileKeys.length) {
          this.words = [];
          this.loading = false;
          return;
        }
        const results = await getRelatedWords(fileKeys);
        const infoMap = new Map(results.map((w) => [w.file, w]));
        this.words = fileKeys.map((f) => infoMap.get(f)).filter((w): w is SearchResult => !!w);
      } catch {
        this.words = [];
      }
      this.loading = false;
    },

    itemTitle(item: SearchResult): string {
      return wordListTitle(item, this.showArticles);
    },

    removeFavorite(file: string) {
      try {
        const favs: string[] = JSON.parse(getCached(FAVORITES_KEY) || "[]");
        setItem(FAVORITES_KEY, JSON.stringify(favs.filter((f) => f !== file)));
        this.words = this.words.filter((w) => w.file !== file);
      } catch {
        // silently skip
      }
    },

  },
});
</script>
