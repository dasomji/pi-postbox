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
import { pathToFileURL } from "node:url";

test("smoke reports bounded server stderr and preserves the journey error when cleanup fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "postbox-smoke-diagnostics-"));
  try {
    const preload = join(root, "preload.mjs");
    // Inject only at process boundaries: a server that fails at startup, and an
    // OS liveness check failure after the real teardown has stopped that server.
    writeFileSync(
      preload,
      `
      if (process.argv[1]?.endsWith('/dist/cli.js')) {
        process.stderr.write(Array.from({length:220},(_,i)=>'server diagnostic '+i).join('\\n')+'\\n');
        if(process.env.SMOKE_TEST_HUGE_LINE) process.stderr.write('huge-line-start'+'é'.repeat(70000)+'huge-line-end\\n');
        throw Error('injected server startup failure');
      }
      if (process.argv[1]?.endsWith('/smoke-postbox.mjs') && process.env.SMOKE_TEST_CLEANUP_FAILURE) {
        const kill = process.kill;
        process.kill = (pid, signal) => { if(signal===0) throw Error('injected cleanup liveness failure'); return kill(pid,signal); };
      }
    `,
    );
    for (const [cleanupFailure, hugeLine] of [
      [false, false],
      [true, true],
    ]) {
      const child = spawn(process.execPath, ["scripts/smoke-postbox.mjs"], {
        cwd: resolve(import.meta.dirname, "../.."),
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          SMOKE_TEST_CLEANUP_FAILURE: cleanupFailure ? "1" : "",
          SMOKE_TEST_HUGE_LINE: hugeLine ? "1" : "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 20000);
      let code;
      try {
        code = await new Promise((res, reject) => {
          child.once("error", reject);
          child.once("close", res);
        });
      } finally {
        clearTimeout(deadline);
        child.kill("SIGKILL");
      }
      assert.equal(code, 1, output);
      if (hugeLine) {
        assert.match(output, /huge-line-end/);
        assert.doesNotMatch(output, /huge-line-start/);
        const tail = output
          .split(/Server stderr[^\n]*\n/)[1]
          ?.split("\nError: Timed out")[0]
          .trimEnd();
        assert.ok(tail, output);
        assert.ok(
          Buffer.byteLength(tail) <= 65536,
          `stderr tail: ${Buffer.byteLength(tail)} bytes`,
        );
      } else assert.match(output, /server diagnostic 219/);
      assert.doesNotMatch(output, /server diagnostic 0\n/);
      assert.match(
        output,
        /Health did not become ready|health.*timed out|Timed out.*health/i,
      );
      if (cleanupFailure)
        assert.match(output, /injected cleanup liveness failure/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
