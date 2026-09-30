# Morph patterns

A morph lands at the next chunk boundary and blends the current picture toward the new text. The model keeps its own history, so small, anchored steps look like one shot evolving; big unanchored steps look like a glitch. These patterns get you from A to B on air.

## 1. Single-variable drift (the default)
Keep setting, subject, camera. Change one axis per cue.
- Time: golden hour → blue hour → night → dawn
- Weather: clear → haze → rain → snow
- Season: summer green → autumn gold → bare winter branches
- Palette/grade: natural → teal-orange → monochrome red
- Density: empty street → a few pedestrians → crowded
- Subject action: stands still → turns toward camera → raises a hand
Spacing: 6–10 chunks.

## 2. Bridge through a shared medium
For A→B that share nothing. Pick a medium that can exist in both worlds, fill the frame with it, then let it resolve into B.
- **Fog/smoke:** A fills with dense fog → fog glows with B's colour of light → shapes of B appear in the fog → fog thins to reveal B.
- **Light bloom:** a bright light source grows until it washes the frame → the glare softens into B's light source (sun, neon, lantern).
- **Water surface:** camera tilts down to a puddle/lake reflecting A → the reflection becomes B → camera tilts up into B.
- **Macro texture:** push into bark/skin/metal texture until it fills the frame → texture becomes B's surface (stone, circuitry) → pull back into B.
- **Fly-through:** camera flies into a dark opening (cave, doorway, cloud) → darkness → emerges in B.
Each step is its own cue, 4–6 chunks apart. Keep the camera verb constant through the bridge ("the camera keeps pushing slowly forward").

## 3. Subject transformation
Same place, the subject changes: armour grows over the pilot's suit; the tree's leaves turn to glass; the statue's stone cracks and warm light shows through. Describe the end state progressively over 2–4 cues ("thin cracks appear" → "the cracks widen and glow" → "the stone shell falls away").

## 4. Reveal / scale shift
Keep the camera move but widen the world: close on a hand → the hand belongs to a pilot in a cockpit → the cockpit is inside a giant mecha → the mecha stands on a ridge over a city. One scale step per cue.

## 5. Loop / return
For long streams, end the sequence on a prompt that is the opening prompt's world so the set can loop without a reset. Reuse the cue 0 text verbatim for the last cue.

## Anti-patterns
- Changing camera move and setting in the same cue.
- Cues closer than 4 chunks apart (they stack before either resolves).
- Pronoun drift ("she", "the girl", "the pilot") for one subject.
- Adding text/typography, logos, or fine readable detail — 832x480 generation won't hold it.
- Putting sound words in the visual prompt to steer audio. Audio follows the picture; use `audio_prompt` at start if needed.
