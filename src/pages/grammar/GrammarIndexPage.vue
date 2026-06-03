<template>
  <f7-page name="grammar-index" with-subnavbar>
    <f7-navbar :title="t('settings.grammarReference')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('settings.grammarReference')" :path="props.f7route.url" />
      </f7-nav-right>
      <f7-subnavbar :inner="false">
        <f7-searchbar
          custom-search
          :value="filter"
          :clear-button="true"
          :disable-button="false"
          :placeholder="t('grammar.filterPlaceholder')"
          @searchbar:search="onSearch"
          @searchbar:clear="onClear"
        />
      </f7-subnavbar>
    </f7-navbar>

    <f7-list inset strong-ios outline-ios>
      <f7-list-item
        v-for="item in displayed"
        :key="item.slug"
        :link="`/grammar/${item.slug}/`"
        :title="item.title"
      />
    </f7-list>

    <f7-block v-if="displayed.length === 0">
      <p class="text-secondary">{{ t('search.noResults') }}</p>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import { grammarTopics } from "../../data/grammar-topics.js";
import { searchGrammarTopics } from "../../utils/grammar-search.js";

const props = defineProps<{ f7route: { url: string } }>();

const filter = ref("");

const displayed = computed(() => {
  const q = filter.value.trim();
  if (q.length < 2) {
    return grammarTopics.map((topic) => ({ slug: topic.slug, title: t(topic.titleKey) }));
  }
  return searchGrammarTopics(q).map((hit) => ({ slug: hit.slug, title: hit.title }));
});

function onSearch(_sb: unknown, query: string) {
  filter.value = query || "";
}

function onClear() {
  filter.value = "";
}
</script>
