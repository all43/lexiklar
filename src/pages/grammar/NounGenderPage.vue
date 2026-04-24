<template>
  <f7-page name="grammar-noun-gender">
    <f7-navbar :title="t('grammar.nounGenderRulesTitle')" back-link>
      <f7-nav-right>
        <ShareButton :title="t('grammar.nounGenderRulesTitle')" :path="props.f7route.url" />
      </f7-nav-right>
    </f7-navbar>

    <f7-block>
      <p class="grammar-desc">{{ t('grammar.nounGenderDesc') }}</p>
    </f7-block>

    <f7-block class="view-switch-block">
      <f7-segmented strong tag="p" class="noun-gender-switch">
        <f7-button :active="view === 'reliability'" @click="view = 'reliability'">{{ t('grammar.byReliability') }}</f7-button>
        <f7-button :active="view === 'gender'" @click="view = 'gender'">{{ t('grammar.byGender') }}</f7-button>
      </f7-segmented>
    </f7-block>

    <template v-for="group in displayedGroups" :key="group.key">
      <f7-block-title>
        <span v-if="group.badge" :class="['gender-badge', group.badge]">{{ group.badgeText }}</span>
        {{ group.label }}
      </f7-block-title>
      <f7-block class="grammar-rules-block">
        <div v-for="rule in group.rules" :key="rule.id" class="gender-rule-item">
          <div class="gender-rule-header">
            <span :class="['gender-badge', genderClass(rule.predicted_gender)]">
              {{ genderArticle(rule.predicted_gender) }}
            </span>
            <span class="gender-rule-pattern">{{ rulePattern(rule) }}</span>
            <span v-if="view === 'gender'" class="gender-rule-reliability">
              {{ t(TIER_LABEL[rule.reliability] ?? rule.reliability) }}
            </span>
          </div>
          <div class="gender-rule-examples">
            <template v-for="(ex, i) in rule.examples" :key="ex">
              <f7-link :href="`/word/nouns/${ex}/`" class="gender-rule-word">{{ ex }}</f7-link>
              <span v-if="i < rule.examples.length - 1" class="gender-rule-sep"> · </span>
            </template>
          </div>
          <div v-if="rule.known_exceptions?.length" class="gender-rule-exceptions">
            <span class="gender-rule-exc-label">{{ t('grammar.exceptions') }}</span>
            <template v-for="(exc, i) in rule.known_exceptions" :key="exc">
              <f7-link :href="`/word/nouns/${exc}/`" class="gender-rule-exc">{{ exc }}</f7-link>
              <span v-if="i < rule.known_exceptions.length - 1"> · </span>
            </template>
          </div>
        </div>
      </f7-block>
    </template>
  </f7-page>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "../../js/i18n.js";
import ShareButton from "../../components/ShareButton.vue";
import nounGenderData from "../../../data/rules/noun-gender.json";

const props = defineProps<{ f7route: { url: string } }>();

interface GenderRule {
  id: string;
  type: string;
  pattern: string | null;
  predicted_gender: "M" | "F" | "N";
  reliability: string;
  description_en: string;
  examples: string[];
  known_exceptions?: string[];
  false_matches?: string[];
}

interface RuleGroup {
  key: string;
  label: string;
  badge?: string;
  badgeText?: string;
  rules: GenderRule[];
}

const rules = nounGenderData.rules as GenderRule[];

const view = ref<"reliability" | "gender">("reliability");

const TIER_ORDER: Record<string, number> = {
  always: 0, nearly_always: 1, high: 2, moderate: 3,
};

const TIER_LABEL: Record<string, string> = {
  always:        "grammar.always",
  nearly_always: "grammar.nearlyAlways",
  high:          "grammar.usually",
  moderate:      "grammar.often",
};

const displayedGroups = computed<RuleGroup[]>(() => {
  if (view.value === "reliability") {
    const tiers = [
      { key: "always",        label: t("grammar.always") },
      { key: "nearly_always", label: t("grammar.nearlyAlways") },
      { key: "high",          label: t("grammar.usually") },
      { key: "moderate",      label: t("grammar.often") },
    ];
    const map: Record<string, GenderRule[]> = {};
    for (const tier of tiers) map[tier.key] = [];
    for (const rule of rules) {
      if (map[rule.reliability]) map[rule.reliability].push(rule);
    }
    return tiers
      .filter(tier => map[tier.key].length > 0)
      .map(tier => ({ key: tier.key, label: tier.label, rules: map[tier.key] }));
  } else {
    const genders = [
      { key: "M" as const, article: "der", label: "Maskulinum", badge: "gender-badge-m" },
      { key: "F" as const, article: "die", label: "Femininum",  badge: "gender-badge-f" },
      { key: "N" as const, article: "das", label: "Neutrum",    badge: "gender-badge-n" },
    ];
    const map: Record<string, GenderRule[]> = { M: [], F: [], N: [] };
    for (const rule of rules) map[rule.predicted_gender]?.push(rule);
    for (const g of Object.keys(map)) {
      map[g].sort((a, b) => (TIER_ORDER[a.reliability] ?? 9) - (TIER_ORDER[b.reliability] ?? 9));
    }
    return genders.map(g => ({
      key: g.key,
      label: g.label,
      badge: g.badge,
      badgeText: g.article,
      rules: map[g.key],
    }));
  }
});

function genderClass(g: "M" | "F" | "N") {
  return g === "M" ? "gender-badge-m" : g === "F" ? "gender-badge-f" : "gender-badge-n";
}

function genderArticle(g: "M" | "F" | "N") {
  return g === "M" ? "der" : g === "F" ? "die" : "das";
}

function rulePattern(rule: GenderRule) {
  if (rule.type === "nominalized_infinitive") return "-(e)n infinitive";
  return rule.pattern ? `-${rule.pattern}` : rule.type;
}
</script>

<style scoped>
.grammar-desc {
  color: var(--f7-block-footer-text-color);
  font-size: 14px;
  margin: 0;
}

.view-switch-block {
  padding-top: 0;
  padding-bottom: 0;
}

.noun-gender-switch {
  margin: 0;
}

.grammar-rules-block {
  padding-top: 0;
  padding-bottom: 0;
}

.gender-rule-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--f7-list-item-border-color, rgba(0,0,0,.12));
}
.gender-rule-item:last-child {
  border-bottom: none;
}

.gender-rule-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 5px;
}

.gender-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  min-width: 30px;
  text-align: center;
  flex-shrink: 0;
}
.gender-badge-m { background: var(--color-gender-m); }
.gender-badge-f { background: var(--color-gender-f); }
.gender-badge-n { background: var(--color-gender-n); }

.gender-rule-pattern {
  font-weight: 600;
  font-size: 15px;
}

.gender-rule-reliability {
  margin-left: auto;
  font-size: 12px;
  color: var(--f7-block-footer-text-color);
  flex-shrink: 0;
}

.gender-rule-examples {
  font-size: 14px;
  color: var(--f7-text-color);
}

.gender-rule-word {
  font-size: 14px;
}

.gender-rule-sep {
  color: var(--f7-block-footer-text-color);
}

.gender-rule-exceptions {
  margin-top: 4px;
  font-size: 13px;
  color: var(--f7-block-footer-text-color);
}

.gender-rule-exc-label {
  font-style: italic;
  margin-right: 2px;
}

.gender-rule-exc {
  font-size: 13px;
  color: var(--color-rule-exception);
}
</style>
