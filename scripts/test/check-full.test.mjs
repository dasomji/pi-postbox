import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
test("full contract requires an explicit base and rejects unsupported partitions before running gates", () => {
  for (const args of [[], ["--part", "bogus"], ["--part", "node"]]) {
    const p = spawnSync(process.execPath, ["scripts/check-full.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(p.status, 0);
    assert.match(p.stderr, /Usage|explicit base/);
  }
});
test("verify:app refuses CI before a build or fixture can start", () => {
  const p = spawnSync(process.execPath, ["scripts/verify-app.mjs"], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /refuses CI/);
  assert.doesNotMatch(p.stdout, /build|server/);
});
