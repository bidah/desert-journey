"use client";

import { useEffect } from "react";

import { forgetSession, rememberSession } from "@/lib/orbis";
import type { ReactorModelName } from "@/lib/reactor-models";

/**
 * Housekeeping every Reactor session needs, whichever model it runs: close the
 * session when the page unloads, remember it so a reload can close it, and in
 * development register it for the dev server's cleanup sweep.
 */
export function useReactorLifecycle({
  modelName,
  sessionId,
  getCurrentJwt,
  onError,
}: {
  modelName: ReactorModelName;
  sessionId: string | null | undefined;
  getCurrentJwt: () => string | null;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    const handlePageHide = (event: PageTransitionEvent) => {
      // A page entering the back-forward cache is suspended, not closed.
      if (event.persisted || !sessionId) return;

      const jwt = getCurrentJwt();
      if (!jwt) return;

      // keepalive asks the browser to finish uploading this small request even
      // after the document starts unloading. The server then terminates only
      // the session owned by this session-scoped JWT.
      void fetch("/api/session-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, jwt }),
        keepalive: true,
      }).catch(() => {
        // The page is leaving, so there is nowhere useful to surface failure.
      });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [getCurrentJwt, sessionId]);

  useEffect(() => {
    const jwt = sessionId && getCurrentJwt();
    if (sessionId && jwt) rememberSession(sessionId, jwt);
  }, [getCurrentJwt, sessionId]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !sessionId) {
      return;
    }

    const jwt = getCurrentJwt();
    if (!jwt) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const register = async (attempt: number) => {
      try {
        const response = await fetch("/api/session-registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, jwt, model: modelName }),
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            result?.error ?? `registry returned ${response.status}`,
          );
        }
      } catch (caught) {
        if (cancelled) return;
        if (attempt < 5) {
          retryTimer = setTimeout(
            () => void register(attempt + 1),
            attempt * 1_000,
          );
          return;
        }
        onError(
          `Could not register Reactor session for development cleanup: ${
            caught instanceof Error ? caught.message : String(caught)
          }`,
        );
      }
    };

    void register(1);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [getCurrentJwt, modelName, onError, sessionId]);
}

/** Forgets a session the browser has disconnected, locally and in the dev registry. */
export async function releaseSession(sessionId: string | null | undefined) {
  forgetSession(sessionId ?? undefined);
  if (process.env.NODE_ENV !== "development" || !sessionId) return;
  try {
    await fetch("/api/session-registry", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    // A stale registry entry is harmless: the next sweep gets a 404 from
    // Reactor and removes it.
  }
}
