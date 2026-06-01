<template>
  <f7-page name="grammar-oscillating-verbs">
    <f7-navbar :title="t('grammar.oscillatingVerbsTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.oscillatingVerbsTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.oscillatingVerbsDesc') }}</p>
    </f7-block>

    <!-- Rules -->
    <f7-block-title>{{ t('grammar.oscillatingVerbsRules') }}</f7-block-title>
    <f7-block class="osc-rules-block">
      <div class="osc-rule">
        <span class="osc-rule-badge osc-badge-sep">trennbar</span>
        <span class="osc-rule-text">{{ t('grammar.oscillatingVerbsSep') }}</span>
      </div>
      <div class="osc-rule osc-rule-example">
        <span class="osc-rule-example-de">Er fährt durch.</span>
        <span class="osc-rule-example-sep">↔</span>
        <span class="osc-rule-example-de">durchgefahren</span>
      </div>
      <div class="osc-rule osc-rule-spacer" />
      <div class="osc-rule">
        <span class="osc-rule-badge osc-badge-insep">untrennbar</span>
        <span class="osc-rule-text">{{ t('grammar.oscillatingVerbsInsep') }}</span>
      </div>
      <div class="osc-rule osc-rule-example">
        <span class="osc-rule-example-de">Er durchfährt die Stadt.</span>
        <span class="osc-rule-example-sep">↔</span>
        <span class="osc-rule-example-de">durchfahren</span>
      </div>
    </f7-block>

    <!-- Verb pairs grouped by prefix -->
    <template v-for="group in VERB_GROUPS" :key="group.prefix">
      <f7-block-title>{{ group.prefix }}</f7-block-title>
      <f7-block class="osc-verb-block">
        <div v-for="v in group.verbs" :key="v.lemma" class="osc-verb-item">
          <f7-link :href="`/word/verbs/${v.lemma}/`" class="osc-verb-link">{{ v.lemma }}</f7-link>
          <div class="osc-meanings">
            <div class="osc-meaning-row">
              <span class="osc-tag osc-tag-sep">trennbar</span>
              <span class="osc-meaning-en">{{ v.sep }}</span>
            </div>
            <div class="osc-meaning-row">
              <span class="osc-tag osc-tag-insep">untrennbar</span>
              <span class="osc-meaning-en">{{ v.insep }}</span>
            </div>
          </div>
        </div>
      </f7-block>
    </template>
  </f7-page>
</template>

<script setup lang="ts">
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";

const props = defineProps<{ f7route: { url: string } }>();

const VERB_GROUPS = [
  {
    prefix: "durch-",
    verbs: [
      { lemma: "durchfahren",  sep: "drive/pass through (a place)",        insep: "travel nonstop; feel suddenly" },
      { lemma: "durchbrechen", sep: "break through",                        insep: "break in two" },
      { lemma: "durchschauen", sep: "look through (physically)",            insep: "see through; understand" },
      { lemma: "durchsetzen",  sep: "push through; enforce",                insep: "intersperse; pervade" },
      { lemma: "durchlaufen",  sep: "walk/run through; wear out (shoes)",   insep: "complete; permeate" },
      { lemma: "durchgehen",   sep: "go through; run away; be accepted",    insep: "pass through continuously" },
    ],
  },
  {
    prefix: "über-",
    verbs: [
      { lemma: "übersetzen",   sep: "ferry across",                         insep: "translate" },
      { lemma: "übergehen",    sep: "transition to; pass over to",          insep: "ignore; overlook" },
      { lemma: "überlegen",    sep: "lay over; lean over",                  insep: "consider; think over" },
      { lemma: "überfahren",   sep: "ferry across",                         insep: "run over; drive past" },
      { lemma: "überschlagen", sep: "flip; cross (legs); skip",             insep: "estimate roughly" },
    ],
  },
  {
    prefix: "um-",
    verbs: [
      { lemma: "umfahren",     sep: "knock over (with a vehicle)",          insep: "drive around" },
      { lemma: "umgehen",      sep: "handle; go around; circulate",         insep: "circumvent; avoid" },
      { lemma: "umschreiben",  sep: "rewrite; transfer",                    insep: "paraphrase; describe in other words" },
      { lemma: "umstellen",    sep: "rearrange; adjust",                    insep: "surround; encircle" },
    ],
  },
  {
    prefix: "unter-",
    verbs: [
      { lemma: "unterstellen", sep: "store temporarily; take shelter",      insep: "subordinate; falsely attribute" },
      { lemma: "unterstehen",  sep: "take shelter (from rain)",             insep: "be subordinate to; dare" },
    ],
  },
  {
    prefix: "hinter-",
    verbs: [
      { lemma: "hinterlegen",  sep: "place in the back",                    insep: "deposit; leave on file" },
      { lemma: "hintergehen",  sep: "walk behind",                          insep: "betray; deceive" },
    ],
  },
  {
    prefix: "wieder-",
    verbs: [
      { lemma: "wiederholen",  sep: "fetch back; retrieve",                 insep: "repeat; review" },
    ],
  },
];
</script>

<style scoped>
.osc-rules-block {
  padding-top: 0;
}

.osc-rule {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.osc-rule-spacer {
  height: 8px;
  margin-bottom: 0;
}

.osc-rule-example {
  margin-left: 4px;
  margin-bottom: 8px;
  gap: 6px;
  flex-wrap: wrap;
}

.osc-rule-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.osc-badge-sep {
  background-color: rgba(255, 149, 0, 0.15);
  color: #b36200;
}

.dark .osc-badge-sep {
  background-color: rgba(255, 149, 0, 0.2);
  color: #ffb74d;
}

.osc-badge-insep {
  background-color: rgba(120, 120, 128, 0.15);
  color: #555;
}

.dark .osc-badge-insep {
  background-color: rgba(120, 120, 128, 0.2);
  color: #aaa;
}

.osc-rule-text {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

.osc-rule-example-de {
  font-size: 13px;
  font-style: italic;
  color: var(--f7-block-footer-text-color);
}

.osc-rule-example-sep {
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
}

.osc-verb-block {
  padding-top: 0;
}

.osc-verb-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
}

.osc-verb-link {
  font-weight: 600;
  font-size: 15px;
  flex-shrink: 0;
  min-width: 120px;
}

.osc-meanings {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.osc-meaning-row {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex-wrap: wrap;
}

.osc-tag {
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 6px;
}

.osc-tag-sep {
  background-color: rgba(255, 149, 0, 0.12);
  color: #b36200;
}

.dark .osc-tag-sep {
  background-color: rgba(255, 149, 0, 0.18);
  color: #ffb74d;
}

.osc-tag-insep {
  background-color: rgba(120, 120, 128, 0.12);
  color: #555;
}

.dark .osc-tag-insep {
  background-color: rgba(120, 120, 128, 0.18);
  color: #aaa;
}

.osc-meaning-en {
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}
</style>
