"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StoryRunner } from "@/hooks/use-story-runner";
import { formatTimecode } from "@/lib/cue-sheet";
import type { Story, StoryChoice } from "@/lib/story";

/** How long a picked card stays on screen while it fades. */
const LEAVE_MS = 1_400;

/**
 * The two choices, drawn over the video once the current scene has landed.
 *
 * With `autoPickSeconds`, a "Make your choice" countdown runs over the cards
 * and picks one at random when it ends. A picked card shows as selected and
 * both fade out; the choice itself is sent at once.
 */
export function StoryChoices({
  runner,
  autoPickSeconds,
}: {
  runner: StoryRunner;
  autoPickSeconds?: number;
}) {
  const [leaving, setLeaving] = useState<{
    choices: StoryChoice[];
    picked: StoryChoice;
  } | null>(null);
  const { choicesReady, scene, node, choose } = runner;

  const pick = useCallback(
    (choice: StoryChoice) => {
      if (!scene) return;
      setLeaving({ choices: scene.choices, picked: choice });
      choose(choice);
    },
    [scene, choose],
  );

  // Clear the fading snapshot once its animation has played.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  // Pick at random when the countdown runs out. `pick` changes on every
  // render of the runner, so read it through a ref rather than restarting the
  // timer each time.
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    if (!autoPickSeconds || !choicesReady || !scene?.choices.length) return;
    const timer = setTimeout(() => {
      const choices = scene.choices;
      pickRef.current(choices[Math.floor(Math.random() * choices.length)]);
    }, autoPickSeconds * 1000);
    return () => clearTimeout(timer);
  }, [autoPickSeconds, choicesReady, scene, node]);

  // An ending scene shows its closing text instead (see the droid stage).
  if (!runner.playing || !scene || !scene.choices.length) return null;

  if (leaving) {
    return (
      <div className="story-choices leaving">
        <div className="story-cards">
          {leaving.choices.map((choice) => (
            <button
              key={`${choice.to}-${choice.label}`}
              type="button"
              disabled
              className={choice === leaving.picked ? "picked" : "dropped"}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="story-choices">
      {choicesReady ? (
        <>
          {autoPickSeconds ? (
            <div className="story-countdown" key={node}>
              <span>Make your choice</span>
              <span
                className="story-countdown-bar"
                style={{ animationDuration: `${autoPickSeconds}s` }}
              />
            </div>
          ) : null}
          <div className="story-cards">
            {scene.choices.map((choice) => (
              <button
                key={`${choice.to}-${choice.label}`}
                type="button"
                onClick={() => pick(choice)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <span className="story-wait">
          {runner.cueIndex < scene.cues.length - 1
            ? `Travelling… ${runner.cueIndex + 1}/${scene.cues.length}`
            : "The world is changing…"}
        </span>
      )}
    </div>
  );
}

/** The path taken so far and the current scene's prompt. */
export function StoryPath({
  story,
  runner,
}: {
  story: Story;
  runner: StoryRunner;
}) {
  const sceneCount = Object.keys(story.nodes).length;

  return (
    <div className="story-path">
      <p className="hint">
        {story.title || "Interactive story"} · {sceneCount} scenes, two choices
        each. A scene can bridge over several cues{" "}
        {Math.round(story.cueGapSeconds)}s apart; its choices appear{" "}
        {Math.round(story.holdSeconds + story.choiceDelaySeconds)}s after its last cue.
      </p>
      {runner.scene && (
        <aside>
          <strong>
            Current scene: {runner.node} · cue{" "}
            {Math.min(runner.cueIndex + 1, runner.scene.cues.length)}/
            {runner.scene.cues.length}
          </strong>
          <code>
            {
              runner.scene.cues[
                Math.min(runner.cueIndex, runner.scene.cues.length - 1)
              ]
            }
          </code>
        </aside>
      )}
      {runner.path.length > 0 && (
        <ol className="story-steps">
          {runner.path.map((step, index) => (
            <li key={`${step.node}-${index}`}>
              <span className="beat-time">{formatTimecode(step.at)}</span>{" "}
              {step.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
