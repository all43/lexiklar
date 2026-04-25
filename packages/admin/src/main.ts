import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { initStorage } from "@app/utils/storage.js";

// Shared design tokens + component styles (no F7 dependency)
import "@shared/tokens.css";
import "@shared/components.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./pages/DashboardPage.vue") },
    { path: "/reports", component: () => import("./pages/ReportsPage.vue") },
  ],
});

async function main() {
  await initStorage();
  const app = createApp(App);
  app.use(router);
  app.mount("#app");
}

main();
