export type CueBeat = {
  /** Seconds from the first frame at which this beat should be on screen. */
  start: number;
  /** Seconds at which the next beat (or the end of the sheet) takes over. */
  end: number;
  shot: string;
  scene: string;
  style: string;
  /** Matched against uploaded files to use as this shot's keyframe. */
  pinnedFrame?: string;
  id?: string;
  /** A complete Orbis prompt, sent verbatim instead of composing one. */
  prompt?: string;
};

/** Run settings a cue sheet can carry (the Orbis director JSON format). */
export type CueSettings = {
  mode?: "cut" | "steer";
  seed?: number;
  resolution?: string;
  audioPrompt?: string;
  audioEnabled?: boolean;
};

export type CueSheet = {
  title: string;
  openingPrompt: string;
  firstFrame?: string;
  beats: CueBeat[];
  /** Seconds at which the sheet ends and the run is paused. */
  end: number;
  settings?: CueSettings;
};

/** Orbis generates one chunk (~33 frames at 18 fps) about every 1.8 seconds. */
export const CHUNK_SECONDS = 1.8;

/** The first picture arrives about 2 chunks after `start` (chunk 0 emits none). */
export const FIRST_PICTURE_CHUNKS = 2;

type DirectorCue = { id?: string; at_chunk?: number; prompt?: string };
type DirectorSheet = {
  title?: string;
  anchor?: string;
  seed?: number;
  resolution?: string;
  audio_enabled?: boolean;
  audio_prompt?: string;
  cues: DirectorCue[];
};

/**
 * The Orbis director format: one continuous take whose cues are timed in
 * chunks and already restate the world, so each prompt is sent as written.
 */
function readDirectorSheet(raw: DirectorSheet): CueSheet {
  const cues = raw.cues
    .filter((cue) => cue.prompt?.trim())
    .sort((a, b) => (a.at_chunk ?? 0) - (b.at_chunk ?? 0));
  // `at_chunk` counts from `start`; this app's clock starts at the first
  // picture, about FIRST_PICTURE_CHUNKS later.
  const starts = cues.map(
    (cue) => Math.max(0, (cue.at_chunk ?? 0) - FIRST_PICTURE_CHUNKS) * CHUNK_SECONDS,
  );
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  const typicalGap = gaps.length ? gaps.sort((a, b) => a - b)[gaps.length >> 1] : 20;
  const beats = cues.map((cue, index) => ({
    id: cue.id,
    start: starts[index],
    end: starts[index + 1] ?? starts[index] + typicalGap,
    shot: "",
    scene: cue.prompt!.trim(),
    style: "",
    prompt: cue.prompt!.trim(),
  }));
  return {
    title: raw.title ?? "",
    openingPrompt: raw.anchor ?? "",
    beats,
    end: beats.at(-1)?.end ?? 0,
    settings: {
      mode: "steer",
      seed: raw.seed,
      resolution: raw.resolution,
      audioPrompt: raw.audio_prompt,
      audioEnabled: raw.audio_enabled,
    },
  };
}

type Field = "shot" | "scene" | "style" | "range" | "pinnedFrame";

// A beat header starts at column 0: "1:04 (64s)", "1:04", or "1:04 Scene text".
const HEADER = /^(\d+):(\d{2}(?:\.\d+)?)(?:\s*\((\d+(?:\.\d+)?)s\))?\s*(.*)$/;
const FIELD = /^\s*(SHOT|SCENE|STYLE|RANGE|PROMPT|Pinned frame):\s*(.*)$/i;
const RANGE = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s?$/;

type DraftBeat = {
  start: number;
  rangeEnd?: number;
  fields: Partial<Record<Field, string>>;
};

function fieldKey(label: string): Field {
  const key = label.toLowerCase();
  if (key === "pinned frame") return "pinnedFrame";
  if (key === "prompt") return "scene";
  return key as Field;
}

export function parseCueSheet(text: string): CueSheet {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  let firstFrame: string | undefined;
  const opening: string[] = [];
  let inOpening = false;
  const drafts: DraftBeat[] = [];
  let current: DraftBeat | null = null;
  let currentField: Field | null = null;

  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) {
      const [, minutes, seconds, explicit, rest] = header;
      const start = explicit
        ? Number(explicit)
        : Number(minutes) * 60 + Number(seconds);
      current = { start, fields: {} };
      currentField = null;
      inOpening = false;
      if (rest.trim()) {
        current.fields.scene = rest.trim();
        currentField = "scene";
      }
      drafts.push(current);
      continue;
    }

    if (!current) {
      const opener = /^Opening prompt:\s*(.*)$/i.exec(line);
      const frame = /^First frame:\s*(.*)$/i.exec(line);
      if (opener) {
        inOpening = true;
        opening.push(opener[1]);
      } else if (frame) {
        inOpening = false;
        firstFrame = frame[1].trim();
      } else if (inOpening) {
        opening.push(line);
      } else if (!title && line.trim()) {
        title = line.trim();
      }
      continue;
    }

    const field = FIELD.exec(line);
    if (field) {
      currentField = fieldKey(field[1]);
      current.fields[currentField] = field[2].trim();
      if (currentField === "range") {
        const range = RANGE.exec(field[2].trim());
        if (range) current.rangeEnd = Number(range[2]);
      }
    } else if (currentField && line.trim() && !/^\s*\(no prompt\)\s*$/i.test(line)) {
      current.fields[currentField] += ` ${line.trim()}`;
    }
  }

  drafts.sort((a, b) => a.start - b.start);
  const beats: CueBeat[] = [];
  drafts.forEach((draft, index) => {
    const { shot = "", scene = "", style = "", pinnedFrame } = draft.fields;
    // A header with nothing to say (e.g. "3:00 (no prompt)") marks the end.
    if (!shot && !scene && !style) return;
    const next = drafts[index + 1];
    beats.push({
      start: draft.start,
      end: draft.rangeEnd ?? next?.start ?? draft.start + 5,
      shot,
      scene,
      style,
      pinnedFrame,
    });
  });

  const lastHeader = drafts.at(-1)?.start ?? 0;
  const lastBeatEnd = beats.at(-1)?.end ?? 0;

  return {
    title,
    openingPrompt: opening.join("\n").trim(),
    firstFrame,
    beats,
    end: Math.max(lastHeader, lastBeatEnd),
  };
}

/** Accepts either the plain-text cue sheet format or a CueSheet as JSON. */
export function readCueSheet(text: string): CueSheet {
  if (!text.trim().startsWith("{")) return parseCueSheet(text);

  const parsed = JSON.parse(text) as Partial<CueSheet> | DirectorSheet;
  if (Array.isArray((parsed as DirectorSheet).cues)) {
    return readDirectorSheet(parsed as DirectorSheet);
  }
  const raw = parsed as Partial<CueSheet>;
  const beats = (raw.beats ?? [])
    .map((beat) => ({
      start: Number(beat.start),
      end: Number(beat.end),
      shot: beat.shot ?? "",
      scene: beat.scene ?? "",
      style: beat.style ?? "",
      pinnedFrame: beat.pinnedFrame,
      id: beat.id,
      prompt: beat.prompt,
    }))
    .sort((a, b) => a.start - b.start);
  beats.forEach((beat, index) => {
    if (!Number.isFinite(beat.end)) {
      beat.end = beats[index + 1]?.start ?? beat.start + 5;
    }
  });
  return {
    title: raw.title ?? "",
    openingPrompt: raw.openingPrompt ?? "",
    firstFrame: raw.firstFrame,
    beats,
    end: Number.isFinite(raw.end) ? Number(raw.end) : (beats.at(-1)?.end ?? 0),
    settings: raw.settings,
  };
}

/**
 * How mid-run beats are written. The opening beat always carries the base
 * prompt; Orbis keeps characters and setting across prompts until reset.
 * - "shot": only the shot, scene first, so consecutive prompts differ sharply.
 * - "shot-then-base": the shot first, then the base prompt.
 * - "base-then-shot": the base prompt, then the shot (most continuity).
 */
export type PromptMode = "shot" | "shot-then-base" | "base-then-shot";

export const PROMPT_MODES: { value: PromptMode; label: string }[] = [
  { value: "shot", label: "Shot only (base prompt sent once, at start)" },
  { value: "shot-then-base", label: "Shot first, then base prompt" },
  { value: "base-then-shot", label: "Base prompt, then shot" },
];

function shotText(beat: CueBeat) {
  return [
    beat.scene,
    beat.shot && `SHOT: ${beat.shot}`,
    beat.style && `STYLE: ${beat.style}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeOpeningPrompt(basePrompt: string, beat?: CueBeat) {
  if (beat?.prompt) return beat.prompt;
  return [basePrompt.trim(), beat && `CURRENT SHOT\n${shotText(beat)}`]
    .filter(Boolean)
    .join("\n\n");
}

export function composeBeatPrompt(
  basePrompt: string,
  beat: CueBeat,
  mode: PromptMode,
) {
  if (beat.prompt) return beat.prompt;
  const shot = `NEW SHOT\n${shotText(beat)}`;
  const base = basePrompt.trim();
  if (mode === "shot" || !base) return shot;
  return mode === "shot-then-base"
    ? `${shot}\n\n${base}`
    : `${base}\n\n${shot}`;
}

export function formatTimecode(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
