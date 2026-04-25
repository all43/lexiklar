import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

const root = resolve(__dirname, "../..");

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@admin": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "../shared/src"),
      // Reuse main app's utilities and types (read-only, never modified by admin)
      "@app": resolve(root, "src"),
      "@types": resolve(root, "types"),
      "@data": resolve(root, "data"),
      // Mock Capacitor for admin (used by storage.ts → i18n.ts)
      "@capacitor/preferences": resolve(__dirname, "src/mocks/capacitor-preferences.ts"),
    },
  },
  server: {
    port: 5174,
  },
});
