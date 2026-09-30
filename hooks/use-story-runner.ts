"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CueSettings } from "@/lib/cue-sheet";
import type { Story, StoryChoice } from "@/lib/story";

export type StoryStep = { node: string; label: string; at: number };

/** What the runner needs from a live stream: an Orbis session. */
export type StoryStream = {
  runStarted: boolean;
  paused: boolean;
  startRun: (
    image: File | null,
    prompt: string,
    passthrough: boolean,
    settings?: CueSettings,
  ) => Promise<boolean>;
  sendPrompt: (prompt: string, passthrough: boolean) => Promise<void>;
  stopRun: () => Promise<void>;
  setError: (message: string) => void;
};

type Scheduled = { prompt: string; at: number };

// After a choice, the character's reaction starts this long after the click,
// and the scene waits this long again after it ends before moving on.
const REACTION_DELAY_SECONDS = 2;
const REACTION_PAUSE_SECONDS = 2;

/**
 * Plays an interactive story in one continuous take. Choosing a scene sends
 * its first cue at once and the rest of its bridge `cueGapSeconds` apart;
 * the next two choices appear `holdSeconds` after the scene's last cue. A
 * scene with a reaction line plays it just after the choice (`reactionCue`)
 * and holds its choices back by the line's length plus a pause on each side.
 */
export function useStoryRunner({
  session,
  story,
  passthrough,
  firstChoicesSeconds,
  voiceLeadSeconds = 0,
}: {
  session: StoryStream;
  story: Story | null;
  passthrough: boolean;
  /**
   * Show the opening scene's choices this many seconds after the first frame,
   * instead of after the scene's usual hold.
   */
  firstChoicesSeconds?: number;
  /** `voiceCue` turns true this many seconds before each scene's choices. */
  voiceLeadSeconds?: number;
}) {
  const [node, setNode] = useState<string | null>(null);
  const [cueIndex, setCueIndex] = useState(0);
  const [path, setPath] = useState<StoryStep[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [choicesReady, setChoicesReady] = useState(false);
  // When the scene's spoken line should start (just before the choices).
  const [voiceCue, setVoiceCue] = useState(false);
  // When the line reacting to the viewer's choice should start.
  const [reactionCue, setReactionCue] = useState(false);
  const [playing, setPlaying] = useState(false);

  const firstFrameAt = useRef<number | null>(null);
  const armed = useRef(false);
  // Remaining bridge cues, and when the current scene's choices unlock (ms).
  const queue = useRef<Scheduled[]>([]);
  const choicesAt = useRef<number | null>(null);
  const reactionAt = useRef<number | null>(null);

  const clockNow = () =>
    firstFrameAt.current === null
      ? 0
      : (performance.now() - firstFrameAt.current) / 1000;

  const send = (prompt: string) =>
    session.sendPrompt(prompt, passthrough).catch((caught: unknown) => {
      session.setError(
        caught instanceof Error ? caught.message : String(caught),
      );
    });

  /** Queues a scene's remaining cues and its choice unlock, from `from` (ms). */
  const schedule = (scene: Story["nodes"][string], from: number) => {
    if (!story) return;
    const gap = story.cueGapSeconds * 1000;
    queue.current = scene.cues
      .slice(1)
      .map((prompt, index) => ({ prompt, at: from + gap * (index + 1) }));
    choicesAt.current =
      from +
      gap * (scene.cues.length - 1) +
      (story.holdSeconds + story.choiceDelaySeconds) * 1000;
  };

  const reset = () => {
    firstFrameAt.current = null;
    queue.current = [];
    choicesAt.current = null;
    reactionAt.current = null;
    armed.current = false;
    setPlaying(false);
    setChoicesReady(false);
    setVoiceCue(false);
    setReactionCue(false);
  };

  const begin = async (startImage: File | null) => {
    if (!story) return;
    reset();
    setElapsed(0);
    setNode(story.start);
    setCueIndex(0);
    setPath([{ node: story.start, label: "Start", at: 0 }]);
    armed.current = await session.startRun(
      startImage,
      story.nodes[story.start].cues[0],
      passthrough,
      story.settings,
    );
  };

  const markFirstFrame = useCallback(() => {
    if (!armed.current || firstFrameAt.current !== null || !story) return;
    firstFrameAt.current = performance.now();
    setPlaying(true);
    schedule(story.nodes[story.start], firstFrameAt.current);
    if (firstChoicesSeconds !== undefined) {
      choicesAt.current = firstFrameAt.current + firstChoicesSeconds * 1000;
    }
  }, [story, firstChoicesSeconds]);

  const choose = (choice: StoryChoice) => {
    if (!story || !choicesReady) return;
    const scene = story.nodes[choice.to];
    setChoicesReady(false);
    setVoiceCue(false);
    setReactionCue(false);
    setNode(choice.to);
    setCueIndex(0);
    setPath((current) => [
      ...current,
      { node: choice.to, label: choice.label, at: clockNow() },
    ]);
    void send(scene.cues[0]);
    const now = performance.now();
    schedule(scene, now);
    if (scene.reaction && choicesAt.current !== null) {
      reactionAt.current = now + REACTION_DELAY_SECONDS * 1000;
      choicesAt.current +=
        (REACTION_DELAY_SECONDS + scene.reaction.seconds + REACTION_PAUSE_SECONDS) *
        1000;
    }
  };

  const stop = async () => {
    reset();
    await session.stopRun();
  };

  useEffect(() => {
    if (!session.runStarted) reset();
  }, [session.runStarted]);

  // Fire queued bridge cues and unlock choices on time.
  useEffect(() => {
    if (!story || !playing) return;
    const timer = setInterval(() => {
      setElapsed(clockNow());
      if (session.paused) return;
      const now = performance.now();
      while (queue.current.length && queue.current[0].at <= now) {
        void send(queue.current.shift()!.prompt);
        setCueIndex((index) => index + 1);
      }
      if (reactionAt.current !== null && now >= reactionAt.current) {
        reactionAt.current = null;
        setReactionCue(true);
      }
      if (choicesAt.current !== null) {
        if (now >= choicesAt.current - voiceLeadSeconds * 1000) setVoiceCue(true);
        if (now >= choicesAt.current) {
          choicesAt.current = null;
          setChoicesReady(true);
        }
      }
    }, 200);
    return () => clearInterval(timer);
  }, [story, playing, session.paused, voiceLeadSeconds]);

  const scene = story && node ? story.nodes[node] : null;

  return {
    node,
    scene,
    cueIndex,
    path,
    elapsed,
    playing,
    waitingForFirstFrame: session.runStarted && !playing,
    choicesReady,
    voiceCue,
    reactionCue,
    begin,
    choose,
    stop,
    markFirstFrame,
  };
}

export type StoryRunner = ReturnType<typeof useStoryRunner>;
