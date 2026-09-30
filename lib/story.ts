import { CHUNK_SECONDS, type CueSettings } from "@/lib/cue-sheet";

export type StoryChoice = { label: string; to: string };

/**
 * A scene is one or more cues. Several cues form a bridge (fly-through, light
 * bloom, traversal) so a change of setting morphs instead of cutting.
 */
export type StoryNode = {
  cues: string[];
  choices: StoryChoice[];
  /** The character's line, played when this scene's choices appear. */
  voice?: StoryVoice;
  /**
   * What the character says just after the viewer picks this scene. The
   * scene's choices wait that much longer, so the stream has time to change.
   */
  reaction?: StoryReaction;
  /** Makes this the last scene: shown where its choices would appear. */
  ending?: StoryEnding;
};

/** The closing text, and a video that plays after it, instead of choices. */
export type StoryEnding = { text: string; video?: string };

/** A spoken line (Seed Audio prompt text) and its rendered audio, if any. */
export type StoryVoice = { prompt: string; url?: string };

/** A rendered line and its length, spoken right after a choice. */
export type StoryReaction = { prompt: string; url: string; seconds: number };

/**
 * An interactive story played in one continuous take: after each scene lands,
 * the viewer picks one of two choices and that scene's cues are sent live.
 * Prompts follow the visko-orbis-director skill (.claude/skills).
 */
export type Story = {
  title: string;
  anchor: string;
  /** Seconds between the cues of a bridge. */
  cueGapSeconds: number;
  /** Seconds a scene's last cue holds before its choices appear. */
  holdSeconds: number;
  /** Extra seconds added on top of the hold before the choices show. */
  choiceDelaySeconds: number;
  start: string;
  nodes: Record<string, StoryNode>;
  settings: CueSettings;
};

type RawNode = {
  cues?: string[];
  prompt?: string;
  choices?: StoryChoice[];
  voice?: StoryVoice;
  reaction?: StoryReaction;
  ending?: StoryEnding;
};

type RawStory = {
  title?: string;
  anchor?: string;
  cue_gap_chunks?: number;
  hold_chunks?: number;
  choice_delay_seconds?: number;
  start?: string;
  nodes?: Record<string, RawNode>;
  seed?: number;
  resolution?: string;
  audio_enabled?: boolean;
  audio_prompt?: string;
};

/** Returns a Story when `text` is story JSON (it has `nodes`), else null. */
export function readStory(text: string): Story | null {
  if (!text.trim().startsWith("{")) return null;
  let raw: RawStory;
  try {
    raw = JSON.parse(text) as RawStory;
  } catch {
    return null;
  }
  if (!raw.nodes || typeof raw.nodes !== "object") return null;

  const nodes: Record<string, StoryNode> = {};
  for (const [id, node] of Object.entries(raw.nodes)) {
    const cues = (node.cues ?? (node.prompt ? [node.prompt] : []))
      .map((cue) => cue.trim())
      .filter(Boolean);
    if (!cues.length) throw new Error(`Scene "${id}" has no prompt`);
    nodes[id] = {
      cues,
      choices: node.choices ?? [],
      voice: node.voice,
      reaction: node.reaction,
      ending: node.ending,
    };
  }
  for (const [id, node] of Object.entries(nodes)) {
    for (const choice of node.choices) {
      if (!nodes[choice.to]) {
        throw new Error(`Scene "${id}" links to missing scene "${choice.to}"`);
      }
    }
  }
  const start =
    raw.start && nodes[raw.start] ? raw.start : Object.keys(nodes)[0];
  if (!start) throw new Error("The story has no scenes");

  // The skill's pacing: hold each look at least 4 chunks before morphing.
  const chunks = (value: number | undefined, fallback: number) =>
    Math.max(4, value ?? fallback) * CHUNK_SECONDS;

  return {
    title: raw.title ?? "",
    anchor: raw.anchor ?? "",
    cueGapSeconds: chunks(raw.cue_gap_chunks, 5),
    holdSeconds: chunks(raw.hold_chunks, 5),
    choiceDelaySeconds: Math.max(0, raw.choice_delay_seconds ?? 0),
    start,
    nodes,
    settings: {
      mode: "steer",
      seed: raw.seed,
      resolution: raw.resolution,
      audioPrompt: raw.audio_prompt,
      audioEnabled: raw.audio_enabled,
    },
  };
}
