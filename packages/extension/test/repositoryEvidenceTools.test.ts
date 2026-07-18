import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRepositoryEvidenceTools } from "../src/repositoryEvidenceTools.js";
import {
  REPOSITORY_EVIDENCE_ENTRY_MAX,
  REPOSITORY_EVIDENCE_FILE_BYTES_MAX,
  REPOSITORY_EVIDENCE_MATCH_MAX,
  REPOSITORY_EVIDENCE_OUTPUT_MAX
} from "../src/repositoryEvidenceTools.js";

describe("Question Chat repository evidence tools", () => {
  it("discovers the containing Git worktree and reads tracked and nonignored untracked source", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-evidence-git-"));
    const worktree = join(root, "worktree");
    const cwd = join(worktree, "packages", "feature");
    mkdirSync(join(worktree, "src"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(worktree, "src", "tracked.ts"), "export const tracked = true;\n");
    writeFileSync(join(worktree, "src", "untracked.ts"), "export const untracked = true;\n");
    execFileSync("git", ["init", "--quiet", worktree]);
    execFileSync("git", ["-C", worktree, "add", "src/tracked.ts"]);

    const evidence = await createRepositoryEvidenceTools(cwd);

    expect(evidence.scopeRoot).toBe(realpathSync(worktree));
    expect(evidence.tools.map((tool) => tool.name)).toEqual([
      "repository_read",
      "repository_grep",
      "repository_find",
      "repository_list"
    ]);
    await expect(execute(evidence, "repository_read", { path: "src/tracked.ts" })).resolves.toMatchObject({
      content: [{ type: "text", text: "export const tracked = true;" }]
    });
    await expect(execute(evidence, "repository_read", { path: "src/untracked.ts" })).resolves.toMatchObject({
      content: [{ type: "text", text: "export const untracked = true;" }]
    });
  });

  it("uses a non-Git cwd boundary and rejects relative, absolute, and symlink escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-evidence-cwd-"));
    const cwd = join(root, "cwd");
    mkdirSync(join(cwd, "nested"), { recursive: true });
    writeFileSync(join(cwd, "safe.ts"), "safe evidence\n");
    writeFileSync(join(root, "outside.ts"), "outside secret contents\n");
    symlinkSync(join(root, "outside.ts"), join(cwd, "outside-link.ts"));
    symlinkSync(join(cwd, "safe.ts"), join(cwd, "inside-link.ts"));
    symlinkSync(join(cwd, "safe.ts"), join(root, "outside-back-link.ts"));
    symlinkSync(join(root, "outside-back-link.ts"), join(cwd, "outside-then-back-link.ts"));
    const evidence = await createRepositoryEvidenceTools(cwd);

    expect(evidence.scopeRoot).toBe(realpathSync(cwd));
    await expect(execute(evidence, "repository_read", { path: join(cwd, "safe.ts") })).resolves.toMatchObject({
      content: [{ text: "safe evidence" }]
    });
    await expect(execute(evidence, "repository_read", { path: "nested/../safe.ts" })).resolves.toMatchObject({
      content: [{ text: "safe evidence" }]
    });
    await expect(execute(evidence, "repository_read", { path: "../outside.ts" })).rejects.toThrow("Repository evidence access denied.");
    await expect(execute(evidence, "repository_read", { path: join(root, "outside.ts") })).rejects.toThrow("Repository evidence access denied.");
    await expect(execute(evidence, "repository_read", { path: "outside-link.ts" })).rejects.toThrow("Repository evidence access denied.");
    await expect(execute(evidence, "repository_read", { path: "outside-then-back-link.ts" })).rejects.toThrow(
      "Repository evidence access denied."
    );
    await expect(execute(evidence, "repository_read", { path: "inside-link.ts" })).resolves.toMatchObject({
      content: [{ text: "safe evidence" }]
    });
  });

  it("denies ignored, Git metadata, and case-insensitive secret-like paths without revealing rejected details", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-evidence-secret-"));
    const worktree = join(root, "worktree");
    mkdirSync(worktree, { recursive: true });
    execFileSync("git", ["init", "--quiet", worktree]);
    writeFileSync(join(worktree, ".gitignore"), "ignored.txt\n");
    const denied = [
      "ignored.txt",
      ".ENV.production",
      "Credentials.JSON",
      "private.PEM",
      "token-store.json",
      "token.json",
      "TOKENS.JSON",
      "service-account.json",
      "auth.json",
      ".npmrc",
      ".pypirc",
      ".netrc",
      ".aws/credentials",
      ".ssh/config",
      ".docker/config.json",
      ".gnupg/private-keys-v1.d/key-material"
    ];
    for (const path of denied) {
      mkdirSync(join(worktree, path, ".."), { recursive: true });
      writeFileSync(join(worktree, path), `sensitive contents for ${path}\n`);
    }
    writeFileSync(join(worktree, "visible.ts"), "export const visible = true;\n");
    const evidence = await createRepositoryEvidenceTools(worktree);

    for (const path of [...denied, ".git/config"]) {
      await expect(execute(evidence, "repository_read", { path })).rejects.toThrow("Repository evidence access denied.");
      try {
        await execute(evidence, "repository_read", { path });
      } catch (error) {
        expect(String(error)).not.toContain(path);
        expect(String(error)).not.toContain("sensitive contents");
      }
    }

    const listing = await execute(evidence, "repository_list", { path: "." });
    const output = listing.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(output).toContain("visible.ts");
    for (const path of denied) expect(output).not.toContain(path);
    expect(output.split("\n")).not.toContain(".git/");
  });

  it("validates before access, rejects directory-symlink traversal, and sanitizes filesystem failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-evidence-order-"));
    const cwd = join(root, "cwd");
    const outside = join(root, "outside-host-directory-with-sensitive-name");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "host-secret.txt"), "must never be read\n");
    symlinkSync(outside, join(cwd, "directory-link"));
    writeFileSync(join(cwd, "tokenizer.ts"), "export const tokenizer = true;\n");
    const evidence = await createRepositoryEvidenceTools(cwd);

    await expect(execute(evidence, "repository_list", { path: outside })).rejects.toThrow("Repository evidence access denied.");
    await expect(execute(evidence, "repository_read", { path: "directory-link/host-secret.txt" })).rejects.toThrow(
      "Repository evidence access denied."
    );
    await expect(execute(evidence, "repository_list", { path: "directory-link" })).rejects.toThrow(
      "Repository evidence access denied."
    );
    await expect(execute(evidence, "repository_read", { path: "missing-sensitive-name.txt" })).rejects.toThrow(
      "Repository evidence target is unavailable."
    );
    await expect(execute(evidence, "repository_read", { path: "tokenizer.ts" })).resolves.toMatchObject({
      content: [{ text: "export const tokenizer = true;" }]
    });

    for (const attempt of [
      execute(evidence, "repository_list", { path: outside }),
      execute(evidence, "repository_read", { path: "directory-link/host-secret.txt" }),
      execute(evidence, "repository_read", { path: "missing-sensitive-name.txt" })
    ]) {
      try {
        await attempt;
      } catch (error) {
        expect(String(error)).not.toContain(outside);
        expect(String(error)).not.toContain("host-secret.txt");
        expect(String(error)).not.toContain("missing-sensitive-name.txt");
      }
    }
  });

  it("greps literal text and finds paths without traversing ignored, secret, or symlinked directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-evidence-search-"));
    const worktree = join(root, "worktree");
    const outside = join(root, "outside");
    mkdirSync(join(worktree, "src"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    execFileSync("git", ["init", "--quiet", worktree]);
    writeFileSync(join(worktree, ".gitignore"), "ignored/\n");
    mkdirSync(join(worktree, "ignored"));
    writeFileSync(join(worktree, "ignored", "ignored-source.ts"), "literal[needle] ignored\n");
    writeFileSync(join(worktree, "src", "tracked-source.ts"), "first\nliteral[needle] tracked\n");
    writeFileSync(join(worktree, "src", "untracked-source.ts"), "literal[needle] untracked\n");
    writeFileSync(join(worktree, "src", "auth.json"), "literal[needle] secret\n");
    mkdirSync(join(worktree, "src", "inside-directory"));
    writeFileSync(join(worktree, "src", "inside-directory", "inside.ts"), "literal[needle] inside\n");
    symlinkSync(join(worktree, "src", "inside-directory"), join(worktree, "inside-directory-link"));
    writeFileSync(join(outside, "outside-source.ts"), "literal[needle] outside\n");
    symlinkSync(outside, join(worktree, "linked-directory"));
    execFileSync("git", ["-C", worktree, "add", "src/tracked-source.ts"]);
    const evidence = await createRepositoryEvidenceTools(join(worktree, "src"));

    const grep = await execute(evidence, "repository_grep", { query: "literal[needle]", path: "." });
    const grepText = grep.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(grepText).toContain("src/tracked-source.ts:2:literal[needle] tracked");
    expect(grepText).toContain("src/untracked-source.ts:1:literal[needle] untracked");
    expect(grepText).not.toContain("ignored-source");
    expect(grepText).not.toContain("auth.json");
    expect(grepText).not.toContain("outside-source");

    const found = await execute(evidence, "repository_find", { query: "source.ts", path: "." });
    const foundText = found.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(foundText.split("\n").sort()).toEqual(["src/tracked-source.ts", "src/untracked-source.ts"]);
    await expect(execute(evidence, "repository_grep", { query: "literal[needle]", path: "inside-directory-link" })).rejects.toThrow(
      "Repository evidence access denied."
    );
    await expect(execute(evidence, "repository_find", { query: "inside.ts", path: "inside-directory-link" })).rejects.toThrow(
      "Repository evidence access denied."
    );
  });

  it("bounds arguments, traversal results, file bytes, browser-facing output, and cancellation", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-evidence-bounds-"));
    const cwd = join(root, "cwd");
    mkdirSync(cwd, { recursive: true });
    for (let index = 0; index < REPOSITORY_EVIDENCE_ENTRY_MAX + 30; index += 1) {
      writeFileSync(join(cwd, `source-${index.toString().padStart(3, "0")}.ts`), `bounded needle ${index}\n`);
    }
    writeFileSync(join(cwd, "large.txt"), "x".repeat(100_000));
    writeFileSync(join(cwd, "large-utf8.txt"), "é".repeat(50_000));
    writeFileSync(join(cwd, "large-search.txt"), `${"x".repeat(REPOSITORY_EVIDENCE_FILE_BYTES_MAX)}needle beyond bound\n`);
    writeFileSync(join(cwd, "binary.dat"), Buffer.from([0x66, 0x6f, 0x6f, 0x00, 0x62, 0x61, 0x72]));
    let deep = cwd;
    for (let depth = 0; depth < 14; depth += 1) {
      deep = join(deep, `depth-${depth}`);
      mkdirSync(deep);
    }
    writeFileSync(join(deep, "too-deep.ts"), "bounded needle too deep\n");
    const evidence = await createRepositoryEvidenceTools(cwd);

    const read = await execute(evidence, "repository_read", { path: "large.txt" });
    expect(textOutput(read).length).toBeLessThanOrEqual(REPOSITORY_EVIDENCE_OUTPUT_MAX);
    expect((read.details as { truncated: boolean }).truncated).toBe(true);
    const utf8Read = await execute(evidence, "repository_read", { path: "large-utf8.txt" });
    expect(Buffer.byteLength(textOutput(utf8Read), "utf8")).toBeLessThanOrEqual(REPOSITORY_EVIDENCE_OUTPUT_MAX);
    await expect(execute(evidence, "repository_read", { path: "binary.dat" })).rejects.toThrow(
      "Repository evidence binary files are unavailable."
    );

    const listing = await execute(evidence, "repository_list", { path: "." });
    expect(textOutput(listing).split("\n").length).toBeLessThanOrEqual(REPOSITORY_EVIDENCE_ENTRY_MAX + 1);
    expect((listing.details as { truncated: boolean }).truncated).toBe(true);

    const grep = await execute(evidence, "repository_grep", { query: "bounded needle", path: "." });
    expect((grep.details as { matches: number }).matches).toBe(REPOSITORY_EVIDENCE_MATCH_MAX);
    expect(textOutput(grep).length).toBeLessThanOrEqual(REPOSITORY_EVIDENCE_OUTPUT_MAX);
    const partialGrep = await execute(evidence, "repository_grep", { query: "needle beyond bound", path: "large-search.txt" });
    expect(textOutput(partialGrep)).toMatch(/… output truncated …$/);
    expect((partialGrep.details as { truncated: boolean }).truncated).toBe(true);

    const found = await execute(evidence, "repository_find", { query: "source-", path: "." });
    expect(textOutput(found).split("\n").filter((line) => !line.includes("output truncated"))).toHaveLength(
      REPOSITORY_EVIDENCE_ENTRY_MAX
    );
    expect((found.details as { truncated: boolean }).truncated).toBe(true);
    const deepResult = await execute(evidence, "repository_find", { query: "too-deep", path: "." });
    expect(textOutput(deepResult)).not.toContain("too-deep.ts");
    expect((deepResult.details as { truncated: boolean }).truncated).toBe(true);

    await expect(execute(evidence, "repository_grep", { query: "x".repeat(201), path: "." })).rejects.toThrow(
      "Repository evidence arguments are invalid."
    );
    await expect(execute(evidence, "repository_read", { path: "missing.txt", ["x".repeat(20_000)]: true })).rejects.toThrow(
      "Repository evidence arguments are invalid."
    );
    const controller = new AbortController();
    controller.abort();
    await expect(execute(evidence, "repository_list", { path: "." }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("invokes git with argv only and denies access conservatively when ignore checks fail or time out", async () => {
    const root = mkdtempSync(join(tmpdir(), "postbox-evidence-git-failure-"));
    const worktree = join(root, "worktree");
    mkdirSync(worktree);
    writeFileSync(join(worktree, "visible.ts"), "visible evidence\n");

    symlinkSync(join(worktree, "missing-target"), join(worktree, "dangling-link"));
    const orderRun = vi.fn(async (args: string[]) =>
      args[0] === "rev-parse"
        ? { exitCode: 0, stdout: `${worktree}\n` }
        : { exitCode: 1, stdout: "" }
    );
    const orderedEvidence = await createRepositoryEvidenceTools(worktree, { gitRunner: { run: orderRun } });
    orderRun.mockClear();
    await expect(execute(orderedEvidence, "repository_read", { path: "dangling-link" })).rejects.toThrow(
      "Repository evidence target is unavailable."
    );
    expect(orderRun).not.toHaveBeenCalled();

    const hangingRun = vi.fn(async (args: string[]) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: `${worktree}\n` };
      return new Promise<{ exitCode: number; stdout: string }>(() => undefined);
    });
    const timeoutEvidence = await createRepositoryEvidenceTools(worktree, {
      gitRunner: { run: hangingRun },
      operationTimeoutMs: 20
    });
    await expect(execute(timeoutEvidence, "repository_read", { path: "visible.ts" })).rejects.toThrow(
      "Repository evidence operation timed out."
    );

    const discoveryFailure = vi.fn(async () => {
      throw new Error(`git discovery failed for ${worktree}`);
    });
    await expect(createRepositoryEvidenceTools(worktree, { gitRunner: { run: discoveryFailure } })).rejects.toThrow(
      "Repository evidence access denied."
    );
    try {
      await createRepositoryEvidenceTools(worktree, { gitRunner: { run: discoveryFailure } });
    } catch (error) {
      expect(String(error)).not.toContain(worktree);
    }

    for (const failure of [new Error("git failed with sensitive diagnostics"), Object.assign(new Error("timed out"), { name: "TimeoutError" })]) {
      const run = vi.fn(async (args: string[]) => {
        if (args[0] === "rev-parse") return { exitCode: 0, stdout: `${worktree}\n` };
        throw failure;
      });
      const evidence = await createRepositoryEvidenceTools(worktree, { gitRunner: { run } });

      await expect(execute(evidence, "repository_read", { path: "visible.ts" })).rejects.toThrow(
        "Repository evidence access denied."
      );
      expect(run.mock.calls[1]?.[0]).toEqual(["check-ignore", "--no-index", "--quiet", "--", "visible.ts"]);
      try {
        await execute(evidence, "repository_read", { path: "visible.ts" });
      } catch (error) {
        expect(String(error)).not.toContain("sensitive diagnostics");
        expect(String(error)).not.toContain(worktree);
      }
    }
  });
});

async function execute(
  evidence: Awaited<ReturnType<typeof createRepositoryEvidenceTools>>,
  name: string,
  params: unknown,
  signal = new AbortController().signal
) {
  const tool = evidence.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool.execute("test-call", params as never, signal, undefined, {} as never);
}

function textOutput(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
}
