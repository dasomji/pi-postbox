import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function listProtocolSourceModules(root) {
  const entries = await readdir(resolve(root, "packages/protocol/src"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name)
    .sort();
}

export function discriminatorValues(schema, key) {
  const values = [];
  const visit = (candidate) => {
    if (!candidate) return;
    const shape = typeof candidate.shape === "function" ? candidate.shape() : candidate.shape;
    const value = shape?.[key]?.value;
    if (value !== undefined) {
      values.push(value);
      return;
    }
    const options = candidate.options ?? candidate._def?.options;
    if (options) {
      for (const option of options instanceof Map ? options.values() : options) visit(option);
      return;
    }
    visit(candidate._def?.schema ?? candidate._def?.innerType);
  };
  visit(schema);
  return [...new Set(values)];
}

export async function readServerPackageVersion(root) {
  const manifest = JSON.parse(await readFile(resolve(root, "packages/server/package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !manifest.version) {
    throw new Error("Unable to read server package version");
  }
  return manifest.version;
}
