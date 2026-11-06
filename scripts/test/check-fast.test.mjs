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
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
const source = resolve(import.meta.dirname, "../..");
// Exercise the real CLI with real Git/index and Vitest. Other npm gates are
// inert fixture commands so a skipped test is observable as a false success.
function selectionFixture() {
  const root = mkdtempSync(join(tmpdir(), "postbox-selection-test-"));
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  for (const file of [
    "check-fast.mjs",
    "check-protocol-discipline.mjs",
    "protocol-discipline.mjs",
  ])
    put(`scripts/${file}`, readFileSync(join(source, "scripts", file)));
  put(
    "package.json",
    JSON.stringify({
      type: "module",
      scripts: Object.fromEntries(
        [
          "lint",
          "lint:docs",
          "typecheck",
          "check",
          "build",
          "test",
          "check:android",
          "check:android-protocol-contract",
        ].map((name) => [name, "node -e '' --"]),
      ),
    }),
  );
  put("packages/protocol/package.json", '{"name":"@pi-postbox/protocol"}');
  put("packages/server/package.json", '{"version":"0.5.8"}');
  put(
    "packages/protocol/fixtures/android/contract.json",
    '{"fixtures":{"health":{"version":"0.5.8"}}}',
  );
  put("vitest.config.mjs", 'export default {test:{include:["**/*.test.ts"]}};');
  put("README.md", "# Fixture\n");
  put(".gitignore", "node_modules\n");
  symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir");
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  return {
    root,
    put,
    git,
    run(file, before, after) {
      put(file, before);
      git("add", ".");
      git("commit", "-qm", "baseline");
      put(file, after);
      git("add", file);
      return spawnSync(process.execPath, ["scripts/check-fast.mjs"], {
        cwd: root,
        env: { ...process.env, INIT_CWD: root },
        encoding: "utf8",
        timeout: 30000,
      });
    },
  };
}

test("docs-only changes discover and execute documentation-reading Vitest files", () => {
  const f = selectionFixture();
  try {
    f.put(
      "packages/server/test/newDocsReader.test.ts",
      `import {test} from 'vitest'; import {readFileSync} from 'node:fs'; test('docs',()=>{readFileSync('README.md');throw Error('docs reader selected');});`,
    );
    const p = f.run("README.md", "# Fixture\n", "# Updated\n");
    assert.notEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout + p.stderr, /docs reader selected/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("Android-only changes execute Vitest files under apps", () => {
  const f = selectionFixture();
  try {
    f.put(
      "apps/newAndroidGuard.test.ts",
      `import {test} from 'vitest'; test('Android scaffold',()=>{throw Error('apps guard selected');});`,
    );
    const p = f.run(
      "apps/android/app/src/main/Example.kt",
      "// before\n",
      "// after\n",
    );
    assert.notEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout + p.stderr, /apps guard selected/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("hand-edited generated Kotlin runs the generated-contract gate", () => {
  const f = selectionFixture();
  try {
    const pkg = JSON.parse(readFileSync(join(f.root, "package.json"), "utf8"));
    pkg.scripts["check:android-protocol-contract"] =
      `node -e "throw Error('generated contract selected')"`;
    f.put("package.json", JSON.stringify(pkg));
    const p = f.run(
      "apps/android/app/src/main/java/dev/pi/postbox/protocol/GeneratedPostboxProtocolContract.kt",
      "// generated\n",
      "// hand edited\n",
    );
    assert.notEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout + p.stderr, /generated contract selected/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("source edits execute static filesystem tests even when related tests pass", () => {
  const f = selectionFixture();
  try {
    const pkg = JSON.parse(readFileSync(join(f.root, "package.json"), "utf8"));
    pkg.workspaces = ["packages/*"];
    f.put("package.json", JSON.stringify(pkg));
    f.put(
      "packages/protocol/package.json",
      '{"name":"@pi-postbox/protocol","scripts":{"build":"node -e 0"}}',
    );
    f.put(
      "packages/server/test/related.test.ts",
      `import {test,expect} from 'vitest'; import {value} from '../src/value'; test('related',()=>expect(value).toBe(2));`,
    );
    f.put(
      "apps/web/src/new.static.test.ts",
      `import {test} from 'vitest'; import {readFileSync} from 'node:fs'; test('static',()=>{readFileSync('packages/server/src/value.ts');throw Error('static reader selected');});`,
    );
    const p = f.run(
      "packages/server/src/value.ts",
      "export const value = 1;\n",
      "export const value = 2;\n",
    );
    assert.notEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout + p.stderr, /static reader selected/);
    assert.match(p.stdout + p.stderr, /1 passed/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

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
