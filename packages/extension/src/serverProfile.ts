import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PackageOrigin = "local-checkout" | "npm" | "git" | "distributed";
export type ServerProfileKind = "production" | "development";

export interface ResolvedServerProfile {
  kind: ServerProfileKind;
  origin: PackageOrigin;
  id: string;
  packageRoot?: string;
  stateDir: string;
  configPath: string;
  databasePath: string;
  metadataPath: string;
  logPath: string;
}

export interface ResolveServerProfileOptions {
  packageRoot?: string;
  moduleUrl?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  stateHome?: string;
  canonicalize?: (path: string) => string;
}

export function resolveServerProfile(options: ResolveServerProfileOptions = {}): ResolvedServerProfile {
  const env = options.env ?? process.env;
  const homeDir = canonicalPath(options.homeDir ?? homedir(), options.canonicalize);
  const packageRoot = canonicalPath(
    options.packageRoot ?? packageRootFromModuleUrl(options.moduleUrl ?? import.meta.url),
    options.canonicalize
  );
  const cwd = canonicalPath(options.cwd ?? process.cwd(), options.canonicalize);
  const origin = resolvePackageOrigin({ packageRoot, cwd, homeDir });
  const explicitStateDir = env.PI_POSTBOX_CONFIG_DIR ?? (env.PI_POSTBOX_CONFIG_PATH ? dirname(env.PI_POSTBOX_CONFIG_PATH) : undefined);

  if (origin !== "local-checkout") {
    return profilePaths("production", origin, explicitStateDir ?? join(homeDir, ".pi-postbox"), env.PI_POSTBOX_CONFIG_PATH);
  }

  const checkoutId = createHash("sha256").update(packageRoot).digest("hex").slice(0, 16);
  const stateHome = canonicalPath(options.stateHome ?? env.XDG_STATE_HOME ?? join(homeDir, ".local", "state"), options.canonicalize);
  return {
    ...profilePaths(
      `development:${checkoutId}`,
      origin,
      explicitStateDir ?? join(stateHome, "pi-postbox", "dev", checkoutId),
      env.PI_POSTBOX_CONFIG_PATH
    ),
    kind: "development",
    packageRoot
  };
}

export function resolvePackageOrigin(options: { packageRoot: string; cwd: string; homeDir: string }): PackageOrigin {
  const packageRoot = normalize(resolve(options.packageRoot));
  const cwd = normalize(resolve(options.cwd));
  const homeDir = normalize(resolve(options.homeDir));

  if (isWithin(packageRoot, join(homeDir, ".pi", "agent", "npm")) || packageRoot.includes(`${join(".pi", "npm")}/`)) {
    return "npm";
  }
  if (isWithin(packageRoot, join(homeDir, ".pi", "agent", "git")) || packageRoot.includes(`${join(".pi", "git")}/`)) {
    return "git";
  }
  if (isWithin(cwd, packageRoot)) {
    return "local-checkout";
  }
  return "distributed";
}

export function packageRootFromModuleUrl(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../..");
}

function profilePaths(id: string, origin: PackageOrigin, stateDir: string, explicitConfigPath?: string): ResolvedServerProfile {
  return {
    kind: id === "production" ? "production" : "development",
    origin,
    id,
    stateDir,
    configPath: explicitConfigPath ?? join(stateDir, "config.json"),
    databasePath: join(stateDir, "postbox.sqlite"),
    metadataPath: join(stateDir, "active-local", "server.json"),
    logPath: join(stateDir, "server.log")
  };
}

function canonicalPath(path: string, canonicalize: ((path: string) => string) | undefined): string {
  const absolute = normalize(isAbsolute(path) ? path : resolve(path));
  if (canonicalize) return normalize(canonicalize(absolute));
  try {
    return normalize(realpathSync.native(absolute));
  } catch {
    return absolute;
  }
}

function isWithin(candidate: string, parent: string): boolean {
  const remainder = relative(parent, candidate);
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}
