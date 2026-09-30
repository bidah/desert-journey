/**
 * Plays an Orbis-Stable cue sheet on a connected Reactor client and exposes
 * live overrides for the operator.
 *
 *   import { Reactor } from "@reactor-team/js-sdk";
 *   const reactor = new Reactor({ modelName: "reactor/visko-orbis-stable" });
 *   await reactor.connect(jwt);
 *   const show = await runCueSheet(reactor, sheet, { imageFile, autoRestart: true });
 *   show.push("The same ..., now snowing. Continuous ..., no cuts.");
 *   show.jumpTo("night-glow");
 *
 * Works with @reactor-team/js-sdk 2.x/3.x via sendCommand + on("message").
 */

export type Cue = { id: string; at_chunk: number; prompt: string; note?: string };
export type CueSheet = {
  title?: string;
  anchor?: string;
  seed?: number;
  resolution?: string;
  audio_enabled?: boolean;
  audio_prompt?: string;
  reference_image?: { path: string; brief?: string } | null;
  cues: Cue[];
};

type ReactorLike = {
  sendCommand: (cmd: string, payload: Record<string, unknown>) => Promise<unknown>;
  on: (ev: "message", cb: (msg: any) => void) => void;
  off?: (ev: "message", cb: (msg: any) => void) => void;
  uploadFile?: (file: Blob) => Promise<unknown>;
};

export type RunnerOptions = {
  /** Blob/File for set_image. Only read at start. */
  imageFile?: Blob;
  /** On generation_complete, re-send the current prompt and start again. */
  autoRestart?: boolean;
  /** Called on every cue sent (scheduled or manual). */
  onCue?: (info: { id: string; chunk: number; prompt: string }) => void;
  log?: (...a: unknown[]) => void;
};

export async function runCueSheet(reactor: ReactorLike, sheet: CueSheet, opts: RunnerOptions = {}) {
  const log = opts.log ?? ((...a: unknown[]) => console.log("[orbis]", ...a));
  const cues = [...sheet.cues].sort((a, b) => a.at_chunk - b.at_chunk);
  if (!cues.length || cues[0].at_chunk !== 0) throw new Error("first cue must have at_chunk 0");

  let base: number | null = null; // session_chunk of first chunk in this run
  let relChunk = 0;
  let next = 1;
  let currentPrompt = cues[0].prompt;
  let stopped = false;
  let resolutionChecked = false;

  const send = async (id: string, prompt: string) => {
    currentPrompt = prompt;
    await reactor.sendCommand("set_prompt", { prompt });
    opts.onCue?.({ id, chunk: relChunk, prompt });
    log(`cue ${id} → lands at chunk ~${relChunk + 1}`);
  };

  const onMessage = async (msg: any) => {
    if (stopped || !msg?.type) return;
    switch (msg.type) {
      case "state": {
        if (!resolutionChecked && sheet.resolution && Array.isArray(msg.available_resolutions)) {
          resolutionChecked = true;
          if (!msg.available_resolutions.includes(sheet.resolution))
            log(`resolution ${sheet.resolution} not offered (${msg.available_resolutions.join(", ")})`);
        }
        break;
      }
      case "generation_started":
        base = null;
        break;
      case "chunk_complete": {
        const sc = Number(msg.session_chunk);
        if (base === null) base = sc;
        relChunk = sc - base;
        // A prompt sent now lands at the next boundary, i.e. chunk relChunk + 1.
        // If we fell behind, only the latest due cue is sent.
        let due: Cue | null = null;
        while (next < cues.length && cues[next].at_chunk <= relChunk + 1) due = cues[next++];
        if (due) await send(due.id, due.prompt);
        break;
      }
      case "command_error":
        log(`command_error on ${msg.command}: ${msg.reason}`);
        break;
      case "generation_complete":
        log("generation_complete");
        if (opts.autoRestart && !stopped) {
          // prompt/image/seed are not kept after completion; re-arm with the current look.
          await reactor.sendCommand("set_prompt", { prompt: currentPrompt });
          if (sheet.seed !== undefined) await reactor.sendCommand("set_seed", { seed: sheet.seed });
          await reactor.sendCommand("start", {});
        }
        break;
    }
  };
  reactor.on("message", onMessage);

  // Settings read at next start.
  if (sheet.resolution) await reactor.sendCommand("set_resolution", { resolution: sheet.resolution });
  if (sheet.audio_enabled !== undefined) await reactor.sendCommand("set_audio_enabled", { audio_enabled: sheet.audio_enabled });
  await reactor.sendCommand("set_audio_prompt", { prompt: sheet.audio_prompt ?? "" });
  if (sheet.seed !== undefined) await reactor.sendCommand("set_seed", { seed: sheet.seed });
  if (opts.imageFile) {
    if (!reactor.uploadFile) throw new Error("client has no uploadFile");
    const ref = await reactor.uploadFile(opts.imageFile);
    await reactor.sendCommand("set_image", { image: ref });
  }
  await reactor.sendCommand("set_prompt", { prompt: cues[0].prompt });
  await reactor.sendCommand("start", {});
  log(`started "${sheet.title ?? "untitled"}" with ${cues.length} cues`);

  return {
    /** Fire an ad-hoc prompt at the next chunk boundary. Scheduled cues continue after it. */
    push: (prompt: string) => send("manual", prompt),
    /** Jump the schedule to a cue id: send it now and continue from the one after. */
    jumpTo: async (id: string) => {
      const i = cues.findIndex((c) => c.id === id);
      if (i < 0) throw new Error(`no cue ${id}`);
      // Shift remaining cue times so spacing after the jump is preserved.
      const offset = relChunk + 1 - cues[i].at_chunk;
      for (let k = i; k < cues.length; k++) cues[k] = { ...cues[k], at_chunk: cues[k].at_chunk + offset };
      next = i + 1;
      await send(cues[i].id, cues[i].prompt);
    },
    /** Hold the current look: stop firing scheduled cues (manual push still works). */
    hold: () => { next = cues.length; },
    pause: () => reactor.sendCommand("pause", {}),
    resume: () => reactor.sendCommand("resume", {}),
    stop: () => { stopped = true; reactor.off?.("message", onMessage); },
    get chunk() { return relChunk; },
    get currentPrompt() { return currentPrompt; },
  };
}
