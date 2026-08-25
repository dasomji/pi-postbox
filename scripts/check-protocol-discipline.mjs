import { execFileSync } from "node:child_process";

const base = process.argv[2];
if (!base) throw new Error("Usage: node scripts/check-protocol-discipline.mjs <base-ref>");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
const publicProtocolChanged = changed.some((path) => path.startsWith("packages/protocol/src/") && !path.includes(".test."));
if (!publicProtocolChanged) process.exit(0);

const currentHealth = git("show", "HEAD:packages/protocol/src/health.ts");
const baseHealth = git("show", `${base}:packages/protocol/src/health.ts`);
const versionOf = (text) => text.match(/PROTOCOL_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (versionOf(currentHealth) === versionOf(baseHealth)) {
  throw new Error("Android-facing protocol source changed without a PROTOCOL_VERSION bump.");
}

const androidIdentity = (text) => ({
  versionName: text.match(/versionName\s*=\s*"([^"]+)"/)?.[1],
  versionCode: Number(text.match(/versionCode\s*=\s*(\d+)/)?.[1])
});
const currentAndroid = androidIdentity(git("show", "HEAD:apps/android/app/build.gradle.kts"));
const baseAndroid = androidIdentity(git("show", `${base}:apps/android/app/build.gradle.kts`));
if (!currentAndroid.versionName || !baseAndroid.versionName || !Number.isInteger(currentAndroid.versionCode) || !Number.isInteger(baseAndroid.versionCode)) {
  throw new Error("Unable to parse current/base Android version identity.");
}
if (currentAndroid.versionName === baseAndroid.versionName || currentAndroid.versionCode <= baseAndroid.versionCode) {
  throw new Error("Protocol version changed without advancing Android versionName and versionCode.");
}

for (const required of [
  "apps/android/app/build.gradle.kts",
  "apps/android/app/src/main/java/dev/pi/postbox/protocol/GeneratedPostboxProtocolContract.kt",
  "packages/protocol/fixtures/android/contract.json",
  "docs/protocol.md"
]) {
  if (!changed.includes(required)) throw new Error(`Protocol version changed without required synchronized file: ${required}`);
}

const docs = git("show", "HEAD:docs/protocol.md");
if (!docs.includes(versionOf(currentHealth)) || !docs.includes(currentAndroid.versionName) || !docs.includes(`versionCode ${currentAndroid.versionCode}`)) {
  throw new Error("Protocol compatibility documentation does not contain the current protocol and Android identities.");
}

console.log(`Protocol discipline passed for ${base}...HEAD.`);
