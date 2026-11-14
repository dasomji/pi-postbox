#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === "--unit"))
  throw Error("Usage: check:android -- [--unit]");
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), "Android/Sdk");
if (!existsSync(sdk))
  throw Error(
    `Android SDK missing: set ANDROID_HOME (looked in ${sdk}). JDK 17 required in CI; JDK 21 also supported locally.`,
  );
const p = spawnSync(
  "./apps/android/gradlew",
  [
    "-p",
    "apps/android",
    "--no-daemon",
    "--build-cache",
    "testDebugUnitTest",
    ...(args.length ? [] : ["lintDebug", "assembleDebug"]),
  ],
  { env: { ...process.env, ANDROID_HOME: sdk }, stdio: "inherit" },
);
if (p.error) throw p.error;
process.exitCode = p.status ?? 1;
