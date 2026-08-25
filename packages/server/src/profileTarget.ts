import {
  SERVER_PROFILE_METADATA_VERSION,
  ServerProfileMetadataRecordSchema,
  normalizeLoopbackUrl,
  type ServerProfileIdentity,
  type ServerProfileMetadataRecord
} from "./protocol.js";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ProfileTargetOwner {
  profile: ServerProfileIdentity;
  metadataPath: string;
  url: string;
  instanceId: string;
  protocolVersion: string;
  buildId: string;
  now?: () => number;
  warn?: (message: string) => void;
}

export type ProfileTargetPublicationResult =
  | { ok: true; record: ServerProfileMetadataRecord; path: string }
  | { ok: false; reason: string; path?: string };

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 10;

export function createProfileInstanceId(): string {
  return randomUUID();
}

export async function publishProfileTarget(owner: ProfileTargetOwner): Promise<ProfileTargetPublicationResult> {
  const record = createRecord(owner);
  if (!record) return { ok: false, reason: "unsafe-url" };
  return (await withLock(owner, async () => {
    const written = await writeRecord(owner.metadataPath, record, owner.warn);
    return written
      ? { ok: true as const, record, path: owner.metadataPath }
      : { ok: false as const, reason: "write-skipped", path: owner.metadataPath };
  })) ?? { ok: false, reason: "write-skipped", path: owner.metadataPath };
}

export async function refreshProfileTarget(owner: ProfileTargetOwner): Promise<ProfileTargetPublicationResult> {
  const record = createRecord(owner);
  if (!record) return { ok: false, reason: "unsafe-url" };
  return (await withLock(owner, async () => {
    const current = await readCurrentRecord(owner.metadataPath, owner.warn);
    if (!current || !sameOwner(current, owner)) {
      return { ok: false as const, reason: "not-owner", path: owner.metadataPath };
    }
    const written = await writeRecord(owner.metadataPath, record, owner.warn);
    return written
      ? { ok: true as const, record, path: owner.metadataPath }
      : { ok: false as const, reason: "write-skipped", path: owner.metadataPath };
  })) ?? { ok: false, reason: "write-skipped", path: owner.metadataPath };
}

export async function cleanupProfileTarget(owner: ProfileTargetOwner): Promise<void> {
  await withLock(owner, async () => {
    const current = await readCurrentRecord(owner.metadataPath, owner.warn);
    if (!current || !sameOwner(current, owner)) return;
    await unlink(owner.metadataPath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) warn(owner.warn, `Unable to remove profile metadata: ${message(error)}`);
    });
  });
}

function createRecord(owner: ProfileTargetOwner): ServerProfileMetadataRecord | undefined {
  const normalized = normalizeLoopbackUrl(owner.url);
  if (!normalized.ok) {
    warn(owner.warn, `Skipping profile metadata for non-loopback or unsafe URL: ${owner.url}`);
    return undefined;
  }
  return ServerProfileMetadataRecordSchema.parse({
    version: SERVER_PROFILE_METADATA_VERSION,
    profile: owner.profile,
    instanceId: owner.instanceId,
    url: normalized.url,
    protocolVersion: owner.protocolVersion,
    buildId: owner.buildId,
    updatedAt: new Date(owner.now?.() ?? Date.now()).toISOString()
  });
}

async function withLock<T>(owner: ProfileTargetOwner, mutate: () => Promise<T>): Promise<T | undefined> {
  const directory = dirname(owner.metadataPath);
  const lockPath = `${owner.metadataPath}.lock`;
  let locked = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) {
      warn(owner.warn, `Skipping profile metadata because directory is a symlink: ${directory}`);
      return undefined;
    }
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (!locked) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        locked = true;
      } catch (error) {
        if (!isNodeError(error, "EEXIST") || Date.now() >= deadline) {
          warn(owner.warn, `Unable to lock profile metadata: ${message(error)}`);
          return undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
    return await mutate();
  } catch (error) {
    warn(owner.warn, `Unable to mutate profile metadata: ${message(error)}`);
    return undefined;
  } finally {
    if (locked) await rmdir(lockPath).catch(() => undefined);
  }
}

async function writeRecord(
  path: string,
  record: ServerProfileMetadataRecord,
  warnFn: ((message: string) => void) | undefined
): Promise<boolean> {
  const directory = dirname(path);
  let tempPath: string | undefined;
  try {
    const pathStat = await lstat(path).catch((error: unknown) => isNodeError(error, "ENOENT") ? undefined : Promise.reject(error));
    if (pathStat?.isSymbolicLink()) {
      warn(warnFn, `Skipping profile metadata because server.json is a symlink: ${path}`);
      return false;
    }
    tempPath = join(directory, `.server.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(tempPath, path);
    tempPath = undefined;
    return true;
  } catch (error) {
    warn(warnFn, `Unable to write profile metadata: ${message(error)}`);
    return false;
  } finally {
    if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function readCurrentRecord(path: string, warnFn?: (message: string) => void) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return undefined;
    const parsed = ServerProfileMetadataRecordSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) warn(warnFn, `Unable to read profile metadata: ${message(error)}`);
    return undefined;
  }
}

function sameOwner(record: ServerProfileMetadataRecord, owner: ProfileTargetOwner): boolean {
  return record.profile.kind === owner.profile.kind
    && record.profile.id === owner.profile.id
    && record.instanceId === owner.instanceId;
}

function warn(warnFn: ((message: string) => void) | undefined, value: string): void {
  warnFn?.(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
