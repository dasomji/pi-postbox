#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const selected = process.argv.slice(2);
const files = (selected.length ? selected : tracked).filter(
  (p) =>
    !/(?:^|\/)(?:node_modules|dist|build|vendor|generated|\.kitchen)\//i.test(
      p,
    ) && !p.endsWith(".d.ts"),
);
function run(name, args) {
  const p = spawnSync(process.execPath, [name, ...args], { stdio: "inherit" });
  if (p.error) throw p.error;
  if (p.status !== 0) process.exit(p.status ?? 1);
}
if (files.includes(".githooks/pre-commit")) {
  const shell = spawnSync("sh", ["-n", ".githooks/pre-commit"], {
    stdio: "inherit",
  });
  if (shell.error) throw shell.error;
  if (shell.status !== 0) process.exit(shell.status ?? 1);
}
const code = files.filter((p) => /\.(?:[cm]?js|tsx?|svelte)$/.test(p));
if (code.length)
  run("node_modules/oxlint/bin/oxlint", ["--max-warnings", "0", "--", ...code]);
const format = files.filter(
  (p) =>
    /^scripts\/.*\.mjs$/.test(p) ||
    /^(?:package\.json|(?:packages\/[^/]+|apps\/web)\/package\.json|\.oxlintrc\.json|\.github\/workflows\/ci\.yml)$/.test(
      p,
    ),
);
if (format.length)
  run("node_modules/prettier/bin/prettier.cjs", ["--check", ...format]);
console.log(
  `Lint passed (${code.length} code, ${format.length} format files).`,
);
