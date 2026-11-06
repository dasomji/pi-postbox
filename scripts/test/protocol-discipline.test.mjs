import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const source = resolve(import.meta.dirname, "../..");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "postbox-discipline-test-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const put = (name, value) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), value);
  };
  mkdirSync(join(root, "scripts"));
  for (const name of [
    "check-protocol-discipline.mjs",
    "protocol-discipline.mjs",
  ])
    cpSync(join(source, "scripts", name), join(root, "scripts", name));
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  put("packages/server/package.json", '{"version":"0.5.8"}');
  put(
    "packages/protocol/fixtures/android/contract.json",
    '{"fixtures":{"health":{"version":"0.5.8"}}}',
  );
  put(
    "packages/protocol/src/health.ts",
    'export const PROTOCOL_VERSION = "0.1.12";\n',
  );
  put("packages/protocol/src/example.ts", "export const value = 1;\n");
  put(
    "apps/android/app/build.gradle.kts",
    'versionName = "0.5.4"\nversionCode = 16\n',
  );
  git("add", ".");
  git("commit", "-qm", "baseline");
  const base = git("rev-parse", "HEAD");
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["scripts/check-protocol-discipline.mjs", ...args],
      { cwd: root, encoding: "utf8" },
    );
  return { root, git, put, base, run };
}
test("staged discipline reads the index, refuses protocol changes, and ignores unstaged repair", () => {
  const f = fixture();
  try {
    f.put("packages/protocol/src/example.ts", "export const value = 2;\n");
    f.git("add", ".");
    f.put(
      "packages/protocol/src/health.ts",
      'export const PROTOCOL_VERSION = "0.1.13";\n',
    );
    const result = f.run("--staged");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /without a PROTOCOL_VERSION bump/);
    f.git("reset", "--hard", "-q", "HEAD");
    f.put("packages/protocol/src/example.ts", "unstaged broken code");
    assert.equal(f.run("--staged").status, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("PR target, push-before, invalid/self/initial bases fail closed at the CLI", () => {
  const f = fixture();
  try {
    assert.notEqual(f.run().status, 0);
    assert.notEqual(f.run("missing-ref").status, 0);
    const unreachable = f.run("--push", "a".repeat(40));
    assert.notEqual(unreachable.status, 0);
    assert.match(
      unreachable.stderr,
      /previous push SHA.*unavailable.*workflow_dispatch/i,
    );
    assert.notEqual(f.run("HEAD").status, 0);
    assert.match(f.run("--push", "0".repeat(40)).stderr, /initial push/i);
    f.put("notes.txt", "a real push\n");
    f.git("add", ".");
    f.git("commit", "-qm", "docs change");
    assert.equal(f.run(f.base).status, 0);
    assert.equal(f.run("--push", f.base).status, 0);
    assert.notEqual(f.run("--push", "HEAD").status, 0);
    assert.notEqual(f.run("--push", f.base.slice(0, 8)).status, 0);
    f.put("packages/protocol/src/example.ts", "export const value = 3;\n");
    f.git("add", ".");
    f.git("commit", "-qm", "unversioned protocol");
    for (const args of [[f.base], ["--push", f.base]]) {
      const result = f.run(...args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /without a PROTOCOL_VERSION bump/);
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
