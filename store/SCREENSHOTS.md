# Screenshot Capture Instructions

All screenshot definitions are in `store/screenshots.json`.  
7 screenshots × 5 device slots × 2 themes = 70 total shots.

Screenshots are organised by theme:
```
store/ios/screenshots/iphone/light/  01-search-homonyms.png … 07-adjective-rules.png
store/ios/screenshots/iphone/dark/   01-search-homonyms.png … 07-adjective-rules.png
```

---

## Automated capture (recommended)

```bash
npm run screenshots -- --platform ios|android [--device phone|ipad|tablet_7|tablet_10] [--mode light|dark]
```

- **Idempotent** — skips files that already exist. Delete a file to retake it.
- **Migration** — on first run, existing flat screenshots are moved into `light/` automatically.
- **Theme** — sets dark/light mode on the device before capturing, restores light mode after.
- **Preflight** — verifies the correct simulator/emulator is running before starting.

### Examples

```bash
# iOS dark, all devices (boot iPhone 14 Plus, then iPad Pro 12.9" in turn)
npm run screenshots -- --platform ios --mode dark

# iOS dark, phone only
npm run screenshots -- --platform ios --device phone --mode dark

# Android dark, phone only (Pixel_7_API_33 emulator must be running)
npm run screenshots -- --platform android --device phone --mode dark

# Android with explicit serial (if multiple emulators running)
npm run screenshots -- --platform android --device phone --mode dark --serial emulator-5554
```

---

## Prerequisites

- Xcode + iOS Simulator installed
- Android Studio + AVD Manager installed
- App built and installed on the target simulator/emulator (see setup below)

---

## iOS Setup

### Install required simulators

In Xcode: **Xcode → Settings → Platforms → iOS** — ensure iOS 18 is downloaded.

Then add devices via **Window → Devices and Simulators → Simulators → +**:
- **iPhone 14 Plus** (iOS 18) — produces 1284×2778
- **iPad Pro (12.9-inch) (6th generation)** (iPadOS 18) — produces 2048×2732

### Build and install

```bash
npm run build
npx cap sync ios
```

Open `ios/App/Lexiklar.xcodeproj` in Xcode, select the target simulator, press Run.

Boot only **one simulator at a time** before running the script (the script targets `booted`).

---

## Android Setup

### Create required AVDs in Android Studio

Open **Device Manager → +** and create:
- **Pixel 7** (API 33) — phone, 1080×2400 — AVD name: `Pixel_7_API_33`
- **Nexus 7 (2013)** (API 33) — 7-inch tablet, 1200×1920 — AVD name: `Nexus_7_2013_API_33`
- **Pixel Tablet** (API 33) — 10-inch tablet, 1600×2560 — AVD name: `Pixel_Tablet_API_33`

### Build and install

```bash
npm run build
npx cap sync android
```

Open `android/` in Android Studio, select emulator, press Run.

---

## Verification

After capture, verify dimensions:

```bash
sips -g pixelWidth -g pixelHeight store/ios/screenshots/iphone/dark/01-search-homonyms.png
# Expected: pixelWidth: 1284 / pixelHeight: 2778

sips -g pixelWidth -g pixelHeight store/ios/screenshots/ipad/dark/01-search-homonyms.png
# Expected: pixelWidth: 2048 / pixelHeight: 2732
```
