/**
 * Capawesome Live Update integration for native app shell updates.
 *
 * Bundle manifests and assets are hosted as GitHub Releases on the main repo.
 * The unified manifest at the permanent "manifest" release tag contains a
 * `bundle` section with absolute URLs to release assets.
 *
 * Web builds use the PWA service worker instead — this module is a no-op on web.
 */

import { Capacitor } from "@capacitor/core";
import { ref } from "vue";

// Same permanent release as db.ts — single manifest for both channels
const MANIFEST_URL =
  "https://github.com/all43/lexiklar/releases/download/manifest/manifest.json";

export interface AppUpdateInfo {
  available: boolean;
  version?: string;
  url?: string;
  size?: number;
}

/** Reactive state for app update availability (consumed by SettingsPage). */
export const pendingAppUpdate = ref<AppUpdateInfo | null>(null);

/** Whether an app update bundle has been downloaded and is ready to apply. */
export const appUpdateReady = ref(false);

/**
 * Check if a newer app bundle is available.
 * Only runs on native platforms — returns null on web.
 */
export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const resp = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!resp.ok) return null;

    const manifest = await resp.json();
    const bundle = manifest.bundle;
    if (!bundle) return null;

    const currentVersion = __APP_VERSION__;

    if (bundle.current_version === currentVersion) {
      return { available: false };
    }

    return {
      available: true,
      version: bundle.current_version,
      url: bundle.url,
      size: bundle.size,
    };
  } catch {
    return null;
  }
}

/**
 * Download and stage an app bundle for the next launch.
 * Call `reloadApp()` afterward to apply immediately, or let it apply on next cold start.
 */
export async function downloadAndApplyAppUpdate(info: AppUpdateInfo): Promise<{ ok: boolean; error?: string }> {
  if (!Capacitor.isNativePlatform() || !info.url || !info.version) {
    return { ok: false, error: "Not on native platform" };
  }

  try {
    const { LiveUpdate } = await import("@capawesome/capacitor-live-update");

    // Download the bundle zip
    await LiveUpdate.downloadBundle({
      bundleId: info.version,
      url: info.url,
    });

    // Set it as the bundle to load on next launch
    await LiveUpdate.setNextBundle({
      bundleId: info.version,
    });

    appUpdateReady.value = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Reload the app to apply a staged bundle update.
 */
export async function reloadApp(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.location.reload();
    return;
  }

  try {
    const { LiveUpdate } = await import("@capawesome/capacitor-live-update");
    await LiveUpdate.reload();
  } catch {
    window.location.reload();
  }
}

/**
 * Notify the plugin that the current bundle is working correctly.
 * Must be called on every app start to prevent automatic rollback.
 */
export async function notifyReady(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { LiveUpdate } = await import("@capawesome/capacitor-live-update");
    await LiveUpdate.ready();
  } catch {
    // Plugin not available — ignore
  }
}
