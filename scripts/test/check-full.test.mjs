import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
test("full contract rejects empty and option-shaped comparison values before gates", () => {
  for (const flag of ["--base", "--push"]) {
    for (const value of ["", "--staged", "--push", "-x"]) {
      const p = spawnSync(
        process.execPath,
        ["scripts/check-full.mjs", flag, value],
        {
          cwd: root,
          encoding: "utf8",
        },
      );
      assert.notEqual(p.status, 0);
      assert.match(p.stderr, /Usage/);
      assert.equal(p.stdout, "", "must reject before starting any gate");
    }
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

test("recovery workflow validates its environment base before invoking gates", () => {
  const workflow = readFileSync(
    resolve(root, ".github/workflows/ci.yml"),
    "utf8",
  );
  const step = workflow
    .split("- name: Full Node contract (reviewed recovery base)")[1]
    .split("\n  android:")[0];
  assert.match(step, /POSTBOX_BASE_REF: \$\{\{ inputs.base \}\}/);
  const command = step
    .split("        run: |\n")[1]
    ?.replace(/^          /gm, "");
  assert.ok(command, "recovery must validate before running check:full");
  assert.doesNotMatch(command, /\$\{\{/);
  // Replace only the external npm command: accepted input exits at this sentinel.
  for (const [base, accepted] of [
    ["", false],
    ["--staged", false],
    ["HEAD", false],
    ["abc123", false],
    ["0".repeat(40), false],
    ["a".repeat(40), true],
    ["refs/heads/main", true],
    ["origin/main", true],
  ]) {
    const p = spawnSync(
      "bash",
      ["-e", "-c", `npm() { echo gates-started; };\n${command}`],
      {
        encoding: "utf8",
        env: { ...process.env, POSTBOX_BASE_REF: base },
      },
    );
    assert.equal(p.status === 0, accepted, `${base}: ${p.stdout}${p.stderr}`);
    assert.equal(p.stdout.includes("gates-started"), accepted);
  }
});
