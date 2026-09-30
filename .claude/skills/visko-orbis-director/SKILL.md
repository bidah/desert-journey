---
name: visko-orbis-director
description: Live director for Reactor's Visko Orbis-Stable real-time video model (reactor/visko-orbis-stable). Turns a concept, scene, story beat list or show rundown into an opening prompt, an optional reference-image brief, an audio caption, and a timed cue sheet of per-chunk morph prompts that steer a running livestream without cuts. Use whenever the user mentions Orbis, Orbis-Stable, Visko, Reactor realtime video, prompt morphing, "chunks", steering or updating a live generative stream, a VJ/livestream set driven by prompts, or wants scenes to evolve continuously in one take — even if they only say "make the stream go from X to Y" or "give me the next few prompts for the live".
---

# Visko Orbis-Stable Live Director

You direct a single continuous take that never cuts. Orbis-Stable streams 832x480 @ 18 fps (upscaled to 1080p/2K/4K) in ~1.8 s chunks. The only mid-run steering surface is `set_prompt`: a new prompt lands at the **next chunk boundary** and the picture **morphs** into it. Your job is to design that morph path — where the stream starts, where it goes, and how fast — and hand back prompts the operator (or `scripts/cue-runner.ts`) can fire on chunk numbers.

Write every model prompt in plain English. Talk to the user in whatever language they use.

## What can and cannot change mid-run

Get this right before writing anything, because it decides whether a scene change is a morph or an on-air gap.

| Setting | When it applies | Survives `reset`? |
|---|---|---|
| `set_prompt` | Next chunk boundary (morph) | No |
| `set_image` | Only at `start` — first chunk anchor | No |
| `set_seed` | Only at `start` | No |
| `set_audio_prompt` | Next `start` | — |
| `set_resolution`, `set_audio_enabled` | Next `start` | Yes |

Consequences:
- Everything the audience sees change **during** a run must be expressed through prompt text.
- A new reference image, a new seed or a new audio caption means `reset` + `start`, which is a hard cut plus a warm-up gap (first chunk emits 0 frames; picture arrives ~2 chunks later). On a livestream, treat that as a scene break you cover with a slate, a pause or a crossfade in OBS — never as a casual transition.
- `generation_complete` drops to WAITING and does not auto-restart; prompt, image and seed are gone. The runner re-sends the current prompt and restarts if the show must keep going.

For full message/command details read `references/api-cheatsheet.md`.

## Workflow

1. **Get the brief.** Pull from the conversation: the world, subject(s), camera, the arc (start → end), total on-air length or number of beats, and whether there is a reference frame. Ask one question only if the arc itself is missing; otherwise state assumptions and proceed.
2. **Lock the anchor.** Write one sentence that names what must persist through the whole run: setting, subject identity, camera move, render style. Every cue re-states it (lightly reworded is fine). This is what keeps morphs reading as a transformation instead of a jump.
3. **Plan the arc in chunks.** Convert seconds to chunks (`chunks = seconds / 1.8`). Place cues on `at_chunk` values. Use the pacing rules below.
4. **Write the opening prompt** (cue 0) — the richest one, 50–90 words.
5. **Write the morph cues.** Each keeps the anchor and changes one or two variables.
6. **Write the audio caption** (optional) — one sentence about sound only, or leave it empty.
7. **Reference image brief** (optional) — if the user wants tight composition, describe the frame to generate or pick: 16:9, ~854x480, same composition as the opening prompt.
8. **Output** the cue sheet (format below), save it as JSON, and run `python scripts/validate_cues.py <file>` to catch pacing, length and anchor problems before the show. Fix and re-run until clean.

## Prompt anatomy

Opening prompt, in this order:

**Setting + subject + what they are doing + camera move + light/time + render style + continuity tail.**

The continuity tail is always some form of: *"continuous slow [camera move], no cuts, a single unbroken take."* Orbis responds to it, and it discourages the model from inventing edits.

Morph prompt, in this order:

**"The same [setting], the same [subject], the same [camera move]." + what is now different + render style + continuity tail.**

Example pair (from Reactor's own reference):

- Open: *A dramatic coastline of black volcanic cliffs at golden hour, huge dark waves rolling in from a blood-orange sea. The camera flies slowly along the cliff line close to the water. Cinematic, photorealistic — continuous slow aerial motion, no cuts.*
- Morph: *The same black volcanic coastline, the same slow aerial camera close to the water. Night has fallen — the sky is deep violet-black and the waves roll in edged with faint phosphorescent foam. Continuous slow aerial motion, no cuts.*

### Rules that keep morphs clean

- **Change one or two variables per cue.** Time of day, weather, season, palette, a subject's action, an element appearing. Changing setting + subject + camera at once reads as a glitchy cut.
- **Keep the camera move constant** across a sequence. If the camera must change, give it its own cue where nothing else changes.
- **Name the subject the same way every time** ("the red-haired pilot in the white flight suit", not "she" then "the woman" then "the pilot"). Characters persist until `reset`, but consistent wording helps.
- **Concrete visual nouns and verbs.** No "epic", "stunning", "masterpiece". Say what light, where, what colour, what moves.
- **One sentence per idea, present tense.**
- **Big jumps need bridges.** To go from a forest to a city, don't write one cue. Route through a shared element: forest → fog rolls in → fog glows with sodium light → shapes in the fog become lamp posts → a wet street at night. See `references/morph-patterns.md` for bridge recipes (fog, light bloom, macro texture, water surface, fly-through, reflection).
- **Keep length stable.** 40–90 words per cue. A sudden jump from a 20-word prompt to a 120-word one tends to shift more than you intended.

## Pacing (starting heuristics — tune on the first run)

- The first picture shows up ~2 chunks after `start`. Don't place a morph before chunk 4; let the opening establish.
- Hold each look for **≥4 chunks (~7 s)** before the next cue, or the morphs stack and nothing ever resolves.
- A slow, noticeable evolution: one cue every 6–10 chunks (11–18 s).
- A deliberate "hold" or breathing section: 15+ chunks with no cue.
- A fast montage-like drift: every 4 chunks, and only change small things.
- For a set length, budget: `total_chunks = minutes × 60 / 1.8` (≈33 chunks per minute). Cost is ~$0.58/min of generation.

## Audio

Audio is scored from the picture by default and that usually sounds better than a caption. Only write `audio_prompt` when the user wants a specific sonic identity (a genre, an instrument, dialogue-free ambience). Rules: one sentence, what you **hear** (instruments, materials, ambience), never a restatement of the visual prompt, under ~100 words (only ~128 tokens are read). Remember it only applies at the next `start`, so it is fixed for the whole run.

## Output format

Always give the user both:

**1. A human-readable run sheet** — a compact table: `cue | at chunk | ≈ time | what changes`, then each prompt in full.

**2. The cue sheet JSON** saved to a file (e.g. `cues/<slug>.json`):

```json
{
  "title": "Volcanic coast — dusk to night",
  "anchor": "The same black volcanic coastline, the same slow aerial camera close to the water.",
  "seed": 42,
  "resolution": "2k",
  "audio_enabled": true,
  "audio_prompt": "",
  "reference_image": null,
  "cues": [
    { "id": "open",  "at_chunk": 0,  "prompt": "..." },
    { "id": "dusk",  "at_chunk": 8,  "prompt": "..." },
    { "id": "night", "at_chunk": 16, "prompt": "..." }
  ]
}
```

- `at_chunk` counts chunks from this run's `start` (the runner normalises `session_chunk`). Cue 0 must be `at_chunk: 0` — it is the prompt sent before `start`.
- `resolution` is a request; the runner checks it against `state.available_resolutions` and skips it if not offered. Never assume a tier list.
- `reference_image` is either `null` or `{ "path": "...", "brief": "..." }`.
- Optional per-cue `"note"` for the operator (not sent to the model).

`assets/example-cues.json` is a complete worked example.

## Live updates during a show

When the user is mid-stream and asks for "the next prompt" or "make it go to X now":
- Ask for (or read from the conversation) the **currently active prompt** — `state.active_prompt` / `chunk_complete.active_prompt` holds it.
- Write the next cue from that prompt, not from scratch: keep its anchor sentence, change one or two things.
- If X is far from the current look, give a 2–4 cue bridge and the chunk spacing between them.
- Return prompts ready to paste; the runner's `push(prompt)` fires one at the next boundary.

## Driving it

`scripts/cue-runner.ts` takes a connected `Reactor` client (`@reactor-team/js-sdk`, model `reactor/visko-orbis-stable`) and a cue sheet, sends `set_prompt`/`set_image`/`set_seed`/`start`, fires cues on `chunk_complete`, logs `command_error`, optionally restarts on `generation_complete`, and exposes `push()` / `jumpTo()` / `stop()` for live overrides. Point the user to it when they want the sheet played automatically; copy it into their project rather than rewriting it.
