import type { FastifyInstance, FastifyRequest } from "fastify";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface AdminRoutesOptions {
  // Invoked after a valid loopback shutdown request. The app deliberately does NOT
  // call process.exit itself (that would kill the test runner); the CLI supplies a
  // callback that closes the app and exits. When omitted, /admin/shutdown reports 501.
  onShutdownRequest?: () => void;
}

// A request is "local" only if it came straight from the loopback interface AND was
// not relayed by a reverse proxy. Tailscale Serve / lizardtail terminate the tunnel
// and re-connect from 127.0.0.1, so the loopback check alone is not enough — we also
// reject anything carrying proxy-forwarding headers.
function isLocalRequest(request: FastifyRequest): boolean {
  if (request.headers["x-forwarded-for"] !== undefined) return false;
  if (request.headers["forwarded"] !== undefined) return false;
  return LOOPBACK_ADDRESSES.has(request.ip);
}

export async function registerAdminRoutes(app: FastifyInstance, options: AdminRoutesOptions = {}): Promise<void> {
  app.post("/admin/shutdown", async (request, reply) => {
    if (!isLocalRequest(request)) {
      return reply.code(403).send({ error: "forbidden_remote", message: "Shutdown is only allowed from localhost." });
    }

    const { onShutdownRequest } = options;
    if (!onShutdownRequest) {
      return reply.code(501).send({ error: "shutdown_unavailable", message: "This server was started without shutdown support." });
    }

    // Schedule the actual teardown for the next tick so the 202 flushes to the caller first.
    setImmediate(onShutdownRequest);
    return reply.code(202).send({ status: "shutting_down" });
  });
}
