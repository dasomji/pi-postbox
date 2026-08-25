import { createHash } from "node:crypto";
import type { SessionRegistration } from "@pi-postbox/protocol";

interface SessionLikeContext {
  cwd?: string;
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
    getLeafId?: () => string | undefined;
  };
}

interface PiLikeApi {
  getSessionName?: () => string | undefined;
}

function stableId(value: string): string {
  return `session_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

export function collectSessionMetadata(
  pi: PiLikeApi,
  ctx: SessionLikeContext,
  branch?: string,
  worktreePath?: string,
  fallbackSessionIdentity?: string
): SessionRegistration {
  const cwd = ctx.cwd ?? process.cwd();
  const sessionPath = ctx.sessionManager?.getSessionFile?.();
  const piSessionId = ctx.sessionManager?.getSessionId?.();
  const sessionId = sessionPath ? stableId(sessionPath) : stableId(fallbackSessionIdentity ?? `${cwd}:${process.pid}`);

  return {
    sessionId,
    title: pi.getSessionName?.(),
    cwd,
    branch,
    worktreePath,
    semanticState: "idle",
    agentSessionId: piSessionId,
    agentSessionPath: sessionPath,
    leafId: ctx.sessionManager?.getLeafId?.(),
    owner: piSessionId ? { harness: "pi", ownerId: piSessionId } : undefined
  };
}
