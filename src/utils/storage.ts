/**
 * Persistent storage abstraction layer.
 *
 * Uses @capacitor/preferences on native (iOS UserDefaults, Android SharedPreferences)
 * and falls back to localStorage on web. All known keys are preloaded into an
 * in-memory cache at startup so that synchronous reads work in Vue data() and
 * module-level reactive initializers.
 *
 * Usage:
 *   import { initStorage, getCached, setItem, removeItem } from './storage.js';
 *   await initStorage();              // call once at startup (before Vue mount)
 *   const val = getCached('key');     // sync read from cache
 *   await setItem('key', 'value');    // async write (cache updated immediately)
 */
import { Preferences } from "@capacitor/preferences";

const cache = new Map<string, string>();

/** Exported key constants for use across components. */
export const SHOW_ARTICLES_KEY = "lexiklar_show_articles";
export const CONDENSED_GRAMMAR_KEY = "lexiklar_condensed_grammar";
export const SEARCH_BAR_POSITION_KEY = "lexiklar_search_position";
export const AUTO_CHECK_UPDATES_KEY = "lexiklar_auto_check_updates";
export const LAST_UPDATE_CHECK_KEY = "lexiklar_last_update_check";

export type SearchBarPosition = "auto" | "top" | "bottom";

/** All known app keys — preloaded at init. */
const KEYS = [
  "lexiklar_theme",
  SHOW_ARTICLES_KEY,
  "lexiklar_language",
  "lexiklar_favorites",
  "lexiklar_recents",
  "lexiklar_view_counts",
  "lexiklar_phrase_terms",
  SEARCH_BAR_POSITION_KEY,
  CONDENSED_GRAMMAR_KEY,
  AUTO_CHECK_UPDATES_KEY,
  LAST_UPDATE_CHECK_KEY,
] as const;

/**
 * Preload all known keys into the in-memory cache.
 * Must be called (and awaited) before any getCached() calls.
 */
export async function initStorage(): Promise<void> {
  for (const key of KEYS) {
    const { value } = await Preferences.get({ key });
    if (value !== null) cache.set(key, value);
  }
}

/**
 * Synchronous read from the in-memory cache.
 * Returns null if the key was not found.
 * @param {string} key
 * @returns {string|null}
 */
export function getCached(key: string): string | null {
  return cache.get(key) ?? null;
}

/**
 * Write a value. Updates the in-memory cache immediately,
 * then persists asynchronously.
 * @param {string} key
 * @param {string} value
 */
export async function setItem(key: string, value: string): Promise<void> {
  cache.set(key, value);
  await Preferences.set({ key, value });
}

/**
 * Remove a key. Updates the in-memory cache immediately,
 * then removes from persistent store asynchronously.
 * @param {string} key
 */
export async function removeItem(key: string): Promise<void> {
  cache.delete(key);
  await Preferences.remove({ key });
}
