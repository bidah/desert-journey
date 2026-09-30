# seedaudio

Voice lines for the Desert Journey story, rendered with ByteDance Seed Audio 1.0
through the Higgsfield MCP (see `.claude/skills/story-voices/SKILL.md`). Each
story scene has one line the android boy says when its choices appear, hinting
at the two options.

| Path | What |
|---|---|
| `lines.json` | The spoken line per story node (source of truth). |
| `build-prompts.py` | Builds `prompts.json`: one Seed Audio prompt per node, voiced by `@Audio1`; fails over 2048 chars. |
| `voice-ref/droid-voice.mp3` | Voice reference: the character's speech from the intro video (15.0–39.9 s), vocals isolated, normalized mono. |
| `voice-ref/intro-full.mp3` | The intro's full audio (he speaks from 15.3 s to 39.5 s). |
| `jobs.json` | Higgsfield media id of the reference, each render's job id / url / seconds, and `pending` nodes. |
| `scripts/finalize.py` | Download → verify → tighten pauses → normalize → record → rebuild, for one or more renders. |
| `renders/` | Raw downloads from Higgsfield. |

Rendered lines are normalized into `public/examples/desert-journey-voice/<node>.mp3`;
`scripts/build-desert-still.py` adds `voice: { prompt, url }` to each story
node (url only once its file exists). The droid pages play a scene's line when
its choices appear and lower the song while it plays.

Rendering one line (TA2A with the reference) costs 4.2 Higgsfield credits.

The full flow is the project skill `.claude/skills/story-voices/SKILL.md`.

## Render a line

1. `python3 seedaudio/build-prompts.py`
2. `generate_audio` / `generate_audio_batch` with `model: "seed_audio"`, the
   node's prompt from `prompts.json`, `format: "mp3"`, `sample_rate: 44100` and
   `medias: [{ value: <reference media id>, role: "audio_references" }]`.
3. Download the result into `renders/<node>.mp3`, check it with `file`, then
   tighten pauses to 0.5 s (renders leave 2–4 s between sentences), trim the
   ends and normalize:
   `ffmpeg -i renders/<node>.mp3 -af "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.5:stop_threshold=-45dB:stop_silence=0.5,loudnorm=I=-16:TP=-1.5:LRA=11" -ac 1 -ar 44100 -b:a 160k public/examples/desert-journey-voice/<node>.mp3`
4. Record the job in `jobs.json` and run `python3 scripts/build-desert-still.py`.
