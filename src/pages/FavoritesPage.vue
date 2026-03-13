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
          :title="item.pluralDominant ? item.pluralForm : item.lemma"
          :subtitle="item.glossEn[0] || ''"
          :link="`/word/${item.file}/`"
          @swipeout:deleted="removeFavorite(item.file)"
        >
          <template #after>
            <span class="list-item-pos">{{ item.pos }}</span>
            <f7-badge v-if="item.pluralDominant" color="orange" class="list-item-badge">Pl.</f7-badge>
            <f7-badge v-else-if="item.gender" :color="genderColor(item.gender)" class="list-item-badge">{{ item.gender }}</f7-badge>
          </template>
          <f7-swipeout-actions right>
            <f7-swipeout-button delete>{{ t('favorites.remove') }}</f7-swipeout-button>
          </f7-swipeout-actions>
        </f7-list-item>
      </f7-list>
    </template>

    <f7-block v-else-if="!loading">
      <p style="color: var(--f7-list-item-footer-text-color);">{{ t('favorites.empty') }}</p>
    </f7-block>
  </f7-page>
</template>

<script>
import { getRelatedWords } from "../utils/db.js";
import { t } from "../js/i18n.js";
import { getCached, setItem } from "../utils/storage.js";

const FAVORITES_KEY = "lexiklar_favorites";

export default {
  data() {
    return {
      words: [],
      loading: true,
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
      this.loading = true;
      try {
        const fileKeys = JSON.parse(getCached(FAVORITES_KEY) || "[]");
        if (!fileKeys.length) {
          this.words = [];
          this.loading = false;
          return;
        }
        const results = await getRelatedWords(fileKeys);
        // Preserve the user's saved order
        const infoMap = new Map(results.map((w) => [w.file, w]));
        this.words = fileKeys.map((f) => infoMap.get(f)).filter(Boolean);
      } catch {
        this.words = [];
      }
      this.loading = false;
    },

    removeFavorite(file) {
      try {
        const favs = JSON.parse(getCached(FAVORITES_KEY) || "[]");
        setItem(FAVORITES_KEY, JSON.stringify(favs.filter((f) => f !== file)));
        this.words = this.words.filter((w) => w.file !== file);
      } catch {
        // silently skip
      }
    },

    genderColor(gender) {
      if (gender === "M") return "blue";
      if (gender === "F") return "pink";
      if (gender === "N") return "green";
      return "";
    },
  },
};
</script>
