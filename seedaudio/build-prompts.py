#!/usr/bin/env python3
"""Builds seedaudio/prompts.json: one Seed Audio prompt per story node, from
seedaudio/lines.json, voiced by the droid reference (@Audio1). Fails if any
prompt exceeds Seed Audio's 2048-character cap (seed-audio skill)."""
import json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
lines = json.loads((HERE / "lines.json").read_text())

TEMPLATE = """Create a short, intimate spoken line of about {seconds} seconds.

[AESTHETIC]
- Voice (the android boy, voiced by @Audio1): match the reference voice exactly — its young timbre, accent and soft, thoughtful, slightly wondering delivery. Close, warm, dry microphone.
- Clean voice only: no music, no sound effects, no background ambience, over silence.

[EXECUTION]
[DIAL] The android boy (voiced by @Audio1, curious, gentle, unhurried, speaking to a friend beside him) says: "{line}"
[TRANS] Half a second of silence."""

prompts = {}
for node, line in lines.items():
    seconds = max(5, round(len(line.split()) / 2.6))
    prompt = TEMPLATE.format(line=line, seconds=seconds)
    if len(prompt) > 2048:
        raise SystemExit(f"{node}: prompt is {len(prompt)} chars (max 2048)")
    prompts[node] = prompt
(HERE / "prompts.json").write_text(json.dumps(prompts, indent=2, ensure_ascii=False) + "\n")
print(f"{len(prompts)} prompts, longest {max(map(len, prompts.values()))} chars")
