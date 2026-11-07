#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
let part = "all";
let comparison;
while (args.length) {
  const flag = args.shift();
  const value = args.shift();
  if (flag === "--part" && ["all", "node", "android"].includes(value))
    part = value;
  else if (
    ["--base", "--push"].includes(flag) &&
    value &&
    !value.startsWith("-") &&
    !comparison
  )
    comparison = [flag, value];
  else
    throw Error(
      "Usage: check:full -- [--part node|android|all] --base <PR-target-base> | --push <previous-push-SHA>",
    );
}
if (part !== "android" && !comparison)
  throw Error(
    "check:full requires an explicit base: --base <PR-target-base> or --push <previous-push-SHA>.",
  );
const started = performance.now();
function run(command, argv) {
  console.log("+", command, ...argv);
  const p = spawnSync(command, argv, { stdio: "inherit" });
  if (p.error) throw p.error;
  if (p.status !== 0) process.exit(p.status ?? 1);
}
const npm = (...argv) => run("npm", ["run", ...argv]);
if (part !== "android") {
  run(process.execPath, [
    "scripts/check-protocol-discipline.mjs",
    ...comparison,
  ]);
  npm("lint");
  npm("lint:docs");
  npm("typecheck");
  run("npm", ["run", "check", "-w", "@pi-postbox/web"]);
  npm("check:android-protocol-contract");
  run("npm", ["test"]);
  npm("build");
  npm("smoke");
}
if (part !== "node") {
  npm("check:android-protocol-contract");
  npm("check:android");
}
console.log(
  `PASS check:full ${part} (${((performance.now() - started) / 1000).toFixed(2)}s)`,
);
