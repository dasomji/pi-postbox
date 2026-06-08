import { useEffect, useState } from "react";
import { fetchHealth } from "../api/postboxApi";
import type { ConnectionState } from "../types";

export function useHealthCheck(): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    fetchHealth()
      .then((health) => {
        if (!cancelled) setConnection({ status: "connected", health });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown health check error";
        if (!cancelled) setConnection({ status: "unavailable", message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return connection;
}
