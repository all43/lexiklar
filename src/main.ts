import { createApp } from "vue";

// Framework7 CSS
import "framework7/css/bundle";

// Framework7 icons
import "framework7-icons/css/framework7-icons.css";

// Custom app styles
import "./css/app.css";

// Framework7 core + Vue plugin
import Framework7 from "framework7/lite-bundle";
// @ts-expect-error — framework7-vue bundle exports registerComponents but its .d.ts doesn't declare it
import Framework7Vue, { registerComponents } from "framework7-vue/bundle";

// Init Framework7 Vue plugin
Framework7.use(Framework7Vue);

// Persistent storage (Capacitor Preferences with sync cache)
import { initStorage, getCached, setItem, AUTO_CHECK_UPDATES_KEY, LAST_UPDATE_CHECK_KEY } from "./utils/storage.js";
import { initDevice } from "./utils/device.js";

// Database
import { initDb, checkForUpdates } from "./utils/db.js";
import { pendingDbUpdate, dbReady, dbDownloadNeeded } from "./utils/db-update-state.js";

// Live update (Capawesome — native only)
import { notifyReady, checkAppUpdate, pendingAppUpdate } from "./utils/live-update.js";

// Import root App component
import App from "./App.vue";

// Wrap initialization in async IIFE to avoid top-level await.
// Top-level await in main.ts causes a circular dependency deadlock in Chrome:
// index.js (TLA paused) ← web-*.js (Capacitor) ← index.js (still paused).
(async () => {
  await initStorage();
  await initDevice();
  try {
    await initDb();
    dbReady.value = true;
  } catch (err) {
    if (err instanceof Error && err.message === "download-needed") {
      dbDownloadNeeded.value = true;
    } else {
      console.error("Database initialization failed:", err);
    }
    // App still mounts — SearchPage shows a download prompt
  }

  // Strip query params before F7 browser history sees them
  // (query params cause F7 to push a duplicate page on initial load)
  if (window.location.search) {
    window.history.replaceState(null, "", window.location.pathname);
  }

  const app = createApp(App);
  registerComponents(app);
  app.mount("#app");

  // Notify Capawesome that current bundle is stable (prevents rollback)
  notifyReady();

  // Non-blocking background check for updates (throttled to once per 24h)
  const autoCheck = getCached(AUTO_CHECK_UPDATES_KEY) !== "0"; // on by default
  if (autoCheck) {
    const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    const lastCheck = Number(getCached(LAST_UPDATE_CHECK_KEY)) || 0;
    if (Date.now() - lastCheck > UPDATE_CHECK_INTERVAL) {
      checkForUpdates().then((info) => {
        setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
        if (info?.available) pendingDbUpdate.value = info;
      }).catch(() => { /* silent — network may be unavailable */ });
    }

    // Non-blocking check for app shell updates (native only)
    checkAppUpdate().then((info) => {
      if (info?.available) pendingAppUpdate.value = info;
    }).catch(() => { /* silent */ });
  }
})();
