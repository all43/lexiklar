<template>
  <f7-page name="grammar-purpose-clauses">
    <f7-navbar :title="t('grammar.purposeClausesTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.purposeClausesTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.purposeClausesDesc') }}</p>
    </f7-block>

    <!-- um...zu construction -->
    <f7-block-title>um … zu + Infinitiv</f7-block-title>
    <f7-block class="purpose-block">
      <div class="structure-card">
        <div class="structure-label">{{ t('grammar.purposeClausesStructure') }}</div>
        <div class="structure-pattern">
          <span class="kw">…, um</span> … <span class="kw">zu</span> + <span class="kw">Infinitiv</span>
        </div>
      </div>
      <div class="example-pair">
        <div class="ex-de">Ich lerne Deutsch, <strong>um</strong> in Berlin <strong>zu arbeiten</strong>.</div>
        <div class="ex-en">I'm learning German (in order) to work in Berlin.</div>
      </div>
      <div class="example-pair">
        <div class="ex-de">Sie spart Geld, <strong>um</strong> ein Auto <strong>zu kaufen</strong>.</div>
        <div class="ex-en">She's saving money (in order) to buy a car.</div>
      </div>
      <div class="purpose-note">
        {{ t('grammar.purposeClausesSepVerb') }}
      </div>
      <div class="example-pair">
        <div class="ex-de">Er steht früh auf, <strong>um ein<span class="kw">zu</span>kaufen</strong>.</div>
        <div class="ex-en">He gets up early to go shopping.</div>
      </div>
    </f7-block>

    <!-- damit construction -->
    <f7-block-title>damit + Nebensatz</f7-block-title>
    <f7-block class="purpose-block">
      <div class="structure-card">
        <div class="structure-label">{{ t('grammar.purposeClausesStructure') }}</div>
        <div class="structure-pattern">
          <span class="kw">…, damit</span> … <span class="kw">Verb (konjugiert, am Ende)</span>
        </div>
      </div>
      <div class="example-pair">
        <div class="ex-de">Ich erkläre es langsam, <strong>damit</strong> du es <strong>verstehst</strong>.</div>
        <div class="ex-en">I'm explaining it slowly so that you understand it.</div>
      </div>
      <div class="example-pair">
        <div class="ex-de">Er gibt ihr Geld, <strong>damit</strong> sie einkaufen <strong>kann</strong>.</div>
        <div class="ex-en">He gives her money so that she can go shopping.</div>
      </div>
    </f7-block>

    <!-- When to use which -->
    <f7-block-title>{{ t('grammar.purposeClausesRule') }}</f7-block-title>
    <f7-block class="purpose-block">
      <div class="rule-cards">
        <div class="rule-card">
          <div class="rule-label same-subj">{{ t('grammar.purposeClausesSameSubject') }}</div>
          <div class="rule-arrow">→ um … zu</div>
          <div class="ex-de"><strong>Ich</strong> lerne Deutsch, um in Berlin zu arbeiten.</div>
          <div class="ex-en">(I … I → same subject → um…zu)</div>
        </div>
        <div class="rule-card">
          <div class="rule-label diff-subj">{{ t('grammar.purposeClausesDiffSubject') }}</div>
          <div class="rule-arrow">→ damit</div>
          <div class="ex-de"><strong>Ich</strong> erkläre es langsam, damit <strong>du</strong> es verstehst.</div>
          <div class="ex-en">(I … you → different subjects → damit)</div>
        </div>
      </div>
      <div class="purpose-note">
        {{ t('grammar.purposeClausesSameSubjectNote') }}
      </div>
      <div class="example-pair">
        <div class="ex-de correct">✓ Ich lerne Deutsch, <strong>um</strong> in Berlin <strong>zu arbeiten</strong>.</div>
        <div class="ex-de correct">✓ Ich lerne Deutsch, <strong>damit</strong> ich in Berlin arbeiten <strong>kann</strong>.</div>
        <div class="ex-en">Both correct — but um…zu is preferred (shorter).</div>
      </div>
    </f7-block>

    <!-- Common verbs -->
    <f7-block-title>{{ t('grammar.purposeClausesCommonVerbs') }}</f7-block-title>
    <f7-block class="purpose-block">
      <div class="verb-list">
        <div v-for="v in COMMON_VERBS" :key="v.verb" class="verb-item">
          <f7-link :href="`/word/verbs/${v.file}/`" class="verb-link">{{ v.verb }}</f7-link>
          <span class="verb-en">{{ v.en }}</span>
        </div>
      </div>
      <div class="example-pair" style="margin-top: 10px">
        <div class="ex-de">Er <strong>versucht</strong>, pünktlich <strong>zu kommen</strong>.</div>
        <div class="ex-en">He tries to come on time.</div>
      </div>
      <div class="example-pair">
        <div class="ex-de">Ich <strong>hoffe</strong>, dich bald wieder<strong>zusehen</strong>.</div>
        <div class="ex-en">I hope to see you again soon.</div>
      </div>
    </f7-block>

    <!-- Common mistakes -->
    <f7-block-title>{{ t('grammar.purposeClausesMistakes') }}</f7-block-title>
    <f7-block class="purpose-block">
      <div class="mistake-list">
        <div class="mistake-item">
          <div class="mistake-wrong">✗ Ich lerne Deutsch, <em>damit</em> ich in Berlin arbeite.</div>
          <div class="mistake-right">✓ Ich lerne Deutsch, <strong>um</strong> in Berlin <strong>zu arbeiten</strong>.</div>
          <div class="mistake-note">{{ t('grammar.purposeClausesMistake1') }}</div>
        </div>
        <div class="mistake-item">
          <div class="mistake-wrong">✗ Ich gehe ins Kino <em>zu</em> einen Film sehen.</div>
          <div class="mistake-right">✓ Ich gehe ins Kino, <strong>um</strong> einen Film <strong>zu sehen</strong>.</div>
          <div class="mistake-note">{{ t('grammar.purposeClausesMistake2') }}</div>
        </div>
        <div class="mistake-item">
          <div class="mistake-wrong">✗ Er spricht langsam, damit ich <em>verstehe</em> ihn.</div>
          <div class="mistake-right">✓ Er spricht langsam, damit ich ihn <strong>verstehe</strong>.</div>
          <div class="mistake-note">{{ t('grammar.purposeClausesMistake3') }}</div>
        </div>
      </div>
    </f7-block>
  </f7-page>
</template>

<script setup lang="ts">
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";

const props = defineProps<{ f7route: { url: string } }>();

const COMMON_VERBS = [
  { verb: "versuchen",  file: "versuchen",  en: "to try" },
  { verb: "hoffen",     file: "hoffen",     en: "to hope" },
  { verb: "anfangen",   file: "anfangen",   en: "to start" },
  { verb: "aufhören",   file: "aufhören",   en: "to stop" },
  { verb: "brauchen",   file: "brauchen",   en: "to need" },
  { verb: "helfen",     file: "helfen",     en: "to help" },
  { verb: "bitten",     file: "bitten",     en: "to ask / request" },
];
</script>

<style scoped>
.purpose-block {
  padding-top: 0;
}

/* Structure cards */
.structure-card {
  background: var(--f7-block-strong-bg-color, #fff);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}

.structure-label {
  font-size: 11px;
  color: var(--f7-block-footer-text-color);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.structure-pattern {
  font-size: 16px;
  font-weight: 600;
}

.kw {
  color: var(--f7-theme-color);
}

/* Examples */
.example-pair {
  padding: 6px 0;
}

.ex-de {
  font-size: 14px;
  font-style: italic;
  color: var(--f7-text-color);
}

.ex-en {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  margin-top: 2px;
}

.purpose-note {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  font-style: italic;
  margin: 6px 0;
}

/* Rule cards */
.rule-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.rule-card {
  background: var(--f7-block-strong-bg-color, #fff);
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}

.rule-label {
  font-size: 13px;
  font-weight: 700;
}

.same-subj {
  color: var(--color-rule-match, #4caf50);
}

.diff-subj {
  color: var(--f7-theme-color);
}

.rule-arrow {
  font-size: 15px;
  font-weight: 600;
  margin: 2px 0 6px;
}

.rule-card .ex-de {
  font-size: 13px;
}

.rule-card .ex-en {
  font-size: 11px;
}

.correct {
  color: var(--color-rule-match, #4caf50);
  font-style: normal;
}

/* Common verbs */
.verb-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.verb-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.verb-link {
  font-weight: 600;
  font-size: 15px;
}

.verb-en {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

/* Common mistakes */
.mistake-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mistake-item {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.mistake-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.mistake-wrong {
  font-size: 14px;
  color: var(--color-vowel-change, #d32f2f);
}

.mistake-right {
  font-size: 14px;
  color: var(--color-rule-match, #4caf50);
  margin-top: 3px;
}

.mistake-note {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  font-style: italic;
  margin-top: 3px;
}
</style>
