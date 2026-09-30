"use client";

import { useEffect, type RefObject } from "react";

/**
 * Calls `onFirstFrame` when the <video> inside `containerRef` presents the
 * first frame of each run (`runId` changes on every start). ReactorView mounts
 * its <video> asynchronously, and the first Orbis chunk emits no frames, so
 * this is the moment a run's first picture is actually on screen.
 */
export function useFirstFrame(
  containerRef: RefObject<HTMLElement | null>,
  runStarted: boolean,
  runId: number,
  onFirstFrame: () => void,
) {
  useEffect(() => {
    if (!runStarted) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const watch = () => {
      if (cancelled) return;
      const video = containerRef.current?.querySelector("video");
      if (!video) {
        retry = setTimeout(watch, 100);
        return;
      }
      if ("requestVideoFrameCallback" in video) {
        video.requestVideoFrameCallback(() => {
          if (!cancelled) onFirstFrame();
        });
      } else {
        (video as HTMLVideoElement).addEventListener(
          "playing",
          () => !cancelled && onFirstFrame(),
          { once: true },
        );
      }
    };
    watch();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [containerRef, runStarted, runId, onFirstFrame]);
}
