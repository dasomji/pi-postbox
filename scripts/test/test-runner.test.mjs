import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";
test("npm test runs ordinary files once and serializes every packaging/smoke file", () => {
  const root = mkdtempSync(join(tmpdir(), "postbox-test-runner-"));
  try {
    mkdirSync(join(root, "scripts"));
    cpSync(
      resolve(import.meta.dirname, "../test-vitest.mjs"),
      join(root, "scripts/test-vitest.mjs"),
    );
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(
      join(root, "package.json"),
      '{"type":"module","scripts":{"test":"node scripts/test-vitest.mjs"}}',
    );
    writeFileSync(
      join(root, "vitest.config.mjs"),
      'export default { test: { include: ["**/*.test.ts"] } };\n',
    );
    for (const name of [
      "ordinary.test.ts",
      "packages/server/test/packageDocs.test.ts",
      "packages/server/test/shippedAsyncWorkflowAcceptance.test.ts",
      "apps/androidScaffold.test.ts",
    ]) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      const serial = name !== "ordinary.test.ts";
      writeFileSync(
        join(root, name),
        `import {test} from 'vitest';import fs from 'node:fs';test('phase safety',async()=>{${serial ? "const fd=fs.openSync('serial.lock','wx'); await new Promise(r=>setTimeout(r,100));fs.closeSync(fd);fs.unlinkSync('serial.lock');" : "if(fs.existsSync('serial.lock'))throw Error('phases overlapped');"}});\n`,
      );
    }
    const env = { ...process.env, NO_COLOR: "1" };
    delete env.FORCE_COLOR;
    const p = spawnSync("npm", ["test"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    const stdout = stripVTControlCharacters(p.stdout);
    assert.match(stdout, /1 passed \(1\)/);
    assert.match(stdout, /3 passed \(3\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
