"""Shorten the silent stretches of the composed walkthrough; narrated lines keep their speed.

Run from this folder after compose.py (copied unchanged from the Sandbox Class pipeline). Reads cues.json, clean.mp4 and burned.mp4; writes
paced-clean.mp4, paced-burned.mp4 and paced-cues.json (the timings the build and captions use).
Gaps up to 1 s are kept, gaps up to 6 s play at 1.8x and longer ones at 2.5x.
"""
import json, subprocess

def factor(gap):
    return 1.0 if gap <= 1.0 else (2.5 if gap > 6 else 1.8)

def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", path]).decode())

cues = json.load(open("cues.json"))
total = duration("clean.mp4")
segs, t = [], 0.0
for c in cues:
    if c["s"] > t + 0.01: segs.append((t, c["s"], factor(c["s"] - t), None))
    segs.append((c["s"], c["e"], 1.0, c["t"])); t = c["e"]
if total > t + 0.01: segs.append((t, total, factor(total - t), None))

new, pos = [], 0.0
for a, b, f, text in segs:
    d = (b - a) / f
    if text is not None: new.append({"s": round(pos, 2), "e": round(pos + d, 2), "t": text})
    pos += d
json.dump(new, open("paced-cues.json", "w"), indent=1)

def atempo(f):
    return "atempo=1.0" if f == 1.0 else (f"atempo={f}" if f <= 2 else f"atempo={f/2:.4f},atempo=2.0")
graph = []
for i, (a, b, f, _) in enumerate(segs):
    graph.append(f"[0:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{f}[v{i}]")
    graph.append(f"[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,{atempo(f)}[a{i}]")
graph.append("".join(f"[v{i}][a{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=1[v][a]")
open("pace-filter.txt", "w").write(";\n".join(graph))
for src in ("clean", "burned"):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{src}.mp4", "-filter_complex_script", "pace-filter.txt",
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-tune", "animation", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", f"paced-{src}.mp4"], check=True)
print(f"{total:.1f}s -> {pos:.1f}s, {len(new)} lines")
