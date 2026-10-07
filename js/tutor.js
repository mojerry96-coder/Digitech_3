/* tutor.js — optional "Practice tasks" checklist. It only listens to app events on
 * window.Bus, so it can be removed (or switched off with ?guide=off) without
 * touching the clone itself.
 */
(function () {
  'use strict';
  const C = window.CONFIG;
  const params = new URLSearchParams(location.search);
  if (params.get('guide') === 'off' || C.showPracticeGuide === false) { window.Tutor = null; return; }
  const { h, icon } = UI;

  // To add a task, add one line. `target` is what the "Show me" button pulses.
  const TASKS = [
    { id: 'folder', ev: 'folder:create', name: 'Create a folder', hint: 'Click New, then New folder.', target: '#btn-new' },
    { id: 'upload', ev: 'file:upload', name: 'Upload a file', hint: 'Click New › File upload, or drag a file from your computer onto the page.', target: '#btn-new' },
    { id: 'doc', ev: 'doc:create', name: 'Create a Google Doc', hint: 'Click New › Google Docs › Blank document.', target: '#btn-new' },
    { id: 'open', ev: 'folder:open', name: 'Open a folder', hint: 'Double-click a folder to go inside it.', target: '#content' },
    { id: 'rename', ev: 'item:rename', name: 'Rename a file or folder', hint: 'Right-click an item and choose Rename (or select it and press N).', target: '#content' },
    { id: 'move', ev: 'item:move', name: 'Move a file into a folder', hint: 'Drag a file onto a folder, or right-click › Organise › Move.', target: '#content' },
    { id: 'star', ev: 'item:star', name: 'Star an item', hint: 'Hover over a row and click the star, or select it and press S.', target: '#content' },
    { id: 'share', ev: 'item:share', name: 'Share an item', hint: 'Right-click › Share › Share, type an email address and click Send. No email is sent.', target: '#content' },
    { id: 'grid', ev: 'view:grid', name: 'Switch to grid layout', hint: 'Use the list/grid buttons at the top right, or press V.', target: '#layout-toggle' },
    { id: 'details', ev: 'details:open', name: 'View file details', hint: 'Select an item and click the ⓘ button (or press D).', target: '#btn-details' },
    { id: 'search', ev: 'search:run', name: 'Search your Drive', hint: 'Type in the search box at the top and press Enter.', target: '#search-form' },
    { id: 'trash', ev: 'item:trash', name: 'Move something to trash', hint: 'Select an item and press Delete, or right-click › Move to trash.', target: '#content' },
    { id: 'restore', ev: 'item:restore', name: 'Restore an item from trash', hint: 'Open Trash in the left menu, right-click an item and choose Restore.', target: '[data-nav="trash"]' }
  ];

  const done = new Set();
  let open = window.innerWidth > 900;
  let userOpened = false;   // once the learner opens the panel themselves, leave it open
  let expanded = null;
  let celebrated = false;
  const el = h('section', { class: 'guide', id: 'guide', 'aria-label': 'Practice tasks' });
  document.body.appendChild(el);

  function nextTask() { return TASKS.find(t => !done.has(t.id)) || null; }

  function draw(flashId) {
    el.textContent = '';
    el.classList.toggle('min', !open);
    const n = done.size, total = TASKS.length;
    el.appendChild(h('button', {
      type: 'button', class: 'g-head', 'aria-expanded': String(open),
      onclick: () => { open = !open; if (open) userOpened = true; draw(); }
    }, icon('school'), h('span', { class: 'g-title' }, 'Practice tasks'), h('span', { class: 'g-count', 'aria-live': 'polite' }, `${n} of ${total}`), icon(open ? 'expand_more' : 'expand_less')));
    if (!open) return;
    el.appendChild(h('div', { class: 'g-prog' },
      h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Practice progress', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(n) },
        h('i', { style: { width: (n / total * 100) + '%' } })),
      h('div', { class: 'g-note' }, `${n} of ${total} tried · this is progress, not a score`)));
    const focusId = expanded || (nextTask() || {}).id;
    const ul = h('ul', { class: 'g-list' });
    TASKS.forEach(t => {
      const ok = done.has(t.id);
      const showHint = !ok && t.id === focusId;
      const li = h('li', { class: 'g-task' + (ok ? ' done' : '') + (flashId === t.id ? ' g-flash' : '') },
        icon(ok ? 'check_circle' : 'radio_button_unchecked', ok ? 'fill' : ''),
        h('div', { class: 'g-txt' }, h('div', { class: 'g-name' }, t.name), showHint ? h('div', { class: 'g-hint' }, t.hint) : null),
        ok ? null : h('button', { type: 'button', class: 'btn-text sm', onclick: e => { e.stopPropagation(); showMe(t); } }, 'Show me'));
      li.addEventListener('click', () => { if (!ok) { expanded = t.id; draw(); } });
      ul.appendChild(li);
    });
    el.appendChild(ul);
    el.appendChild(h('div', { class: 'g-foot' },
      h('button', { type: 'button', class: 'btn-text sm', onclick: () => window.Walkthrough && window.Walkthrough.open() }, icon('smart_display'), 'Walkthrough'),
      h('button', { type: 'button', class: 'btn-text sm', onclick: startOver }, icon('restart_alt'), 'Start over')));
  }

  function showMe(t) {
    expanded = t.id;
    draw();
    const target = document.querySelector(t.target);
    if (target && target.closest('.sidebar') && window.innerWidth <= 900) document.body.classList.add('drawer-open');
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
      target.classList.remove('tutor-pulse');
      void target.offsetWidth;
      target.classList.add('tutor-pulse');
      setTimeout(() => target.classList.remove('tutor-pulse'), 3200);
    }
    UI.snack(t.hint, { duration: 8000 });
  }

  async function startOver() {
    const ok = await UI.confirm({
      title: 'Start over?', ok: 'Start over',
      text: 'This clears everything you have done and gives you a brand-new, empty practice account.'
    });
    if (ok) location.replace(location.pathname + location.search);
  }

  function complete() {
    UI.dialog({
      title: 'You tried every practice task',
      body: [`Nice work. You've practised all ${TASKS.length} core Drive actions.`, 'Keep practising here, or start over with a fresh, empty account.'],
      width: 460,
      actions: [
        { label: 'Start over', onClick: () => { location.replace(location.pathname + location.search); } },
        { label: 'Keep practising', primary: true }
      ]
    });
  }

  Bus.on('*', ev => {
    const hit = TASKS.find(t => t.ev === ev && !done.has(t.id));
    if (!hit) return;
    done.add(hit.id);
    if (expanded === hit.id) expanded = null;
    // Get out of the way once the learner is working, but keep the count visible.
    if (!userOpened) open = false;
    draw(hit.id);
    if (!open) { el.classList.remove('g-flash'); void el.offsetWidth; el.classList.add('g-flash'); }
    if (done.size === TASKS.length && !celebrated) { celebrated = true; setTimeout(complete, 700); }
  });

  draw();

  window.Tutor = {
    TASKS,
    done,
    open() {
      open = true;
      userOpened = true;
      draw();
      el.classList.remove('tutor-pulse');
      void el.offsetWidth;
      el.classList.add('tutor-pulse');
      setTimeout(() => el.classList.remove('tutor-pulse'), 3200);
    }
  };
})();
