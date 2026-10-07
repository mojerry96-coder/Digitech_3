/* walkthrough.js — the walkthrough player. It plays the recorded, narrated demo
 * (walkthrough/drive-walkthrough-1080p.*) and never touches the learner's Drive.
 * Opened by the opener's Begin (plays with sound, because Begin is a click) or
 * later from Support › Watch walkthrough (waits for Play).
 */
(function () {
  'use strict';
  const BASE = 'walkthrough/drive-walkthrough-1080p';
  const END_CARD = 3.2;   // seconds of end card at the close of the video
  let el = null, prevFocus = null;

  const isOpen = () => !!el;

  function close() {
    if (!el) return;
    const v = el.querySelector('video');
    if (v) v.pause();
    const node = el;
    el = null;
    document.body.removeAttribute('data-overlay');
    node.classList.remove('in');
    setTimeout(() => node.remove(), 300);
    const visible = prevFocus && document.contains(prevFocus) && prevFocus.offsetParent !== null && !prevFocus.closest('.intro');
    const back = visible ? prevFocus : document.getElementById('btn-new');
    if (back) back.focus({ preventScroll: true });
    if (window.Bus) Bus.emit('walkthrough:close', {});
  }

  function open(opts) {
    opts = opts || {};
    if (el) return;
    prevFocus = document.activeElement;
    document.body.setAttribute('data-overlay', 'walkthrough');
    el = document.createElement('div');
    el.className = 'wt';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'How the Drive practice works');
    el.innerHTML = `
      <div class="wt-card">
        <div class="wt-top">
          <img src="assets/brand/miva-logo-white.png" alt="MIVA Open University">
          <span class="wt-title">How the Drive practice works</span>
          <button type="button" class="wt-btn" data-k="skip">Skip to practice <span class="ms" aria-hidden="true">skip_next</span></button>
        </div>
        <div class="wt-frame">
          <video controls playsinline preload="auto" aria-label="Walkthrough video with narration and captions">
            <source src="${BASE}.mp4" type="video/mp4">
            <source src="${BASE}.webm" type="video/webm">
          </video>
          <button type="button" class="amber-cta wt-go" data-k="go" hidden>Begin Practice <span class="ms" aria-hidden="true">arrow_forward</span></button>
          <button type="button" class="wt-btn wt-unmute" data-k="unmute" hidden><span class="ms" aria-hidden="true">volume_up</span>Turn on sound</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el && el.classList.add('in'));

    const v = el.querySelector('video');
    const go = el.querySelector('[data-k="go"]');
    const unmute = el.querySelector('[data-k="unmute"]');
    el.querySelector('[data-k="skip"]').addEventListener('click', close);
    go.addEventListener('click', close);
    unmute.addEventListener('click', () => { v.muted = false; unmute.hidden = true; v.play().catch(() => {}); });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = Array.from(el.querySelectorAll('button:not([hidden]), video'));
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });

    // Captions are available but off by default (the CC control turns them on). Cues come from walkthrough/captions.js rather than a <track> file,
    // because Chrome will not load a .vtt over file:// (double-clicking index.html).
    const cues = window.WALKTHROUGH_CUES || [];
    if (cues.length && window.VTTCue) {
      const tt = v.addTextTrack('captions', 'English', 'en');
      cues.forEach(c => tt.addCue(new VTTCue(c.s, c.e, c.t)));
      tt.mode = 'hidden';
    }
    v.addEventListener('timeupdate', () => {
      if (v.duration && v.currentTime >= v.duration - END_CARD + 0.3) go.hidden = false;
    });
    v.addEventListener('ended', () => { go.hidden = false; go.focus({ preventScroll: true }); });
    v.addEventListener('seeking', () => { if (v.duration && v.currentTime < v.duration - END_CARD) go.hidden = true; });
    v.addEventListener('error', () => { if (v.error) missing(); });
    const lastSource = el.querySelectorAll('source')[1];
    lastSource.addEventListener('error', missing);

    function missing() {
      const frame = el && el.querySelector('.wt-frame');
      if (!frame || frame.querySelector('.wt-missing')) return;
      v.remove();
      const box = document.createElement('div');
      box.className = 'wt-missing';
      box.innerHTML = '<div><p>The walkthrough video isn\'t available in this copy. You can go straight to the practice.</p><button type="button" class="amber-cta">Begin Practice</button></div>';
      box.querySelector('button').addEventListener('click', close);
      frame.appendChild(box);
      box.querySelector('button').focus();
    }

    if (opts.auto) {
      v.play().catch(() => {
        // Sound blocked: play muted with captions and offer sound
        v.muted = true;
        unmute.hidden = false;
        v.play().catch(() => {});
      });
      el.querySelector('[data-k="skip"]').focus({ preventScroll: true });
    } else {
      v.focus({ preventScroll: true });
    }
  }

  window.Walkthrough = { open, close, isOpen };
})();
