import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerRuntimeIdentity {
  version: string;
  buildId: string;
}

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const defaultRuntimeDir = dirname(fileURLToPath(import.meta.url));
let cachedIdentity: ServerRuntimeIdentity | undefined;

export function createRuntimeBuildId(version: string, runtimeDir: string): string {
  const hash = createHash("sha256");
  hash.update(`version\0${version}\0`);

  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const runtimePath = relative(runtimeDir, absolutePath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        hash.update(`directory\0${runtimePath}\0`);
        visit(absolutePath);
      } else if (entry.isFile()) {
        hash.update(`file\0${runtimePath}\0`);
        hash.update(readFileSync(absolutePath));
        hash.update("\0");
      }
    }
  };

  visit(runtimeDir);
  return `${version}+sha256.${hash.digest("hex").slice(0, 16)}`;
}

export function getServerRuntimeIdentity(): ServerRuntimeIdentity {
  if (cachedIdentity) return cachedIdentity;
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`Server package version is missing from ${packageJsonPath}`);
  }
  cachedIdentity = {
    version: packageJson.version,
    buildId: createRuntimeBuildId(packageJson.version, defaultRuntimeDir)
  };
  return cachedIdentity;
}
