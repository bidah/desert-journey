"use client";

import { ReactorProvider } from "@reactor-team/js-sdk";
import { useCallback, useRef, type ReactNode } from "react";

import { ORBIS_MODEL_NAME, ORBIS_TRACKS, requestReactorJwt } from "@/lib/orbis";
import type { ReactorModelName } from "@/lib/reactor-models";

export type JwtHandles = {
  clearJwt: () => void;
  getCurrentJwt: () => string | null;
};

/**
 * Wraps children in a Reactor provider for `modelName` (Orbis Stable by
 * default), minting session JWTs through /api/token on demand. The render
 * prop receives the JWT handles the session hook needs for cleanup.
 */
export function OrbisShell({
  modelName = ORBIS_MODEL_NAME,
  children,
}: {
  modelName?: ReactorModelName;
  children: (handles: JwtHandles) => ReactNode;
}) {
  const jwtPromise = useRef<Promise<string> | null>(null);
  const currentJwt = useRef<string | null>(null);
  const getJwt = useCallback(async () => {
    const pending = (jwtPromise.current ??= requestReactorJwt(modelName));
    try {
      const jwt = await pending;
      currentJwt.current = jwt;
      return jwt;
    } catch (error) {
      // Do not permanently cache a failed token request.
      if (jwtPromise.current === pending) jwtPromise.current = null;
      throw error;
    }
  }, [modelName]);
  const getCurrentJwt = useCallback(() => currentJwt.current, []);
  const clearJwt = useCallback(() => {
    jwtPromise.current = null;
    currentJwt.current = null;
  }, []);

  return (
    <ReactorProvider
      apiUrl="https://api.reactor.inc"
      modelName={modelName}
      modelTracks={[...ORBIS_TRACKS]}
      connectOptions={{ autoConnect: false }}
      jwtToken={getJwt}
    >
      {children({ clearJwt, getCurrentJwt })}
    </ReactorProvider>
  );
}
