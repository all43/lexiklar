---
paths:
  - "src/**"
  - "plugins/**"
  - "workers/**"
  - ".github/**"
---

# App Runtime Architecture

## Persistent storage (`src/utils/storage.ts`)
Uses `@capacitor/preferences` (iOS UserDefaults / Android SharedPreferences on native, localStorage on web/PWA). All known keys are preloaded into an in-memory `Map` at startup so that Vue `data()` initializers and module-level code can read synchronously via `getCached(key)`. Writes via `setItem(key, value)` update the cache immediately and persist asynchronously.

## Database layer (`src/utils/db.ts`, `src/utils/db-native.ts`)

Two backends, selected at startup via `Capacitor.isNativePlatform()`:

**Native (iOS/Android)** — `db-native.ts` uses `lexiklar-sqlite`, a custom Capacitor plugin (`plugins/lexiklar-sqlite/`) that wraps platform-built-in SQLite (iOS `sqlite3` C library, Android `android.database.sqlite`). No WASM, no Web Worker, no Cache API. The plugin copies the bundled DB from app assets to its storage on first launch, and compares `db-version.txt` against the installed version on app updates.

**Web/PWA** — `db.ts` runs SQLite in a Web Worker via `@sqlite.org/sqlite-wasm` (`sqlite3_deserialize` in-memory). DB bytes are cached using the **Cache API** (`caches.open()`). Flow:
  1. Try Cache API — if cached, load silently (skips `db-version.txt` check to avoid invalidation on SW update)
  2. If not cached: show download prompt with real size fetched from manifest
  3. User taps Download → `downloadDb()` fetches gzipped from `cdn.lexiklar.app` (R2)
  4. Decompresses via `DecompressionStream` or `fflate` fallback (iOS < 16.4)
  5. Cache downloaded bytes via Cache API for next time

All 20+ public query functions (`getWord`, `searchByLemma`, etc.) call the internal `query(sql, bind)` function which routes to the appropriate backend. The public API is identical regardless of platform.

**Gzip decompression** (web only): `DecompressionStream("gzip")` is a native streaming API (Chrome 80+, Firefox 113+, Safari 16.4+). Progress is tracked against the known uncompressed size from the manifest.

**Download loop prevention** (web only): `initDb()` does NOT compare cached version against `db-version.txt` (which changes on every build). Version validation happens via OTA update check instead.

**DB version hash** — content-deterministic, computed in `build-index.ts` from row-level content hashes (`SELECT file, hash FROM words` + `SELECT id, hash FROM examples`) plus `word_forms` row count and `PRAGMA table_info(words)` column list. Any data change, new search-indexed form, or schema column addition produces a new hash. Two builds of identical data always produce the same hash regardless of runner or timing. `built_at` is a full ISO timestamp (not just date).

**Schema version** — `meta.schema_version` (integer) is written by `build-index.ts` and checked by `initDb()` (web only) against `MIN_SCHEMA_VERSION` in `db.ts`. If the cached DB has a lower schema version, `initDb()` calls `cacheClear()` and throws `"download-needed"`, triggering the re-download prompt automatically. Bump both values in sync whenever columns are added or removed from the `words` table. Current: `schema_version = 4` (v3: added `superlative`; v4: added `acc_form`).

**Anti-downgrade guard** — `checkForUpdates()` requires the manifest's `built_at` to be >30 min newer than the local DB's timestamp. Prevents spurious updates when the bundled DB is ahead of R2 (e.g. `publish-data` pipeline delayed or failed). Same content hash = same data = no update regardless of timestamps.

**Native CORS** — `CapacitorHttp` is enabled in `capacitor.config.json`, routing all native `fetch()` calls through Swift/Kotlin networking instead of WKWebView. This bypasses CORS restrictions on `cdn.lexiklar.app` (which only allows `https://lexiklar.app` origins, not `capacitor://localhost`).

## Deep links

**Web (PWA)**: F7's `browserHistory` + `browserHistoryInitialMatch` on the main view handles `/word/:pos/:file/` and `/search/:query/` on reload. `main.ts` seeds browser history with `/` before pushing the deep path (preserving query string) so the back button returns home. `/favorites/` is handled in `App.vue`'s `onMounted` by switching tabs via `f7.tab.show()`. Query params `?sense=N` and `?section=<name>` are read by `WordPage.vue` and deferred to `onPageAfterIn` (or fired immediately if the page transition already completed).

**Native (iOS/Android)**: Custom URL scheme `lexiklar://` registered in `Info.plist` (`CFBundleURLTypes`) and `AndroidManifest.xml` (intent-filter via `@string/custom_url_scheme`). `@capacitor/app`'s `appUrlOpen` listener in `App.vue` parses the URL (stripping `lexiklar:///` prefix manually — `new URL()` misparses custom schemes by treating the first path segment as hostname) and navigates F7's router via `router.navigate(path + search)`. `f7route.query.section` is read by `WordPage.vue` identically to the web path.

| URL | Platform |
|---|---|
| `lexiklar://word/nouns/Tisch/` | native |
| `lexiklar://word/nouns/Tisch/?sense=2` | native |
| `lexiklar://word/nouns/Tisch/?section=grammar` | native |
| `lexiklar://word/verbs/kennen/?section=confusable-pairs` | native |
| `lexiklar://word/adjectives/schnell/?section=grammar&tab=table` | native |
| `lexiklar://word/adjectives/groß/?section=grammar&tab=rules` | native |
| `lexiklar://search/Bank/` | native |
| `lexiklar://favorites/` | native |
| `lexiklar://grammar/` | native |
| `lexiklar://grammar/noun-gender/` | native |
| `/word/nouns/Tisch/?section=grammar` | web |
| `/search/Bank/` | web |
| `/favorites/` | web |
| `/grammar/` | web |
| `/grammar/noun-gender/` | web |

**Grammar pages** (`/grammar/*`) are routed through `#tab-search` (the only view with `browserHistory: true`) so their URLs update in the browser bar. `SettingsPage` navigates programmatically via `f7.tab.show("#tab-search"); f7.views.get("#tab-search")?.router.navigate("/grammar/")`. The `appUrlOpen` handler treats `/grammar/` paths identically to `/word/` and `/search/`. The `main.ts` history seeder inserts an intermediate `/grammar/` entry for subpages (e.g. `/grammar/noun-gender/` seeds `["/" → "/grammar/" → "/grammar/noun-gender/"]`) so the back button lands on `/grammar/` with the correct URL.

**`?section=<name>` convention** — scrolls `WordPage` to element `#word-<name>` after load. Supported values: `grammar` (`#word-grammar`), `false-friend` (`#word-false-friend`), `confusable-pairs` (`#word-confusable-pairs`). Scroll is scoped to `.page-current` to avoid hitting same-named IDs on stale pages kept in F7's DOM stack. Section is read from `f7route.query.section` on both web and native.

**`?tab=<view>` convention** — for adjective word pages, overrides the cached tab preference. Values: `table` (declension table) or `rules` (condensed rules view). Passed as `initialView` prop to `AdjectiveDeclension.vue`, taking precedence over the `CONDENSED_GRAMMAR_KEY` preference. Combinable with `?section=grammar` to both scroll and set the tab in one URL.

Test on simulator: `xcrun simctl openurl booted "lexiklar:///word/nouns/Tisch/?section=grammar"`

## Custom SQLite plugin (`plugins/lexiklar-sqlite/`)

A minimal Capacitor plugin using platform-native SQLite. No encryption, no external dependencies. SPM-native (no CocoaPods).

**API** (`src/definitions.ts`):
- `open({ path, readOnly })` — open DB, copy from bundled assets if needed
- `query({ sql, params })` → `{ rows: Record<string, unknown>[] }`
- `execute({ sql, transaction })` → `{ changes: number }` — multi-statement SQL for OTA patches
- `close()` / `deleteDatabase({ path })` / `getDatabasePath()`

**Structure**: `ios/Plugin/` (Swift, single SPM target), `android/src/main/` (Java). Tests in `ios/Tests/` — run via `cd plugins/lexiklar-sqlite && swift test` (13 unit tests for the core SQLite wrapper).

**Why custom**: `@capacitor-community/sqlite` requires CocoaPods (no SPM support). Capawesome SQLite is paywalled. Our needs are minimal (open, query, execute, close) so a ~300-line custom plugin is simpler and dependency-free.

## Grammar Table Color System

Declension tables use a consistent color system defined as CSS custom properties in `src/css/app.css` (`:root` scope), with dark mode overrides under `.dark`:

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--color-gender-m` | `#2196f3` (blue) | — | Masculine articles (der/den/dem/des) |
| `--color-gender-f` | `#e91e63` (pink) | — | Feminine articles (die/der) |
| `--color-gender-n` | `#4caf50` (green) | — | Neuter articles (das/dem/des) |
| `--color-rule-match` | `#4caf50` (green) | `#66bb6a` | Rule badges (n-Deklination), n-declension endings |
| `--color-rule-exception` | `#ff9800` (orange) | `#ffa726` | Gender rule exception badges |
| `--color-vowel-change` | `#d32f2f` (red) | `#ef5350` | Umlaut vowel changes in plural forms |
| `var(--f7-theme-color)` | — | — | Adjective declension endings |
| `--color-tag-register` / `-bg` | amber | lighter amber | Sense register tags (informal, fig., dated…) |
| `--color-tag-dialect` / `-bg` | blue | lighter blue | Sense dialect tags (Austrian, Swiss, regional…) |
| `--color-tag-domain` / `-bg` | purple | lighter purple | Sense domain tags (physics, law, finance…) |
| `--color-tag-grammar-bg` | grey `rgba(0,0,0,.06)` | white tint | Sense grammar tags (transitive, reflexive…) |

Global classes `.gender-m`, `.gender-f`, `.gender-n` use `!important` to override component-level `color` rules (e.g. `.decl-num-header`).

### Adjective declension highlighting (`AdjectiveDeclension.vue`)
- **Condensed rules view**: articles colored by gender; in the no-article (strong) section, collocation nouns colored by gender instead
- **Full table view**: column headers M/F/N colored by gender; endings highlighted in theme color

### Noun declension highlighting (`NounDeclension.vue`)
- **Articles**: singular articles colored by gender (`.gender-m/f/n`); plural articles uncolored
- **N-declension endings**: detected via `isNDeclension` computed property (masculine, acc=dat=gen≠nom). Added suffix highlighted in green (`--color-rule-match`), matching the "n-Deklination" badge
- **Umlaut in plurals**: `splitUmlaut()` from `src/utils/umlaut.ts` compares singular nom with each plural form character-by-character. Detects a→ä, o→ö, u→ü, au→äu (digraph highlighted as unit). Changed vowel highlighted in red (`--color-vowel-change`). Works for compounds (Krankenhaus→Krankenhäuser). 36 test cases in `tests/umlaut.test.ts`

## Adjective declension rules

`data/rules/adj-endings.json` — static lookup table of standard endings:

```json
{
  "strong": {
    "masc":   { "nom": "er",  "acc": "en",  "dat": "em",  "gen": "en" },
    "fem":    { "nom": "e",   "acc": "e",   "dat": "er",  "gen": "er" },
    "neut":   { "nom": "es",  "acc": "es",  "dat": "em",  "gen": "en" },
    "plural": { "nom": "e",   "acc": "e",   "dat": "en",  "gen": "er" }
  },
  "weak":  { "..." },
  "mixed": { "..." }
}
```

At runtime, for a regular adjective: `form = declension_stem + endings[declType][gender][case]`.

## i18n (`src/js/i18n.ts`)
Two locales: **English** (default) and **German**. UI chrome is translated; grammar terminology (Indikativ, Konjunktiv, Nom., etc.) stays in German in both modes.

```js
import { t } from "../js/i18n.js";
// In template: {{ t('verb.zuInfinitive') }}
// In script:   computed: { t() { return t; } }
```

- Keys are namespaced by component/domain: `tab.*`, `word.*`, `noun.*`, `adj.*`, `verb.*`, `related.*`, `settings.*`, `report.*`, `pwa.*`, `dbUpdate.*`
- `t(key)` falls back to English, then to the raw key — so missing translations degrade gracefully
- Locale preference stored via `@capacitor/preferences` under `lexiklar_language` (`"auto" | "en" | "de"`)
- `"auto"` resolves to `"de"` if `navigator.language` starts with `"de"`, otherwise `"en"`
- **When adding UI text**: add the key to both `en` and `de` blocks. Grammar term labels (Partizip I, Infinitiv mit zu) stay in German in both locales.

## PWA (Progressive Web App)

Configured via `vite-plugin-pwa` in `vite.config.ts`. Capacitor provides no PWA infrastructure — it only provides cross-platform plugin APIs with web fallbacks.

**Service worker** (Workbox, `generateSW` mode):
- **Precaches app shell**: JS, CSS, HTML, fonts, icons (~2.3 MB, 13 entries)
- **Excludes from precache**: `data/lexiklar.db`, `sqlite3/*.wasm`, sqlite3 helper workers — large, handled separately
- **Runtime caching**:
  - `db-version.txt` → `NetworkFirst` (always check for fresh version)
  - `lexiklar.db` → `CacheFirst` (large file, versioned by db.ts Cache API logic)
  - `sqlite3.wasm` → `CacheFirst` (stable binary, rarely changes)
- **NavigateFallback**: `index.html` for SPA routing

**Update flow** (`registerType: 'prompt'`):
- When a new SW is detected, `PwaUpdatePrompt.vue` shows a toast at the bottom of the screen
- User taps "Update" → `updateServiceWorker()` activates the new SW and reloads
- User taps "Later" → dismisses until next visit
- Only shown on web (`v-if="isWeb"` in App.vue) — native builds don't use the SW

**Web app manifest** (generated by plugin):
- `name: "Lexiklar"`, `display: "standalone"`, `theme_color: "#1a73e8"`
- Icons: `pwa-192x192.png`, `pwa-512x512.png` (+ maskable), `apple-touch-icon.png`
- Generated from SVG source at `public/icon.svg`

**COOP/COEP headers**: set in `vite.config.ts` `server.headers` for dev only. Not needed in production — the web WASM path uses `sqlite3_deserialize` with plain `ArrayBuffer`, not `SharedArrayBuffer`. Native builds don't use WASM at all.

**Cloudflare Pages deployment**:
- `npm run deploy` — removes `lexiklar.db` from `dist/` (exceeds 25 MB limit) and deploys to Cloudflare Pages
- App shell (~4 MB: JS, CSS, HTML, WASM, icons) is served from `lexiklar.app`
- DB is fetched from `cdn.lexiklar.app` (R2) on first load after user confirmation
- Auto-deploy via `.github/workflows/deploy-pwa.yml` on push to `src/`, `public/`, etc.

**Cloudflare R2** (`cdn.lexiklar.app`):
- Bucket `lexiklar-data` with custom domain `cdn.lexiklar.app`
- CORS: restricted to `https://lexiklar.app` and `https://*.lexiklar.app`
- Stores: `manifest.json`, `lexiklar.db`, `lexiklar.db.gz`, `patches/*.sql.gz`, `bundles/<version>.zip`
- Updated by `.github/workflows/publish-data.yml` via `wrangler r2 object put`

**Interaction with OTA DB updates**: the SW does not interfere with `checkForUpdates()` — those are cross-origin fetches to CDN URLs which bypass the SW's scope.

**App version vs DB version**: these are independent. App version (`package.json`) tracks UI/code; DB version (content hash in `db-version.txt`) tracks dictionary data; SW version is implicit from Workbox content hashes.

## OTA Updates

Three independent update channels:

| Channel | What updates | Mechanism | Trigger |
|---|---|---|---|
| **PWA service worker** | App shell (HTML/CSS/JS) on web | Workbox `registerType: 'prompt'` → `PwaUpdatePrompt.vue` | Automatic (SW lifecycle) |
| **DB data update** | Dictionary content (words, examples) | `checkForUpdates()` in `db.ts` → `DbUpdatePrompt.vue` toast | Auto on startup (24h throttle) + manual in Settings |
| **Capawesome live update** | App shell on native iOS/Android | `@capawesome/capacitor-live-update` → `live-update.ts` | Auto on startup + manual in Settings |

**Asset hosting**:
- **R2 CDN** (`cdn.lexiklar.app`) — all assets: `manifest.json`, `lexiklar.db`, `lexiklar.db.gz`, `patches/*.sql.gz`, `bundles/<version>.zip`
- **GitHub Releases** — `data-*` tags kept for archival only

**Unified manifest format** (on the `manifest` release):
```json
{
  "db": {
    "current_version": "<16-char DB hash>",
    "built_at": "YYYY-MM-DD",
    "patches": { "<old_version>": { "url": "https://cdn.lexiklar.app/patches/old_to_new.sql.gz", "size": 1234 } },
    "full_db_size": 232763392,
    "full_db_gz": { "url": "https://cdn.lexiklar.app/lexiklar.db.gz", "size": 54242223 }
  },
  "bundle": {
    "current_version": "0.9.1",
    "url": "https://github.com/.../releases/download/app-v0.9.1/0.9.1.zip",
    "size": 2345678
  }
}
```

All asset URLs in the manifest are absolute R2 CDN URLs (`cdn.lexiklar.app`).

**DB update flow**:
1. `main.ts` calls `checkForUpdates()` after `initDb()` (fire-and-forget, 24h throttle via `lexiklar_last_update_check`)
2. Fetches `manifest.json` from `cdn.lexiklar.app`, reads `db` section, compares `current_version` against local DB `meta.version`
3. Prefers gzipped SQL patch (small) over full DB download (large) — patches are keyed by source version
4. **Patch apply**: download gzipped SQL → decompress → `exec_batch` (transactional). On native, plugin writes to disk directly (no serialize/cache step). On web, worker applies patch then serializes back to Cache API.
5. **Full DB replace (web)**: streams decompressed bytes to Cache API first, then reads back into worker — avoids ~500 MB peak memory that crashes iOS Safari. On native: downloads, decompresses, writes via Filesystem plugin, closes/deletes old DB, reopens.
6. `DbUpdatePrompt.vue` shows a toast; user can apply immediately or dismiss

**Capawesome flow** (`src/utils/live-update.ts`):
1. `notifyReady()` called on every startup to confirm current bundle is stable (prevents rollback)
2. `checkAppUpdate()` fetches the same `manifest.json`, reads `bundle` section, compares version against `__APP_VERSION__` using semver (ignores `+build` suffix, only updates when manifest is strictly newer — no downgrades)
3. `downloadAndApplyAppUpdate()` downloads zip via `LiveUpdate.downloadBundle()`, stages with `setNextBundle()`
4. User restarts app (or taps "Restart" in Settings) to load new bundle
5. No-op on web — PWA service worker handles app shell updates
6. Bundle excludes DB (~4 MB app shell only) — native loads DB from `Library/databases/`, not web assets

**SQL patch generation** (`scripts/publish-update.ts`):
```bash
npx tsx scripts/publish-update.ts --old <old.db> --out <dir> [--keep-patches 3] [--release-url <url>]
```
Diffs `words` and `examples` tables using the `hash` column (SHA-256 of JSON `data`). Generates INSERT/UPDATE/DELETE statements; uses `(SELECT id FROM words WHERE file = ?)` subqueries for word_id references since client DBs have different autoincrement IDs. Patches are written as `.sql.gz` (gzip level 9) and decompressed by the client before applying via `exec_batch`. `--release-url` sets the base URL for asset links in the manifest (CI passes `https://cdn.lexiklar.app`). Also generates `lexiklar.db.gz` (gzip level 9) alongside the raw DB.

**GitHub Actions**:
- **`publish-data.yml`** (`publish-db` job): triggers on push to `data/`, `scripts/build-index.ts`, or manual dispatch. Builds index, uploads DB + gzipped DB + patches + manifest to R2 CDN.
- **`deploy-pwa.yml`** (`deploy` job): triggers on push to `src/`, `public/`, etc. Builds app, deploys to Cloudflare Pages.
- **`deploy-pwa.yml`** (`publish-bundle` job): manual dispatch checkbox. Builds Capawesome OTA bundle zip, uploads to R2 (`bundles/<version>.zip`), updates manifest on R2.
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (for Pages + R2). `GITHUB_TOKEN` automatic (used by publish-data for archival releases).

## Report Worker (`workers/report-worker.js`)

Cloudflare Worker at `reports.lexiklar.app` — stores user reports (missing words, incorrect data) privately in KV.

**Configuration** (`workers/wrangler.toml`):
- KV namespace `RATE_LIMITS` for rate limiting (100/hour per IP) and report storage (`report:*` keys)
- Secret: `ADMIN_TOKEN` (Bearer token for `GET /reports`)

**Endpoints**:
- `POST /report` — submit a report (public, rate-limited)
- `GET /reports` — list all reports (requires `Authorization: Bearer <ADMIN_TOKEN>`)

**Deploy**: `cd workers && npx wrangler deploy`
**Set admin token**: `cd workers && npx wrangler secret put ADMIN_TOKEN`
**View reports**: `curl -H "Authorization: Bearer <token>" https://reports.lexiklar.app/reports`

Client-side: `src/utils/report.ts` sends reports to `https://reports.lexiklar.app/report`.
