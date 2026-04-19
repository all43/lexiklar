# Screenshot Capture Instructions

All screenshot definitions are in `store/screenshots.json`.  
7 screenshots × 5 device slots = 35 total shots.

---

## Prerequisites

- Xcode + iOS Simulator installed
- Android Studio + AVD Manager installed
- App built and installed on each simulator/emulator (see below)

---

## iOS Setup

### Install required simulators

In Xcode: **Xcode → Settings → Platforms → iOS** — ensure iOS 18 is downloaded.

Then add devices via **Window → Devices and Simulators → Simulators → +**:
- **iPhone 14 Plus** (iOS 18) — produces 1284×2778
- **iPad Pro (12.9-inch) (6th generation)** (iPadOS 18) — produces 2048×2732

### Build and install the app

```bash
npm run build
npx cap sync ios
```

Open `ios/App/Lexiklar.xcodeproj` in Xcode, select the target simulator, press Run.

### Capture a screenshot (iPhone)

Boot iPhone 14 Plus simulator, then for each screenshot entry in `screenshots.json`:

```bash
xcrun simctl openurl booted "lexiklar://{url}"
sleep 2
xcrun simctl io booted screenshot "store/ios/screenshots/iphone/{order:02d}-{id}.png"
```

Example for entry `noun-declension`:
```bash
xcrun simctl openurl booted "lexiklar:///word/nouns/Hoffnung/?section=grammar"
sleep 2
xcrun simctl io booted screenshot "store/ios/screenshots/iphone/02-noun-declension.png"
```

### Capture a screenshot (iPad)

Same commands, but boot iPad Pro (12.9-inch) (6th generation) and use `ipad/` output folder:
```bash
xcrun simctl io booted screenshot "store/ios/screenshots/ipad/02-noun-declension.png"
```

### All 7 iOS commands (phone) — copy-paste ready

```bash
xcrun simctl openurl booted "lexiklar:///search/Bank/" && sleep 2 && xcrun simctl io booted screenshot store/ios/screenshots/iphone/01-search-homonyms.png
xcrun simctl openurl booted "lexiklar:///word/nouns/Hoffnung/?section=grammar" && sleep 2 && xcrun simctl io booted screenshot store/ios/screenshots/iphone/02-noun-declension.png
xcrun simctl openurl booted "lexiklar:///word/verbs/aufstehen/" && sleep 2 && xcrun simctl io booted screenshot store/ios/screenshots/iphone/03-verb-meanings.png
xcrun simctl openurl booted "lexiklar:///word/verbs/aufstehen/?section=grammar" && sleep 2 && xcrun simctl io booted screenshot store/ios/screenshots/iphone/04-verb-conjugation.png
xcrun simctl openurl booted "lexiklar:///word/verbs/kennen/?section=confusable-pairs" && sleep 2 && xcrun simctl io booted screenshot store/ios/screenshots/iphone/05-confusable-pairs.png
xcrun simctl openurl booted "lexiklar:///word/adjectives/schnell/?section=grammar&tab=table" && sleep 2 && xcrun simctl io booted screenshot store/ios/screenshots/iphone/06-adjective-table.png
xcrun simctl openurl booted "lexiklar:///word/adjectives/gro%C3%9F/?section=grammar&tab=rules" && sleep 2 && xcrun simctl io booted screenshot store/ios/screenshots/iphone/07-adjective-rules.png
```

---

## Android Setup

### Create required AVDs in Android Studio

Open **Device Manager → +** and create:
- **Pixel 7** (API 33) — phone, 1080×2400
- **Nexus 7 (2013)** (API 33) — 7-inch tablet, 1200×1920
- **Pixel Tablet** (API 33) — 10-inch tablet, 1600×2560

### Build and install the app

```bash
npm run build
npx cap sync android
```

Open `android/` in Android Studio, select emulator, press Run.

### Capture a screenshot (phone)

```bash
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///word/nouns/Hoffnung/?section=grammar" app.lexiklar
sleep 2
adb exec-out screencap -p > store/android/screenshots/phone/02-noun-declension.png
```

### All 7 Android commands (phone) — copy-paste ready

```bash
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///search/Bank/" app.lexiklar && sleep 2 && adb exec-out screencap -p > store/android/screenshots/phone/01-search-homonyms.png
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///word/nouns/Hoffnung/?section=grammar" app.lexiklar && sleep 2 && adb exec-out screencap -p > store/android/screenshots/phone/02-noun-declension.png
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///word/verbs/aufstehen/" app.lexiklar && sleep 2 && adb exec-out screencap -p > store/android/screenshots/phone/03-verb-meanings.png
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///word/verbs/aufstehen/?section=grammar" app.lexiklar && sleep 2 && adb exec-out screencap -p > store/android/screenshots/phone/04-verb-conjugation.png
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///word/verbs/kennen/?section=confusable-pairs" app.lexiklar && sleep 2 && adb exec-out screencap -p > store/android/screenshots/phone/05-confusable-pairs.png
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///word/adjectives/schnell/?section=grammar&tab=table" app.lexiklar && sleep 2 && adb exec-out screencap -p > store/android/screenshots/phone/06-adjective-table.png
adb shell am start -a android.intent.action.VIEW -d "lexiklar:///word/adjectives/gro%C3%9F/?section=grammar&tab=rules" app.lexiklar && sleep 2 && adb exec-out screencap -p > store/android/screenshots/phone/07-adjective-rules.png
```

For **tablet_7** and **tablet_10**: same commands, change output folder to `tablet_7/` or `tablet_10/`. If multiple emulators are running, target a specific one:
```bash
adb -s emulator-5554 exec-out screencap -p > store/android/screenshots/tablet_7/01-search-homonyms.png
```
(Use `adb devices` to list running emulator IDs.)

---

## Output Structure

```
store/ios/screenshots/
  iphone/   01-search-homonyms.png … 07-adjective-rules.png
  ipad/     01-search-homonyms.png … 07-adjective-rules.png
store/android/screenshots/
  phone/      01-search-homonyms.png … 07-adjective-rules.png
  tablet_7/   01-search-homonyms.png … 07-adjective-rules.png
  tablet_10/  01-search-homonyms.png … 07-adjective-rules.png
```

---

## Verification

After capture, verify dimensions match expectations:

```bash
sips -g pixelWidth -g pixelHeight store/ios/screenshots/iphone/01-search-homonyms.png
# Expected: pixelWidth: 1284 / pixelHeight: 2778

sips -g pixelWidth -g pixelHeight store/ios/screenshots/ipad/01-search-homonyms.png
# Expected: pixelWidth: 2048 / pixelHeight: 2732
```
