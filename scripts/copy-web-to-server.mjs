#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const webDist = resolve("apps/web/dist");
const serverPublic = resolve("packages/server/dist/public");

if (!existsSync(webDist)) {
  console.error("apps/web/dist does not exist. Run `npm run build -w @pi-postbox/web` first.");
  process.exit(1);
}

await rm(serverPublic, { recursive: true, force: true });
await mkdir(serverPublic, { recursive: true });
await cp(webDist, serverPublic, { recursive: true });
console.log(`Copied web assets to ${serverPublic}`);
