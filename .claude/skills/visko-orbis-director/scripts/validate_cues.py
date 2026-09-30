#!/usr/bin/env python3
"""Validate an Orbis-Stable cue sheet and print a timeline.

Usage: python validate_cues.py cues.json [--min-gap 4]
Exit code 1 on errors; warnings don't fail.
"""
import json, re, sys, argparse

CHUNK_S = 1.8
COST_PER_MIN = 0.582
CONTINUITY = re.compile(r"no cuts|unbroken take|single take|continuous", re.I)

def words(s): return len(re.findall(r"\b\w+\b", s))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--min-gap", type=int, default=4)
    a = ap.parse_args()
    sheet = json.load(open(a.path))
    errs, warns = [], []

    cues = sheet.get("cues") or []
    if not cues: errs.append("no cues")
    anchor = (sheet.get("anchor") or "").strip()
    if not anchor: warns.append("no 'anchor' sentence set")
    anchor_words = {w.lower() for w in re.findall(r"[A-Za-z]{4,}", anchor)} - {"same", "with", "that", "this", "from"}

    ids = set()
    prev = None
    for i, c in enumerate(cues):
        cid, at, p = c.get("id", f"#{i}"), c.get("at_chunk"), (c.get("prompt") or "").strip()
        if cid in ids: errs.append(f"{cid}: duplicate id")
        ids.add(cid)
        if not isinstance(at, int) or at < 0: errs.append(f"{cid}: at_chunk must be a non-negative int"); continue
        if i == 0 and at != 0: errs.append(f"{cid}: first cue must have at_chunk 0 (it is the prompt sent before start)")
        if prev is not None:
            gap = at - prev
            if gap <= 0: errs.append(f"{cid}: at_chunk not ascending")
            elif gap < a.min_gap: warns.append(f"{cid}: only {gap} chunks after previous cue (<{a.min_gap}); morphs will stack")
        if i == 1 and at < 4: warns.append(f"{cid}: first morph at chunk {at}; the first picture only appears ~chunk 2, let the opening establish")
        prev = at
        if not p: errs.append(f"{cid}: empty prompt"); continue
        n = words(p)
        if n < 30: warns.append(f"{cid}: prompt is short ({n} words); aim 40–90")
        if n > 110: warns.append(f"{cid}: prompt is long ({n} words); aim 40–90")
        if not CONTINUITY.search(p): warns.append(f"{cid}: no continuity tail ('continuous …, no cuts')")
        if i > 0 and anchor_words:
            hit = sum(1 for w in anchor_words if w in p.lower())
            if hit < max(1, len(anchor_words) // 2):
                warns.append(f"{cid}: re-states little of the anchor ({hit}/{len(anchor_words)} key words); morph may read as a cut")

    # word-count jumps between consecutive cues
    for x, y in zip(cues, cues[1:]):
        wx, wy = words(x.get("prompt", "")), words(y.get("prompt", ""))
        if wx and wy and max(wx, wy) / min(wx, wy) > 2:
            warns.append(f"{y.get('id')}: length jumps {wx}→{wy} words vs previous cue")

    ap_ = (sheet.get("audio_prompt") or "").strip()
    if ap_:
        if words(ap_) > 90: warns.append(f"audio_prompt is {words(ap_)} words; only ~128 tokens are read")
        if len(re.findall(r"[.!?](\s|$)", ap_)) > 1: warns.append("audio_prompt should be one sentence")
        if cues:
            vis = set(re.findall(r"[a-z]{5,}", cues[0].get("prompt", "").lower()))
            aud = set(re.findall(r"[a-z]{5,}", ap_.lower()))
            if aud and len(vis & aud) / len(aud) > 0.5:
                warns.append("audio_prompt looks like it restates the visual prompt; describe sounds, or leave empty")

    ri = sheet.get("reference_image")
    if ri not in (None, {}) and not isinstance(ri, dict): errs.append("reference_image must be null or an object")
    seed = sheet.get("seed")
    if seed is not None and (not isinstance(seed, int) or seed < 0): errs.append("seed must be a non-negative int")

    # timeline
    print(f"\n{sheet.get('title', '(untitled)')}")
    print(f"{'cue':<18}{'chunk':>6}{'≈ time':>9}  prompt start")
    for c in cues:
        at = c.get("at_chunk", 0) or 0
        t = at * CHUNK_S
        print(f"{str(c.get('id')):<18}{at:>6}{int(t//60):>5}:{int(t%60):02d}  {(c.get('prompt') or '')[:60]}…")
    if cues:
        last = cues[-1].get("at_chunk", 0) or 0
        tail = max(a.min_gap * 2, 8)
        mins = (last + tail) * CHUNK_S / 60
        print(f"\nlast cue at ~{last*CHUNK_S:.0f}s; with a {tail}-chunk tail ≈ {mins:.1f} min ≈ ${mins*COST_PER_MIN:.2f} generation")

    for w in warns: print("WARN ", w)
    for e in errs: print("ERROR", e)
    print("OK" if not errs else f"{len(errs)} error(s)")
    sys.exit(1 if errs else 0)

if __name__ == "__main__":
    main()
