<template>
  <div>
    <h1>Dashboard</h1>
    <p>Lexiklar admin interface. Use the navigation above to get started.</p>

    <div v-if="loading" class="loading">Loading stats…</div>
    <template v-else-if="stats">
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">Total Words</div>
          <div class="stat-value">{{ stats.total.toLocaleString() }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Examples</div>
          <div class="stat-value">{{ stats.total_examples.toLocaleString() }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Proofread (gloss)</div>
          <div class="stat-value">{{ stats.proofread_gloss.toLocaleString() }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Missing gloss_en</div>
          <div class="stat-value">{{ stats.missing_gloss_en.toLocaleString() }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Has Overrides</div>
          <div class="stat-value">{{ stats.has_overrides.toLocaleString() }}</div>
        </div>
      </div>

      <h2>By Part of Speech</h2>
      <div class="pos-grid">
        <div v-for="(count, pos) in stats.by_pos" :key="pos" class="pos-card">
          <div class="pos-label">{{ pos }}</div>
          <div class="pos-count">{{ count.toLocaleString() }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";

interface Stats {
  total: number;
  proofread_gloss: number;
  proofread_full: number;
  proofread_syn: number;
  has_overrides: number;
  missing_gloss_en: number;
  total_examples: number;
  by_pos: Record<string, number>;
}

const loading = ref(true);
const stats = ref<Stats | null>(null);

onMounted(async () => {
  try {
    const res = await fetch("/api/stats");
    stats.value = await res.json();
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
h1 {
  margin-bottom: 0.5rem;
}
h2 {
  margin-top: 2rem;
  margin-bottom: 0.75rem;
  font-size: 1.1rem;
}
p {
  color: var(--admin-text-secondary);
  margin-bottom: 2rem;
}
.loading {
  color: var(--admin-text-faint);
  padding: 2rem 0;
}
.stats {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.stat-card {
  background: white;
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  box-shadow: var(--admin-shadow-sm);
  min-width: 160px;
}
.stat-label {
  font-size: 0.85rem;
  color: var(--admin-text-secondary);
  margin-bottom: 0.25rem;
}
.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
}
.pos-grid {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.pos-card {
  background: white;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  box-shadow: var(--admin-shadow-sm);
  min-width: 120px;
  text-align: center;
}
.pos-label {
  font-size: 0.8rem;
  color: var(--admin-text-muted);
  margin-bottom: 0.25rem;
}
.pos-count {
  font-size: 1.2rem;
  font-weight: 600;
}
</style>
