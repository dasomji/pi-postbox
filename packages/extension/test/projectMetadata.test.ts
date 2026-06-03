import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectMetadata } from "../src/projectMetadata.js";

const dirs: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function createRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "pi-postbox-metadata-repo-"));
  dirs.push(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "postbox@example.test"]);
  git(repo, ["config", "user.name", "Postbox Test"]);
  await writeFile(join(repo, "README.md"), "# Example\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("project metadata collection", () => {
  it("collects git identity, dirty state, repo-local display overrides, and uploaded icon data", async () => {
    const repo = await createRepo();
    await mkdir(join(repo, "assets"));
    await writeFile(join(repo, "assets", "postbox.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><title>Postbox</title></svg>');
    await writeFile(
      join(repo, ".pi-postbox.json"),
      JSON.stringify({ name: "Friendly Repo", description: "Shown in Postbox", icon: "assets/postbox.svg" })
    );
    await writeFile(join(repo, "changed.txt"), "dirty\n");

    const metadata = collectProjectMetadata(repo);

    expect(metadata).toMatchObject({
      cwd: repo,
      gitRoot: repo,
      worktreePath: repo,
      repoName: expect.stringContaining("pi-postbox-metadata-repo-"),
      branch: "main",
      isDirty: true,
      displayName: "Friendly Repo",
      description: "Shown in Postbox"
    });
    expect(metadata.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(metadata.name).toBe(metadata.repoName);
    expect(metadata.icon).toMatchObject({ mediaType: "image/svg+xml" });
    expect(metadata.icon?.hash).toMatch(/^sha256:/);
    expect(metadata.icon?.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("rejects icon paths that escape through sibling path prefixes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pi-postbox-prefix-parent-"));
    dirs.push(parent);
    const repo = join(parent, "repo");
    const sibling = join(parent, "repo-secret");
    await mkdir(repo);
    await mkdir(sibling);
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "postbox@example.test"]);
    git(repo, ["config", "user.name", "Postbox Test"]);
    await writeFile(join(repo, "README.md"), "# Example\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "initial"]);
    await writeFile(join(sibling, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(repo, ".pi-postbox.json"), JSON.stringify({ icon: "../repo-secret/icon.svg" }));

    const metadata = collectProjectMetadata(repo);

    expect(metadata.icon).toBeUndefined();
  });

  it("distinguishes linked worktrees for the same repository", async () => {
    const repo = await createRepo();
    const worktree = await mkdtemp(join(tmpdir(), "pi-postbox-metadata-worktree-"));
    dirs.push(worktree);
    git(repo, ["worktree", "add", "-b", "feature/postbox", worktree]);

    const mainMetadata = collectProjectMetadata(repo);
    const worktreeMetadata = collectProjectMetadata(worktree);

    expect(worktreeMetadata.repoName).toBe(mainMetadata.repoName);
    expect(worktreeMetadata.branch).toBe("feature/postbox");
    expect(worktreeMetadata.worktreePath).toBe(worktree);
    expect(worktreeMetadata.gitRoot).toBe(worktree);
    expect(worktreeMetadata.projectId).not.toBe(mainMetadata.projectId);
  });
});
