---
name: story-voices
description: >-
  Create the android boy's spoken voice lines for the Desert Journey story in
  this app (one line per story node, played when that scene's two choices
  appear) with Seed Audio 1.0 on the Higgsfield MCP, cloned from the character's
  own voice in the intro video. Use when adding or re-rendering story voice
  lines, adding a new scene that needs a line, changing a line's text, making a
  new voice reference from a video, or when the user mentions seedaudio, story
  voices, the character talking over the choices, or voice lines for nodes.
---

# Story voice lines (Seed Audio via Higgsfield)

Each story node in `public/examples/desert-journey*/story.json` can carry
`voice: { prompt, url }`. On the droid pages (`/`, `/orbis`) the scene's line is
preloaded when the scene starts and plays when its choices fade in; the song
ducks to 30% while he speaks (`components/droid-experience.tsx`). A node without
a rendered file plays silently.

Everything lives in `seedaudio/` (see `seedaudio/README.md`). Use the
`seed-audio` skill, if installed, for Seed Audio's rules; this skill is the
app-specific recipe on top of it.

## Files

| Path | Role |
|---|---|
| `seedaudio/lines.json` | Source of truth: node id → the spoken line. |
| `seedaudio/build-prompts.py` | lines → `seedaudio/prompts.json` (Seed Audio prompts, voiced by `@Audio1`, ≤ 2048 chars). |
| `seedaudio/voice-ref/droid-voice.mp3` | The voice reference (clean, normalized, 25 s). |
| `seedaudio/jobs.json` | Higgsfield media id of the reference; each render's job id / url / seconds; `pending` nodes. |
| `seedaudio/scripts/finalize.py` | Download → verify → tighten pauses → normalize → record → rebuild stories. |
| `public/examples/desert-journey-voice/<node>.mp3` | What the app plays. |
| `scripts/build-desert-still.py` | Adds `voice` to every node; `url` only when the mp3 exists. |

## Writing a line

- The boy thinks out loud about the scene's **two choices** and asks the viewer
  ("Should we…? Or…? What do you think?"). Tone of the intro: soft, curious,
  reflective, speaking to a friend beside him.
- About 20 words (≈ 7–10 s after pause tightening), so it ends well inside the
  15 s choice countdown. English only.
- Keep `lines.json` keys identical to the story's node ids (the build checks
  nothing is missing: compare `lines.json` keys with `story.json` nodes).
  Exception: `scripts/build-desert-still.py` (the story the droid pages play)
  maps several nodes to one line id (`focus`, `focus-again`, `stillness`, and
  every `-fox` node to its base node), so those lines render once.
- `stillness` is the closing text of the still story, not a choice line: it is
  long on purpose (~65 words, ~30 s) and also shows on screen as text.

## Rendering

1. **Prompts:** `python3 seedaudio/build-prompts.py`.
2. **Reference media id:** reuse `jobs.json → reference.higgsfield_media_id`.
   Higgsfield uploads can expire; if a job rejects the id, re-upload:
   `media_upload {filename:"droid-voice.mp3", content_type:"audio/mpeg"}` →
   `curl -X PUT -H "Content-Type: audio/mpeg" --data-binary @seedaudio/voice-ref/droid-voice.mp3 '<upload_url>'`
   → `media_confirm {type:"audio", media_id}` → save the new id in `jobs.json`.
3. **Cost first:** `balance`, then one `generate_audio` with `get_cost: true`.
   A voice-cloned line costs **4.2 credits** (2026-09). Tell the user the total
   (lines × 4.2) against the balance before rendering many; render the scenes
   heard first (the start, then one or two taps in) when credits are short.
4. **Submit** with `generate_audio_batch` (≤ 12 per call), each item:
   ```jsonc
   { "model": "seed_audio", "prompt": "<prompts.json[node]>",
     "medias": [{ "value": "<reference media id>", "role": "audio_references" }],
     "format": "mp3", "sample_rate": 44100, "use_unlim": false }
   ```
   Batches can come back with `submission_failed … 429 rate_limit_reached` for
   some items; those are not charged. Record them under `jobs.json → pending`
   and resubmit later. Never resubmit an item whose outcome is unknown.
5. **Wait** with `jobs_wait` (≤ 12 jobs, 15 s per call; voice-cloned jobs take
   ~30–60 s). Collect each `result_url`.
6. **Finish:** `python3 seedaudio/scripts/finalize.py <node> <job_id> <url> [...]`.
   Renders leave 2–4 s pauses between sentences (a 20-word line came back
   15 s); the script keeps 0.5 s pauses, trims the ends, normalizes to
   −16 LUFS mono, updates `jobs.json` and rebuilds the stories.
7. **Verify** a render says the right words when in doubt: listen to
   `public/examples/desert-journey-voice/<node>.mp3`.

## Making a new voice reference

Seed Audio references: one speaker, ≤ 30 s, no music, steady level.

1. Audio of the source video: `ffmpeg -i <video> -vn -ac 1 -c:a libmp3lame -b:a 192k seedaudio/voice-ref/<name>-full.mp3`.
2. Find the speech by listening (`ffmpeg -i <file> -af silencedetect=n=-35dB:d=0.5 -f null -`
   lists the quiet gaps). The droid intro speaks from 15.3 s to 39.5 s.
3. Cut ≤ 30 s of it to WAV (`ffmpeg -ss <start> -to <end> -i <video> -vn -c:a pcm_s16le cut.wav`),
   then strip the music with a vocal-separation tool into `vocals.wav`.
   Check a pause between lines got quieter while speech did not
   (`ffmpeg -ss <a> -to <b> -i <file> -af volumedetect -f null -`); the droid
   reference went from −37 dB to −49 dB in the pauses.
4. `ffmpeg -i vocals.wav -af "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11" -ac 1 -b:a 192k seedaudio/voice-ref/<name>-voice.mp3`,
   upload it (step 2 above) and record its media id.
