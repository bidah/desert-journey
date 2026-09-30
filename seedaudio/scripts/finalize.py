#!/usr/bin/env python3
"""Finishes Seed Audio renders for story nodes: download, verify, tighten the
pauses, normalize, record the job and rebuild the stories.

Usage (from the repo root), one or more node/job/url triples:
  python3 seedaudio/scripts/finalize.py <node> <job_id> <result_url> [<node> <job_id> <result_url> ...]
"""
import json, pathlib, subprocess, sys

REPO = pathlib.Path(__file__).resolve().parents[2]
RENDERS = REPO / "seedaudio/renders"
PUBLIC = REPO / "public/examples/desert-journey-voice"
MANIFEST = REPO / "seedaudio/jobs.json"
# Renders leave 2–4 s between sentences; keep 0.5 s, trim the ends, and match
# the voice reference's loudness.
FILTER = ("silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:"
          "stop_duration=0.5:stop_threshold=-45dB:stop_silence=0.5,"
          "loudnorm=I=-16:TP=-1.5:LRA=11")

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

def duration(path):
    return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "default=nw=1:nk=1", str(path)))

args = sys.argv[1:]
if not args or len(args) % 3:
    sys.exit(__doc__)
RENDERS.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
manifest = json.loads(MANIFEST.read_text())
for node, job_id, url in zip(args[0::3], args[1::3], args[2::3]):
    raw = RENDERS / f"{node}.mp3"
    run("curl", "-sS", "-o", str(raw), url)
    kind = run("file", "-b", str(raw))
    if "MPEG" not in kind and "WAVE" not in kind:
        sys.exit(f"{node}: not audio ({kind.strip()})")
    out = PUBLIC / f"{node}.mp3"
    run("ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", FILTER, "-ac", "1",
        "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "160k", str(out))
    manifest["renders"][node] = {"job_id": job_id, "result_url": url,
                                 "seconds": round(duration(out), 1)}
    manifest.get("pending", {}).pop(node, None)
    print(f"{node}: raw {duration(raw):.1f}s → {duration(out):.1f}s")
MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
for script in ("build-desert-still.py",):
    print(run("python3", str(REPO / "scripts" / script)).strip().splitlines()[-1])
