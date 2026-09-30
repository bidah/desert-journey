import {
  ORBIS_MODEL_NAME,
  REACTOR_OUTPUT_TRACKS,
  type ReactorModelName,
} from "@/lib/reactor-models";

export { ORBIS_MODEL_NAME };

export const ORBIS_TRACKS = REACTOR_OUTPUT_TRACKS;

export const DOCUMENTED_RESOLUTIONS = ["1080p", "2k", "4k"];

export type OrbisMessage = {
  type?: string;
  command?: string;
  reason?: string;
  available_resolutions?: string[];
  width?: number;
  height?: number;
  has_image?: boolean;
  image_conditioned?: boolean;
  started?: boolean;
  paused?: boolean;
  active_prompt?: string;
  session_chunk?: number;
};

export function unwrapOrbisMessage(raw: unknown): OrbisMessage {
  const envelope = raw as { type?: string; data?: Record<string, unknown> };
  if (envelope?.data && typeof envelope.data === "object") {
    return { ...envelope.data, type: envelope.type } as OrbisMessage;
  }
  return raw as OrbisMessage;
}

/** Mints a session JWT for `model` through the server-side token route. */
export async function requestReactorJwt(
  model: ReactorModelName = ORBIS_MODEL_NAME,
) {
  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  const result = (await response.json()) as { jwt?: string; error?: string };
  if (!response.ok || !result.jwt) {
    throw new Error(result.error || "Could not create a Reactor token");
  }
  return result.jwt;
}

// The browser remembers its open session so a reload can close it before
// connecting again (the unload cleanup request can be cut off by the reload,
// and the account may allow only one concurrent session).
const LAST_SESSION_KEY = "orbis:last-session";

export function rememberSession(sessionId: string, jwt: string) {
  try {
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ sessionId, jwt }));
  } catch {
    // Storage is a convenience only.
  }
}

export function forgetSession(sessionId?: string) {
  try {
    const stored = localStorage.getItem(LAST_SESSION_KEY);
    if (!stored) return;
    if (!sessionId || JSON.parse(stored).sessionId === sessionId) {
      localStorage.removeItem(LAST_SESSION_KEY);
    }
  } catch {
    // Storage is a convenience only.
  }
}

/** Closes the session this browser left open, if any, and waits for it. */
export async function closePreviousSession() {
  let stored: { sessionId?: string; jwt?: string } | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(LAST_SESSION_KEY) ?? "null");
  } catch {
    stored = null;
  }
  if (!stored?.sessionId || !stored.jwt) return;
  try {
    await fetch("/api/session-cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stored),
    });
  } catch {
    // If it is still open, connecting reports the quota and is retried.
  }
  forgetSession(stored.sessionId);
}
