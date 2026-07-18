import { execFile } from "node:child_process";
import { constants, type Dir, type Stats } from "node:fs";
import { lstat, open, opendir, readlink, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";

const TOOL_PATH_MAX = 4_000;
const GIT_TIMEOUT_MS = 2_000;
export const REPOSITORY_EVIDENCE_FILE_BYTES_MAX = 64 * 1024;
export const REPOSITORY_EVIDENCE_OUTPUT_MAX = 16 * 1024;
export const REPOSITORY_EVIDENCE_ENTRY_MAX = 200;
export const REPOSITORY_EVIDENCE_MATCH_MAX = 100;
export const REPOSITORY_EVIDENCE_TRAVERSAL_MAX = 1_000;
export const REPOSITORY_EVIDENCE_DEPTH_MAX = 12;
const SEARCH_QUERY_MAX = 200;
const OPERATION_TIMEOUT_MS = 5_000;
export const REPOSITORY_EVIDENCE_TOOL_NAMES = [
  "repository_read",
  "repository_grep",
  "repository_find",
  "repository_list"
] as const;

const ReadInputSchema = z.object({ path: z.string().min(1).max(TOOL_PATH_MAX) }).strict();
const ListInputSchema = z.object({ path: z.string().min(1).max(TOOL_PATH_MAX).optional() }).strict();
const GrepInputSchema = z.object({
  query: z.string().min(1).max(SEARCH_QUERY_MAX),
  path: z.string().min(1).max(TOOL_PATH_MAX).optional(),
  ignoreCase: z.boolean().optional(),
  limit: z.number().int().min(1).max(REPOSITORY_EVIDENCE_MATCH_MAX).optional()
}).strict();
const FindInputSchema = z.object({
  query: z.string().min(1).max(SEARCH_QUERY_MAX),
  path: z.string().min(1).max(TOOL_PATH_MAX).optional(),
  limit: z.number().int().min(1).max(REPOSITORY_EVIDENCE_ENTRY_MAX).optional()
}).strict();
const SECRET_EXTENSION = /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/i;
const SECRET_BASENAME = /^(?:\.env(?:\..+)?|credentials?(?:\..+)?|tokens?\.json|service-account\.json|auth\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..+)?|authinfo|\.?(?:netrc|npmrc|pypirc))$/i;
const SECRET_SEGMENT = /(?:^|[._-])(?:secrets?|credentials?|access-token|refresh-token|auth-token|token-store|signing-key|private-key)(?:[._-]|$)/i;
const SECRET_DIRECTORY = /^(?:\.aws|\.ssh|\.docker|\.gnupg)$/i;

export interface RepositoryEvidenceToolSet {
  scopeRoot: string;
  tools: ToolDefinition[];
}

export interface RepositoryEvidenceGitRunner {
  run(
    args: string[],
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
  ): Promise<{ exitCode: number; stdout: string }>;
}

export interface RepositoryEvidenceToolOptions {
  gitRunner?: RepositoryEvidenceGitRunner;
  operationTimeoutMs?: number;
}

export async function createRepositoryEvidenceTools(
  recordedCwd: string,
  options: RepositoryEvidenceToolOptions = {}
): Promise<RepositoryEvidenceToolSet> {
  let cwd: string;
  try {
    cwd = await realpath(recordedCwd);
  } catch {
    throw targetUnavailable();
  }
  const scope = await discoverScope(cwd, options.gitRunner ?? defaultGitRunner);
  const { scopeRoot } = scope;
  const configuredOperationTimeout = options.operationTimeoutMs ?? OPERATION_TIMEOUT_MS;
  const operationTimeoutMs = Number.isFinite(configuredOperationTimeout)
    ? Math.max(1, Math.min(OPERATION_TIMEOUT_MS, configuredOperationTimeout))
    : OPERATION_TIMEOUT_MS;
  const readTool = defineTool({
    name: "repository_read",
    label: "Read repository file",
    description: "Read one text file inside the originating repository evidence scope.",
    parameters: Type.Object(
      { path: Type.String({ minLength: 1, maxLength: TOOL_PATH_MAX }) },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, input, signal) {
      try {
        const parsed = parseInput(ReadInputSchema, input);
        const operation = new EvidenceOperation(signal, operationTimeoutMs);
        const target = await validateEvidencePath(scope, parsed.path, "file", operation);
        const file = await readOpenedFile(target.path, operation, REPOSITORY_EVIDENCE_FILE_BYTES_MAX + 1);
        if (file.binary) throw binaryUnavailable();
        const truncated = file.bytesRead > REPOSITORY_EVIDENCE_FILE_BYTES_MAX;
        const text = file.bytes.subarray(0, REPOSITORY_EVIDENCE_FILE_BYTES_MAX).toString("utf8").replace(/\n$/, "");
        const output = truncateOutput(text, truncated);
        return {
          content: [{ type: "text" as const, text: output.text }],
          details: { target: displayPath(scopeRoot, target.path), truncated: output.truncated }
        };
      } catch (error) {
        throw sanitizedToolError(error);
      }
    }
  });
  const listTool = defineTool({
    name: "repository_list",
    label: "List repository directory",
    description: "List safe entries in one directory inside the originating repository evidence scope.",
    parameters: Type.Object(
      { path: Type.Optional(Type.String({ minLength: 1, maxLength: TOOL_PATH_MAX })) },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, input, signal) {
      try {
        const parsed = parseInput(ListInputSchema, input);
        const operation = new EvidenceOperation(signal, operationTimeoutMs);
        const target = await validateEvidencePath(scope, parsed.path ?? ".", "directory", operation);
        const visible: string[] = [];
        let visited = 0;
        let traversalTruncated = false;
        const directory = await operation.waitForResource(opendir(target.path), (openedDirectory) => openedDirectory.close());
        try {
          while (true) {
            const entry = await operation.wait(directory.read());
            if (!entry) break;
            operation.check();
            visited += 1;
            if (visited > REPOSITORY_EVIDENCE_ENTRY_MAX) {
              traversalTruncated = true;
              break;
            }
            const entryPath = join(target.path, entry.name);
            try {
              const resolvedEntry = await validateEvidencePath(scope, entryPath, "any", operation);
              visible.push(`${entry.name}${resolvedEntry.isDirectory ? "/" : ""}`);
            } catch (error) {
              if (isOperationControlError(error)) throw error;
              // Denied and concurrently removed entries are omitted without revealing their names.
            }
          }
        } finally {
          closeDirectory(directory, operation);
        }
        visible.sort((left, right) => left.localeCompare(right));
        const output = truncateOutput(visible.join("\n"), traversalTruncated);
        return {
          content: [{ type: "text" as const, text: output.text }],
          details: { target: displayPath(scopeRoot, target.path), truncated: output.truncated }
        };
      } catch (error) {
        throw sanitizedToolError(error);
      }
    }
  });
  const grepTool = defineTool({
    name: "repository_grep",
    label: "Search repository text",
    description: "Search for a literal text string in safe repository files; regular expressions are not accepted.",
    parameters: Type.Object(
      {
        query: Type.String({ minLength: 1, maxLength: SEARCH_QUERY_MAX }),
        path: Type.Optional(Type.String({ minLength: 1, maxLength: TOOL_PATH_MAX })),
        ignoreCase: Type.Optional(Type.Boolean()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: REPOSITORY_EVIDENCE_MATCH_MAX }))
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, input, signal) {
      try {
        const parsed = parseInput(GrepInputSchema, input);
        const operation = new EvidenceOperation(signal, operationTimeoutMs);
        const limit = parsed.limit ?? REPOSITORY_EVIDENCE_MATCH_MAX;
        const files = await collectEvidenceFiles(scope, parsed.path ?? ".", operation);
        const query = parsed.ignoreCase ? parsed.query.toLocaleLowerCase() : parsed.query;
        const matches: string[] = [];
        let contentTruncated = false;
        for (const file of files.files) {
          operation.check();
          const opened = await readOpenedFile(file.path, operation, REPOSITORY_EVIDENCE_FILE_BYTES_MAX + 1);
          if (opened.binary) continue;
          contentTruncated ||= opened.bytesRead > REPOSITORY_EVIDENCE_FILE_BYTES_MAX;
          const searchableText = opened.bytes.subarray(0, REPOSITORY_EVIDENCE_FILE_BYTES_MAX).toString("utf8");
          for (const [index, line] of searchableText.split(/\r?\n/).entries()) {
            const candidate = parsed.ignoreCase ? line.toLocaleLowerCase() : line;
            if (!candidate.includes(query)) continue;
            matches.push(`${file.display}:${index + 1}:${line.slice(0, 1_000)}`);
            if (matches.length >= limit) break;
          }
          if (matches.length >= limit) break;
        }
        const output = truncateOutput(matches.join("\n"), files.truncated || contentTruncated || matches.length >= limit);
        return {
          content: [{ type: "text" as const, text: output.text }],
          details: { target: displayRequestedPath(scopeRoot, parsed.path), matches: matches.length, truncated: output.truncated }
        };
      } catch (error) {
        throw sanitizedToolError(error);
      }
    }
  });
  const findTool = defineTool({
    name: "repository_find",
    label: "Find repository files",
    description: "Find safe repository file paths containing a literal name fragment.",
    parameters: Type.Object(
      {
        query: Type.String({ minLength: 1, maxLength: SEARCH_QUERY_MAX }),
        path: Type.Optional(Type.String({ minLength: 1, maxLength: TOOL_PATH_MAX })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: REPOSITORY_EVIDENCE_ENTRY_MAX }))
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, input, signal) {
      try {
        const parsed = parseInput(FindInputSchema, input);
        const operation = new EvidenceOperation(signal, operationTimeoutMs);
        const limit = parsed.limit ?? REPOSITORY_EVIDENCE_ENTRY_MAX;
        const files = await collectEvidenceFiles(scope, parsed.path ?? ".", operation);
        const query = parsed.query.toLocaleLowerCase();
        const matches = files.files
          .map((file) => file.display)
          .filter((path) => path.toLocaleLowerCase().includes(query))
          .slice(0, limit);
        const output = truncateOutput(matches.join("\n"), files.truncated || matches.length >= limit);
        return {
          content: [{ type: "text" as const, text: output.text }],
          details: { target: displayRequestedPath(scopeRoot, parsed.path), matches: matches.length, truncated: output.truncated }
        };
      } catch (error) {
        throw sanitizedToolError(error);
      }
    }
  });

  return {
    scopeRoot,
    tools: [
      readTool,
      grepTool,
      findTool,
      listTool
    ]
  };
}

interface EvidenceScope {
  scopeRoot: string;
  gitRoot?: string;
  gitRunner: RepositoryEvidenceGitRunner;
}

async function discoverScope(cwd: string, gitRunner: RepositoryEvidenceGitRunner): Promise<EvidenceScope> {
  let result: { exitCode: number; stdout: string };
  try {
    result = await gitRunner.run(["rev-parse", "--show-toplevel"], {
      cwd,
      timeoutMs: GIT_TIMEOUT_MS
    });
  } catch {
    throw accessDenied();
  }
  if (result.exitCode !== 0) return { scopeRoot: cwd, gitRunner };
  try {
    const root = await realpath(result.stdout.trim());
    assertContained(root, cwd);
    return { scopeRoot: root, gitRoot: root, gitRunner };
  } catch {
    throw accessDenied();
  }
}

async function validateEvidencePath(
  scope: EvidenceScope,
  requestedPath: string,
  expected: "file" | "directory" | "any",
  operation: EvidenceOperation
): Promise<{ path: string; isDirectory: boolean }> {
  const { scopeRoot } = scope;
  const candidate = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(scopeRoot, requestedPath);
  assertContained(scopeRoot, candidate);
  assertNotSecret(scopeRoot, candidate);
  operation.check();

  const child = relative(scopeRoot, candidate);
  const components = child ? child.split(sep) : [];
  let current = scopeRoot;
  let finalPath = scopeRoot;
  let finalStat = await safeLstat(scopeRoot, operation);
  let finalWasSymlink = false;
  const symlinkTargets: string[] = [];
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    const configuredStat = await safeLstat(current, operation);
    const finalComponent = index === components.length - 1;
    if (configuredStat.isSymbolicLink()) {
      if (!finalComponent) throw accessDenied();
      const resolvedTarget = await resolveFinalSymlinkChain(scopeRoot, current, operation);
      finalPath = resolvedTarget.path;
      finalStat = resolvedTarget.stat;
      symlinkTargets.push(...resolvedTarget.targets);
      finalWasSymlink = true;
      continue;
    }
    if (!finalComponent && !configuredStat.isDirectory()) throw targetUnavailable();
    finalPath = current;
    finalStat = configuredStat;
  }
  if (finalWasSymlink && finalStat.isDirectory()) throw accessDenied();
  if (
    (expected === "file" && !finalStat.isFile()) ||
    (expected === "directory" && !finalStat.isDirectory()) ||
    (expected === "any" && !finalStat.isFile() && !finalStat.isDirectory())
  ) throw targetUnavailable();
  if (await isIgnored(scope, candidate, operation)) throw accessDenied();
  for (const target of new Set(symlinkTargets)) {
    if (await isIgnored(scope, target, operation)) throw accessDenied();
  }
  return { path: finalPath, isDirectory: finalStat.isDirectory() };
}

async function resolveFinalSymlinkChain(
  scopeRoot: string,
  initialLink: string,
  operation: EvidenceOperation
): Promise<{ path: string; stat: Stats; targets: string[] }> {
  const seen = new Set<string>();
  const targets: string[] = [];
  let linkPath = initialLink;
  for (let hop = 0; hop < 40; hop += 1) {
    if (seen.has(linkPath)) throw accessDenied();
    seen.add(linkPath);
    const configuredTarget = await safeReadlink(linkPath, operation);
    const target = isAbsolute(configuredTarget)
      ? resolve(configuredTarget)
      : resolve(dirname(linkPath), configuredTarget);
    assertContained(scopeRoot, target);
    assertNotSecret(scopeRoot, target);
    targets.push(target);

    const child = relative(scopeRoot, target);
    const components = child ? child.split(sep) : [];
    let current = scopeRoot;
    let currentStat = await safeLstat(scopeRoot, operation);
    let foundNextLink = false;
    for (const [index, component] of components.entries()) {
      current = join(current, component);
      currentStat = await safeLstat(current, operation);
      const finalComponent = index === components.length - 1;
      if (currentStat.isSymbolicLink()) {
        if (!finalComponent) throw accessDenied();
        linkPath = current;
        foundNextLink = true;
        break;
      }
      if (!finalComponent && !currentStat.isDirectory()) throw targetUnavailable();
    }
    if (!foundNextLink) return { path: target, stat: currentStat, targets };
  }
  throw accessDenied();
}

async function collectEvidenceFiles(
  scope: EvidenceScope,
  requestedPath: string,
  operation: EvidenceOperation
): Promise<{ files: Array<{ path: string; display: string }>; truncated: boolean }> {
  const start = await validateEvidencePath(scope, requestedPath, "any", operation);
  if (!start.isDirectory) {
    return { files: [{ path: start.path, display: displayPath(scope.scopeRoot, start.path) }], truncated: false };
  }
  const files: Array<{ path: string; display: string }> = [];
  const directories: Array<{ path: string; depth: number }> = [{ path: start.path, depth: 0 }];
  let visited = 0;
  let truncated = false;
  while (directories.length > 0) {
    operation.check();
    const directory = directories.shift()!;
    let entries;
    try {
      entries = await operation.waitForResource(opendir(directory.path), (openedDirectory) => openedDirectory.close());
    } catch (error) {
      if (isOperationControlError(error)) throw error;
      throw targetUnavailable();
    }
    try {
      while (true) {
        const entry = await operation.wait(entries.read());
        if (!entry) break;
        operation.check();
        visited += 1;
        if (visited > REPOSITORY_EVIDENCE_TRAVERSAL_MAX) {
          truncated = true;
          break;
        }
        const entryPath = join(directory.path, entry.name);
        try {
          const resolvedEntry = await validateEvidencePath(scope, entryPath, "any", operation);
          if (resolvedEntry.isDirectory) {
            if (directory.depth >= REPOSITORY_EVIDENCE_DEPTH_MAX) {
              truncated = true;
              continue;
            }
            directories.push({ path: entryPath, depth: directory.depth + 1 });
          } else {
            files.push({ path: resolvedEntry.path, display: displayPath(scope.scopeRoot, entryPath) });
          }
        } catch (error) {
          if (isOperationControlError(error)) throw error;
          // Denied and concurrently removed entries are excluded from traversal.
        }
      }
    } finally {
      closeDirectory(entries, operation);
    }
    if (visited > REPOSITORY_EVIDENCE_TRAVERSAL_MAX) break;
  }
  return { files, truncated };
}

async function readOpenedFile(
  path: string,
  operation: EvidenceOperation,
  byteLimit: number
): Promise<{ bytes: Buffer; bytesRead: number; binary: boolean }> {
  const handle = await operation.waitForResource(
    open(path, constants.O_RDONLY | constants.O_NOFOLLOW),
    (openedHandle) => openedHandle.close()
  );
  try {
    if (!(await operation.wait(handle.stat())).isFile()) throw targetUnavailable();
    const buffer = Buffer.alloc(byteLimit);
    const { bytesRead } = await operation.wait(handle.read(buffer, 0, buffer.length, 0));
    operation.check();
    const bytes = buffer.subarray(0, bytesRead);
    return { bytes, bytesRead, binary: bytes.includes(0) };
  } catch (error) {
    throw sanitizedToolError(error);
  } finally {
    closeFile(handle, operation);
  }
}

function assertContained(root: string, candidate: string): void {
  const child = relative(root, candidate);
  if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) return;
  throw accessDenied();
}

export function isRepositoryEvidenceRestrictedPath(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => segment === ".." || isRepositoryEvidenceSecretName(basename(segment)));
}

function isRepositoryEvidenceSecretName(name: string): boolean {
  return (
    name.toLowerCase() === ".git" ||
    SECRET_DIRECTORY.test(name) ||
    SECRET_BASENAME.test(name) ||
    SECRET_EXTENSION.test(name) ||
    SECRET_SEGMENT.test(name)
  );
}

function assertNotSecret(scopeRoot: string, candidate: string): void {
  const child = relative(scopeRoot, candidate);
  for (const segment of child.split(sep)) {
    if (isRepositoryEvidenceSecretName(basename(segment))) throw accessDenied();
  }
}

async function isIgnored(scope: EvidenceScope, candidate: string, operation: EvidenceOperation): Promise<boolean> {
  if (!scope.gitRoot) return false;
  const child = relative(scope.gitRoot, candidate);
  assertContained(scope.gitRoot, candidate);
  if (!child) return false;
  operation.check();
  try {
    const result = await operation.wait(
      scope.gitRunner.run(["check-ignore", "--no-index", "--quiet", "--", child], {
        cwd: scope.gitRoot,
        timeoutMs: operation.subprocessTimeout(GIT_TIMEOUT_MS),
        signal: operation.signal
      })
    );
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    throw accessDenied();
  } catch (error) {
    if (isOperationControlError(error)) throw error;
    throw accessDenied();
  }
}

const defaultGitRunner: RepositoryEvidenceGitRunner = {
  run(args, options) {
    return new Promise((resolveRun, rejectRun) => {
      execFile(
        "git",
        args,
        {
          cwd: options.cwd,
          encoding: "utf8",
          timeout: options.timeoutMs,
          maxBuffer: 16_384,
          windowsHide: true,
          signal: options.signal
        },
        (error, stdout) => {
          if (!error) {
            resolveRun({ exitCode: 0, stdout });
            return;
          }
          const exitCode = (error as { code?: unknown }).code;
          if (typeof exitCode === "number") {
            resolveRun({ exitCode, stdout });
            return;
          }
          rejectRun(error);
        }
      );
    });
  }
};

function accessDenied(): Error {
  return new EvidenceToolError("Repository evidence access denied.");
}

function targetUnavailable(): Error {
  return new EvidenceToolError("Repository evidence target is unavailable.");
}

function binaryUnavailable(): Error {
  return new EvidenceToolError("Repository evidence binary files are unavailable.");
}

function invalidArguments(): Error {
  return new EvidenceToolError("Repository evidence arguments are invalid.");
}

function operationTimedOut(): Error {
  return new EvidenceToolError("Repository evidence operation timed out.");
}

class EvidenceToolError extends Error {}

class EvidenceOperation {
  private readonly deadline: number;

  constructor(readonly signal: AbortSignal | undefined, timeoutMs: number) {
    this.deadline = Date.now() + timeoutMs;
    this.check();
  }

  check(): void {
    this.signal?.throwIfAborted();
    if (Date.now() >= this.deadline) throw operationTimedOut();
  }

  subprocessTimeout(maximum: number): number {
    this.check();
    return Math.max(1, Math.min(maximum, this.deadline - Date.now()));
  }

  async wait<T>(promise: Promise<T>): Promise<T> {
    this.check();
    const remaining = Math.max(1, this.deadline - Date.now());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(operationTimedOut()), remaining);
    });
    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (!this.signal) return;
      abortListener = () => reject(this.signal?.reason ?? Object.assign(new Error("Operation aborted."), { name: "AbortError" }));
      this.signal.addEventListener("abort", abortListener, { once: true });
      if (this.signal.aborted) abortListener();
    });
    try {
      return await Promise.race([promise, timeoutPromise, abortPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortListener) this.signal?.removeEventListener("abort", abortListener);
    }
  }

  async waitForResource<T>(promise: Promise<T>, release: (resource: T) => Promise<unknown>): Promise<T> {
    try {
      return await this.wait(promise);
    } catch (error) {
      void promise.then((resource) => release(resource)).catch(() => undefined);
      throw error;
    }
  }
}

function parseInput<Schema extends z.ZodTypeAny>(schema: Schema, input: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidArguments();
  return parsed.data;
}

async function safeLstat(path: string, operation: EvidenceOperation) {
  try {
    return await operation.wait(lstat(path));
  } catch (error) {
    if (isOperationControlError(error)) throw error;
    throw targetUnavailable();
  }
}

async function safeReadlink(path: string, operation: EvidenceOperation): Promise<string> {
  try {
    return await operation.wait(readlink(path));
  } catch (error) {
    if (isOperationControlError(error)) throw error;
    throw targetUnavailable();
  }
}

function sanitizedToolError(error: unknown): Error {
  if (error instanceof EvidenceToolError || isAbortError(error)) return error as Error;
  return targetUnavailable();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isOperationControlError(error: unknown): boolean {
  return isAbortError(error) || (error instanceof EvidenceToolError && error.message === "Repository evidence operation timed out.");
}

function closeDirectory(directory: Dir, operation: EvidenceOperation): void {
  const close = directory.close();
  void operation.wait(close).catch(() => undefined);
}

function closeFile(handle: FileHandle, operation: EvidenceOperation): void {
  const close = handle.close();
  void operation.wait(close).catch(() => undefined);
}

function truncateOutput(text: string, alreadyTruncated: boolean): { text: string; truncated: boolean } {
  const truncated = alreadyTruncated || Buffer.byteLength(text, "utf8") > REPOSITORY_EVIDENCE_OUTPUT_MAX;
  if (!truncated) return { text, truncated: false };
  const marker = "\n… output truncated …";
  const available = REPOSITORY_EVIDENCE_OUTPUT_MAX - Buffer.byteLength(marker, "utf8");
  let prefix = "";
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > available) break;
    prefix += character;
    bytes += characterBytes;
  }
  return { text: `${prefix}${marker}`, truncated: true };
}

function displayPath(scopeRoot: string, path: string): string {
  return relative(scopeRoot, path) || ".";
}

function displayRequestedPath(scopeRoot: string, requestedPath: string | undefined): string {
  if (!requestedPath) return ".";
  const candidate = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(scopeRoot, requestedPath);
  return displayPath(scopeRoot, candidate);
}
