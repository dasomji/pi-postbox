import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  discriminatorValues,
  listProtocolSourceModules,
  readServerPackageVersion
} from "../../../scripts/android-contract-inputs.mjs";

const root = resolve(import.meta.dirname, "../../..");

describe("Android contract generator inputs", () => {
  it("enumerates every non-test protocol source module", async () => {
    const modules = await listProtocolSourceModules(root);

    expect(modules).toContain("history.ts");
    expect(modules).toContain("limits.ts");
    expect(modules).toContain("questionTelemetry.ts");
    expect(modules).toContain("serverProfile.ts");
    expect(modules).toContain("ws.ts");
    expect(modules.some((module: string) => module.endsWith(".test.ts"))).toBe(false);
  });

  it("derives transport from the versioned stream-event schema", async () => {
    const protocol = await import(pathToFileURL(resolve(root, "packages/protocol/dist/index.js")).href);

    expect(discriminatorValues(protocol.VersionedQuestionChatStreamEventSchema, "type"))
      .toContain("transport");
  });

  it("reads the health fixture version from the server package manifest", async () => {
    await expect(readServerPackageVersion(root)).resolves.toBe("0.2.11");
  });
});
