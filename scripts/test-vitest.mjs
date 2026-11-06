#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { relative } from "node:path";
if (process.argv.length !== 2)
  throw Error("Usage: node scripts/test-vitest.mjs");
const cli = "node_modules/vitest/vitest.mjs";
const listing = spawnSync(
  process.execPath,
  [cli, "list", "--filesOnly", "--json"],
  { encoding: "utf8" },
);
if (listing.error) throw listing.error;
if (listing.status !== 0)
  throw Error(`Vitest discovery failed: ${listing.stderr}`);
const found = JSON.parse(listing.stdout);
if (
  !Array.isArray(found) ||
  !found.length ||
  found.some((p) => typeof p.file !== "string")
)
  throw Error("No trustworthy Vitest file inventory.");
const files = [
  ...new Set(
    found.map((p) => relative(process.cwd(), p.file).replaceAll("\\", "/")),
  ),
];
const serial = [
  "packages/server/test/packageDocs.test.ts",
  "packages/server/test/shippedAsyncWorkflowAcceptance.test.ts",
  "apps/androidScaffold.test.ts",
];
for (const file of serial)
  if (!files.includes(file))
    throw Error(`Missing packaging/smoke test: ${file}`);
const ordinary = files.filter((file) => !serial.includes(file));
for (const [name, selected, flags] of [
  ["ordinary", ordinary, []],
  ["packaging/smoke", serial, ["--no-file-parallelism"]],
]) {
  if (!selected.length) continue;
  console.log(`Vitest ${name}: ${selected.length} files.`);
  const p = spawnSync(process.execPath, [cli, "run", ...flags, ...selected], {
    stdio: "inherit",
  });
  if (p.error) throw p.error;
  if (p.status !== 0) process.exit(p.status ?? 1);
}
