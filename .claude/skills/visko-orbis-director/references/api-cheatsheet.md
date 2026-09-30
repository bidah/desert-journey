# Orbis-Stable API cheatsheet

Source: https://www.reactor.inc/models/visko-orbis-stable/api (and /info). Full docs: https://docs.reactor.inc/model-api-reference/visko-orbis-stable/overview

## Model
- Wire name: `reactor/visko-orbis-stable`
- JS: `@reactor-team/js-sdk` (2.x or 3.x). Typed `@reactor-models/visko-orbis-stable` may exist once published (`npx create-reactor-app my-app --model=visko-orbis-stable`).
- Generation 832x480 @ 18 fps, ~1.8 s chunks (~33 frames). Delivery 1080p (1920x1080), 2k (2560x1440, default), 4k (3840x2160).
- Tracks: `main_video` (out), `main_audio` (out, 48 kHz mono).
- Cost: $0.582/min.

## Auth
Server exchanges `REACTOR_API_KEY` for a JWT (≤6 h, scoped per model):

```
POST https://api.reactor.inc/tokens
Reactor-API-Key: <key>
{ "authorization_details": [{ "type": "session",
  "resources": { "models": { "match": ["reactor/visko-orbis-stable"] } },
  "constraints": { "max_sessions": 10 } }] }
→ { "jwt": "..." }
```

Client: `new Reactor({ modelName: "reactor/visko-orbis-stable" }); await reactor.connect(jwt);`

## Commands (client → model)
| Command | Params | Notes |
|---|---|---|
| `set_prompt` | `prompt: string` | Any time. Mid-run → morph at next chunk boundary. Required before `start`. |
| `set_image` | `image: FileRef` (from `reactor.uploadFile(blob)`) | Read at `start` only. 16:9 ~854x480; non-16:9 is squashed, not cropped. |
| `set_seed` | `seed: int ≥0` (default 42) | Read at `start`. Same seed + same prompts reproduces the video. |
| `set_audio_prompt` | `prompt: string` | Sound caption, ~1 sentence, first ~128 tokens used. `""` = picture-driven. Next `start`. |
| `set_audio_enabled` | `audio_enabled: bool` | Next `start`; survives `reset`. |
| `set_resolution` | `resolution: string` | Must be in `state.available_resolutions`. Next `start`; survives `reset`. |
| `start` | — | Needs a prompt, else `command_error`. No effect if already generating. |
| `pause` / `resume` | — | Between chunks; resume continues the same shot. |
| `reset` | — | Aborts; clears prompt, image, seed. |

## Messages (model → client)
- `state` — every chunk; authoritative (`available_resolutions`, `session_chunk`, `active_prompt`).
- `chunk_complete` — per chunk; has `session_chunk`, `active_prompt`, `frames_emitted` (0 on first chunk — normal).
- `command_error` — `command`, `reason`. Failures arrive here, not as exceptions.
- `prompt_accepted`, `image_accepted`, `conditions_ready` (wait for this before `start` rather than assuming ack order), `generation_started`, `generation_paused`, `generation_resumed`, `generation_reset`, `generation_complete` (→ WAITING, no auto-restart; prompt/image/seed not kept), `resolution_accepted`, `audio_prompt_accepted`, `audio_enabled_accepted`.

On js-sdk 3.x, per-command acks resolve as the awaited command's return value instead of broadcasting; `chunk_complete`/`state` still arrive as messages.

## Timing facts that matter for a show
- Session startup can take minutes (upscaler compiles per pod) — connect and warm up well before going live.
- After `start`: first chunk 0 frames, first picture ~2 chunks (~3.7 s).
- `session_chunk` is a session counter; the runner measures cues relative to the first chunk seen after `generation_started`. Log the first few values on a test run to confirm.
