import { describe, expect, it } from "vitest";
import { exposePostboxWithTailscale, inspectPostboxTailscaleStatus } from "../src/tailscaleServe.js";

type ExecCall = { command: string; args: string[] };
type ExecResult = { stdout: string; stderr?: string };
type FakeExecHandler = (call: ExecCall) => ExecResult | Error;

function statusJson(dnsName = "postbox.tailnet.example."): string {
  return JSON.stringify({ Self: { DNSName: dnsName, TailscaleIPs: ["100.64.0.10"] } });
}

function serveStatusJson(web: Record<string, unknown> = {}): string {
  return JSON.stringify({ Web: web });
}

function fakeExecutor(handler: FakeExecHandler) {
  const calls: ExecCall[] = [];
  const exec = async (command: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    const call = { command, args };
    calls.push(call);
    const result = handler(call);
    if (result instanceof Error) throw result;
    return { stdout: result.stdout, stderr: result.stderr ?? "" };
  };
  return { exec, calls };
}

function isServeMutation(call: ExecCall): boolean {
  return call.command === "tailscale" && call.args[0] === "serve" && call.args.includes("--bg");
}

describe("Tailscale Serve integration", () => {
  it("exposes the actual bound Postbox port after inspecting Serve status and reports the Tailnet URL", async () => {
    const { exec, calls } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") return { stdout: serveStatusJson() };
      if (args.join(" ") === "status --json") return { stdout: statusJson() };
      if (args.join(" ") === "serve --bg --https 4567 http://127.0.0.1:4567") return { stdout: "" };
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    const result = await exposePostboxWithTailscale({
      localUrl: "http://127.0.0.1:4567/",
      role: "production",
      exec
    });

    expect(result).toMatchObject({
      state: "served",
      localUrl: "http://127.0.0.1:4567/",
      tailnetUrl: "https://postbox.tailnet.example:4567",
      httpsPort: 4567
    });
    expect(calls.findIndex((call) => call.args.join(" ") === "serve status --json")).toBeLessThan(
      calls.findIndex(isServeMutation)
    );
    expect(calls).toContainEqual({
      command: "tailscale",
      args: ["serve", "--bg", "--https", "4567", "http://127.0.0.1:4567"]
    });
    expect(calls.flatMap((call) => call.args)).not.toContain("funnel");
  });

  it("treats an existing same-target Serve mapping as idempotent and does not mutate Serve", async () => {
    const { exec, calls } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") {
        return {
          stdout: serveStatusJson({
            "postbox.tailnet.example:4567": {
              Handlers: { "/": { Proxy: "http://127.0.0.1:4567" } }
            }
          })
        };
      }
      if (args.join(" ") === "status --json") return { stdout: statusJson() };
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    const result = await exposePostboxWithTailscale({
      localUrl: "http://127.0.0.1:4567/",
      role: "production",
      exec
    });

    expect(result).toMatchObject({ state: "idempotent", tailnetUrl: "https://postbox.tailnet.example:4567" });
    expect(calls.some(isServeMutation)).toBe(false);
  });

  it("does not overwrite an existing mapping for a different local target", async () => {
    const { exec, calls } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") {
        return {
          stdout: serveStatusJson({
            "postbox.tailnet.example:4567": {
              Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } }
            }
          })
        };
      }
      if (args.join(" ") === "status --json") return { stdout: statusJson() };
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    const result = await exposePostboxWithTailscale({
      localUrl: "http://127.0.0.1:4567/",
      role: "production",
      exec
    });

    expect(result).toMatchObject({
      state: "conflict",
      localUrl: "http://127.0.0.1:4567/",
      tailnetUrl: "https://postbox.tailnet.example:4567"
    });
    expect(result.diagnostic).toMatch(/conflict|already/i);
    expect(result.remediation).toMatch(/tailscale serve status|status/i);
    expect(calls.some(isServeMutation)).toBe(false);
  });

  it.each([
    ["missing-cli", new Error("spawn tailscale ENOENT"), /not installed|unavailable/i],
    ["logged-out", new Error("tailscale status failed: not logged in"), /not logged in|unauthenticated|unavailable/i]
  ])("reports %s as an unavailable diagnostic instead of throwing", async (_name, failure, expectedDiagnostic) => {
    const { exec } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") throw failure;
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    await expect(
      exposePostboxWithTailscale({ localUrl: "http://127.0.0.1:4567/", role: "production", exec })
    ).resolves.toMatchObject({ state: "unavailable", diagnostic: expect.stringMatching(expectedDiagnostic) });
  });

  it("sanitizes permission failures and includes operator plus manual Serve guidance", async () => {
    const { exec } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") return { stdout: serveStatusJson() };
      if (args.join(" ") === "serve --bg --https 4567 http://127.0.0.1:4567") {
        return new Error("access denied: run sudo tailscale serve or configure an operator");
      }
      if (args.join(" ") === "status --json") return { stdout: statusJson() };
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    const result = await exposePostboxWithTailscale({
      localUrl: "http://127.0.0.1:4567/",
      role: "production",
      exec
    });

    expect(result).toMatchObject({ state: "unavailable" });
    expect(result.diagnostic).toMatch(/permission|access denied/i);
    expect(result.remediation).toContain("sudo tailscale set --operator=$USER");
    expect(result.remediation).toContain("tailscale serve --bg --https 4567 http://127.0.0.1:4567");
  });

  it("retries with a bare local port when loopback URL targets are rejected", async () => {
    const { exec, calls } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") return { stdout: serveStatusJson() };
      if (args.join(" ") === "serve --bg --https 4567 http://127.0.0.1:4567") {
        return new Error("unknown serve target URL form");
      }
      if (args.join(" ") === "serve --bg --https 4567 4567") return { stdout: "" };
      if (args.join(" ") === "status --json") return { stdout: statusJson() };
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    const result = await exposePostboxWithTailscale({
      localUrl: "http://127.0.0.1:4567/",
      role: "production",
      exec
    });

    expect(result).toMatchObject({ state: "served", tailnetUrl: "https://postbox.tailnet.example:4567" });
    expect(calls).toContainEqual({
      command: "tailscale",
      args: ["serve", "--bg", "--https", "4567", "4567"]
    });
  });

  it("does not retry with a bare local port when the primary Serve failure is not a URL target rejection", async () => {
    const { exec, calls } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") return { stdout: serveStatusJson() };
      if (args.join(" ") === "status --json") return { stdout: statusJson() };
      if (args.join(" ") === "serve --bg --https 4567 http://127.0.0.1:4567") {
        return new Error("tailscale daemon reported Serve unavailable");
      }
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    const result = await exposePostboxWithTailscale({
      localUrl: "http://127.0.0.1:4567/",
      role: "production",
      exec
    });

    expect(result).toMatchObject({ state: "unavailable", httpsPort: 4567 });
    expect(result.diagnostic).toMatch(/Serve unavailable/i);
    expect(calls).not.toContainEqual({
      command: "tailscale",
      args: ["serve", "--bg", "--https", "4567", "4567"]
    });
  });

  it("reports status from Serve state and falls back to a Tailscale IPv4 URL when DNS is absent", async () => {
    const { exec } = fakeExecutor(({ args }) => {
      if (args.join(" ") === "serve status --json") {
        return {
          stdout: serveStatusJson({
            "100.64.0.10:4567": { Handlers: { "/": { Proxy: "http://127.0.0.1:4567" } } }
          })
        };
      }
      if (args.join(" ") === "status --json") {
        return { stdout: JSON.stringify({ Self: { TailscaleIPs: ["100.64.0.10", "fd7a:115c:a1e0::1"] } }) };
      }
      return new Error(`unexpected tailscale command: ${args.join(" ")}`);
    });

    await expect(
      inspectPostboxTailscaleStatus({ localUrl: "http://127.0.0.1:4567/", role: "production", exec })
    ).resolves.toMatchObject({ state: "served", tailnetUrl: "https://100.64.0.10:4567" });
  });
});
