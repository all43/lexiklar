<template>
  <f7-page name="grammar-index">
    <f7-navbar :title="t('settings.grammarReference')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('settings.grammarReference')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-list inset strong-ios outline-ios>
      <f7-list-item link="/grammar/noun-gender/"          :title="t('grammar.nounGenderRules')" />
      <f7-list-item link="/grammar/adjective-declension/" :title="t('grammar.adjectiveDeclension')" />
      <f7-list-item link="/grammar/determiners/"          :title="t('grammar.determiners')" />
      <f7-list-item link="/grammar/cases/"                :title="t('grammar.cases')" />
      <f7-list-item link="/grammar/modal-verbs/"          :title="t('grammar.modalVerbs')" />
      <f7-list-item link="/grammar/reflexive/"            :title="t('grammar.reflexive')" />
      <f7-list-item link="/grammar/connectors/"           :title="t('grammar.connectors')" />
    </f7-list>
  </f7-page>
</template>

<script setup lang="ts">
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";

const props = defineProps<{ f7route: { url: string } }>();
</script>
