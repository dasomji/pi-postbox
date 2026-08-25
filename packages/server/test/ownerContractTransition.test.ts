import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function runtimeText(relative: string): string {
  const root = resolve(process.cwd(), relative);
  const files: string[] = [];
  const visit = (path: string) => {
    if (statSync(path).isDirectory()) for (const entry of readdirSync(path)) visit(resolve(path, entry));
    else if (/\.(ts|svelte|kt|md)$/.test(path) && !/\.(test|spec)\.(ts|kt)$/.test(path)) files.push(path);
  };
  visit(root);
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("completed owner Question/Answer contract transition", () => {
  it("removes urgency from protocol, extension, server, web, Android, and current documentation consumers", () => {
    const consumers = ["packages/protocol/src", "packages/extension/src", "packages/server/src", "apps/web/src",
      "apps/android/app/src/main", "README.md", "docs/protocol.md", "docs/configuration.md"];
    for (const consumer of consumers) expect(runtimeText(consumer), consumer).not.toMatch(/\burgency\b/i);
  });

  it("removes the blocking request and configurable retention compatibility surfaces after callers migrate", () => {
    const runtime = ["packages/protocol/src", "packages/extension/src", "packages/server/src", "apps/web/src",
      "apps/android/app/src/main"].map(runtimeText).join("\n");
    expect(runtime).not.toMatch(/awaitAnswer|history-retention|maxHistoryRecords|retentionMaxAge/i);
    const docs = ["README.md", "docs/protocol.md", "docs/configuration.md"].map(runtimeText).join("\n");
    expect(docs).not.toMatch(/history\/prune|history-retention|retention cap/i);
  });
});
