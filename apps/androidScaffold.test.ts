import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const androidRoot = join(repoRoot, "apps", "android");

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readText(path)) as Record<string, unknown>;
}

async function findFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
  if (!(await directoryExists(root))) {
    return [];
  }

  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findFiles(path, predicate)));
    } else if (entry.isFile() && predicate(path)) {
      found.push(path);
    }
  }
  return found;
}

type NpmPackDryRun = Array<{
  files?: Array<{ path?: string }>;
}>;

function parseNpmPackDryRun(stdout: string): NpmPackDryRun {
  const trimmed = stdout.trim();

  try {
    return JSON.parse(trimmed) as NpmPackDryRun;
  } catch {
    const jsonStart = trimmed.lastIndexOf("\n[");
    const candidate = jsonStart >= 0 ? trimmed.slice(jsonStart + 1) : trimmed;
    return JSON.parse(candidate) as NpmPackDryRun;
  }
}

async function readDryRunPackPaths(): Promise<string[]> {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false"
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000
  });
  const [pack] = parseNpmPackDryRun(String(stdout));
  return (pack.files ?? []).map((file) => String(file.path)).sort();
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (value && typeof value === "object" && Array.isArray((value as { packages?: unknown }).packages)) {
    return (value as { packages: unknown[] }).packages.map(String);
  }

  return [];
}

describe("native Android scaffold", () => {
  it("provides a self-contained Gradle Android project under apps/android", async () => {
    const requiredProjectFiles = [
      "settings.gradle.kts",
      "build.gradle.kts",
      "gradlew",
      "gradle/wrapper/gradle-wrapper.jar",
      "gradle/wrapper/gradle-wrapper.properties",
      "app/build.gradle.kts"
    ];
    const missingFiles = (
      await Promise.all(
        requiredProjectFiles.map(async (path) => ({ path, exists: await fileExists(join(androidRoot, path)) }))
      )
    )
      .filter((result) => !result.exists)
      .map((result) => `apps/android/${result.path}`);

    expect(
      missingFiles,
      "apps/android must be a self-contained Gradle project with its own wrapper and app module"
    ).toEqual([]);
    if (missingFiles.length > 0) {
      return;
    }

    const settingsGradle = await readText(join(androidRoot, "settings.gradle.kts"));
    const appGradle = await readText(join(androidRoot, "app", "build.gradle.kts"));

    expect(settingsGradle, "the Android project should include the app module").toContain("include(\":app\")");
    expect(appGradle, "the app module should apply the Android application plugin").toMatch(/com\.android\.application/);
    expect(appGradle, "the app module should use Kotlin for native Android code").toMatch(
      /org\.jetbrains\.kotlin\.android/
    );
    expect(appGradle, "Compose support should be configured in the app module").toMatch(
      /org\.jetbrains\.kotlin\.plugin\.compose|composeOptions|buildFeatures\s*\{[\s\S]*compose\s*=\s*true/
    );
    expect(appGradle, "the native placeholder UI should be able to use Material 3").toMatch(/material3/i);
    expect(appGradle, "the native client stack should include OkHttp for HTTP and SSE calls").toMatch(/okhttp/i);
    expect(appGradle, "the native client stack should include kotlinx.serialization for protocol DTOs").toMatch(
      /kotlinx-serialization|serialization-json/i
    );
  });

  it("declares the app manifest and a MainActivity entry point", async () => {
    const manifestPath = join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
    const manifestExists = await fileExists(manifestPath);
    expect(manifestExists, "apps/android/app/src/main/AndroidManifest.xml should exist").toBe(true);
    if (!manifestExists) {
      return;
    }

    const manifest = await readText(manifestPath);
    const mainActivityFiles = await findFiles(join(androidRoot, "app", "src", "main"), (path) =>
      /\.(kt|java)$/.test(path) && basename(path).startsWith("MainActivity.")
    );
    const relativeMainActivityFiles = mainActivityFiles.map((path) => relative(repoRoot, path));

    expect(relativeMainActivityFiles, "the app module should define a native MainActivity source file").not.toEqual([]);
    expect(manifest, "the Android manifest should register MainActivity as the launcher activity").toMatch(
      /MainActivity[\s\S]*android\.intent\.action\.MAIN|android\.intent\.action\.MAIN[\s\S]*MainActivity/
    );
  });

  it("keeps apps/android out of root npm workspaces and publish allowlists", async () => {
    const rootPackage = await readJson(join(repoRoot, "package.json"));
    const workspacePatterns = asStringArray(rootPackage.workspaces);
    const rootFilesAllowlist = asStringArray(rootPackage.files);
    const forbiddenAndroidPackageEntries = ["apps/android", "apps/android/", "apps/android/*", "apps/android/**"];

    expect(
      workspacePatterns,
      "the native Android project must not be added as an npm workspace; keep it Gradle-only"
    ).not.toEqual(expect.arrayContaining(forbiddenAndroidPackageEntries));
    expect(
      rootFilesAllowlist.filter((entry) => entry === "apps/android" || entry.startsWith("apps/android/")),
      "the root npm package files allowlist must not publish Android sources or build outputs"
    ).toEqual([]);
    expect(await fileExists(join(androidRoot, "package.json")), "apps/android must not contain package.json").toBe(false);

    const { stdout } = await execFileAsync("npm", ["query", ".workspace", "--json"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000
    });
    const workspaces = JSON.parse(String(stdout)) as Array<{ location?: unknown }>;
    const workspaceLocations = workspaces.map((workspace) => String(workspace.location));
    expect(workspaceLocations, "npm must not resolve apps/android as a workspace package").not.toContain("apps/android");
  });

  it("keeps the Android scaffold out of npm pack dry-run output", async () => {
    const [androidExists, packedPaths] = await Promise.all([directoryExists(androidRoot), readDryRunPackPaths()]);

    expect(androidExists, "apps/android should exist before npm pack exclusion can protect the scaffold").toBe(true);
    expect(
      packedPaths.filter((path) => path === "apps/android" || path.startsWith("apps/android/")),
      "npm pack --dry-run must not include Android project sources, wrapper files, or APK outputs"
    ).toEqual([]);
  }, 180_000);
});
