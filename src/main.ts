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
import { initStorage } from "./utils/storage.js";

// Database
import { initDb } from "./utils/db.js";

// Import root App component
import App from "./App.vue";

// Initialize storage cache, then database, then mount Vue app
await initStorage();
await initDb();

const app = createApp(App);
registerComponents(app);
app.mount("#app");
