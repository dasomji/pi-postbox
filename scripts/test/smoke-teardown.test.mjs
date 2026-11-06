import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("interrupting the real smoke removes its server/state and leaves default home data untouched", async () => {
  const home = mkdtempSync(join(tmpdir(), "postbox-smoke-home-"));
  mkdirSync(join(home, ".pi-postbox"));
  writeFileSync(join(home, ".pi-postbox/sentinel"), "must survive");
  const child = spawn(process.execPath, ["scripts/smoke-postbox.mjs"], {
    cwd: resolve(import.meta.dirname, "../.."),
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let identity;
  let sent = false;
  const collect = (data) => {
    output += data;
    const match = output.match(/Smoke identity: (\{[^\n]+\})/);
    if (match && !sent) {
      identity = JSON.parse(match[1]);
      sent = true;
      child.kill("SIGTERM");
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20000);
  try {
    const code = await new Promise((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("close", resolvePromise);
    });
    assert.equal(code, 143, output);
    assert.ok(identity, output);
    assert.match(output, /Smoke teardown verified/);
    assert.ok(![32187, 45795].includes(new URL(identity.url).port * 1));
    assert.ok(identity.databasePath.startsWith(identity.stateDir + "/"));
    assert.equal(existsSync(identity.stateDir), false);
    assert.throws(() => process.kill(identity.pid, 0), { code: "ESRCH" });
    const listener = createServer();
    await new Promise((resolvePromise, reject) => {
      listener.once("error", reject);
      listener.listen(
        new URL(identity.url).port * 1,
        "127.0.0.1",
        resolvePromise,
      );
    });
    await new Promise((resolvePromise) => listener.close(resolvePromise));
    assert.equal(
      readFileSync(join(home, ".pi-postbox/sentinel"), "utf8"),
      "must survive",
    );
    assert.deepEqual(readdirSync(join(home, ".pi-postbox")), ["sentinel"]);
  } finally {
    clearTimeout(deadline);
    child.kill("SIGKILL");
    rmSync(home, { recursive: true, force: true });
  }
});
