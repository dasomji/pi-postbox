import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectMetadata } from "./projectMetadata.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function repo(remote?: string): string {
  const path = mkdtempSync(join(tmpdir(), "postbox-identity-"));
  dirs.push(path);
  execFileSync("git", ["init", "-q", path]);
  if (remote) execFileSync("git", ["-C", path, "remote", "add", "origin", remote]);
  return path;
}

describe("Git-backed Postbox identities", () => {
  it.each([
    "git@github.com:Acme/Postbox.git",
    "ssh://git@github.com/Acme/Postbox.git",
    "https://github.com/Acme/Postbox.git/"
  ])("normalizes equivalent origin remotes (%s)", (remote) => {
    const metadata = collectProjectMetadata(repo(remote)) as Record<string, any>;
    expect(metadata.repository).toEqual({
      repositoryId: expect.any(String),
      remote: "github.com/Acme/Postbox"
    });
  });

  it("falls back to machine plus Git common directory and canonicalizes the worktree path", () => {
    const path = repo();
    const metadata = collectProjectMetadata(join(path, ".")) as Record<string, any>;
    expect(metadata.repository).toMatchObject({ commonDirectory: realpathSync(join(path, ".git")) });
    expect(metadata.worktree).toMatchObject({ path: realpathSync(path) });
    expect(metadata.repository.repositoryId).toContain("machine");
    expect(metadata.worktree.worktreeId).toContain("machine");
  });
});
