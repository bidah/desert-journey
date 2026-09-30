"use client";

import { useReactor, useReactorMessage } from "@reactor-team/js-sdk";
import { useEffect, useRef, useState } from "react";

import { releaseSession, useReactorLifecycle } from "@/hooks/use-reactor-lifecycle";
import type { CueSettings } from "@/lib/cue-sheet";
import {
  closePreviousSession,
  DOCUMENTED_RESOLUTIONS,
  ORBIS_MODEL_NAME,
  type OrbisMessage,
  unwrapOrbisMessage,
} from "@/lib/orbis";

export function useOrbisSession(
  clearJwt: () => void,
  getCurrentJwt: () => string | null,
  { initialMuted = true }: { initialMuted?: boolean } = {},
) {
  const { status, sessionId, connect, disconnect, sendCommand, uploadFile } =
    useReactor((state) => ({
      status: state.status,
      sessionId: state.sessionId,
      connect: state.connect,
      disconnect: state.disconnect,
      sendCommand: state.sendCommand,
      uploadFile: state.uploadFile,
    }));

  const [resolution, setResolution] = useState("");
  const [availableResolutions, setAvailableResolutions] = useState<string[]>(
    DOCUMENTED_RESOLUTIONS,
  );
  const [muted, setMuted] = useState(initialMuted);
  const [busy, setBusy] = useState(false);
  const [runStarted, setRunStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [imageStatus, setImageStatus] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  // Increments on every start, so the player can detect each run's first frame.
  const [runId, setRunId] = useState(0);
  // What the model reports it is generating from, for checking prompts land.
  const [activePrompt, setActivePrompt] = useState("");

  const previousStatus = useRef(status);
  const disconnecting = useRef(false);
  const conditionsReadyResolver = useRef<(() => void) | null>(null);
  const imageReadyResolver = useRef<(() => void) | null>(null);
  const expectsImageForRun = useRef(false);
  // While a hard cut restarts the run, the reset must not end the take.
  const restarting = useRef(false);
  // Set by stopRun so an in-flight restart never sends its start.
  const cancelled = useRef(false);

  const connected = status === "ready";
  const controlsBusy = busy;

  useEffect(() => {
    if (
      status === "disconnected" &&
      previousStatus.current !== "disconnected"
    ) {
      setRunStarted(false);
      setPaused(false);
      setImageStatus("");
    }
    previousStatus.current = status;
  }, [status]);

  useReactorLifecycle({
    modelName: ORBIS_MODEL_NAME,
    sessionId,
    getCurrentJwt,
    onError: setError,
  });

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateRunState = (message: OrbisMessage) => {
    if (
      restarting.current &&
      (message.type === "generation_reset" ||
        message.type === "generation_complete" ||
        (message.type === "state" && message.started === false))
    ) {
      return;
    }
    if (message.type === "state") {
      if (typeof message.started === "boolean") setRunStarted(message.started);
      if (typeof message.paused === "boolean") setPaused(message.paused);
      if (message.has_image === false && !message.started) setImageStatus("");
    } else if (message.type === "generation_started") {
      setRunStarted(true);
      setPaused(false);
      if (message.image_conditioned === true) {
        setImageStatus("Orbis started from this image");
      } else if (
        message.image_conditioned === false &&
        expectsImageForRun.current
      ) {
        setImageStatus("Orbis started without image conditioning");
        setError("Orbis started without the uploaded image.");
      }
    } else if (message.type === "generation_paused") {
      setPaused(true);
    } else if (message.type === "generation_resumed") {
      setPaused(false);
    } else if (
      message.type === "generation_complete" ||
      message.type === "generation_reset"
    ) {
      setRunStarted(false);
      setPaused(false);
    }
  };

  useReactorMessage((raw: unknown) => {
    const message = unwrapOrbisMessage(raw);

    if (message.type === "conditions_ready") {
      conditionsReadyResolver.current?.();
      conditionsReadyResolver.current = null;
    }

    if (message.type === "state" && message.has_image === true) {
      imageReadyResolver.current?.();
      imageReadyResolver.current = null;
    }

    if (typeof message.active_prompt === "string") {
      const next = message.active_prompt;
      setActivePrompt((current) => {
        if (current !== next) {
          console.info("[orbis] active_prompt", message.session_chunk, next);
        }
        return next;
      });
    }

    if (message.type === "state" && message.available_resolutions) {
      const reported = message.available_resolutions.map(String);
      if (reported.length) {
        setAvailableResolutions(reported);
        setResolution((current) =>
          !current || reported.includes(current) ? current : "",
        );
      }
    }

    if (!disconnecting.current) updateRunState(message);

    if (message.type === "command_error") {
      setError(
        `${message.command || "command"}: ${message.reason || "rejected"}`,
      );
      if (message.command === "start") setRunStarted(false);
    }

    if (message.type && message.type !== "chunk_complete") {
      setEvents((current) => [message.type!, ...current].slice(0, 8));
    }
  });

  const waitForSignal = (
    resolver: { current: (() => void) | null },
    signalName: string,
  ) => {
    let timeout: ReturnType<typeof setTimeout>;
    const promise = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => {
        resolver.current = null;
        reject(new Error(`Timed out waiting for Orbis ${signalName}.`));
      }, 15_000);
      resolver.current = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    return {
      promise,
      cancel: () => {
        clearTimeout(timeout);
        resolver.current = null;
      },
    };
  };

  const startGeneration = async (
    startImage: File | null,
    runPrompt: string,
    passthrough: boolean,
    settings: CueSettings = {},
    preUploaded?: unknown,
  ) => {
    if (!runPrompt.trim()) throw new Error("Enter a prompt before starting.");
    expectsImageForRun.current = Boolean(startImage);

    if (startImage) {
      const uploaded =
        preUploaded ?? (await uploadFile(startImage, { name: startImage.name }));
      const imageReady = waitForSignal(imageReadyResolver, "state.has_image");
      const rawReply = await sendCommand("set_image", { image: uploaded });
      if (!rawReply) {
        imageReady.cancel();
        throw new Error("Orbis did not accept the uploaded start image.");
      }

      const reply = unwrapOrbisMessage(rawReply);
      if (reply.type === "command_error") {
        imageReady.cancel();
        throw new Error(`set_image: ${reply.reason || "rejected"}`);
      }
      if (reply.type !== "image_accepted") {
        imageReady.cancel();
        throw new Error(
          `Expected image_accepted from Orbis, received ${reply.type || "an unknown reply"}.`,
        );
      }

      await imageReady.promise;

      const dimensions =
        reply.width && reply.height ? ` (${reply.width}×${reply.height})` : "";
      setImageStatus(`Orbis accepted image${dimensions}`);
      setEvents((current) => ["image_accepted", ...current].slice(0, 8));
    }

    if (resolution) await sendCommand("set_resolution", { resolution });
    // Seed and audio are read at start; send them with every (re)start.
    if (typeof settings.seed === "number") {
      await sendCommand("set_seed", { seed: settings.seed });
    }
    if (typeof settings.audioEnabled === "boolean") {
      await sendCommand("set_audio_enabled", {
        audio_enabled: settings.audioEnabled,
      });
    }
    if (settings.audioPrompt !== undefined) {
      await sendCommand("set_audio_prompt", { prompt: settings.audioPrompt });
    }

    const conditionsReady = waitForSignal(
      conditionsReadyResolver,
      "conditions_ready",
    );
    console.info("[orbis] set_prompt (start)", { passthrough, prompt: runPrompt.trim() });
    const promptReply = await sendCommand("set_prompt", {
      prompt: runPrompt.trim(),
      passthrough,
    });
    if (!promptReply) {
      conditionsReady.cancel();
      throw new Error("Orbis did not accept the prompt.");
    }

    const promptMessage = unwrapOrbisMessage(promptReply);
    if (promptMessage.type === "command_error") {
      conditionsReady.cancel();
      throw new Error(`set_prompt: ${promptMessage.reason || "rejected"}`);
    }

    await conditionsReady.promise;
    setEvents((current) => ["conditions_ready", ...current].slice(0, 8));
    if (cancelled.current) throw new Error("Stopped.");
    await sendCommand("start", {});
    setRunStarted(true);
    setPaused(false);
    setRunId((current) => current + 1);
  };

  const startRun = (
    startImage: File | null,
    runPrompt: string,
    passthrough: boolean,
    settings?: CueSettings,
  ) => {
    cancelled.current = false;
    return runAction(() =>
      startGeneration(startImage, runPrompt, passthrough, settings),
    );
  };

  /** Ends the take, cancelling any restart that is still in flight. */
  const stopRun = async () => {
    cancelled.current = true;
    restarting.current = false;
    setRunStarted(false);
    setPaused(false);
    await sendCommand("reset", {}).catch(() => undefined);
  };

  /**
   * A hard cut: reset the running take and start a new one from `startImage`.
   * The image is uploaded before the reset so the current shot keeps playing
   * as long as possible. Unlike other actions this does not lock the controls,
   * so the take can still be reset or disconnected mid-cut.
   */
  const restartRun = async (
    startImage: File | null,
    runPrompt: string,
    passthrough: boolean,
    settings?: CueSettings,
  ) => {
    setError("");
    restarting.current = true;
    try {
      const uploaded = startImage
        ? await uploadFile(startImage, { name: startImage.name })
        : undefined;
      if (cancelled.current) return false;
      const reply = await sendCommand("reset", {});
      if (!reply) throw new Error("Orbis did not accept the reset.");
      await startGeneration(startImage, runPrompt, passthrough, settings, uploaded);
      return true;
    } catch (caught) {
      if (!cancelled.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      return false;
    } finally {
      restarting.current = false;
    }
  };

  // Mid-run prompts are fire-and-forget so a slow reply never delays the next
  // cue; failures surface through the returned promise and command_error.
  const sendPrompt = async (runPrompt: string, passthrough: boolean) => {
    console.info("[orbis] set_prompt (steer)", { passthrough, prompt: runPrompt.trim() });
    const reply = await sendCommand("set_prompt", {
      prompt: runPrompt.trim(),
      passthrough,
    });
    if (!reply) throw new Error("Orbis did not accept the prompt.");
    const message = unwrapOrbisMessage(reply);
    if (message.type === "command_error") {
      throw new Error(`set_prompt: ${message.reason || "rejected"}`);
    }
  };

  const disconnectSession = async () => {
    disconnecting.current = true;
    setRunStarted(false);
    setPaused(false);

    // Remove ReactorView before closing the WebRTC tracks it is playing.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    try {
      const disconnected = await runAction(() => disconnect());
      if (disconnected) {
        await releaseSession(sessionId);
        clearJwt();
      }
    } finally {
      disconnecting.current = false;
    }
  };

  return {
    status,
    connected,
    controlsBusy,
    runStarted,
    paused,
    muted,
    imageStatus,
    runId,
    activePrompt,
    resolution,
    availableResolutions,
    error,
    events,
    connectSession: () =>
      runAction(async () => {
        // Close a session a previous page load left open, then connect.
        await closePreviousSession();
        await connect();
      }),
    disconnectSession,
    toggleMuted: () => setMuted((current) => !current),
    setMuted,
    setResolution,
    setError,
    startRun,
    restartRun,
    stopRun,
    sendPrompt,
    pause: () => runAction(() => sendCommand("pause", {})),
    resume: () => runAction(() => sendCommand("resume", {})),
    reset: () => runAction(() => sendCommand("reset", {})),
  };
}

export type OrbisSession = ReturnType<typeof useOrbisSession>;
