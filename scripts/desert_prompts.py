"""Prompt pieces and voice lookup for the Desert Journey story builder
(build-desert-still.py).

Only an opening prompt describes the whole world (WHO + WHAT + WHERE + camera +
style). Every later cue is short: the boy keeps walking while one thing changes
around him, then the same camera sentence. Each cue replaces the active prompt,
so a cue without the camera sentence would drop the follow shot.
"""
import json, pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
EXAMPLES = REPO / "public/examples"

# The Pixar version's camera follows its video style: a slow dolly with parallax.
PIXAR_CAMERA = ("The camera dollies slowly forward behind him with subtle parallax, "
                "keeping his whole body in the frame.")

# Pixar only: the model sometimes flipped him to walk toward the camera while
# still seen from the rear. State the facing positively in every cue (a
# negation like "never show his face" can draw the face). He also stopped
# walking at times, so say he never stops or turns back toward the camera.
# The meditation cue (SIT in build-desert-still.py) is the one place he stops
# and it leaves this sentence out.
PIXAR_FACING = ("He always faces away from the camera and always walks forward, "
                "away from the camera, with the camera following behind him; he "
                "never stops and never walks toward the camera, seen only "
                "from behind. His head stays pointed straight ahead the "
                "whole time, so only the back of his head and his black hair are "
                "ever visible.")

# Pixar only: the character lock. The full block rides the opening prompt; every
# later cue repeats a short identity sentence, since an Orbis set_prompt
# replaces the previous one. The face description from the character sheet is
# left out on purpose: he is only ever seen from behind, and describing the
# face invites the model to turn him around.
PIXAR_CHARACTER = (
    "CHARACTER (identical in every shot, same proportions, materials, wear and "
    "scarf): a physically built child-sized robot, about 1.1 meters tall, rounded "
    "friendly proportions, slightly oversized round head. Short black hair of soft "
    "molded synthetic material shaped into a few rounded spikes, exactly as in the "
    "reference. Small rounded ears on the sides of the head. Smooth white body of "
    "matte ceramic-like plates with fine panel seams; on the back, two dull teal "
    "inset panels (upper back and lower back with the small hatch seam) matching the "
    "reference; on the front, one small dull teal inset panel on the chest in the "
    "same material. Teal joint gaps at the neck, hips and knees. Simple rounded hands "
    "with short fingers, short sturdy legs, rounded white boots with light sand dust "
    "on the soles and lower edges. A short dull-teal woven cotton scarf wrapped once "
    "around the neck, one end hanging over the shoulder. Slight wear, scuffs and "
    "faint sand marks on the plates, no glowing lights, no exposed wires.")


PIXAR_OPENING = (
    "A small android boy with rounded chunky black hair, a white jointed robot body "
    "with a teal panel on his back, white rounded boots and a dull-teal scarf blowing "
    "sideways walks slowly away from the camera across rippled golden sand dunes "
    "toward a low hazy sun, wind-blown dust drifting along the horizon. " + PIXAR_FACING +
    " " + PIXAR_CAMERA + " " + PIXAR_CHARACTER +
    " Stylized 3D CG animation in the Pixar / DreamWorks tradition, appealing rounded "
    "character design with clean silhouettes, soft global "
    "illumination with warm motivated key light and gentle fill, subsurface scattering "
    "on skin, physically-based materials, believable cloth and hair, rich but "
    "controlled cinematic color palette, shallow depth of field with soft bokeh, "
    "polished high-quality render. No flat 2D shading, no hand-drawn linework, no "
    "photoreal live-action footage, no uncanny realism. Smooth character-animated 3D "
    "motion with real weight, anticipation and follow-through, gentle cinematic camera "
    "moves — a slow dolly-in with subtle parallax — and consistent lighting across the "
    "shot. No morphing, no warping, no jitter.")

AUDIO_PROMPT = ("Calm lo-fi ambient music with warm synth pads, a slow gentle piano "
                "melody, soft brushed percussion and a quiet desert breeze.")

# The character's spoken line per scene (seedaudio/lines.json), and its
# Seed Audio render when one has been downloaded into VOICE_DIR.
VOICE_LINES = json.loads((REPO / "seedaudio/lines.json").read_text())
VOICE_DIR = EXAMPLES / "desert-journey-voice"


def voice(line_id):
    """The `voice` entry for a line id, or None when no line is written."""
    line = VOICE_LINES.get(line_id)
    if not line:
        return None
    entry = {"prompt": line}
    if (VOICE_DIR / f"{line_id}.mp3").exists():
        entry["url"] = f"/examples/desert-journey-voice/{line_id}.mp3"
    return entry


def reaction(line_id):
    """The `reaction` entry for a line id: its line, audio and length in
    seconds (the app waits that much longer before the next choices), or None
    until the line is rendered."""
    entry = voice(line_id)
    render = json.loads((REPO / "seedaudio/jobs.json").read_text())["renders"].get(line_id)
    if not entry or "url" not in entry or not render:
        return None
    return {**entry, "seconds": render["seconds"]}


def write_story(folder, story):
    """Writes the story JSON and prints a summary with any broken links."""
    out = EXAMPLES / folder / "story.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(story, indent=2, ensure_ascii=False) + "\n")
    nodes = story["nodes"]
    broken = [(k, c["to"]) for k, n in nodes.items() for c in n["choices"] if c["to"] not in nodes]
    words = [len(c.split()) for n in list(nodes.values())[1:] for c in n["cues"]]
    print(f"{folder}: {len(nodes)} scenes, {sum(len(n['cues']) for n in nodes.values())} cues, "
          f"follow-up cues {min(words)}–{max(words)} words, broken links: {broken}")
