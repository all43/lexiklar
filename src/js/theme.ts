/**
 * Theme preference utilities.
 *
 * Stores the user's choice ("light" | "dark" | "auto") in persistent storage
 * and applies it via Framework7's setDarkMode() API.
 */
import { f7 } from "framework7-vue";
import { getCached } from "../utils/storage.js";

export const THEME_KEY = "lexiklar_theme";

export type ThemeValue = "light" | "dark" | "auto";

/**
 * Apply theme preference. Call on app startup and when user changes setting.
 */
export function applyTheme(value: ThemeValue): void {
  const mode: boolean | "auto" = value === "dark" ? true : value === "light" ? false : "auto";
  f7.setDarkMode(mode);
  updateThemeColorMeta();
}

/**
 * Update <meta name="theme-color"> to match current dark/light state.
 */
function updateThemeColorMeta(): void {
  const isDark = document.documentElement.classList.contains("dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "#000000" : "#ffffff");
}

/**
 * Read stored preference and apply. Call once on app mount.
 */
export function initTheme(): void {
  const stored = (getCached(THEME_KEY) || "auto") as ThemeValue;
  applyTheme(stored);

  // When "auto" is active, listen for system changes to update meta tag
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = (getCached(THEME_KEY) || "auto") as ThemeValue;
    if (current === "auto") updateThemeColorMeta();
  });
}
