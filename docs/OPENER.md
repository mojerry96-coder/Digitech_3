# Fix the Prompt — Opener Animation

Specification for the opening sequence of the **Fix the Prompt** simulation (Module 2 · AI Literacy for Teaching and Research · Unit 2.2).

The opener runs for about **4.5 seconds** and ends on a still frame with a **Begin** button. Three partner logos arrive one at a time, centred on screen, and line up. The whole sequence is skippable.

---

## 1. Contents of this package

```
OPENER.md                  this document
logos/ekiti.svg            Government of Ekiti State, Nigeria (crest)
logos/miva.svg             MIVA Open University (white lockup)
logos/tof.svg              Tunji Olowolafe Foundation (cream lockup)
logos/chevrons.svg         background motif, drawn from the MIVA chevron
reference/opener.html      the markup, as built
reference/intro.css        the styles, as built
reference/intro.js         the timeline, as built
```

The logo files are cut from the supplied brand artwork. MIVA and the Foundation arrived as a single combined lockup; they were split into separate files so each can be animated on its own. Nothing was redrawn.

---

## 2. Background

A single flat navy field with a soft lift in the centre, so the logos sit on the brightest part.

```css
background: radial-gradient(ellipse at 50% 40%,
  #0C3F66 0%,      /* lifted centre */
  #09314F 52%,     /* brand navy */
  #06243C 100%);   /* darkened edge */
```

### The chevron motif

`logos/chevrons.svg` is the MIVA chevron enlarged into a background pattern, as on the brand deck cover. It is decoration only and must never compete with the logos.

| Property | Value |
| --- | --- |
| Position | Right edge, vertically centred: `top: 50%; right: -14%; transform: translateY(-50%)` |
| Size | `width: min(980px, 105vh)`, square aspect ratio |
| Colour | `#0E4571` (one step lighter than the navy ground) |
| Opacity | `0.7`, and never above that |
| Entry | Fades in over `1600ms` once the three logos have lined up (not before) |
| Overflow | Clipped by the opener container; it is allowed to run off the right edge |

Keep it behind the content: the container sits at the back of the stacking order and is `aria-hidden="true"`.

---

## 3. Logos

Order, left to right, with the width each one is drawn at:

| Slot | Asset | Width | Notes |
| --- | --- | --- | --- |
| 1 | `ekiti.svg` | `clamp(46px, 7vw, 74px)` | Full-colour crest. Holds a bitmap inside the SVG (474 KB), so it is the heaviest asset on this screen. A vector version would load faster. |
| 2 | `miva.svg` | `clamp(96px, 15vw, 164px)` | White. Vector paths, scales cleanly. |
| 3 | `tof.svg` | `clamp(70px, 11vw, 118px)` | Cream. Holds a bitmap inside the SVG. |

**Separators:** a 1px vertical rule between each pair, `rgba(255, 255, 255, 0.34)`, height `clamp(30px, 5vw, 52px)`. They appear only after all three logos have settled, growing from `scaleY(0.4)` to `scaleY(1)` over 700ms.

**Gaps:** `clamp(24px, 4.2vw, 46px)` between items.

Every logo keeps its own alt text, since these identify real institutions:
- "Government of Ekiti State, Nigeria"
- "MIVA Open University"
- "Tunji Olowolafe Foundation"

---

## 4. The movement

### The rule that matters

**The row slides; the logos do not fly.** Each logo fades in at its own place in the line, and the row as a whole re-centres every time a new one joins. So whatever has arrived is always centred on screen, and no two logos ever occupy the same space.

This is worth stating plainly because the obvious approach — flying each logo to the centre of the screen and then out to its slot — **does not work here**. The centre of the screen is exactly where the middle logo's final slot is, so a third logo arriving at the centre lands on top of the second one. That was the original bug.

### The slide

For the first `n` logos revealed, offset the row by:

```
shift = (row centre) − (centre of the revealed logos' slots)
```

Measured from **layout** positions (`offsetLeft` / `offsetWidth`), never from `getBoundingClientRect()`, because the rect includes the entry scale and gives the wrong answer. At full reveal the shift is `0`, so the finished line is centred.

Transition: `transform 900ms cubic-bezier(0.22, 1, 0.36, 1)`.

### Each logo's entry

| Property | From | To | Duration |
| --- | --- | --- | --- |
| `opacity` | 0 | 1 | 700ms ease-out |
| `transform: scale()` | 1.1 | 1 | 800ms `cubic-bezier(0.22, 1, 0.36, 1)` |
| `filter: blur()` | 8px | 0 | 700ms ease-out |

The scale stays modest at 1.1. A larger entry scale makes a logo's box wide enough to clip its neighbour even when the positions are correct.

### Timeline

Times are from the start of the sequence.

| Time | Event |
| --- | --- |
| 350ms | Ekiti crest fades in, centred |
| 1050ms | Crest finishes settling |
| 1350ms | Row slides left; MIVA fades in beside it; the pair is centred |
| 2050ms | MIVA settles |
| 2350ms | Row slides again; Tunji Olowolafe fades in; all three centred |
| 3050ms | Line complete |
| 3550ms | Dividers grow in; chevron motif begins its fade |
| 3800ms | Title and unit label rise in |
| 4450ms | **Begin** appears and takes keyboard focus; Skip fades out |

---

## 5. Type and the title

| Element | Treatment |
| --- | --- |
| Tagline | "Study. Anywhere. Anyone. Anytime." — 12px, weight 700, `letter-spacing: 0.22em`, uppercase, cream `#FCEBCC` at 85% opacity |
| Title | "FIX THE PROMPT" — Afacad, weight 650, `clamp(40px, 6.4vw, 72px)`, uppercase, `letter-spacing: -0.025em`, white, with **"PROMPT" in amber `#EE9B01`** |
| Unit label | "AI Literacy · Unit 2.2" — 13px, weight 700, `letter-spacing: 0.14em`, uppercase, `rgba(214, 228, 250, 0.72)` |

Accenting one word of the title follows the brand deck cover, which sets "MIVA **CAMPUS**" the same way.

---

## 6. Controls

**Begin** — amber `#EE9B01` with brown `#472E00` text, hover `#FFB01F`, minimum height 48px, fully rounded. Amber is the action colour here because the ground is navy; white text on amber would fail contrast, and navy on navy would disappear.

**Skip** (bottom right) — a quiet outlined button, `Skip` with an `Esc` key hint. It jumps to the finished frame rather than skipping the opener outright, because the **Begin** click is what allows the narration to play with sound later. Browsers block audio until the viewer has interacted with the page.

---

## 7. Behaviour

- **Esc** does the same as Skip.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the finished frame is shown immediately, with no movement.
- **Returning learners** who reload mid-session bypass the opener entirely.
- **Begin** hands over to the loading screen, then the walkthrough.
- The sequence only starts once all three logo files have loaded. Starting earlier measures a collapsed row and the centring is wrong.
- The opener is a modal region: `role="dialog"`, `aria-modal="true"`, `aria-label="Fix the Prompt"`.

---

## 8. Checks before sign-off

- [ ] No two logos overlap at any point. Sample positions through the whole sequence rather than judging by eye.
- [ ] Whatever is on screen stays centred at each stage, including mid-slide.
- [ ] All three logos fit at 375px width with no sideways scroll.
- [ ] The chevron motif stays at or below 0.7 opacity and never crosses a logo.
- [ ] Each logo keeps its institution's alt text.
- [ ] Begin has visible keyboard focus.
- [ ] With reduced motion on, the final frame appears with no animation.

---

## 9. Palette reference

From the Miva Campus brand deck:

| Colour | Hex | Role in the opener |
| --- | --- | --- |
| Navy | `#09314F` | Background ground |
| Navy (lift) | `#0C3F66` | Centre of the background gradient |
| Navy (edge) | `#06243C` | Outer edge of the gradient |
| Chevron | `#0E4571` | Background motif |
| Amber | `#EE9B01` | "PROMPT" in the title, Begin button |
| Brown | `#472E00` | Text on the amber button |
| Cream | `#FCEBCC` | Tagline |
