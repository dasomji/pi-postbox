import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const installDocPath = join(repoRoot, "apps", "android", "README.md");

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

describe("native Android developer install documentation", () => {
  it("documents build/install commands, server URL guidance, emulator fallback, and evidence limitations", async () => {
    const exists = await fileExists(installDocPath);
    expect(exists, "apps/android/README.md should exist for developer APK install handoff").toBe(true);
    if (!exists) {
      return;
    }

    const doc = await readFile(installDocPath, "utf8");

    expect(doc, "the doc should tell developers how to run the Android unit/build gate").toMatch(
      /\.\/gradlew\s+(?:test(?:DebugUnitTest)?\s+)?assembleDebug|\.\/gradlew\s+test\s+assembleDebug/i
    );
    expect(doc, "the doc should show the debug APK install command").toMatch(
      /adb\s+install\s+-r\s+(?:app\/build\/outputs\/apk\/debug\/app-debug\.apk|apps\/android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk)/i
    );
    expect(doc, "the doc should direct real devices to the Tailnet HTTPS Postbox URL").toMatch(
      /https:\/\/[^\s]+(?:tailnet|tailscale|ts\.net)|Tailnet[^\n]+HTTPS|Tailscale[^\n]+HTTPS/i
    );
    expect(doc, "the doc should explain the Android emulator localhost fallback").toMatch(/10\.0\.2\.2|emulator[^\n]+localhost/i);
    expect(doc, "the doc should disclose the current evidence limitations for this prototype").toMatch(
      /KVM|emulator|real device|adb devices|evidence limitation|not yet installed/i
    );
    expect(doc, "the doc should note that browser Web Push is not reused by the native app").toMatch(
      /Web Push|FCM|native push|background push/i
    );
  });
});
