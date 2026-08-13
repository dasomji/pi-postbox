import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function runPackagedSmoke(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const credentialNames = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"];
    const environment = { ...process.env };
    for (const name of credentialNames) delete environment[name];
    environment.PI_POSTBOX_TAILSCALE = "off";
    const child = spawn(process.execPath, [resolve(process.cwd(), "scripts/smoke-postbox.mjs")], {
      cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code, output }));
  });
}

describe("shipped asynchronous Postbox acceptance", () => {
  it("executes the credential-free packaged fake-adapter/browser workflow across every release seam", async () => {
    const result = await runPackagedSmoke();
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("Pi Postbox smoke passed");
    for (const proof of ["async owner single/ordered batch", "browser races", "ping/get_answer/wait", "offline takeover",
      "migration", "capacity", "Question Chat", "restart", "History verified"]) {
      expect(result.output, `packaged smoke omitted ${proof}`).toContain(proof);
    }
    for (const credential of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"]) {
      expect(result.output).not.toContain(credential);
    }
  }, 30_000);
});
