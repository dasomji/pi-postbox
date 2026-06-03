#!/usr/bin/env node
import { createPostboxApp } from "./app.js";

export interface CliOptions {
  host: string;
  port: number;
  uiDistDir?: string;
  databasePath?: string;
  askTimeoutMs?: number;
  historyRetentionMaxAgeMs?: number;
  historyRetentionMaxRecords?: number;
}

export function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
  const getFlagValue = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const host = getFlagValue("--host") ?? env.PI_POSTBOX_HOST ?? "127.0.0.1";
  const portText = getFlagValue("--port") ?? env.PI_POSTBOX_PORT ?? "3000";
  const port = Number.parseInt(portText, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port: ${portText}`);
  }

  const askTimeoutText = getFlagValue("--ask-timeout-ms") ?? env.PI_POSTBOX_ASK_TIMEOUT_MS;
  let askTimeoutMs: number | undefined;
  if (askTimeoutText !== undefined) {
    const parsedAskTimeoutMs = Number.parseInt(askTimeoutText, 10);
    if (!Number.isInteger(parsedAskTimeoutMs) || parsedAskTimeoutMs <= 0) {
      throw new Error(`Invalid ask timeout: ${askTimeoutText}`);
    }
    askTimeoutMs = parsedAskTimeoutMs;
  }

  const historyRetentionMaxAgeText = getFlagValue("--history-retention-max-age-ms") ?? env.PI_POSTBOX_HISTORY_RETENTION_MAX_AGE_MS;
  let historyRetentionMaxAgeMs: number | undefined;
  if (historyRetentionMaxAgeText !== undefined) {
    const parsed = Number.parseInt(historyRetentionMaxAgeText, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid history retention max age: ${historyRetentionMaxAgeText}`);
    }
    historyRetentionMaxAgeMs = parsed;
  }

  const historyRetentionMaxRecordsText = getFlagValue("--history-retention-max-records") ?? env.PI_POSTBOX_HISTORY_RETENTION_MAX_RECORDS;
  let historyRetentionMaxRecords: number | undefined;
  if (historyRetentionMaxRecordsText !== undefined) {
    const parsed = Number.parseInt(historyRetentionMaxRecordsText, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Invalid history retention max records: ${historyRetentionMaxRecordsText}`);
    }
    historyRetentionMaxRecords = parsed;
  }

  return {
    host,
    port,
    uiDistDir: getFlagValue("--ui-dist-dir") ?? env.PI_POSTBOX_UI_DIST_DIR,
    databasePath: getFlagValue("--database") ?? env.PI_POSTBOX_DATABASE,
    askTimeoutMs,
    historyRetentionMaxAgeMs,
    historyRetentionMaxRecords
  };
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const options = parseCliOptions(argv, env);
  const app = await createPostboxApp({
    logger: true,
    uiDistDir: options.uiDistDir,
    databasePath: options.databasePath,
    askTimeoutMs: options.askTimeoutMs,
    historyRetentionMaxAgeMs: options.historyRetentionMaxAgeMs,
    historyRetentionMaxRecords: options.historyRetentionMaxRecords
  });

  const shutdown = async () => {
    await app.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const address = await app.listen({ host: options.host, port: options.port });
  console.log(`pi-postbox-server listening on ${address}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
