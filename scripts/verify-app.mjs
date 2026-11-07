#!/usr/bin/env node
import { spawn } from "node:child_process";
if (process.env.CI)
  throw Error(
    "verify:app refuses CI; run the isolated functional journey on Coolify.",
  );
if (process.platform !== "linux")
  throw Error("verify:app requires the Coolify Linux host.");
async function run(command, args) {
  console.log("+", command, ...args);
  const child = spawn(command, args, { stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    if (code !== 0) throw Error(`${command} exited ${code}`);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
const started = performance.now();
await run("npm", ["run", "build"]);
await run(process.execPath, ["scripts/smoke-postbox.mjs"]);
console.log(
  `PASS verify:app (${((performance.now() - started) / 1000).toFixed(2)}s); browser/device visual journeys are separate verifier work.`,
);
