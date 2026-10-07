"""Place each narration line on the recording's timeline (writes sched.json for compose.py).

Run from this folder after record.mjs. A line starts at its anchor (a fixed time, or a mark that
record.mjs set when the matching action began), but never before the previous line has ended.
Durations come from ffprobe, so no Python audio library is needed.
"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
NARR = os.path.join(HERE, "narration")
GAP = 0.25

# (caption text, anchor): anchor is seconds, a record.mjs mark name, or None to follow on
LINES = [
    ("Welcome to your Drive practice.", 0.6),
    ("This is a brand-new account. It starts empty, and nothing you do here is saved.", None),
    ("Everything begins with the New button. Create a folder, give it a name, and it appears in My Drive.", "newfolder"),
    ("To upload, drag files from your computer onto the page, or choose File upload from the New menu.", "upload"),
    ("Drag a file onto a folder to move it. Changed your mind? Choose Undo.", "move"),
    ("Double-click a folder to open it. The path at the top shows where you are.", "open"),
    ("Right-click any item for more options: rename it, share it, star it, or move it.", "context"),
    ("Sharing is practice too. Add an email address, choose a role, and send. No email ever leaves this page.", "share"),
    ("The New button also creates Google Docs, Sheets and Slides. They open in a simple practice editor.", "doc"),
    ("Use search to find anything by name, then filter the results by type.", "search"),
    ("Deleted items go to Trash. From there, you can restore them, or delete them forever.", "trash"),
    ("Practice tasks tracks what you have tried. It shows progress, not a score.", "guide"),
    ("Reload the page at any time to start again with a fresh, empty account.", None),
    ("Your turn — Begin Practice.", "endcard"),
]


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", path]).decode())


if __name__ == "__main__":
    os.chdir(HERE)
    marks = json.load(open("timeline.json"))["marks"]
    sched, end = [], 0.0
    for i, (text, anchor) in enumerate(LINES, 1):
        d = round(duration(os.path.join(NARR, f"s{i}.wav")), 2)
        at = marks[anchor] if isinstance(anchor, str) else (anchor or 0.0)
        s = round(max(at, end + GAP) if i > 1 else at, 2)
        sched.append({"i": i, "s": s, "d": d, "t": text})
        end = s + d
    json.dump(sched, open("sched.json", "w"), indent=1)
    for o in sched:
        print(f"s{o['i']:<3}{o['s']:6.2f} +{o['d']:4.2f}  {o['t'][:64]}")
