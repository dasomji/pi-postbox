import {
  QuestionChatContextSourceSchema,
  type QuestionChatModel
} from "@pi-postbox/protocol";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

const RECOVERY_MANIFEST = "manifest.json";
const RECOVERY_HASH = /^[a-f0-9]{64}$/;

const QuestionChatRecoveryManifestSchema = z.object({
  version: z.literal(1),
  requestId: z.string().min(1).max(200),
  ownerSessionId: z.string().min(1).max(200),
  forkKind: z.enum(["exact", "context-only"]),
  cwd: z.string().min(1).max(4_000),
  privateSessionPath: z.string().min(1).max(4_000),
  chatBoundaryId: z.string().min(1).max(400).nullable(),
  sequence: z.number().int().nonnegative(),
  model: z.object({
    id: z.string().min(1).max(400),
    source: z.enum(["originating", "pi-default"]),
    fallbackReason: z.string().max(2_000).optional()
  }) satisfies z.ZodType<QuestionChatModel>,
  contextSource: QuestionChatContextSourceSchema.optional()
});

export type QuestionChatRecoveryManifest = z.infer<typeof QuestionChatRecoveryManifestSchema>;

export interface QuestionChatRecoveryRecord {
  runtimeDirectory: string;
  privateSessionPath: string;
  manifest: QuestionChatRecoveryManifest;
}

/**
 * Owns the durable recovery-manifest boundary: private directory creation,
 * finite parsing, restrictive permissions, atomic replacement, and cleanup.
 */
export interface QuestionChatRecoveryStore {
  create(requestId: string): string;
  list(): QuestionChatRecoveryRecord[];
  load(requestId: string): QuestionChatRecoveryRecord;
  write(manifest: QuestionChatRecoveryManifest): void;
  remove(requestId: string): void;
}

export class FileQuestionChatRecoveryStore implements QuestionChatRecoveryStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  create(requestId: string): string {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.assertRoot();
    const runtimeDirectory = this.runtimeDirectory(requestId);
    mkdirSync(runtimeDirectory, { recursive: false, mode: 0o700 });
    this.validateRuntimeDirectory(runtimeDirectory);
    return runtimeDirectory;
  }

  list(): QuestionChatRecoveryRecord[] {
    try {
      if (!existsSync(this.root)) return [];
      this.assertRoot();
    } catch (error) {
      if (isMissingPathError(error)) return [];
      throw error;
    }

    const records: QuestionChatRecoveryRecord[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RECOVERY_HASH.test(entry.name)) continue;
      const runtimeDirectory = join(this.root, entry.name);
      try {
        records.push(this.loadDirectory(runtimeDirectory));
      } catch {
        try {
          this.removeDirectory(runtimeDirectory);
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
    }
    return records;
  }

  load(requestId: string): QuestionChatRecoveryRecord {
    return this.loadDirectory(this.runtimeDirectory(requestId));
  }

  write(input: QuestionChatRecoveryManifest): void {
    const manifest = QuestionChatRecoveryManifestSchema.parse(input);
    const runtimeDirectory = this.runtimeDirectory(manifest.requestId);
    this.validateRuntimeDirectory(runtimeDirectory);
    // A freshly created context-only SessionManager may reserve its session
    // path before the SDK writes the first entry. Secure it as soon as it
    // exists; load/list still require a real contained file.
    if (existsSync(manifest.privateSessionPath)) {
      this.validatePrivateSessionPath(runtimeDirectory, manifest.privateSessionPath);
    }
    const manifestPath = join(runtimeDirectory, RECOVERY_MANIFEST);
    const temporaryPath = join(runtimeDirectory, `${RECOVERY_MANIFEST}.next-${randomUUID()}`);
    writeFileSync(temporaryPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, manifestPath);
    chmodSync(manifestPath, 0o600);
  }

  remove(requestId: string): void {
    const runtimeDirectory = this.runtimeDirectory(requestId);
    try {
      if (!existsSync(runtimeDirectory)) return;
      this.removeDirectory(runtimeDirectory);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }

  private loadDirectory(runtimeDirectory: string): QuestionChatRecoveryRecord {
    this.validateRuntimeDirectory(runtimeDirectory);
    const manifestPath = join(runtimeDirectory, RECOVERY_MANIFEST);
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error("Question Chat recovery manifest is not a regular file");
    }
    const manifest = QuestionChatRecoveryManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    if (this.runtimeDirectory(manifest.requestId) !== runtimeDirectory) {
      throw new Error("Question Chat recovery directory key does not match its request");
    }
    if (manifest.forkKind === "context-only" && !manifest.contextSource) {
      throw new Error("Context-only Question Chat recovery metadata is incomplete");
    }
    if (manifest.forkKind === "exact" && manifest.contextSource) {
      throw new Error("Exact Question Chat recovery metadata has the wrong fork kind");
    }
    if (!isAbsolute(manifest.cwd) || !statSync(realpathSync(manifest.cwd)).isDirectory()) {
      throw new Error("Question Chat recovery working directory is unavailable");
    }
    return {
      runtimeDirectory,
      privateSessionPath: this.validatePrivateSessionPath(runtimeDirectory, manifest.privateSessionPath),
      manifest
    };
  }

  private runtimeDirectory(requestId: string): string {
    return join(this.root, createHash("sha256").update(requestId).digest("hex"));
  }

  private assertRoot(): void {
    const configuredRootStat = lstatSync(this.root);
    if (!configuredRootStat.isDirectory() || configuredRootStat.isSymbolicLink()) {
      throw new Error("Question Chat private root is not a real directory");
    }
    const root = realpathSync(this.root);
    if (!statSync(root).isDirectory()) throw new Error("Question Chat private root is not a directory");
    chmodSync(root, 0o700);
  }

  private validateRuntimeDirectory(runtimeDirectory: string): void {
    this.assertRoot();
    const name = runtimeDirectory.slice(runtimeDirectory.lastIndexOf("/") + 1);
    if (!RECOVERY_HASH.test(name)) throw new Error("Invalid Question Chat recovery directory key");
    const configuredRuntimeStat = lstatSync(runtimeDirectory);
    if (!configuredRuntimeStat.isDirectory() || configuredRuntimeStat.isSymbolicLink()) {
      throw new Error("Question Chat recovery path is not a private directory");
    }
    const runtimeReal = realpathSync(runtimeDirectory);
    assertContained(this.root, runtimeReal);
    const runtimeStat = lstatSync(runtimeReal);
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) {
      throw new Error("Question Chat recovery path is not a private directory");
    }
    chmodSync(runtimeReal, 0o700);
  }

  private validatePrivateSessionPath(runtimeDirectory: string, privateSessionPath: string): string {
    if (!isAbsolute(privateSessionPath)) throw new Error("Question Chat private session path must be absolute");
    const configuredSessionStat = lstatSync(privateSessionPath);
    if (!configuredSessionStat.isFile() || configuredSessionStat.isSymbolicLink()) {
      throw new Error("Question Chat private session is not a regular file");
    }
    const sessionReal = realpathSync(privateSessionPath);
    assertContained(runtimeDirectory, sessionReal);
    const sessionStat = lstatSync(sessionReal);
    if (!sessionStat.isFile() || sessionStat.isSymbolicLink()) {
      throw new Error("Question Chat private session is not a regular file");
    }
    chmodSync(sessionReal, 0o600);
    return sessionReal;
  }

  private removeDirectory(runtimeDirectory: string): void {
    this.validateRuntimeDirectory(runtimeDirectory);
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

function assertContained(root: string, candidate: string): void {
  const relation = relative(resolve(root), resolve(candidate));
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Question Chat runtime path escaped its private root");
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
