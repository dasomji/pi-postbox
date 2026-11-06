import { execFileSync } from "node:child_process";
import { assertAndroidFixtureServerVersion } from "./protocol-discipline.mjs";

const args = process.argv.slice(2);
const staged = args[0] === "--staged";
const push = args[0] === "--push";
const explicitBase = args[0] === "--base";
const suppliedBase = push || explicitBase ? args[1] : args[0];
if (
  staged
    ? args.length !== 1
    : args.length !== (push || explicitBase ? 2 : 1) ||
      !suppliedBase ||
      suppliedBase.startsWith("-")
) {
  throw new Error(
    "Usage: check-protocol-discipline.mjs [--base] <PR-target-base> | --push <previous-push-SHA> | --staged",
  );
}
if (push && /^0+$/.test(suppliedBase)) {
  throw new Error(
    "Initial push has no previous SHA; refusing an empty comparison. Use workflow_dispatch at the affected revision with a reviewed nonzero base input.",
  );
}
if (push && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(suppliedBase)) {
  throw new Error(
    "Push mode requires the full previous-push SHA from github.event.before.",
  );
}
const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
const head = git("rev-parse", "--verify", "HEAD^{commit}");
let baseCommit = head;
if (!staged) {
  try {
    baseCommit = git(
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${suppliedBase}^{commit}`,
    );
  } catch (error) {
    if (push)
      throw new Error(
        "Previous push SHA is unavailable (for example after a force-push); refusing to substitute another base. Use workflow_dispatch at the affected revision with a reviewed nonzero base input.",
      );
    throw error;
  }
}
const base = staged || push ? baseCommit : git("merge-base", baseCommit, head);
if (!staged && base === head)
  throw new Error(
    "Empty comparison: base resolves to HEAD; supply the PR target or previous push SHA.",
  );
const target = staged ? "" : "HEAD";
assertAndroidFixtureServerVersion(
  git("show", `${target}:packages/protocol/fixtures/android/contract.json`),
  git("show", `${target}:packages/server/package.json`),
);
const changed = (
  staged
    ? git("diff", "--cached", "--name-only", "--no-renames", "HEAD")
    : git("diff", "--name-only", "--no-renames", base, head)
)
  .split("\n")
  .filter(Boolean);
if (!staged && !changed.length)
  throw new Error(
    "Empty comparison: no changed paths; refusing silent success.",
  );
console.log(
  `Protocol discipline: ${staged ? "index vs HEAD" : `${push ? "push" : "PR"} ${base}..${head}`} (${changed.length} paths).`,
);
const publicProtocolChanged = changed.some(
  (path) =>
    path.startsWith("packages/protocol/src/") && !path.includes(".test."),
);
if (!publicProtocolChanged) process.exit(0);

const currentHealth = git("show", `${target}:packages/protocol/src/health.ts`);
const baseHealth = git("show", `${base}:packages/protocol/src/health.ts`);
const versionOf = (text) => text.match(/PROTOCOL_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (versionOf(currentHealth) === versionOf(baseHealth)) {
  throw new Error(
    "Android-facing protocol source changed without a PROTOCOL_VERSION bump.",
  );
}

const androidIdentity = (text) => ({
  versionName: text.match(/versionName\s*=\s*"([^"]+)"/)?.[1],
  versionCode: Number(text.match(/versionCode\s*=\s*(\d+)/)?.[1]),
});
const currentAndroid = androidIdentity(
  git("show", `${target}:apps/android/app/build.gradle.kts`),
);
const baseAndroid = androidIdentity(
  git("show", `${base}:apps/android/app/build.gradle.kts`),
);
if (
  !currentAndroid.versionName ||
  !baseAndroid.versionName ||
  !Number.isInteger(currentAndroid.versionCode) ||
  !Number.isInteger(baseAndroid.versionCode)
) {
  throw new Error("Unable to parse current/base Android version identity.");
}
if (
  currentAndroid.versionName === baseAndroid.versionName ||
  currentAndroid.versionCode <= baseAndroid.versionCode
) {
  throw new Error(
    "Protocol version changed without advancing Android versionName and versionCode.",
  );
}

for (const required of [
  "apps/android/app/build.gradle.kts",
  "apps/android/app/src/main/java/dev/pi/postbox/protocol/GeneratedPostboxProtocolContract.kt",
  "packages/protocol/fixtures/android/contract.json",
  "docs/protocol.md",
]) {
  if (!changed.includes(required))
    throw new Error(
      `Protocol version changed without required synchronized file: ${required}`,
    );
}

const docs = git("show", `${target}:docs/protocol.md`);
if (
  !docs.includes(versionOf(currentHealth)) ||
  !docs.includes(currentAndroid.versionName) ||
  !docs.includes(`versionCode ${currentAndroid.versionCode}`)
) {
  throw new Error(
    "Protocol compatibility documentation does not contain the current protocol and Android identities.",
  );
}

console.log(`Protocol discipline passed for ${base}...HEAD.`);
