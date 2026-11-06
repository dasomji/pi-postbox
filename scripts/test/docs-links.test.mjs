import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
test("lint:docs accepts relative headings/references and fails missing files or fragments", () => {
  const root = mkdtempSync(join(tmpdir(), "postbox-links-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    cpSync(
      resolve(import.meta.dirname, "../check-docs.mjs"),
      join(root, "scripts/check-docs.mjs"),
    );
    writeFileSync(
      join(root, "package.json"),
      '{"scripts":{"lint:docs":"node scripts/check-docs.mjs"}}',
    );
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(
      join(root, "target.md"),
      '# Hello, World!\n# Hello, World!\n<a id="custom"></a>\n',
    );
    const put = (text) => {
      writeFileSync(join(root, "README.md"), text);
      execFileSync("git", ["add", "."], { cwd: root });
    };
    const run = () =>
      spawnSync("npm", ["run", "lint:docs"], { cwd: root, encoding: "utf8" });
    put(
      "[ok](target.md#hello-world-1) [custom][ref] [web](https://invalid.example/nope)\n[ref]: target.md#custom\n```md\n[example](missing.md)\n```\n`[inline](missing.md)`\n",
    );
    let result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    put("[bad](target.md#absent)\n");
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /absent/);
    put("[bad](missing.md)\n");
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing.md/);
    writeFileSync(join(root, "target.ts"), "export const value = 1;\n");
    put("[line](target.ts#L99)\n");
    result = run();
    assert.notEqual(result.status, 0);
    put("[line](target.ts#L1)\n");
    result = run();
    assert.equal(result.status, 0, result.stderr);
    put("[plain text][undefined-ref]\n");
    result = run();
    assert.equal(result.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
