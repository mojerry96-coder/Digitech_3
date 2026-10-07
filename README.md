# The Drive Practice

A practice simulation of Drive in its first-day state, for DT01 (unit label `DT01 · Unit DT 01 04` is a placeholder; change it in `index.html`). The full build specification is in [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md).

No build step, server or accounts. Double-click `index.html`. Nothing is saved: reloading gives a fresh, empty account.

## Screen flow

1. **Opener** (house spec: [docs/OPENER.md](docs/OPENER.md)), about 4.5 seconds. The Ekiti State crest, the MIVA lockup and the Tunji Olowolafe Foundation lockup arrive one at a time and the row re-centres on each arrival. Then the dividers, the chevron motif, the tagline, "THE **DRIVE** PRACTICE" and **Begin**. Skip or Esc jumps to the finished frame. Reduced motion shows the finished frame at once.
2. **Walkthrough player.** Begin opens it and plays the narrated walkthrough with sound (Begin is the click browsers require before audio). If sound is still blocked, it plays muted with captions and offers **Turn on sound**. Captions are off by default; the player's captions control turns them on. At the end card, the **Begin Practice** drawn in the video becomes a real button. **Skip to practice** or Esc closes it at any time. Reopen it from **Support (?) › Watch walkthrough** or **Walkthrough** in the Practice tasks panel.
3. **The practice**: the Drive clone and the Practice tasks guide.

URL options: `?skipintro` skips the opener, `?nowalk` makes Begin go straight to the practice, `?guide=off` hides the Practice tasks guide, and `#my-drive` starts on My Drive.

## Files

| Path | What it is |
|---|---|
| `index.html` | Page shell, including the opener markup |
| `css/drive.css`, `js/*.js` | The Drive simulation (see BUILD_INSTRUCTIONS.md §2) |
| `css/intro.css`, `js/intro.js` | The opener |
| `js/walkthrough.js` | The walkthrough player |
| `assets/logos/` | Partner logos and the chevron motif, as supplied in `Fix_the_Prompt_Opener.zip` |
| `assets/icons/type/` | Drive's own file-type icons (Docs, Sheets, Slides, Forms, PDF, image, video, audio, zip, Word, Excel, PowerPoint, text and others), from `drive-thirdparty.googleusercontent.com/64/type/…`, the same images Drive's API returns |
| `assets/icons/product/` | Product icons (Drive, Docs, Sheets, Slides, Forms, Gmail, Calendar, Meet, Chat, Keep, Tasks, Contacts, Maps, Photos, YouTube, Play, Sites), from `www.gstatic.com/images/branding/product/…` |
| `assets/brand/` | MIVA logos (white on the player and end card) |
| `assets/fonts/` | Google Sans, Roboto and Afacad, bundled. Material Symbols still loads from Google Fonts, so icons need a connection |
| `walkthrough/` | The finished walkthrough (see below) |
| `video/` | The pipeline that makes the walkthrough |

## Icons

File and product icons are Google's own, downloaded on 6 Oct 2026 and bundled, so they are recognisable to students and work offline. The Google "G" logo is deliberately not used anywhere; that is why the apps launcher has no Search, Translate or News tile. Folders are still drawn as vectors with Drive's Material folder shape, so they can take the 24 folder colours. The old neutral mark is kept at `assets/logo.svg` but is no longer used. Google's icons are its trademarks; the build spec (§11) asks for permission, such as a Google for Education partnership, before they are used.

## The walkthrough

`walkthrough/` holds:

- `drive-walkthrough-1080p.mp4`: 95 seconds, 1920×1080, 30 fps, H.264/AAC, with no captions showing (the player's captions control, or the `.srt`/`.vtt` files, add them)
- `drive-walkthrough-1080p.webm`: the same in VP9/Opus, for browsers without H.264
- `drive-walkthrough-1080p-open-captions.mp4`: captions burned in, for players that ignore caption tracks
- `captions.srt`, `captions.vtt`, `captions.js` (the player reads this one, so captions work when opened from disk), and `transcript.md`

It shows the real build, not a mock-up: the empty account, New › New folder, dragging files in, moving a file onto a folder and Undo, opening a folder, the right-click menu, sharing, creating a Google Doc, search with a type filter, Trash and Restore, and the Practice tasks list. It ends on a MIVA end card.

**Narration:** ElevenLabs, voice "Ifeoma Odumodu - Nigerian Narrator", `eleven_multilingual_v2`, stability 0.6, similarity 0.8, the same voice and settings as the Sandbox Class and Fix the Prompt walkthroughs. One file per line in `video/narration/` (`s1.wav` … `s14.wav`; the original MP3s are in `video/narration/raw/`).

### Rebuilding it

Needs Google Chrome, Node 22+, ffmpeg, and Python 3 with numpy and Pillow. Nothing else is installed: the recorder drives the Chrome already on the Mac over the DevTools protocol.

```bash
node video/record.mjs        # records the real build headlessly: video/shots/ + timeline.json
cd video
python3 schedule.py          # places each narration line against the recorded actions
python3 compose.py           # adds cursor, click rings, captions and the voice
python3 pace.py              # shortens silent gaps (narrated lines keep their speed)
python3 finish.py            # writes everything in ../walkthrough/
```

- To change a line, regenerate its `s<n>.wav` with the same voice settings, update the text in `video/schedule.py`, and run the whole chain again. The recorder reads the narration lengths, so the actions wait for the voice.
- To use a recorded human voiceover, replace `video/narration/s1.wav` … `s14.wav` (24 kHz mono) and rerun from `record.mjs`.
- `video/shots/` (about 80 MB) and the intermediate MP4s in `video/` are working files. They are safe to delete; the next run recreates them.
- When testing locally, open `index.html` directly or use a server that supports range requests (for example `npx serve .`). Python's `http.server` does not, so seeking inside the video jumps back to the start.

## Checks run

- **Opener**, sampled every 150 ms at 1440 px and 375 px: no two logos ever overlapped, each stage settled centred, there was no sideways scroll, the motif stayed at 0.7, and Begin took focus.
- **Player**, from disk: the video loads (95.3 s), captions start off and can be turned on, the end-card Begin Practice appears over the drawn one and takes focus, closing returns focus to New, and keyboard shortcuts stay off while the opener or player is up.
