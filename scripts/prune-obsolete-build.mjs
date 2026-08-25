import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const obsoleteGeneratedFiles = [
  ...["js", "d.ts", "d.ts.map"].map((suffix) => join(repositoryRoot, "packages", "protocol", "dist", `activeLocal.${suffix}`)),
  ...["js", "d.ts", "d.ts.map"].map((suffix) => join(repositoryRoot, "packages", "server", "dist", `activeLocalTarget.${suffix}`))
];

await Promise.all(obsoleteGeneratedFiles.map((path) => rm(path, { force: true })));
