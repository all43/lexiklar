/**
 * Theme preference utilities.
 *
 * Stores the user's choice ("light" | "dark" | "auto") in localStorage
 * and applies it via Framework7's setDarkMode() API.
 */
import { f7 } from "framework7-vue";
import { getCached, setItem } from "../utils/storage.js";

export const THEME_KEY = "lexiklar_theme";

/**
 * Apply theme preference. Call on app startup and when user changes setting.
 * @param {"light"|"dark"|"auto"} value
 */
export function applyTheme(value) {
  const mode = value === "dark" ? true : value === "light" ? false : "auto";
  f7.setDarkMode(mode);
  updateThemeColorMeta();
}

/**
 * Update <meta name="theme-color"> to match current dark/light state.
 */
function updateThemeColorMeta() {
  const isDark = document.documentElement.classList.contains("dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "#000000" : "#ffffff");
}

/**
 * Read stored preference and apply. Call once on app mount.
 */
export function initTheme() {
  const stored = getCached(THEME_KEY) || "auto";
  applyTheme(stored);

  // When "auto" is active, listen for system changes to update meta tag
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = getCached(THEME_KEY) || "auto";
    if (current === "auto") updateThemeColorMeta();
  });
}
