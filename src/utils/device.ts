/**
 * Device detection using Capacitor's native bridge.
 * WKWebView freezes the UA at iOS 18, so f7.device.osVersion is unreliable
 * on iOS 26+. This module resolves the real OS version at startup.
 */
import { Device } from "@capacitor/device";

let _iOSVersion = 0; // numeric: major*10000 + minor*100 + patch (e.g. 260301)
let _platform = "web";

export async function initDevice(): Promise<void> {
  try {
    const info = await Device.getInfo();
    _platform = info.platform;
    _iOSVersion = info.iOSVersion ?? 0;
  } catch {
    // web/dev fallback — leave defaults
  }
}

/** Returns true on iOS 26 and later. */
export function isIOS26Plus(): boolean {
  return _platform === "ios" && _iOSVersion >= 260000;
}
