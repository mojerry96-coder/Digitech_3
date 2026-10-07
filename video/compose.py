"""Composite the recording: cursor, click rings, narration, soft click ticks and captions.

Run from this folder after schedule.py. Needs numpy, Pillow, ffmpeg and gs500.ttf (Google Sans 500).
Writes clean.mp4 (no burned captions), burned.mp4 (captions drawn in), cues.json and mix.wav.
"""
import json, os, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
SCH = json.load(open("sched.json"))
M = json.load(open("timeline.json"))
FPS, W, H, SR = 30, 1920, 1080, 24000
DUR = round(max(M["end"], max(o["s"] + o["d"] for o in SCH) + 0.8), 2)
imgs = sorted(M["images"], key=lambda x: x[0])
keys, clicks, ET = M["keys"], M["clicks"], M["endcard_t"]

# ---- captions
cues = [{"s": o["s"], "e": round(o["s"] + o["d"] + 0.35, 2), "t": o["t"]} for o in SCH]
for i in range(len(cues) - 1):
    cues[i]["e"] = min(cues[i]["e"], cues[i + 1]["s"])
cues[-1]["e"] = min(cues[-1]["e"], DUR)
json.dump(cues, open("cues.json", "w"), indent=1)

# ---- audio: narration plus soft click ticks
def read_wav(path):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"])
    return np.frombuffer(raw, dtype=np.float32)

audio = np.zeros(int(DUR * SR), dtype=np.float32)
for o in SCH:
    a = read_wav(os.path.join("narration", f"s{o['i']}.wav"))
    st = int(o["s"] * SR)
    audio[st:st + len(a)] += a[:max(0, len(audio) - st)]
n = int(0.03 * SR)
tick = (np.exp(-np.linspace(0, 40, n)) * np.sin(2 * np.pi * 1900 * np.linspace(0, 0.03, n)) * 0.05).astype(np.float32)
for t, _, _ in clicks:
    s = int(t * SR)
    audio[s:s + n] += tick[:max(0, len(audio) - s)]
audio = np.clip(audio / max(1e-6, np.abs(audio).max()) * 0.89, -1, 1).astype(np.float32)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "mix.wav"],
               input=audio.tobytes(), check=True)

# ---- cursor
def ease(x): return x * x * (3 - 2 * x)

def cursor_at(t):
    prev = keys[0]
    for k in keys:
        if k[0] >= t:
            if k[0] == prev[0]: return k[1], k[2]
            u = ease((t - prev[0]) / (k[0] - prev[0]))
            return prev[1] + (k[1] - prev[1]) * u, prev[2] + (k[2] - prev[2]) * u
        prev = k
    return prev[1], prev[2]

arrow = [(0, 0), (0, 34), (9, 26), (15, 40), (21, 37), (15, 24), (26, 24)]
cur_img = Image.new("RGBA", (40, 48), (0, 0, 0, 0))
dc = ImageDraw.Draw(cur_img)
dc.polygon([(x + 3, y + 3) for x, y in arrow], fill=(0, 0, 0, 70))
dc.polygon([(x + 1, y + 1) for x, y in arrow], fill="white", outline="black", width=2)
font = ImageFont.truetype("gs500.ttf", 36)

def draw_caption(im, text):
    dr = ImageDraw.Draw(im, "RGBA")
    words, lines, cur = text.split(), [], ""
    for w in words:
        tt = (cur + " " + w).strip()
        if dr.textlength(tt, font=font) > 1500 and cur: lines.append(cur); cur = w
        else: cur = tt
    lines.append(cur)
    lh = 50; bh = lh * len(lines) + 24; y0 = 950 - bh
    bw = max(dr.textlength(l, font=font) for l in lines) + 48
    dr.rounded_rectangle([W / 2 - bw / 2, y0, W / 2 + bw / 2, y0 + bh], radius=10, fill=(0, 0, 0, 205))
    for i, l in enumerate(lines):
        dr.text((W / 2, y0 + 12 + i * lh + lh / 2), l, font=font, fill="white", anchor="mm")

def ff(out):
    return subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                             "-r", str(FPS), "-i", "-", "-i", "mix.wav", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                             "-pix_fmt", "yuv420p", "-tune", "animation", "-c:a", "aac", "-b:a", "160k", "-shortest",
                             "-movflags", "+faststart", out], stdin=subprocess.PIPE)

p1, p2 = ff("clean.mp4"), ff("burned.mp4")
endc_path = imgs[-1][1]
endc = Image.open(endc_path).convert("RGB")
body = [(t, p) for t, p in imgs if p != endc_path]
cache = {}

def base(t):
    cands = [p for tt, p in body if tt <= t + 1e-6]
    path = cands[-1] if cands else body[0][1]
    if path not in cache:
        cache.clear(); cache[path] = Image.open(path).convert("RGB")
    return cache[path]

for f in range(int(DUR * FPS)):
    t = f / FPS
    fr = base(t).copy()
    if t < ET:
        cx, cy = cursor_at(t)
        rings = [(ct, x, y) for ct, x, y in clicks if 0 <= t - ct < 0.45]
        if rings:
            ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
            for ct, x, y in rings:
                dt = t - ct; r = 14 + 40 * dt / 0.45; a = int(150 * (1 - dt / 0.45))
                od.ellipse([x - r, y - r, x + r, y + r], outline=(11, 87, 208, a), width=5)
                od.ellipse([x - 10, y - 10, x + 10, y + 10], fill=(11, 87, 208, int(a * 0.5)))
            fr = Image.alpha_composite(fr.convert("RGBA"), ov).convert("RGB")
        fr.paste(cur_img, (int(cx) - 1, int(cy) - 1), cur_img)
    else:
        fr = Image.blend(fr, endc, min(1, (t - ET) / 0.45))
    p1.stdin.write(fr.tobytes())
    c = [c for c in cues if c["s"] <= t < c["e"]]
    if c:
        fr = fr.copy(); draw_caption(fr, c[-1]["t"])
    p2.stdin.write(fr.tobytes())
p1.stdin.close(); p2.stdin.close(); p1.wait(); p2.wait()
print(f"composed {DUR}s, {len(cues)} captions")
