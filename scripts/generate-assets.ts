/**
 * Generate splash screen PNGs for @capacitor/assets.
 * Icons use SVG sources directly (assets/icon-*.svg) — no pre-conversion needed.
 *
 * Run when the icon or brand colors change:
 *   npx tsx scripts/generate-assets.ts
 *   npx capacitor-assets generate
 */
import sharp from "sharp";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const SVG = readFileSync(join(ROOT, "public/icon.svg"));
const OUT = join(ROOT, "assets");
if (!existsSync(OUT)) mkdirSync(OUT);

const ICON_SIZE = 800; // px, centered in 2732×2732 canvas
const CANVAS = 2732;
const offset = Math.round((CANVAS - ICON_SIZE) / 2);

const icon = await sharp(SVG).resize(ICON_SIZE, ICON_SIZE).png().toBuffer();

for (const [filename, bg] of [
  ["splash.png",      { r: 255, g: 255, b: 255, alpha: 1 }],
  ["splash-dark.png", { r: 18,  g: 18,  b: 18,  alpha: 1 }],
] as const) {
  await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: bg },
  })
    .composite([{ input: icon, left: offset, top: offset }])
    .png()
    .toFile(join(OUT, filename));
  console.log(filename);
}

console.log("\nDone. Now run: npx capacitor-assets generate");
