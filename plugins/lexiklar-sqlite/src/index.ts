import { registerPlugin } from "@capacitor/core";
import type { LexiklarSqlitePlugin } from "./definitions";

const LexiklarSqlite = registerPlugin<LexiklarSqlitePlugin>("LexiklarSqlite");

export * from "./definitions";
export { LexiklarSqlite };
