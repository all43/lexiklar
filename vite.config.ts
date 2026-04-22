/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const gitHash = (() => {
  try { return execSync('git rev-parse --short=7 HEAD').toString().trim(); }
  catch { return 'dev'; }
})();

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      injectRegister: false,
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,woff,ttf,ico}'],
        globIgnores: ['data/**', 'sqlite3/**', 'assets/databases/**', '**/sqlite3-worker1-*', '**/sqlite3-opfs-*'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/privacy\.html$/, /^\/support\.html$/, /^\/.well-known\//],
        runtimeCaching: [
          {
            urlPattern: /\/data\/db-version\.txt$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'lexiklar-db-version' },
          },
          // /data/lexiklar.db — no SW rule needed.
          // Native: DB bundled, fetched directly (SW not active).
          // Web: DB fetched from cdn.lexiklar.app (cross-origin, outside SW scope).
          {
            urlPattern: /\/sqlite3\/sqlite3\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lexiklar-wasm',
              expiration: { maxEntries: 1 },
            },
          },
        ],
      },
      manifest: {
        name: 'Lexiklar',
        short_name: 'Lexiklar',
        description: 'Offline German dictionary with deep grammar support',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${gitHash}`),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
