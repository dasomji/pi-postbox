#!/usr/bin/env node
// Standalone: the hook bootstraps this runner and its npm command from the index.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  symlinkSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
let temporary;
const started = performance.now();
try {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.env.INIT_CWD ?? process.cwd(),
    encoding: "utf8",
  }).trim();
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  if (git("ls-files", "--unmerged"))
    throw Error("Resolve unmerged index entries first.");
  git("diff", "--cached", "--check");
  const names = (s) => s.split("\0").filter(Boolean);
  const changed = names(
    git("diff", "--cached", "--no-renames", "--name-only", "-z", "HEAD"),
  );
  const present = names(git("ls-files", "-z"));
  const presentSet = new Set(present);
  const selected = (changed.length ? changed : present).filter((p) =>
    presentSet.has(p),
  );
  temporary = mkdtempSync(join(tmpdir(), "postbox-index-"));
  const snapshot = join(temporary, "tree");
  mkdirSync(snapshot);
  git("checkout-index", "--all", "--force", `--prefix=${snapshot}/`);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.startsWith("GIT_") &&
        !k.startsWith("NODE_TEST_") &&
        !k.startsWith("npm_") &&
        k !== "INIT_CWD",
    ),
  );
  const run = (cmd, args) => {
    console.log(
      "+",
      cmd,
      ...(args[0] === "add"
        ? ["add", `(${present.length} indexed paths)`]
        : args),
    );
    const p = spawnSync(cmd, args, { cwd: snapshot, env, stdio: "inherit" });
    if (p.error) throw p.error;
    if (p.status !== 0) throw Error(`${cmd} exited ${p.status ?? p.signal}`);
  };
  // Independent Git metadata, original objects read-only: staged discipline can
  // compare the exported index with the exact original HEAD without live writes.
  run("git", ["init", "-q"]);
  writeFileSync(
    join(snapshot, ".git/objects/info/alternates"),
    git("rev-parse", "--path-format=absolute", "--git-path", "objects").trim() +
      "\n",
  );
  run("git", ["update-ref", "HEAD", git("rev-parse", "HEAD").trim()]);
  run("git", ["add", "--all", "--force", "--", ...present]);
  const dependencies = join(root, "node_modules");
  if (!existsSync(dependencies)) throw Error("Run npm ci before check:fast.");
  // Do not reuse workspace symlinks or output from the working tree.
  mkdirSync(join(snapshot, "node_modules"));
  for (const name of readdirSync(dependencies)) {
    if (name === "@pi-postbox") continue;
    symlinkSync(join(dependencies, name), join(snapshot, "node_modules", name));
  }
  const lockPath = join(snapshot, "package-lock.json");
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const installed = JSON.parse(
      readFileSync(join(dependencies, ".package-lock.json"), "utf8"),
    );
    for (const [name, entry] of Object.entries(lock.packages ?? {})) {
      if (entry.link) {
        const target = join(snapshot, name);
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(resolve(snapshot, entry.resolved), target, "dir");
      } else if (
        name.startsWith("node_modules/") &&
        !entry.optional &&
        installed.packages?.[name]?.version !== entry.version
      )
        throw Error(
          `Installed dependency differs from staged lock: ${name}. Run npm ci for that lock.`,
        );
    }
  }
  const npm = (...args) => run("npm", ["run", ...args]);
  const paths = changed.length ? changed : present;
  // File reads are invisible to Vitest's import graph. Discover from indexed
  // tests, including future readers; conservatively include filesystem readers
  // even when their documentation paths are computed or hidden in a helper.
  const tests = present.filter((p) =>
    /^(?:packages|apps)\/.*\.test\.ts$/.test(p),
  );
  const docsTests = paths.some((p) => /\.md$/i.test(p))
    ? tests.filter((p) =>
        /README\.md|docs\/|readFile/.test(
          readFileSync(join(snapshot, p), "utf8"),
        ),
      )
    : [];
  let built = false;
  const build = () => {
    if (!built) npm("build");
    built = true;
  };
  const runExtraTests = (files) => {
    if (!files.length) return;
    // Documentation/package and Android scaffold tests consume built output.
    build();
    run(process.execPath, [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--no-file-parallelism",
      ...files,
    ]);
  };
  if (selected.length) npm("lint", "--", ...selected);
  run(process.execPath, ["scripts/check-protocol-discipline.mjs", "--staged"]);
  const docsOnly =
    changed.length > 0 &&
    changed.every(
      (p) => /\.md$/i.test(p) && !/(?:^|\/)(?:AGENTS|CLAUDE)\.md$/.test(p),
    );
  if (docsOnly) {
    npm("lint:docs");
    runExtraTests(docsTests);
  } else {
    const android = paths.some((p) => p.startsWith("apps/android/"));
    const known = (p) =>
      /^(?:packages\/(?:server|extension|protocol)\/.*\.(?:ts|json)|apps\/web\/.*\.(?:ts|js|svelte|json|css)|apps\/android\/|docs\/.*\.md$)/.test(
        p,
      );
    const broad =
      !changed.length ||
      paths.some((p) => !known(p)) ||
      paths.some((p) => !presentSet.has(p));
    const node =
      broad ||
      paths.some((p) => p.startsWith("packages/") || p.startsWith("apps/web/"));
    const web =
      broad ||
      paths.some(
        (p) => p.startsWith("apps/web/") || p.startsWith("packages/protocol/"),
      );
    const contract =
      broad ||
      paths.some(
        (p) =>
          p.startsWith("packages/protocol/") ||
          p === "packages/server/package.json" ||
          p.startsWith("scripts/") ||
          p.endsWith("/GeneratedPostboxProtocolContract.kt") ||
          p === "apps/android/app/build.gradle.kts",
      );
    if (node) {
      npm("typecheck");
      if (web) run("npm", ["run", "check", "-w", "@pi-postbox/web"]);
      run("npm", ["run", "build", "-w", "@pi-postbox/protocol"]);
    }
    if (contract) npm("check:android-protocol-contract");
    if (node) {
      if (broad) run("npm", ["test"]);
      else {
        // Related cases can launch the packaged smoke or import runtime dist.
        build();
        const report = join(temporary, "related.json");
        const args = [
          "node_modules/vitest/vitest.mjs",
          "related",
          "--run",
          "--no-file-parallelism",
          "--reporter=default",
          "--reporter=json",
          `--outputFile.json=${report}`,
          ...paths,
        ];
        console.log("+", process.execPath, ...args);
        const p = spawnSync(process.execPath, args, {
          cwd: snapshot,
          env,
          stdio: "inherit",
        });
        if (p.error) throw p.error;
        const result = existsSync(report)
          ? JSON.parse(readFileSync(report, "utf8"))
          : undefined;
        if (result?.numTotalTests === 0) {
          console.log("No related tests: falling back to the complete suite.");
          run("npm", ["test"]);
        } else if (p.status !== 0 || !result)
          throw Error(
            "Related tests failed or no trustworthy report was produced.",
          );
      }
    }
    if (!broad)
      runExtraTests([
        ...new Set([
          ...docsTests,
          ...(android ? tests.filter((p) => p.startsWith("apps/")) : []),
          ...(node ? tests.filter((p) => p.endsWith(".static.test.ts")) : []),
        ]),
      ]);
    if (android || broad) npm("check:android", "--", "--unit");
  }
  console.log(
    `PASS check:fast (${((performance.now() - started) / 1000).toFixed(2)}s; index snapshot)`,
  );
} catch (error) {
  console.error(`check:fast failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
