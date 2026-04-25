<template>
  <div>
    <h1>Dashboard</h1>
    <p>Lexiklar admin interface. Use the navigation above to get started.</p>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Reports</div>
        <div class="stat-value">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Words</div>
        <div class="stat-value">~25,000</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Examples</div>
        <div class="stat-value">~96,000</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
h1 {
  margin-bottom: 0.5rem;
}
p {
  color: #666;
  margin-bottom: 2rem;
}
.stats {
  display: flex;
  gap: 1rem;
}
.stat-card {
  background: white;
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  min-width: 160px;
}
.stat-label {
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 0.25rem;
}
.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
}
</style>
