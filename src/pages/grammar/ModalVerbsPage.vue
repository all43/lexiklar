<template>
  <f7-page name="grammar-modal-verbs">
    <f7-navbar :title="t('grammar.modalVerbsTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.modalVerbsTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.modalVerbsDesc') }}</p>
    </f7-block>

    <f7-block-title>{{ t('grammar.modalPresent') }}</f7-block-title>
    <f7-block class="modal-block">
      <div class="decl-table-wrap scroll-fade" :style="fadeStylePresent" :class="{ 'is-scrollable': isScrollablePresent }">
        <div class="decl-table-scroll" ref="presentEl">
          <table class="decl-table modal-table">
            <thead>
              <tr>
                <th class="decl-case-header"></th>
                <th v-for="m in MODALS" :key="m.verb" class="decl-num-header">
                  <f7-link :href="`/word/verbs/${m.verb}/`" class="modal-header-link">{{ m.verb }}</f7-link>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in PERSONS" :key="p">
                <td class="decl-case">{{ p }}</td>
                <td v-for="m in MODALS" :key="m.verb" class="decl-form modal-cell">
                  {{ m.present[p] }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </f7-block>

    <f7-block-title>{{ t('grammar.modalPreterite') }}</f7-block-title>
    <f7-block class="modal-block">
      <div class="decl-table-wrap scroll-fade" :style="fadeStylePreterite" :class="{ 'is-scrollable': isScrollablePreterite }">
        <div class="decl-table-scroll" ref="preteriteEl">
          <table class="decl-table modal-table">
            <thead>
              <tr>
                <th class="decl-case-header"></th>
                <th v-for="m in MODALS" :key="m.verb" class="decl-num-header">
                  <f7-link :href="`/word/verbs/${m.verb}/`" class="modal-header-link">{{ m.verb }}</f7-link>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in PERSONS" :key="p">
                <td class="decl-case">{{ p }}</td>
                <td v-for="m in MODALS" :key="m.verb" class="decl-form modal-cell">
                  {{ m.preterite[p] }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import { useScrollFade } from "../../composables/useScrollFade.js";

const props = defineProps<{ f7route: { url: string } }>();

type Person = "ich" | "du" | "er/sie" | "wir" | "ihr" | "sie";

interface Modal {
  verb: string;
  present: Record<Person, string>;
  preterite: Record<Person, string>;
}

const PERSONS: Person[] = ["ich", "du", "er/sie", "wir", "ihr", "sie"];

const MODALS: Modal[] = [
  {
    verb: "dürfen",
    present:   { ich: "darf",   du: "darfst",  "er/sie": "darf",   wir: "dürfen",  ihr: "dürft",   sie: "dürfen"  },
    preterite: { ich: "durfte", du: "durftest", "er/sie": "durfte", wir: "durften", ihr: "durftet", sie: "durften" },
  },
  {
    verb: "können",
    present:   { ich: "kann",   du: "kannst",   "er/sie": "kann",   wir: "können",  ihr: "könnt",   sie: "können"  },
    preterite: { ich: "konnte", du: "konntest",  "er/sie": "konnte", wir: "konnten", ihr: "konntet", sie: "konnten" },
  },
  {
    verb: "mögen",
    present:   { ich: "mag",    du: "magst",    "er/sie": "mag",    wir: "mögen",   ihr: "mögt",    sie: "mögen"   },
    preterite: { ich: "mochte", du: "mochtest", "er/sie": "mochte", wir: "mochten", ihr: "mochtet", sie: "mochten" },
  },
  {
    verb: "müssen",
    present:   { ich: "muss",   du: "musst",    "er/sie": "muss",   wir: "müssen",  ihr: "müsst",   sie: "müssen"  },
    preterite: { ich: "musste", du: "musstest", "er/sie": "musste", wir: "mussten", ihr: "musstet", sie: "mussten" },
  },
  {
    verb: "sollen",
    present:   { ich: "soll",   du: "sollst",   "er/sie": "soll",   wir: "sollen",  ihr: "sollt",   sie: "sollen"  },
    preterite: { ich: "sollte", du: "solltest", "er/sie": "sollte", wir: "sollten", ihr: "solltet", sie: "sollten" },
  },
  {
    verb: "wollen",
    present:   { ich: "will",   du: "willst",   "er/sie": "will",   wir: "wollen",  ihr: "wollt",   sie: "wollen"  },
    preterite: { ich: "wollte", du: "wolltest", "er/sie": "wollte", wir: "wollten", ihr: "wolltet", sie: "wollten" },
  },
];

const presentEl   = ref<HTMLElement | null>(null);
const preteriteEl = ref<HTMLElement | null>(null);

const { fadeStyle: fadeStylePresent,   isScrollable: isScrollablePresent   } = useScrollFade(presentEl);
const { fadeStyle: fadeStylePreterite, isScrollable: isScrollablePreterite } = useScrollFade(preteriteEl);
</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

.modal-block {
  padding-top: 0;
}

.modal-header-link {
  font-weight: 600;
  font-size: 13px;
}

.modal-table th,
.modal-table td {
  text-align: center;
}
.modal-table td:first-child {
  text-align: left;
}

.modal-cell {
  font-size: 13px;
}
</style>
