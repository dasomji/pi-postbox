import {
  ACTIVE_LOCAL_METADATA_DIRECTORY,
  ACTIVE_LOCAL_METADATA_FILENAMES,
  ACTIVE_LOCAL_METADATA_VERSION,
  ActiveLocalMetadataRecordSchema,
  normalizeActiveLocalMetadataUrl,
  type ActiveLocalMetadataRecord,
  type ActiveLocalRole,
  type ActiveLocalTargetIdentity
} from "@pi-postbox/protocol";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ActiveLocalTargetOwner {
  role: ActiveLocalRole;
  url: string;
  instanceId: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  warn?: (message: string) => void;
}

export type ActiveLocalTargetPublicationResult =
  | { ok: true; record: ActiveLocalMetadataRecord; path: string }
  | { ok: false; reason: string; path?: string };

const ACTIVE_LOCAL_MUTATION_LOCK_TIMEOUT_MS = 5_000;
const ACTIVE_LOCAL_MUTATION_LOCK_RETRY_MS = 10;

export function createActiveLocalInstanceId(): string {
  return randomUUID();
}

export async function publishActiveLocalTarget(
  owner: ActiveLocalTargetOwner
): Promise<ActiveLocalTargetPublicationResult> {
  const record = createRecord(owner);
  if (!record) {
    return { ok: false, reason: "unsafe-url" };
  }

  const path = metadataPathForRole(owner.role, owner.env);
  const result = await withMetadataMutationLock(path, owner.role, owner.warn, async () => {
    const written = await writeMetadataRecord(path, record, owner.warn);
    return written ? { ok: true as const, record, path } : { ok: false as const, reason: "write-skipped", path };
  });
  return result ?? { ok: false, reason: "write-skipped", path };
}

export async function refreshActiveLocalTarget(owner: ActiveLocalTargetOwner): Promise<ActiveLocalTargetPublicationResult> {
  const record = createRecord(owner);
  if (!record) {
    return { ok: false, reason: "unsafe-url" };
  }

  const path = metadataPathForRole(owner.role, owner.env);
  const result = await withMetadataMutationLock(path, owner.role, owner.warn, async () => {
    const current = await readCurrentRecord(path, owner.warn);
    if (!current || current.role !== owner.role || current.instanceId !== owner.instanceId) {
      return { ok: false as const, reason: "not-owner", path };
    }

    const written = await writeMetadataRecord(path, record, owner.warn);
    return written ? { ok: true as const, record, path } : { ok: false as const, reason: "write-skipped", path };
  });
  return result ?? { ok: false, reason: "write-skipped", path };
}

export async function cleanupActiveLocalTarget(owner: ActiveLocalTargetOwner): Promise<void> {
  const path = metadataPathForRole(owner.role, owner.env);
  await withMetadataMutationLock(path, owner.role, owner.warn, async () => {
    const current = await readCurrentRecord(path, owner.warn);
    if (!current || current.role !== owner.role || current.instanceId !== owner.instanceId) {
      return;
    }

    try {
      await unlink(path);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        warn(owner.warn, `Unable to remove active-local metadata for ${owner.role}: ${errorMessage(error)}`);
      }
    }
  });
}

function createRecord(owner: ActiveLocalTargetOwner): ActiveLocalMetadataRecord | undefined {
  const normalized = normalizeActiveLocalMetadataUrl(owner.url);
  if (!normalized.ok) {
    warn(owner.warn, `Skipping active-local metadata for non-loopback or unsafe URL: ${owner.url}`);
    return undefined;
  }

  return {
    version: ACTIVE_LOCAL_METADATA_VERSION,
    role: owner.role,
    url: normalized.url,
    instanceId: owner.instanceId,
    updatedAt: new Date(owner.now?.() ?? Date.now()).toISOString()
  };
}

function metadataPathForRole(role: ActiveLocalRole, env: NodeJS.ProcessEnv | undefined): string {
  return join(configBaseDir(env), ACTIVE_LOCAL_METADATA_DIRECTORY, ACTIVE_LOCAL_METADATA_FILENAMES[role]);
}

function configBaseDir(env: NodeJS.ProcessEnv | undefined): string {
  const effectiveEnv = env ?? process.env;
  if (effectiveEnv.PI_POSTBOX_CONFIG_DIR) {
    return effectiveEnv.PI_POSTBOX_CONFIG_DIR;
  }

  if (effectiveEnv.PI_POSTBOX_CONFIG_PATH) {
    return dirname(effectiveEnv.PI_POSTBOX_CONFIG_PATH);
  }

  return join(homedir(), ".pi-postbox");
}

async function withMetadataMutationLock<T>(
  path: string,
  role: ActiveLocalRole,
  warnFn: ((message: string) => void) | undefined,
  mutate: () => Promise<T>
): Promise<T | undefined> {
  const directory = dirname(path);
  const lockPath = `${path}.lock`;
  let locked = false;

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const directoryStat = await lstat(directory);
    if (directoryStat.isSymbolicLink()) {
      warn(warnFn, `Skipping active-local metadata because directory is a symlink: ${directory}`);
      return undefined;
    }

    const deadline = Date.now() + ACTIVE_LOCAL_MUTATION_LOCK_TIMEOUT_MS;
    while (!locked) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        locked = true;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) {
          warn(warnFn, `Unable to lock active-local metadata for ${role}: ${errorMessage(error)}`);
          return undefined;
        }

        if (Date.now() >= deadline) {
          warn(warnFn, `Timed out waiting to lock active-local metadata for ${role}`);
          return undefined;
        }

        await sleep(ACTIVE_LOCAL_MUTATION_LOCK_RETRY_MS);
      }
    }

    return await mutate();
  } catch (error) {
    warn(warnFn, `Unable to mutate active-local metadata for ${role}: ${errorMessage(error)}`);
    return undefined;
  } finally {
    if (locked) {
      await rmdir(lockPath).catch((error: unknown) => {
        warn(warnFn, `Unable to unlock active-local metadata for ${role}: ${errorMessage(error)}`);
      });
    }
  }
}

async function writeMetadataRecord(
  path: string,
  record: ActiveLocalMetadataRecord,
  warnFn: ((message: string) => void) | undefined
): Promise<boolean> {
  const directory = dirname(path);
  let tempPath: string | undefined;

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const directoryStat = await lstat(directory);
    if (directoryStat.isSymbolicLink()) {
      warn(warnFn, `Skipping active-local metadata because directory is a symlink: ${directory}`);
      return false;
    }

    const pathStat = await lstat(path).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    });
    if (pathStat?.isSymbolicLink()) {
      warn(warnFn, `Skipping active-local metadata because role file is a symlink: ${path}`);
      return false;
    }

    tempPath = join(directory, `.${record.role}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(tempPath, path);
    tempPath = undefined;
    return true;
  } catch (error) {
    warn(warnFn, `Unable to write active-local metadata for ${record.role}: ${errorMessage(error)}`);
    return false;
  } finally {
    if (tempPath) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

async function readCurrentRecord(
  path: string,
  warnFn: ((message: string) => void) | undefined
): Promise<ActiveLocalMetadataRecord | undefined> {
  try {
    const pathStat = await lstat(path);
    if (pathStat.isSymbolicLink()) {
      warn(warnFn, `Skipping active-local metadata because role file is a symlink: ${path}`);
      return undefined;
    }

    const parsed = ActiveLocalMetadataRecordSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      warn(warnFn, `Unable to read active-local metadata: ${errorMessage(error)}`);
    }
    return undefined;
  }
}

export function toActiveLocalTargetIdentity(record: ActiveLocalMetadataRecord): ActiveLocalTargetIdentity {
  return {
    role: record.role,
    instanceId: record.instanceId,
    url: record.url
  };
}

function warn(warnFn: ((message: string) => void) | undefined, message: string): void {
  warnFn?.(message);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
