/**
 * Reactive global state for DB update availability and readiness.
 * Shared between main.ts (sets it) and DbUpdatePrompt.vue / SearchPage (reads it).
 */

import { ref } from "vue";
import type { UpdateInfo } from "./db.js";

export const pendingDbUpdate = ref<UpdateInfo | null>(null);

/** True once initDb() completes successfully. */
export const dbReady = ref(false);

/** True when DB is not bundled/cached and needs user-confirmed download. */
export const dbDownloadNeeded = ref(false);
