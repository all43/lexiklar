<template>
  <f7-page name="grammar-proadverb">
    <f7-navbar :title="t('grammar.proadverbTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.proadverbTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.proadverbDesc') }}</p>
    </f7-block>

    <!-- How it works -->
    <f7-block-title>{{ t('grammar.proadverbHowItWorks') }}</f7-block-title>
    <f7-block class="pa-block">
      <div class="pa-rule-list">
        <div class="pa-rule-card">
          <div class="pa-rule-label">da + Präposition</div>
          <div class="pa-rule-desc">{{ t('grammar.proadverbDaDesc') }}</div>
          <div class="pa-rule-example">Ich warte <strong>darauf</strong>. <span class="pa-rule-en">(= auf das / auf es)</span></div>
        </div>
        <div class="pa-rule-card">
          <div class="pa-rule-label">wo + Präposition</div>
          <div class="pa-rule-desc">{{ t('grammar.proadverbWoDesc') }}</div>
          <div class="pa-rule-example"><strong>Worauf</strong> wartest du? <span class="pa-rule-en">(= auf was?)</span></div>
        </div>
        <div class="pa-rule-card pa-rule-r">
          <div class="pa-rule-label">{{ t('grammar.proadverbRInsertion') }}</div>
          <div class="pa-rule-desc">{{ t('grammar.proadverbRInsertionDesc') }}</div>
          <div class="pa-rule-example">da + auf → <strong>da<em>r</em>auf</strong>, wo + in → <strong>wo<em>r</em>in</strong></div>
        </div>
      </div>
    </f7-block>

    <!-- People vs things -->
    <f7-block-title>{{ t('grammar.proadverbPeopleVsThings') }}</f7-block-title>
    <f7-block class="pa-block">
      <div class="pa-contrast">
        <div class="pa-contrast-row">
          <div class="pa-contrast-label">{{ t('grammar.proadverbThings') }}</div>
          <div class="pa-contrast-ex">Ich denke <strong>daran</strong>. <span class="pa-contrast-en">I'm thinking about it.</span></div>
        </div>
        <div class="pa-contrast-row">
          <div class="pa-contrast-label">{{ t('grammar.proadverbPeople') }}</div>
          <div class="pa-contrast-ex">Ich denke <strong>an ihn</strong>. <span class="pa-contrast-en">I'm thinking about him.</span></div>
        </div>
      </div>
    </f7-block>

    <!-- Table -->
    <f7-block-title>{{ t('grammar.proadverbTable') }}</f7-block-title>
    <f7-block class="pa-block">
      <DeclTableWrap>
          <table class="decl-table pa-table">
            <thead>
              <tr>
                <th class="decl-case-header">Präposition</th>
                <th class="decl-num-header">da(r)-</th>
                <th class="decl-num-header">wo(r)-</th>
                <th class="decl-num-header">English</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in TABLE" :key="row.prep">
                <td class="decl-case">{{ row.prep }}</td>
                <td class="decl-form">
                  <f7-link v-if="row.daPath" :href="`/word/${row.daPath}/`" class="pa-word-link">{{ row.da }}</f7-link>
                  <span v-else>{{ row.da }}</span>
                </td>
                <td class="decl-form">
                  <f7-link v-if="row.woPath" :href="`/word/${row.woPath}/`" class="pa-word-link">{{ row.wo }}</f7-link>
                  <span v-else>{{ row.wo }}</span>
                </td>
                <td class="decl-form pa-en-col">{{ row.en }}</td>
              </tr>
            </tbody>
          </table>
      </DeclTableWrap>
    </f7-block>

    <!-- Common verb + proadverb combinations -->
    <f7-block-title>{{ t('grammar.proadverbCommonVerbs') }}</f7-block-title>
    <f7-block class="pa-block">
      <div class="pa-verb-list">
        <div v-for="v in COMMON_VERBS" :key="v.verb" class="pa-verb-item">
          <div class="pa-verb-header">
            <f7-link :href="`/word/verbs/${v.base}/`" class="pa-verb-link">{{ v.verb }}</f7-link>
            <span class="pa-verb-prep">+ {{ v.prep }}</span>
          </div>
          <div class="pa-verb-ex">{{ v.example }}</div>
          <div class="pa-verb-en">{{ v.en }}</div>
        </div>
      </div>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import DeclTableWrap from "../../components/DeclTableWrap.vue";

const props = defineProps<{ f7route: { url: string } }>();

interface ProadverbRow {
  prep: string;
  da: string;
  daPath: string | null;
  wo: string;
  woPath: string | null;
  en: string;
}

const TABLE: ProadverbRow[] = [
  { prep: "an",       da: "daran",     daPath: "adverbs/daran",     wo: "woran",     woPath: null,              en: "about / on it" },
  { prep: "auf",      da: "darauf",    daPath: "adverbs/darauf",    wo: "worauf",    woPath: "adverbs/worauf",  en: "on / for it" },
  { prep: "aus",      da: "daraus",    daPath: "adverbs/daraus",    wo: "woraus",    woPath: null,              en: "out of / from it" },
  { prep: "bei",      da: "dabei",     daPath: "adverbs/dabei",     wo: "wobei",     woPath: "adverbs/wobei",   en: "with it / at it" },
  { prep: "durch",    da: "dadurch",   daPath: "adverbs/dadurch",   wo: "wodurch",   woPath: "adverbs/wodurch", en: "through / by it" },
  { prep: "für",      da: "dafür",     daPath: "adverbs/dafür",     wo: "wofür",     woPath: "adverbs/wofür",   en: "for it" },
  { prep: "gegen",    da: "dagegen",   daPath: "adverbs/dagegen",   wo: "wogegen",   woPath: "adverbs/wogegen", en: "against it" },
  { prep: "hinter",   da: "dahinter",  daPath: "adverbs/dahinter",  wo: "—",         woPath: null,              en: "behind it" },
  { prep: "in",       da: "darin",     daPath: "adverbs/darin",     wo: "worin",     woPath: "adverbs/worin",   en: "in it" },
  { prep: "mit",      da: "damit",     daPath: "adverbs/damit",     wo: "womit",     woPath: "adverbs/womit",   en: "with it" },
  { prep: "nach",     da: "danach",    daPath: "adverbs/danach",    wo: "wonach",    woPath: "adverbs/wonach",  en: "after / for it" },
  { prep: "neben",    da: "daneben",   daPath: "adverbs/daneben",   wo: "—",         woPath: null,              en: "next to it" },
  { prep: "über",     da: "darüber",   daPath: "adverbs/darüber",   wo: "worüber",   woPath: "adverbs/worüber", en: "about / over it" },
  { prep: "um",       da: "darum",     daPath: "adverbs/darum",     wo: "worum",     woPath: "adverbs/worum",   en: "around / about it" },
  { prep: "unter",    da: "darunter",  daPath: "adverbs/darunter",  wo: "—",         woPath: null,              en: "under / among it" },
  { prep: "von",      da: "davon",     daPath: "adverbs/davon",     wo: "wovon",     woPath: "adverbs/wovon",   en: "of / from it" },
  { prep: "vor",      da: "davor",     daPath: "adverbs/davor",     wo: "wovor",     woPath: "adverbs/wovor",   en: "before / of it" },
  { prep: "zu",       da: "dazu",      daPath: "adverbs/dazu",      wo: "wozu",      woPath: "adverbs/wozu",    en: "to / for it" },
  { prep: "zwischen", da: "dazwischen",daPath: "adverbs/dazwischen",wo: "—",         woPath: null,              en: "between them" },
];

interface VerbCombo {
  verb: string;
  base: string;
  prep: string;
  example: string;
  en: string;
}

const COMMON_VERBS: VerbCombo[] = [
  { verb: "warten",       base: "warten",       prep: "darauf",  example: "Ich warte darauf, dass er kommt.",        en: "I'm waiting for him to come." },
  { verb: "denken",       base: "denken",       prep: "daran",   example: "Denk daran, die Tür abzuschließen.",     en: "Remember to lock the door." },
  { verb: "sich freuen",  base: "freuen",       prep: "darauf",  example: "Ich freue mich darauf.",                  en: "I'm looking forward to it." },
  { verb: "sprechen",     base: "sprechen",     prep: "darüber", example: "Wir haben darüber gesprochen.",           en: "We talked about it." },
  { verb: "achten",       base: "achten",       prep: "darauf",  example: "Achte darauf, pünktlich zu sein.",        en: "Make sure to be on time." },
  { verb: "sich handeln", base: "handeln",      prep: "darum",   example: "Es handelt sich darum, eine Lösung zu finden.", en: "It's about finding a solution." },
  { verb: "bitten",       base: "bitten",       prep: "darum",   example: "Ich bitte dich darum.",                   en: "I'm asking you for it." },
  { verb: "anfangen",     base: "anfangen",     prep: "damit",   example: "Fang damit an!",                         en: "Start with it!" },
  { verb: "aufhören",     base: "aufhören",     prep: "damit",   example: "Hör damit auf!",                         en: "Stop doing that!" },
  { verb: "sich gewöhnen",base: "gewöhnen",     prep: "daran",   example: "Ich habe mich daran gewöhnt.",           en: "I've gotten used to it." },
  { verb: "abhängen",     base: "abhängen",     prep: "davon",   example: "Es hängt davon ab.",                     en: "It depends on it." },
  { verb: "träumen",      base: "träumen",      prep: "davon",   example: "Ich träume davon, zu reisen.",           en: "I dream of traveling." },
];
</script>

<style scoped>
.pa-block {
  padding-top: 0;
}

/* How it works */
.pa-rule-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pa-rule-card {
  padding: 10px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.pa-rule-card:last-child {
  border-bottom: none;
}

.pa-rule-label {
  font-weight: 700;
  font-size: 15px;
}

.pa-rule-desc {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
}

.pa-rule-example {
  font-size: 14px;
  font-style: italic;
  margin-top: 4px;
  color: var(--f7-text-color);
}

.pa-rule-en {
  font-style: normal;
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
}

.pa-rule-r em {
  color: var(--color-vowel-change, #d32f2f);
  font-style: normal;
  font-weight: 700;
}

/* People vs things */
.pa-contrast {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pa-contrast-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.pa-contrast-row:last-child {
  border-bottom: none;
}

.pa-contrast-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.pa-contrast-ex {
  font-size: 14px;
  font-style: italic;
}

.pa-contrast-en {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  font-style: normal;
  margin-left: 6px;
}

/* Table */
.pa-table th,
.pa-table td {
  text-align: center;
  white-space: nowrap;
}
.pa-table td:first-child {
  text-align: left;
  font-weight: 600;
}

.pa-word-link {
  font-weight: 600;
}

.pa-en-col {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
}

/* Common verbs */
.pa-verb-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pa-verb-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.pa-verb-item:last-child {
  border-bottom: none;
}

.pa-verb-header {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.pa-verb-link {
  font-weight: 600;
  font-size: 15px;
}

.pa-verb-prep {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

.pa-verb-ex {
  font-size: 13px;
  font-style: italic;
  margin-top: 3px;
  color: var(--f7-text-color);
}

.pa-verb-en {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
}
</style>
