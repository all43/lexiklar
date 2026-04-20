/**
 * Screenshot capture script for App Store / Play Store.
 *
 * Usage:
 *   npx tsx scripts/capture-screenshots.ts --platform ios [--device phone|ipad] [--mode light|dark]
 *   npx tsx scripts/capture-screenshots.ts --platform android [--device phone|tablet_7|tablet_10] [--mode light|dark] [--serial emulator-5554]
 *
 * On first run, existing flat screenshots are migrated to a light/ subfolder.
 * Dark screenshots are written to a dark/ subfolder.
 * If the target file already exists it is skipped — delete it to retake.
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, createWriteStream } from "fs";
import { join } from "path";
import * as readline from "readline";
import { stringArg } from "./lib/cli.js";
import screenshotsConfig from "../store/screenshots.json" with { type: "json" };

type Platform = "ios" | "android";
type Mode = "light" | "dark";

interface DeviceConfig {
  simulator?: string;
  avd?: string;
  output_dir: string;
}

const args = process.argv.slice(2);
const platform = stringArg(args, "--platform") as Platform | null;
const deviceFilter = stringArg(args, "--device");
const mode = (stringArg(args, "--mode") ?? "dark") as Mode;
const serialArg = stringArg(args, "--serial");

if (!platform || !["ios", "android"].includes(platform)) {
  console.error("Usage: --platform ios|android [--device ...] [--mode light|dark] [--serial emulator-XXXX]");
  process.exit(1);
}

// ── Device list for this platform ─────────────────────────────────────────────

const allDevices = screenshotsConfig.devices as Record<string, DeviceConfig>;
const platformPrefix = platform === "ios" ? "ios_" : "android_";
let deviceKeys = Object.keys(allDevices).filter(k => k.startsWith(platformPrefix));

if (deviceFilter) {
  const key = `${platformPrefix}${deviceFilter}`;
  if (!allDevices[key]) {
    console.error(`Unknown device: ${deviceFilter}. Available: ${deviceKeys.map(k => k.replace(platformPrefix, "")).join(", ")}`);
    process.exit(1);
  }
  deviceKeys = [key];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd: string, opts: { silent?: boolean; capture?: boolean } = {}): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: opts.capture ? "pipe" : opts.silent ? "pipe" : "inherit" });
  } catch (e: unknown) {
    if (opts.silent || opts.capture) return "";
    throw e;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, ans => { rl.close(); res(ans.trim()); }));
}

// ── Preflight: iOS ────────────────────────────────────────────────────────────

async function checkIos(cfg: DeviceConfig): Promise<void> {
  const out = run("xcrun simctl list devices booted", { capture: true });
  const match = out.match(/^\s{4}(.+?)\s+\([0-9A-F-]+\)\s+\(Booted\)/m);
  if (!match) {
    console.error("No iOS simulator is currently booted. Boot the correct simulator first.");
    process.exit(1);
  }
  const booted = match[1].trim();
  const expected = cfg.simulator!;
  if (booted !== expected) {
    console.error(`Expected simulator "${expected}" but "${booted}" is booted.\nBoot the correct simulator first.`);
    process.exit(1);
  }
  console.log(`✓ Simulator: ${booted}`);
}

// ── Preflight: Android ────────────────────────────────────────────────────────

async function checkAndroid(cfg: DeviceConfig): Promise<string> {
  const out = run("adb devices", { capture: true });
  const running = [...out.matchAll(/^(emulator-\d+)\tdevice/gm)].map(m => m[1]);

  if (running.length === 0) {
    console.error("No Android emulator is running. Start the emulator first.");
    process.exit(1);
  }

  // Resolve serial: explicit flag, or single running, or ask
  let serial: string;
  if (serialArg) {
    if (!running.includes(serialArg)) {
      console.error(`Serial ${serialArg} not found in running emulators: ${running.join(", ")}`);
      process.exit(1);
    }
    serial = serialArg;
  } else if (running.length === 1) {
    serial = running[0];
  } else {
    // Multiple emulators — show AVD names and ask
    const avdNames: Record<string, string> = {};
    for (const s of running) {
      const name = run(`adb -s ${s} emu avd name`, { capture: true }).split("\n")[0].trim();
      avdNames[s] = name;
    }
    console.log("\nMultiple emulators running:");
    running.forEach((s, i) => console.log(`  ${i + 1}. ${s}  (${avdNames[s]})`));
    const ans = await prompt("Pick number: ");
    const idx = parseInt(ans) - 1;
    if (idx < 0 || idx >= running.length) { console.error("Invalid choice."); process.exit(1); }
    serial = running[idx];
  }

  // Verify AVD name matches config
  const avdName = run(`adb -s ${serial} emu avd name`, { capture: true }).split("\n")[0].trim();
  const expected = cfg.avd!;
  if (avdName !== expected) {
    console.error(`Expected AVD "${expected}" but found "${avdName}" on ${serial}.\nStart the correct emulator.`);
    process.exit(1);
  }
  console.log(`✓ Emulator: ${serial}  (${avdName})`);
  return serial;
}

// ── Migration: move flat files into light/ ────────────────────────────────────

function migrateToLight(outputDir: string): void {
  const lightDir = join(outputDir, "light");
  const files = readdirSync(outputDir).filter(f => /^\d{2}-/.test(f) && f.endsWith(".png"));
  if (files.length === 0) return;
  mkdirSync(lightDir, { recursive: true });
  for (const f of files) {
    const src = join(outputDir, f);
    const dst = join(lightDir, f);
    renameSync(src, dst);
    console.log(`  migrated → light/${f}`);
  }
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

function setThemeIos(m: Mode): void {
  run(`xcrun simctl ui booted appearance ${m === "dark" ? "dark" : "light"}`, { silent: true });
}

function setThemeAndroid(serial: string, m: Mode): void {
  run(`adb -s ${serial} shell cmd uimode night ${m === "dark" ? "yes" : "no"}`, { silent: true });
}

// ── Capture ───────────────────────────────────────────────────────────────────

async function captureIos(outputDir: string, m: Mode): Promise<void> {
  const modeDir = join(outputDir, m);
  mkdirSync(modeDir, { recursive: true });

  for (const shot of screenshotsConfig.screenshots) {
    const filename = `${String(shot.order).padStart(2, "0")}-${shot.id}.png`;
    const dest = join(modeDir, filename);
    if (existsSync(dest)) { console.log(`  skip  ${filename}`); continue; }

    console.log(`  capture ${filename}`);
    run(`xcrun simctl openurl booted "lexiklar:///${shot.url}"`, { silent: true });
    await sleep(screenshotsConfig.capture.ios.delay_seconds * 1000);
    run(`xcrun simctl io booted screenshot "${dest}"`);
  }
}

async function captureAndroid(serial: string, outputDir: string, m: Mode): Promise<void> {
  const modeDir = join(outputDir, m);
  mkdirSync(modeDir, { recursive: true });

  for (const shot of screenshotsConfig.screenshots) {
    const filename = `${String(shot.order).padStart(2, "0")}-${shot.id}.png`;
    const dest = join(modeDir, filename);
    if (existsSync(dest)) { console.log(`  skip  ${filename}`); continue; }

    console.log(`  capture ${filename}`);
    run(`adb -s ${serial} shell am start -a android.intent.action.VIEW -d "lexiklar:///${shot.url}" app.lexiklar`, { silent: true });
    await sleep(screenshotsConfig.capture.android.delay_seconds * 1000);

    // adb exec-out outputs binary — pipe via spawnSync to file
    const result = spawnSync("adb", ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 20 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`screencap failed: ${result.stderr?.toString()}`);
    const ws = createWriteStream(dest);
    await new Promise<void>((res, rej) => { ws.write(result.stdout, err => err ? rej(err) : res()); ws.end(); });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  for (const key of deviceKeys) {
    const cfg = allDevices[key];
    const label = key.replace(platformPrefix, "");
    console.log(`\n── ${label} (${mode}) ──`);

    if (platform === "ios") {
      await checkIos(cfg);
      migrateToLight(cfg.output_dir);
      setThemeIos(mode);
      try { await captureIos(cfg.output_dir, mode); }
      finally { setThemeIos("light"); }
    } else {
      const serial = await checkAndroid(cfg);
      migrateToLight(cfg.output_dir);
      setThemeAndroid(serial, mode);
      try { await captureAndroid(serial, cfg.output_dir, mode); }
      finally { setThemeAndroid(serial, "light"); }
    }
  }
  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
