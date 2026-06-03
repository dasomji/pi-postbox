import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { ProjectIcon, ProjectRegistration } from "@pi-postbox/protocol";

const MAX_ICON_BYTES = 64 * 1024;
const ALLOWED_ICON_MEDIA_TYPES = ["image/svg+xml", "image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type AllowedIconMediaType = (typeof ALLOWED_ICON_MEDIA_TYPES)[number];

interface PostboxProjectConfig {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  icon?: unknown;
}

function hashId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function resolveGitPath(cwd: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function repoNameFromGit(cwd: string, worktreePath: string | undefined): string | undefined {
  const commonDir = resolveGitPath(cwd, git(cwd, ["rev-parse", "--git-common-dir"]));
  if (commonDir) {
    if (basename(commonDir) === ".git") return basename(dirname(commonDir));
    const parent = dirname(commonDir);
    if (basename(parent) === ".git") return basename(dirname(parent));
    return basename(parent);
  }
  return worktreePath ? basename(worktreePath) : undefined;
}

function readConfig(worktreePath: string | undefined): PostboxProjectConfig {
  if (!worktreePath) return {};
  const path = join(worktreePath, ".pi-postbox.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PostboxProjectConfig;
  } catch {
    return {};
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mediaTypeFor(path: string): AllowedIconMediaType | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return undefined;
}

function iconFromDataUrl(dataUrl: string): ProjectIcon | undefined {
  if (!dataUrl.startsWith("data:")) return undefined;
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(";") > 5 ? dataUrl.indexOf(";") : dataUrl.indexOf(","));
  if (!ALLOWED_ICON_MEDIA_TYPES.includes(mediaType as AllowedIconMediaType)) return undefined;
  const allowedMediaType = mediaType as AllowedIconMediaType;
  const sizeBytes = Buffer.byteLength(dataUrl, "utf8");
  if (sizeBytes > MAX_ICON_BYTES * 2) return undefined;
  return {
    hash: `sha256:${createHash("sha256").update(dataUrl).digest("hex")}`,
    dataUrl,
    mediaType: allowedMediaType,
    sizeBytes
  };
}

function iconFromPath(worktreePath: string | undefined, iconPath: string): ProjectIcon | undefined {
  if (!worktreePath) return undefined;
  const resolved = resolve(worktreePath, iconPath);
  if (!existsSync(resolved)) return undefined;

  let realRoot: string;
  let realIcon: string;
  try {
    realRoot = realpathSync(worktreePath);
    realIcon = realpathSync(resolved);
  } catch {
    return undefined;
  }

  const relativeIcon = relative(realRoot, realIcon);
  if (relativeIcon.startsWith("..") || isAbsolute(relativeIcon)) return undefined;

  const stat = statSync(realIcon);
  if (!stat.isFile() || stat.size > MAX_ICON_BYTES) return undefined;
  const bytes = readFileSync(realIcon);
  const mediaType = mediaTypeFor(realIcon);
  if (!mediaType) return undefined;
  const dataUrl = `data:${mediaType};base64,${bytes.toString("base64")}`;
  return {
    hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    dataUrl,
    mediaType,
    sizeBytes: bytes.byteLength
  };
}

function collectIcon(worktreePath: string | undefined, config: PostboxProjectConfig): ProjectIcon | undefined {
  const icon = asString(config.icon);
  if (!icon) return undefined;
  if (icon.startsWith("data:")) return iconFromDataUrl(icon);
  return iconFromPath(worktreePath, icon);
}

export function collectProjectMetadata(cwd: string): ProjectRegistration {
  const worktreePath = git(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = git(cwd, ["branch", "--show-current"]);
  const headSha = git(cwd, ["rev-parse", "HEAD"]);
  const status = git(cwd, ["status", "--porcelain"]);
  const root = worktreePath ?? cwd;
  const repoName = repoNameFromGit(cwd, worktreePath) ?? (basename(root) || undefined);
  const config = readConfig(worktreePath);
  const displayName = asString(config.displayName) ?? asString(config.name);
  const description = asString(config.description);
  const icon = collectIcon(worktreePath, config);

  return {
    projectId: hashId("project", root),
    name: repoName ?? (basename(root) || root),
    displayName,
    description,
    cwd,
    gitRoot: worktreePath,
    repoName,
    branch,
    headSha,
    isDirty: status ? status.length > 0 : undefined,
    worktreePath,
    icon
  };
}
