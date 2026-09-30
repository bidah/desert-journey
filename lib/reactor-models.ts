// The Reactor-hosted model this app connects to. The server allows JWTs for
// this name only, so a browser cannot mint a token for anything else.

export const ORBIS_MODEL_NAME = "reactor/visko-orbis-stable";

export const REACTOR_MODEL_NAMES = [ORBIS_MODEL_NAME] as const;

export type ReactorModelName = (typeof REACTOR_MODEL_NAMES)[number];

export function isReactorModelName(value: unknown): value is ReactorModelName {
  return (
    typeof value === "string" &&
    (REACTOR_MODEL_NAMES as readonly string[]).includes(value)
  );
}

/** Orbis streams one video and one audio track to the browser. */
export const REACTOR_OUTPUT_TRACKS = [
  { name: "main_video", kind: "video", direction: "recvonly" },
  { name: "main_audio", kind: "audio", direction: "recvonly" },
] as const;
