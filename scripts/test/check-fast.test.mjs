import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const source = resolve(import.meta.dirname, "../..");
test("real hook checks indexed bytes, blocks a bad commit, and preserves partial staging", () => {
  const root = mkdtempSync(join(tmpdir(), "postbox-index-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, ".githooks"));
    mkdirSync(join(root, "packages/server"), { recursive: true });
    mkdirSync(join(root, "packages/protocol/fixtures/android"), {
      recursive: true,
    });
    for (const file of [
      "check-fast.mjs",
      "check-docs.mjs",
      "lint.mjs",
      "check-protocol-discipline.mjs",
      "protocol-discipline.mjs",
      "install-hooks.mjs",
    ])
      cpSync(join(source, "scripts", file), join(root, "scripts", file));
    cpSync(
      join(source, ".githooks/pre-commit"),
      join(root, ".githooks/pre-commit"),
    );
    cpSync(join(source, ".oxlintrc.json"), join(root, ".oxlintrc.json"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        {
          scripts: {
            "check:fast": "node scripts/check-fast.mjs",
            lint: "node scripts/lint.mjs",
            "lint:docs": "node scripts/check-docs.mjs",
            "hooks:install": "node scripts/install-hooks.mjs",
          },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(root, "packages/server/package.json"),
      '{"version":"0.5.8"}\n',
    );
    writeFileSync(
      join(root, "packages/protocol/fixtures/android/contract.json"),
      '{"fixtures":{"health":{"version":"0.5.8"}}}\n',
    );
    writeFileSync(join(root, "README.md"), "# Fixture\n");
    writeFileSync(join(root, ".gitignore"), "node_modules\n");
    symlinkSync(
      join(source, "node_modules"),
      join(root, "node_modules"),
      "dir",
    );
    const git = (...args) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    git("add", ".");
    git("commit", "-qm", "baseline");
    let p = spawnSync("npm", ["run", "hooks:install"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(root, "scripts/bad.mjs"), "export const broken = ;\n");
    git("add", "scripts/bad.mjs");
    writeFileSync(
      join(root, "scripts/bad.mjs"),
      "export const repaired = true;\n",
    );
    p = spawnSync("git", ["commit", "-qm", "must reject"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(p.status, 0);
    assert.equal(git("rev-parse", "HEAD"), base);
    assert.match(p.stdout + p.stderr, /syntax|parse|Unexpected/i);
    git("reset", "-q", "HEAD", "scripts/bad.mjs");
    rmSync(join(root, "scripts/bad.mjs"));
    writeFileSync(
      join(root, "README.md"),
      "# Fixture\n\nStaged documentation.\n",
    );
    git("add", "README.md");
    const indexed = git("show", ":README.md");
    writeFileSync(
      join(root, "README.md"),
      "# Fixture\n\n[Unstaged broken link](missing.md)\n",
    );
    const live = readFileSync(join(root, "README.md"), "utf8");
    const index = readFileSync(join(root, ".git/index"));
    // An unstaged npm entry-point edit must not bypass or replace the index command.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    pkg.scripts["check:fast"] = "exit 99";
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
    p = spawnSync(".githooks/pre-commit", [], { cwd: root, encoding: "utf8" });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.deepEqual(readFileSync(join(root, ".git/index")), index);
    p = spawnSync("git", ["commit", "-qm", "partial docs"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.equal(git("show", "HEAD:README.md"), indexed);
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), live);
    assert.match(readFileSync(join(root, "package.json"), "utf8"), /exit 99/);
    assert.equal(git("show", ":README.md"), indexed);
    assert.ok(index.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
