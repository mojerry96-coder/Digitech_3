// record.mjs — record the real Drive practice build as timed screenshots plus a cursor timeline.
// Drives the Google Chrome already installed on this Mac in headless mode over the DevTools
// protocol (Node 22 has WebSocket built in), so nothing extra needs installing.
// Output (in this folder): shots/*.png and timeline.json, read by schedule.py and compose.py.
//
// Run from anywhere:  node video/record.mjs
// Each narrated section waits until the previous narration line has finished, using the
// durations of narration/s1.wav … s14.wav, so the actions and the voice stay in step.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?skipintro';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9339;
const SHOTS = path.join(HERE, 'shots');
const S = 4 / 3;                       // CSS px -> video px (1440x810 -> 1920x1080)
const GAP = 0.25;                      // silence between narration lines

const dur = i => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
  path.join(HERE, 'narration', `s${i}.wav`)]).toString());
const DUR = Array.from({ length: 14 }, (_, i) => dur(i + 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Chrome + CDP ---------- */
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-rec-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--allow-file-access-from-files',
  '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) { chrome.kill(); throw new Error('Chrome did not start'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let msgId = 0;
const pending = new Map(), waiters = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method) waiters.filter(w => w.method === m.method).forEach(w => { waiters.splice(waiters.indexOf(w), 1); w.res(m.params); });
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const once = method => new Promise(res => waiters.push({ method, res }));
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: S, mobile: false });
const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url: PAGE });
await loaded;
await ev('document.fonts.ready.then(() => true)');
await sleep(1200);
// Steady caret, no snackbar slide (it would smear between frames)
await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{caret-color:#1f1f1f} .snack{animation:none}'; document.head.appendChild(s); return true; })()`);

/* ---------- Recorder (real clock: t is seconds since the first frame) ---------- */
let T0 = 0, n = 0;
const now = () => (Date.now() - T0) / 1000;
const images = [], keys = [], clicks = [], marks = {};
let cur = [1500, 700];

async function shot() {
  const t = now();
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, String(++n).padStart(4, '0') + '.png');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  images.push([+t.toFixed(3), file]);
}
/** Keep filming for d seconds (captures animations, snackbars, uploads). */
async function hold(d) { const end = now() + d; do { await shot(); await sleep(60); } while (now() < end); }
async function untilT(t) { if (now() < t) await hold(t - now()); }

async function center(sel) {
  for (let i = 0; i < 40; i++) {
    const c = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      const r = e.getBoundingClientRect(); if (!r.width) return null; return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    if (c) return c;
    await sleep(100);
  }
  throw new Error('not found: ' + sel);
}
/** Tag the first element matching sel whose text includes `text`, and return a selector for it. */
let tagN = 0;
async function byText(sel, text) {
  const id = 'r' + (++tagN);
  for (let i = 0; i < 40; i++) {
    const ok = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)}) && x.getBoundingClientRect().width);
      if (!e) return false; e.dataset.rec = ${JSON.stringify(id)}; return true; })()`);
    if (ok) return `[data-rec="${id}"]`;
    await sleep(100);
  }
  throw new Error(`not found: ${sel} "${text}"`);
}
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'none' }, extra));

async function move(target, d = 0.8, { dx = 0, dy = 0 } = {}) {
  let [x, y] = typeof target === 'string' ? await center(target) : target;
  x += dx; y += dy;
  keys.push([now(), ...cur]);
  await hold(d * 0.85);
  cur = [x * S, y * S];
  keys.push([now(), ...cur]);
  await mouse('mouseMoved', x, y);
  await sleep(120);
  await shot();
}
async function click({ button = 'left', count = 1, settle = 0.45 } = {}) {
  const [x, y] = [cur[0] / S, cur[1] / S];
  clicks.push([now(), ...cur]);
  for (let c = 1; c <= count; c++) {
    await mouse('mousePressed', x, y, { button, clickCount: c, buttons: button === 'left' ? 1 : 2 });
    await mouse('mouseReleased', x, y, { button, clickCount: c });
  }
  await hold(settle);
}
async function type(text, d) {
  const step = d / text.length;
  for (let i = 0; i < text.length; i += 2) {
    await send('Input.insertText', { text: text.slice(i, i + 2) });
    await shot();
    const lag = step * 2 * 1000 - 60;
    if (lag > 0) await sleep(lag);
  }
}
async function key(k, code, vk) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k === 'Enter' ? '\r' : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

/* Narration bookkeeping: line i may start at its mark, never before the previous line ends. */
let lineEnd = 0;
async function section(name, i) {
  await untilT(lineEnd + GAP);
  marks[name] = +now().toFixed(2);
  lineEnd = now() + DUR[i - 1];
}
function follow(i) { lineEnd = lineEnd + GAP + DUR[i - 1]; }

/* Drag helpers: a visible pill follows the cursor while DragEvents are dispatched in the page. */
await ev(`(() => {
  window.__rec = {};
  const g = document.createElement('div'); g.id = 'rec-ghost'; g.className = 'drag-ghost';
  g.style.cssText = 'top:-1000px;left:0;z-index:5000;pointer-events:none;'; document.body.appendChild(g);
  window.__recGhost = (html, x, y) => { g.innerHTML = html; g.style.top = (y + 14) + 'px'; g.style.left = (x + 14) + 'px'; };
  window.__recGhostOff = () => { g.style.top = '-1000px'; };
  window.__recFire = (type, x, y, dt) => { const el = document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y })); };
  return true; })()`);
async function dragPath(from, to, d, onStep) {
  const steps = Math.max(8, Math.round(d / 0.09));
  for (let s = 1; s <= steps; s++) {
    const u = s / steps, e = u * u * (3 - 2 * u);
    const x = from[0] + (to[0] - from[0]) * e, y = from[1] + (to[1] - from[1]) * e;
    cur = [x * S, y * S];
    keys.push([now(), ...cur]);
    await mouse('mouseMoved', x, y);
    await onStep(x, y);
    await shot();
  }
}

/* ================== The walkthrough ================== */
T0 = Date.now();
keys.push([0, ...cur]);
await shot();

// 1–2 · Welcome, on the empty Home page
await section('welcome', 1);
await hold(0.6);
follow(2);
await move('[data-nav="my-drive"]', 1.4, { dx: -60 });
await click({ settle: 1.0 });

// 3 · New › New folder
await section('newfolder', 3);
await move('#btn-new', 0.9);
await click({ settle: 0.5 });
await move(await byText('.menu .mi', 'New folder'), 0.6);
await click({ settle: 0.5 });
await type('Lesson plans', 1.3);
await move('.dialog .btn-filled', 0.7);
await click({ settle: 1.0 });

// 4 · Drag files in from the computer
await section('upload', 4);
await ev(`(async () => {
  const cv = document.createElement('canvas'); cv.width = 800; cv.height = 520; const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 520); sky.addColorStop(0, '#8ec5ff'); sky.addColorStop(1, '#dff1ff'); g.fillStyle = sky; g.fillRect(0, 0, 800, 520);
  g.fillStyle = '#fdd663'; g.beginPath(); g.arc(640, 110, 56, 0, 7); g.fill();
  g.fillStyle = '#5bb974'; g.beginPath(); g.moveTo(0, 520); g.lineTo(0, 330); g.quadraticCurveTo(220, 250, 420, 340); g.quadraticCurveTo(620, 420, 800, 320); g.lineTo(800, 520); g.fill();
  g.fillStyle = '#0b57d0'; g.fillRect(300, 300, 200, 130); g.fillStyle = '#fff'; g.fillRect(330, 340, 50, 90); g.fillRect(420, 330, 50, 40);
  const img = await new Promise(r => cv.toBlob(r, 'image/png'));
  const pdf = '%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 60>>stream\\nBT /F1 28 Tf 72 700 Td (Course outline: EDU 101) Tj ET\\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';
  const dt = new DataTransfer();
  dt.items.add(new File([img], 'Class photo.png', { type: 'image/png' }));
  dt.items.add(new File([pdf + ' '.repeat(180000)], 'Course outline.pdf', { type: 'application/pdf' }));
  dt.items.add(new File(['Week 1 notes\\n\\n- Welcome and introductions\\n- Course outline\\n- Reading for next week'], 'Week 1 notes.txt', { type: 'text/plain' }));
  window.__rec.files = dt; return true; })()`);
const fileIcons = `<span style="display:inline-flex;gap:3px">${['image', 'pdf', 'text'].map(t => `<img src="assets/icons/type/${t}.png" width="18" height="18" alt="">`).join('')}</span><span>3 files</span>`;
await hold(0.3);
await dragPath([1430, 560], [760, 470], 1.6, async (x, y) => {
  await ev(`(__recGhost(${JSON.stringify(fileIcons)}, ${x}, ${y}), (${x} < 1380 ? __recFire('dragover', ${x}, ${y}, __rec.files) : 0), true)`);
});
await hold(0.4);
await ev(`(__recFire('dragover', ${cur[0] / S}, ${cur[1] / S}, __rec.files), __recGhostOff(), __recFire('drop', ${cur[0] / S}, ${cur[1] / S}, __rec.files), true)`);
clicks.push([now(), ...cur]);
await hold(3.4);
await move('#upload-tray [aria-label="Close"]', 0.8);
await click({ settle: 0.4 });

// 5 · Drag a file onto a folder, then Undo
await section('move', 5);
const notes = await center(await byText('#content .row', 'Week 1 notes.txt'));
const folder = await center(await byText('#content .row', 'Lesson plans'));
await move([notes[0] - 260, notes[1]], 0.9);
await ev(`(() => { const r = [...document.querySelectorAll('#content .row')].find(x => x.textContent.includes('Week 1 notes.txt'));
  window.__rec.idt = new DataTransfer(); r.dispatchEvent(new DragEvent('dragstart', { dataTransfer: __rec.idt, bubbles: true })); return true; })()`);
const notesGhost = `<img src="assets/icons/type/text.png" width="20" height="20" alt="">Week 1 notes.txt`;
await dragPath(cur.map(v => v / S), [folder[0] - 300, folder[1]], 1.2, async (x, y) => {
  await ev(`(__recGhost(${JSON.stringify(notesGhost)}, ${x}, ${y}), __recFire('dragover', ${x}, ${y}, __rec.idt), true)`);
});
await hold(0.5);
await ev(`(__recGhostOff(), __recFire('drop', ${cur[0] / S}, ${cur[1] / S}, __rec.idt), document.dispatchEvent(new DragEvent('dragend')), true)`);
clicks.push([now(), ...cur]);
await hold(1.4);
await move('.snack .act', 1.0);
await click({ settle: 1.2 });

// 6 · Open the folder; the path shows where you are
await section('open', 6);
await move(await byText('#content .row .nm', 'Lesson plans'), 0.9);
await click({ count: 2, settle: 1.4 });
await move('.crumbs .crumb:not(.last)', 1.0);
await hold(1.0);
await click({ settle: 1.0 });

// 7 · Right-click for more
await section('context', 7);
const photo = await center(await byText('#content .row .nm', 'Class photo.png'));
await move(photo, 0.9);
await click({ button: 'right', settle: 0.8 });
await move(await byText('.menu .mi', 'Organise'), 0.7);
await hold(1.2);
await move(await byText('.menu .mi', 'Share'), 0.7);
await hold(0.6);

// 8 · Share: add an email, choose a role, send
await section('share', 8);
await ev(`(() => { const all = [...document.querySelectorAll('.menu')]; const sub = all[all.length - 1]; const b = [...sub.querySelectorAll('.mi')].find(x => x.textContent.includes('Share')); b.dataset.rec = 'sharego'; return true; })()`);
await move('[data-rec="sharego"]', 0.5);
await click({ settle: 0.8 });
await type('tunde@example.com', 1.6);
await key('Enter', 'Enter', 13);
await hold(0.6);
await move('.share-field .role-btn', 0.8);
await hold(0.8);
await move('.dialog .btn-filled', 0.8);
await click({ settle: 1.6 });

// 9 · New › Google Docs › Blank document, the practice editor
await section('doc', 9);
await move('#btn-new', 0.9);
await click({ settle: 0.4 });
await move(await byText('.menu .mi', 'Google Docs'), 0.7);
await hold(0.4);
await move(await byText('.menu .mi', 'Blank document'), 0.6);
await click({ settle: 1.0 });
await move('.doc-page', 0.7, { dy: -380 });
await click({ settle: 0.2 });
await type('Ideas for week one: a welcome activity and a short reading.', 2.6);
await hold(0.6);
await move('.editor [aria-label="Close editor"]', 0.9);
await click({ settle: 0.8 });

// 10 · Search, then filter by type
await section('search', 10);
await move('#search-input', 1.0);
await click({ settle: 0.4 });
await type('class', 0.8);
await hold(0.8);
await key('Enter', 'Enter', 13);
await hold(0.8);
await move('[data-chip="type"]', 0.8);
await click({ settle: 0.5 });
await move(await byText('.menu .mi', 'Photos & images'), 0.7);
await click({ settle: 1.0 });

// 11 · Trash, then restore
await section('trash', 11);
await move('[data-nav="my-drive"]', 1.0, { dx: -60 });
await click({ settle: 0.8 });
await move(await byText('#content .row .nm', 'Week 1 notes.txt'), 0.8);
await click({ settle: 0.5 });
await move('.selbar [aria-label="Move to trash"]', 0.8);
await click({ settle: 0.9 });
await move('[data-nav="trash"]', 1.0, { dx: -60 });
await click({ settle: 0.8 });
await move(await byText('#content .row .nm', 'Week 1 notes.txt'), 0.8);
await click({ button: 'right', settle: 0.6 });
await move(await byText('.menu .mi', 'Restore'), 0.6);
await click({ settle: 1.0 });

// 12–13 · Practice tasks, and starting again
await section('guide', 12);
await move('#guide .g-head', 1.0);
await click({ settle: 1.6 });
follow(13);
await move(await byText('#guide .g-foot button', 'Start over'), 1.4);
await hold(1.0);

// 14 · End card (drawn in the page with the same fonts; the player lays a real button over its Begin Practice)
await untilT(lineEnd + 0.6);
marks.endcard = +now().toFixed(2);
await ev(`(() => { const d = document.createElement('div'); d.id = 'endcard';
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:radial-gradient(ellipse at 50% 40%,#0C3F66 0%,#09314F 52%,#06243C 100%);color:#fff;font-family:"Google Sans",Roboto,sans-serif;overflow:hidden';
  d.innerHTML = '<div style="position:absolute;inset:0;background:url(assets/logos/chevrons.svg) right -14% center / min(980px,105vh) no-repeat;opacity:.55"></div>'
    + '<img src="assets/brand/miva-logo-white.png" alt="" style="position:absolute;left:50%;top:208px;height:58px;transform:translateX(-50%)">'
    + '<div style="position:absolute;left:0;right:0;top:300px;text-align:center;font:600 64px/1 Afacad,\\'Google Sans\\';letter-spacing:-.02em;text-transform:uppercase">Your <span style="color:#EE9B01">turn</span></div>'
    + '<div style="position:absolute;left:50%;top:463px;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:10px;background:#EE9B01;color:#472E00;border-radius:999px;padding:0 30px;height:56px;font:700 19px \\'Google Sans\\';white-space:nowrap">Begin Practice &nbsp;&#8594;</div>'
    + '<div style="position:absolute;left:0;right:0;top:530px;text-align:center;font:700 14px \\'Google Sans\\';letter-spacing:.14em;text-transform:uppercase;color:rgba(214,228,250,.72)">The Drive Practice · DT01</div>';
  document.body.appendChild(d); return true; })()`);
await sleep(300);
const endcardT = +now().toFixed(2);
await shot();
const end = +(Math.max(endcardT, lineEnd) + 3.4).toFixed(2);

fs.writeFileSync(path.join(HERE, 'timeline.json'), JSON.stringify({ images, keys, clicks, marks, endcard_t: endcardT, end }));
console.log(`shots ${n}, last t ${now().toFixed(2)}, end ${end}`);
console.log('marks', JSON.stringify(marks));
ws.close();
await new Promise(r => { chrome.once('exit', r); chrome.kill(); });
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temp profile; the OS clears it */ }
