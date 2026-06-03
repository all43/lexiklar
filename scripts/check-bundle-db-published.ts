/**
 * Preflight check for native (Capacitor) release builds.
 *
 * The DB baked into the iOS/Android bundle can only receive an incremental OTA
 * *patch* if its content hash is published to R2 — i.e. it equals the manifest's
 * current_version (or one of its patch sources). When `build:mobile` bundles a
 * locally-built DB that was never run through `publish-data`, that hash is an
 * orphan off the R2 chain, so every user is offered a full DB download instead
 * of a small patch.
 *
 * This script compares the local bundle DB version against R2 and prints a loud
 * warning when they diverge. It never fails the build (network may be down, or
 * you may be intentionally testing unpublished data) — set
 * LEXIKLAR_REQUIRE_PUBLISHED_DB=1 to turn the warning into a hard error.
 *
 * Run automatically by `npm run build:mobile`; also runnable standalone:
 *   npx tsx scripts/check-bundle-db-published.ts
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const MANIFEST_URL = "https://cdn.lexiklar.app/manifest.json";

async function main(): Promise<void> {
  const versionPath = join(process.cwd(), "data", "db-version.txt");
  if (!existsSync(versionPath)) {
    console.warn("[bundle-db-check] data/db-version.txt not found — run 'npm run build-index' first. Skipping check.");
    return;
  }
  const localVersion = readFileSync(versionPath, "utf-8").trim();

  type Manifest = { db?: { current_version?: string; patches?: Record<string, unknown> } };
  let manifest: Manifest | null = null;
  try {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) manifest = (await res.json()) as Manifest;
  } catch {
    // network failure — non-fatal
  }

  if (!manifest?.db?.current_version) {
    console.warn(`[bundle-db-check] Could not fetch R2 manifest (${MANIFEST_URL}) — skipping check. Bundling local DB ${localVersion}.`);
    return;
  }

  const current = manifest.db.current_version;
  const patchSources = Object.keys(manifest.db.patches ?? {});

  if (localVersion === current) {
    console.log(`[bundle-db-check] ✓ Bundle DB ${localVersion} matches R2 current_version — users will get incremental patches.`);
    return;
  }

  const inPatchChain = patchSources.includes(localVersion);
  const lines = [
    "",
    "  ┌─────────────────────────────────────────────────────────────────────────┐",
    "  │  ⚠  NATIVE BUNDLE DB IS NOT THE PUBLISHED VERSION                         │",
    "  └─────────────────────────────────────────────────────────────────────────┘",
    `  Bundling DB:        ${localVersion}`,
    `  R2 current_version: ${current}`,
    `  R2 patch sources:   ${patchSources.length ? patchSources.join(", ") : "(none)"}`,
    "",
    inPatchChain
      ? "  This version IS a current patch source, so users will still get a patch —"
      : "  This version is NOT on the R2 patch chain. Every install will be offered a",
    inPatchChain
      ? "  but it falls off the chain after the next data publish."
      : "  FULL DB download on first launch instead of a small incremental patch.",
    "",
    "  Fix: publish the data first (push to main / run the 'Publish Dictionary Data'",
    "  workflow), then rebuild the native app from the same commit so the bundle",
    "  ships the published DB.",
    "",
  ];
  console.warn(lines.join("\n"));

  if (process.env.LEXIKLAR_REQUIRE_PUBLISHED_DB === "1") {
    console.error("[bundle-db-check] LEXIKLAR_REQUIRE_PUBLISHED_DB=1 — failing build.");
    process.exit(1);
  }
}

main();
