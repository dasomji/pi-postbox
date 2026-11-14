import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
test("hooks:install preserves conflicting config and non-sample hooks, then installs idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "postbox-hooks-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, ".githooks"));
    copyFileSync(
      resolve(import.meta.dirname, "../install-hooks.mjs"),
      join(root, "scripts/install-hooks.mjs"),
    );
    writeFileSync(join(root, ".githooks/pre-commit"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    writeFileSync(
      join(root, "package.json"),
      '{"scripts":{"hooks:install":"node scripts/install-hooks.mjs"}}',
    );
    const git = (...args) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    const run = () =>
      spawnSync("npm", ["run", "hooks:install"], {
        cwd: root,
        encoding: "utf8",
      });
    git("config", "core.hooksPath", "elsewhere");
    assert.notEqual(run().status, 0);
    assert.equal(git("config", "core.hooksPath"), "elsewhere");
    git("config", "--unset", "core.hooksPath");
    writeFileSync(join(root, ".git/hooks/pre-commit"), "existing");
    assert.notEqual(run().status, 0);
    assert.equal(
      readFileSync(join(root, ".git/hooks/pre-commit"), "utf8"),
      "existing",
    );
    rmSync(join(root, ".git/hooks/pre-commit"));
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);
    assert.equal(git("config", "core.hooksPath"), ".githooks");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
