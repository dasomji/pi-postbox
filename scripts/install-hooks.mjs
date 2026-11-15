#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
try {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const root = git("rev-parse", "--show-toplevel");
  accessSync(join(root, ".githooks/pre-commit"), constants.X_OK);
  const setting = spawnSync("git", ["config", "--get-all", "core.hooksPath"], {
    encoding: "utf8",
  });
  if (![0, 1].includes(setting.status))
    throw Error("Cannot read core.hooksPath");
  if (
    setting.status === 0 &&
    setting.stdout
      .replace(/\n$/, "")
      .split("\n")
      .some((s) => s !== ".githooks")
  )
    throw Error(
      "Refusing conflicting core.hooksPath; preserve and integrate existing hooks explicitly.",
    );
  const common = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  const hooks = join(common, "hooks");
  const existing = existsSync(hooks)
    ? readdirSync(hooks).filter((p) => !p.endsWith(".sample"))
    : [];
  if (existing.length)
    throw Error(`Refusing existing hooks: ${existing.join(", ")}`);
  const trees = git("worktree", "list", "--porcelain", "-z")
    .split("\0")
    .filter((s) => s.startsWith("worktree "));
  if (trees.length > 1)
    throw Error(
      "Refusing clone-wide installation with linked worktrees; install in a dedicated clone or integrate explicitly with its owner.",
    );
  git("config", "--local", "core.hooksPath", ".githooks");
  console.log("Installed core.hooksPath=.githooks in this clone.");
} catch (error) {
  console.error(`Hook installation failed: ${error.message}`);
  process.exitCode = 1;
}
