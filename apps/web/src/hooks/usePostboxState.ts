import { StateSnapshotSchema, type StateSnapshot } from "@pi-postbox/protocol";
import { useCallback, useEffect, useState } from "react";
import { fetchHistory, fetchSnapshot } from "../api/postboxApi";
import type { HistoryState, SnapshotState } from "../types";

export function usePostboxState() {
  const [snapshot, setSnapshot] = useState<SnapshotState>({ status: "loading" });
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });

  const loadHistory = useCallback(() => {
    return fetchHistory()
      .then((response) => setHistory({ status: "ready", response }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown history error";
        setHistory({ status: "error", message });
      });
  }, []);

  const loadSnapshot = useCallback(() => {
    return fetchSnapshot()
      .then((nextSnapshot) => setSnapshot({ status: "ready", snapshot: nextSnapshot }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown state snapshot error";
        setSnapshot({ status: "error", message });
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;

    void loadHistory();

    const applySnapshot = (nextSnapshot: StateSnapshot) => {
      if (!cancelled) setSnapshot({ status: "ready", snapshot: nextSnapshot });
    };

    const load = () => {
      fetchSnapshot()
        .then(applySnapshot)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown state snapshot error";
          if (!cancelled) setSnapshot({ status: "error", message });
        });
    };

    const startPollingFallback = () => {
      if (fallbackTimer) return;
      load();
      fallbackTimer = setInterval(load, 5_000);
    };

    if (!("EventSource" in window)) {
      startPollingFallback();
      return () => {
        cancelled = true;
        if (fallbackTimer) clearInterval(fallbackTimer);
      };
    }

    const events = new EventSource("/api/state/events");
    events.addEventListener("state", (event) => {
      try {
        applySnapshot(StateSnapshotSchema.parse(JSON.parse(event.data)));
        void loadHistory();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid live state event";
        if (!cancelled) setSnapshot({ status: "error", message });
      }
    });
    events.onerror = () => {
      startPollingFallback();
    };

    return () => {
      cancelled = true;
      events.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [loadHistory]);

  const refreshAfterResolution = useCallback(async () => {
    await Promise.all([loadSnapshot(), loadHistory()]);
  }, [loadHistory, loadSnapshot]);

  return { history, loadHistory, loadSnapshot, refreshAfterResolution, snapshot };
}
