/**
 * Reactive global state for DB update availability.
 * Shared between main.ts (sets it) and DbUpdatePrompt.vue (reads it).
 */

import { ref } from "vue";
import type { UpdateInfo } from "./db.js";

export const pendingDbUpdate = ref<UpdateInfo | null>(null);
