#!/usr/bin/env python3
"""Builds "Desert Journey (still)" (public/examples/desert-journey-still/): the
short Pixar-style story the droid pages play. He walks alone or with a fox,
picks the oasis or the ruins, and on arriving admits he is losing focus. The
only choice left is to walk on to a quiet spot and sit down to meditate: the
camera holds still on his whole body, no more choices appear, a closing text shows, then the
screen fades to black while the song plays out.

Only the opening prompt carries the world, character, camera and style (see
desert_prompts.py). Every later cue is one visible change, per the Reactor
prompt guide: one action per cue, new subjects enter through an action, and
each change grows out of the last. The fox path keeps its own scene ids so
the fox's sit-down can be named in the ending.
"""
from desert_prompts import AUDIO_PROMPT, PIXAR_FACING, PIXAR_OPENING, reaction, voice, write_story

# Follow-ups name one visible change, then TAIL. Change-only cues let the
# follow shot drift (the camera pushed in and he stopped walking), so every
# walking cue ends with the facing sentences from the opening and a camera
# that travels at his pace at a fixed distance, framing his whole body.
CAMERA = ("The camera follows behind him, travelling forward at his walking pace and "
          "staying the same distance behind him and slightly above, keeping his whole body in the frame from his "
          "hair to his boots.")
# The stream drifted away from the desert over a long take, so every cue,
# the opening included, keeps the dunes and the horizon in the frame.
DESERT = ("Rippled golden sand dunes surround him and stretch all the way to the "
          "horizon, and the open desert and the horizon line stay visible ahead of "
          "him in every frame.")
TAIL = f"{PIXAR_FACING} {DESERT} {CAMERA}"

# The fox is a droid like him, knee-high. Its looks are given once, in the cue
# where it enters; after that cues refer to it as "the fox" (a fresh "A small
# robot fox" reads as a new subject) and keep it in the frame at his side.
FOX_LOOK = ("knee-high, made of the same matte white ceramic plates as the android boy, "
            "with teal joint gaps, tall pointed ears and a long white tail")
FOX = (" The small white robot fox walks right beside his left leg at the same "
       "pace, clearly visible in the frame, seen from behind like him.")
FOX_SITS = " The small white robot fox sits down on the sand right beside him, in the frame."

# The one cue in which he stops. The pose is spelled out (legs, knees, hands,
# back), and the camera eases back and a little to his side so his whole
# seated body, crossed legs included, is in the frame.
SIT = ("The android boy stops walking and sits down on the sand in a meditation "
       "pose, facing away from the camera: his legs crossed in front of him, each "
       "foot tucked beneath the opposite knee, knees resting low on the sand out to "
       "the sides, back straight, hands resting on his knees, head level.{fox} The "
       "camera slowly eases back and holds still behind him, slightly above and a "
       "little to his right, framing his whole body with space around it, from the "
       "top of his hair to his crossed legs and the sand beneath him, nothing cut "
       "off. {desert}")

# id: ([what happens while he walks, ...], [(label, to), ...], voice line id)
# Ids ending in "-sit" are endings: he walks on to a quiet spot, then SIT, and
# there are no choices.
SIT_CHOICE = "Walk on and sit down to find yourself in meditation"
SCENES = {
    "alone": (["The android boy walks on alone across the open dunes."],
              [("Head left, to the oasis", "left-oasis"), ("Head right, to the ruins", "right-ruins")], "alone"),
    # The oasis comes into view little by little: over a dune crest, far off
    # below, then closer, then he reaches it.
    "left-oasis": (["The android boy bears slightly left, still walking away from the camera, and walks up the slope of a tall dune ahead of him toward its crest.",
                    "The android boy crosses the crest and starts walking down the far side of the dune, where a few green palm tops appear far off at the foot of the dunes.",
                    "The android boy walks on down the dune as the palm trees grow closer and a small blue pool glints between them.",
                    "The android boy walks off the dune into the oasis, the clear blue pool ringed by palm trees beside him."],
                   [(SIT_CHOICE, "oasis-sit")], "focus"),
    "oasis-sit": (["The android boy walks on past the oasis, leaving the palm trees behind him, out to a quiet, empty stretch of open sand ahead."],
                  [], "stillness"),
    # The ruins burst up out of the sand in front of him, in the direction he
    # walks, so they are seen from the start: the ground ahead stirs, they
    # rise far ahead, then he walks up to them. Saying where (ahead, between
    # him and the horizon, nothing behind him) keeps them from rising behind
    # him or around the camera.
    "right-ruins": (["The android boy bears slightly right, still walking away from the camera, as the sand far ahead of him, between him and the horizon, begins to tremble and slide.",
                     "Broken sandstone pillars and arches burst up out of the sand far ahead of him, in front of him in the direction he is walking, sand pouring off their tops, while the dunes behind him stay empty.",
                     "The android boy walks toward the sandstone pillars ahead of him as they grow closer, and passes between the first two."],
                    [(SIT_CHOICE, "ruins-sit")], "focus"),
    "ruins-sit": (["The android boy walks on past the last sandstone pillars, leaving the ruins behind him, out to a quiet, empty stretch of open sand ahead."],
                  [], "stillness"),
}

nodes = {
    "walk": {"cues": [f"{PIXAR_OPENING} {DESERT}"], "choices": [
        {"label": "Keep walking alone", "to": "alone"},
        {"label": "Call a fox to walk with him", "to": "fox-comes"}]},
    # The fox path starts here; every scene after it carries "-fox". The fox
    # enters through an action where the camera looks (entering from behind the
    # camera never showed it; "appears" is a description, not an entrance),
    # runs back to him, then walks at his side.
    "fox-comes": {"cues": [
        f"A small robot fox, {FOX_LOOK}, trots into view over the crest of the dune ahead of the android boy and stops on top, looking down at him. {TAIL}",
        f"The small white robot fox runs down the dune toward the android boy, its long tail streaming behind it. {TAIL}",
        f"The small white robot fox reaches the android boy, turns around and falls into step right beside his left leg, walking at his pace. {TAIL}"],
                  "choices": [
        {"label": "Head left, to the oasis", "to": "left-oasis-fox"},
        {"label": "Head right, to the ruins", "to": "right-ruins-fox"}]},
}
for sid, (cues, choices, line) in SCENES.items():
    for suffix, fox, fox_sits in (("", "", ""), ("-fox", FOX, FOX_SITS)):
        if sid == "alone" and suffix:
            continue
        node = {"cues": [f"{cue}{fox} {TAIL}" for cue in cues],
                "choices": [{"label": l, "to": f"{t}{suffix}"} for l, t in choices]}
        if sid.endswith("-sit"):
            node["cues"].append(SIT.format(fox=fox_sits, desert=DESERT))
            node["ending"] = {"text": voice("stillness")["prompt"]}
        nodes[f"{sid}{suffix}"] = node
# What he says a couple of seconds after the viewer picks a scene, before that
# scene's own question; it also gives the stream more time to change.
REACTIONS = {"alone": "alone-reaction", "fox-comes": "fox-reaction",
             "left-oasis": "oasis-reaction", "right-ruins": "ruins-reaction"}

for sid, node in nodes.items():
    if reaction(REACTIONS.get(sid.removesuffix("-fox"), "")):
        node["reaction"] = reaction(REACTIONS[sid.removesuffix("-fox")])
    line = SCENES[sid.removesuffix("-fox")][2] if sid.removesuffix("-fox") in SCENES else sid
    if voice(line):
        node["voice"] = voice(line)

write_story("desert-journey-still", {
    "title": "Desert Journey (still) — walk, then sit",
    "seed": 42,
    "resolution": "2k",
    "audio_enabled": True,
    "audio_prompt": AUDIO_PROMPT,
    "cue_gap_chunks": 4,
    "hold_chunks": 4,
    "choice_delay_seconds": 18,
    "start": "walk",
    "nodes": nodes,
})
