/* intro.js — the opener, built to the house spec in docs/OPENER.md.
 * Three partner logos arrive one at a time and the row re-centres on each
 * arrival, so whatever is on screen stays centred and no logo lands on another.
 * Skip / Esc jump to the finished frame; Begin ends it and starts the
 * walkthrough with sound (Begin is the click browsers need before audio).
 * ?skipintro bypasses it; ?nowalk makes Begin go straight to the practice.
 */
(function () {
  'use strict';
  const intro = document.getElementById('intro');
  if (!intro) return;
  const row = intro.querySelector('.intro-logos');
  const logos = Array.from(intro.querySelectorAll('.intro-logo'));
  const beginBtn = intro.querySelector('.intro-begin');
  const skipBtn = intro.querySelector('.intro-skip');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);
  const timers = [];
  let finished = false;
  let shownCount = 1;
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  /** Slide the row so the logos revealed so far sit centred. Layout positions only:
   *  getBoundingClientRect would include the entry scale. The row is the logos'
   *  offsetParent (it is position: relative), so offsetLeft is in row space. */
  function centreOn(count) {
    const shown = logos.slice(0, Math.max(count, 1));
    const first = shown[0], last = shown[shown.length - 1];
    const mid = (first.offsetLeft + last.offsetLeft + last.offsetWidth) / 2;
    row.style.setProperty('--shift', `${row.offsetWidth / 2 - mid}px`);
  }

  function showBegin() {
    if (finished) return;
    timers.forEach(clearTimeout);
    logos.forEach(el => el.classList.add('in', 'set'));
    shownCount = logos.length;
    centreOn(logos.length);
    intro.classList.add('st-line', 'st-title', 'st-begin');
    beginBtn.focus({ preventScroll: true });
  }

  function finish(openWalkthrough) {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    document.body.removeAttribute('data-overlay');
    intro.classList.add('out');
    intro.setAttribute('aria-hidden', 'true');
    setTimeout(() => intro.classList.add('gone'), reduced ? 0 : 700);
    if (openWalkthrough && window.Walkthrough && !params.has('nowalk')) window.Walkthrough.open({ auto: true });
    else { const n = document.getElementById('btn-new'); if (n) n.focus({ preventScroll: true }); }
  }

  beginBtn.addEventListener('click', () => finish(true));
  skipBtn.addEventListener('click', showBegin);
  document.addEventListener('keydown', e => {
    if (finished || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    showBegin();
  }, true);
  window.addEventListener('resize', () => { if (!finished) centreOn(shownCount); });

  window.Opener = { skip: () => finish(false) };

  if (params.has('skipintro')) { finished = true; intro.classList.add('gone'); intro.setAttribute('aria-hidden', 'true'); return; }
  document.body.setAttribute('data-overlay', 'intro');
  if (reduced) { showBegin(); return; }

  function play() {
    if (finished) return;
    centreOn(1);
    const ENTER = 350, GAP = 1000, HOLD = 700;
    logos.forEach((el, i) => {
      at(ENTER + i * GAP, () => { shownCount = i + 1; centreOn(shownCount); el.classList.add('in'); });
      at(ENTER + i * GAP + HOLD, () => el.classList.add('set'));
    });
    const settled = ENTER + (logos.length - 1) * GAP + HOLD;
    at(settled + 500, () => intro.classList.add('st-line'));
    at(settled + 750, () => intro.classList.add('st-title'));
    at(settled + 1400, () => { intro.classList.add('st-begin'); beginBtn.focus({ preventScroll: true }); });
  }

  // The logos must be laid out before the centre offsets mean anything.
  const imgs = Array.from(intro.querySelectorAll('.intro-logo img'));
  Promise.all(imgs.map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; }))))
    .then(() => requestAnimationFrame(play));
})();
