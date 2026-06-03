import { formatAskResult } from "../tools/askPostbox.js";
import type { LocalAnswerInput, LocalCancelInput, PendingAskSnapshot, PostboxClient } from "../client/PostboxClient.js";

export interface CommandPiApi {
  registerCommand?: (name: string, options: { description?: string; handler: (args: string, ctx: CommandContext) => unknown }) => void;
}

export interface CommandContext {
  ui?: { notify?: (message: string, level?: string) => void };
}

export type LocalFallbackClient = Pick<PostboxClient, "listPendingAsks" | "answerPendingAsk" | "cancelPendingAsk">;

export function registerPostboxFallbackCommands(pi: CommandPiApi, getClient: () => LocalFallbackClient | undefined): void {
  pi.registerCommand?.("postbox-answer", {
    description: "Answer the active pending Postbox request locally. Usage: /postbox-answer [requestId] value[,value2] [--note text] [--rationale text]",
    handler: async (args, ctx) => {
      const client = getClient();
      if (!client) return notify(ctx, "Pi Postbox is not connected; no local pending asks are available.", "warn");
      try {
        const input = parseAnswerArgs(args, client.listPendingAsks());
        const result = client.answerPendingAsk(input);
        notify(ctx, formatAskResult(result), "info");
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "warn");
      }
    }
  });

  pi.registerCommand?.("postbox-cancel", {
    description: "Cancel the active pending Postbox request locally. Usage: /postbox-cancel [requestId] [--note text] [--rationale text]",
    handler: async (args, ctx) => {
      const client = getClient();
      if (!client) return notify(ctx, "Pi Postbox is not connected; no local pending asks are available.", "warn");
      try {
        const input = parseCancelArgs(args, client.listPendingAsks());
        const result = client.cancelPendingAsk(input);
        notify(ctx, formatAskResult(result), "info");
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "warn");
      }
    }
  });

  pi.registerCommand?.("postbox-status", {
    description: "Show the active pending Postbox request and local fallback command hints.",
    handler: async (_args, ctx) => {
      const pending = getClient()?.listPendingAsks() ?? [];
      if (pending.length === 0) return notify(ctx, "No pending Postbox asks.", "info");
      notify(ctx, pending.map(formatPendingStatus).join("\n"), "info");
    }
  });
}

export function parseAnswerArgs(args: string, pending: PendingAskSnapshot[]): LocalAnswerInput {
  if (pending.length === 0) throw new Error("No pending Postbox ask is available for local fallback");
  const parsed = parseFlaggedArgs(args);
  const words = parsed.positionals.trim().split(/\s+/).filter(Boolean);
  let requestId: string | undefined;
  let valuesText = parsed.positionals.trim();

  if (words.length > 0 && pending.some((ask) => ask.requestId === words[0])) {
    requestId = words[0];
    valuesText = words.slice(1).join(" ");
  } else if (pending.length === 1) {
    requestId = pending[0].requestId;
  } else {
    throw new Error("Multiple Postbox asks are pending; include the request id");
  }

  const selectedValues = valuesText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (selectedValues.length === 0) {
    throw new Error("Usage: /postbox-answer [requestId] value[,value2] [--note text] [--rationale text]");
  }

  return { requestId, selectedValues, note: parsed.flags.note, rationale: parsed.flags.rationale };
}

export function parseCancelArgs(args: string, pending: PendingAskSnapshot[]): LocalCancelInput {
  if (pending.length === 0) throw new Error("No pending Postbox ask is available for local fallback");
  const parsed = parseFlaggedArgs(args);
  const words = parsed.positionals.trim().split(/\s+/).filter(Boolean);
  let requestId: string | undefined;

  if (words.length > 0 && pending.some((ask) => ask.requestId === words[0])) {
    requestId = words[0];
  } else if (words.length === 0 && pending.length === 1) {
    requestId = pending[0].requestId;
  } else if (pending.length > 1) {
    throw new Error("Multiple Postbox asks are pending; include the request id");
  } else {
    requestId = pending[0].requestId;
  }

  return { requestId, note: parsed.flags.note, rationale: parsed.flags.rationale };
}

function parseFlaggedArgs(args: string): { positionals: string; flags: { note?: string; rationale?: string } } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const positional: string[] = [];
  const flags: { note?: string; rationale?: string } = {};
  let currentFlag: "note" | "rationale" | undefined;
  let currentValue: string[] = [];

  const flush = () => {
    if (!currentFlag) return;
    const value = currentValue.join(" ").trim();
    if (value) flags[currentFlag] = value;
    currentValue = [];
  };

  for (const token of tokens) {
    if (token === "--note" || token === "--rationale") {
      flush();
      currentFlag = token.slice(2) as "note" | "rationale";
      continue;
    }
    if (currentFlag) currentValue.push(token);
    else positional.push(token);
  }
  flush();

  return { positionals: positional.join(" "), flags };
}

function formatPendingStatus(ask: PendingAskSnapshot): string {
  const values = ask.options.map((option) => option.value).join(",");
  return `Postbox waiting ${ask.requestId}: ${ask.prompt}\nAnswer: /postbox-answer ${ask.requestId} ${values} [--note ...]\nCancel: /postbox-cancel ${ask.requestId} [--note ...]`;
}

function notify(ctx: CommandContext, message: string, level: string): void {
  ctx.ui?.notify?.(message, level);
}
