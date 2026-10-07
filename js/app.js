/* app.js — routing, rendering of every view, interactions, uploads, drag-drop,
 * search, details panel, simulated editors and keyboard shortcuts.
 */
(function () {
  'use strict';
  const C = window.CONFIG, S = Store.S, { h, icon, iconBtn } = UI;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const get = Store.get;

  const NATIVE = ['doc', 'sheet', 'slide', 'form'];
  const NATIVE_NAME = { doc: 'Untitled document', sheet: 'Untitled spreadsheet', slide: 'Untitled presentation', form: 'Untitled form' };
  const BLANK = { doc: 'Blank document', sheet: 'Blank spreadsheet', slide: 'Blank presentation', form: 'Blank form' };
  const APP_NAME = { doc: 'Google Docs', sheet: 'Google Sheets', slide: 'Google Slides', form: 'Google Forms' };
  const PRODUCT = { doc: 'docs', sheet: 'sheets', slide: 'slides', form: 'forms' };
  const ROLE_LABEL = { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor' };
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  /** Friendly "not in this simulation" message. */
  const NA = (what, plural) => UI.snack(`${what} ${plural ? "aren't" : "isn't"} available in this practice simulation`);

  /* ---------- Item helpers ---------- */
  const isFolder = it => !!it && it.type === 'folder';
  const isNative = it => NATIVE.includes(it.type);
  const isShared = it => it.access.length > 0 || it.general === 'anyone';
  const realOf = it => (it && it.shortcutOf ? get(it.shortcutOf) : it);
  const lastTouch = it => Math.max(it.modified || 0, it.opened || 0);
  const byTouch = (a, b) => lastTouch(b) - lastTouch(a);
  const itemIcon = (it, size) => Icons.svg(it.type, { size: size || 20, color: it.color, shared: isFolder(it) && isShared(it), shortcut: !!it.shortcutOf });
  const sizeText = it => (isFolder(it) || it.shortcutOf || isNative(it)) ? '—' : Store.fmtSize(it.size);
  const folderHash = id => id === 'root' ? 'my-drive' : id === 'shared' ? 'shared-with-me' : 'folders/' + id;
  function locationName(it) {
    if (it.trashed) return 'Trash';
    if (it.parent === 'root') return 'My Drive';
    if (it.parent === 'shared') return 'Shared with me';
    const p = get(it.parent);
    return p ? p.name : 'My Drive';
  }
  const locIcon = it => it.trashed ? 'delete' : it.parent === 'root' ? 'hard_drive' : it.parent === 'shared' ? 'group' : 'folder';
  function inMyDrive(it) { const a = Store.ancestors(it.id); return a.length > 0 && a[0].id === 'root'; }
  function topTrashed(it) {
    let top = it;
    for (let p = it, g = 0; p && g < 100; g++) { if (p.trashed) top = p; p = get(p.parent); }
    return top;
  }
  function colorFor(s) {
    const P = ['#1e8e3e', '#d93025', '#e37400', '#9334e6', '#0b57d0', '#007b83', '#c5221f', '#b06000'];
    let n = 0;
    for (const ch of String(s)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return P[n % P.length];
  }
  function avatarMini(who, size) {
    size = size || 24;
    const me = !who || who === 'me' || who === C.user.email;
    const label = me ? C.user.name + ' (you)' : who;
    return h('span', {
      class: 'av', 'data-tip': label, 'aria-label': label,
      style: { width: size + 'px', height: size + 'px', background: me ? C.user.color : colorFor(who), fontSize: Math.round(size * 0.45) + 'px' }
    }, me ? C.user.initial : (String(who).trim()[0] || '?').toUpperCase());
  }
  function reasonText(it) {
    const d = Store.fmtDate;
    if (it.owner !== 'me') return `${it.owner} shared • ${d(it.created)}`;
    if (it.opened && it.opened >= it.modified) return 'You opened • ' + d(it.opened);
    if (it.modified > it.created + 1000) return 'You modified • ' + d(it.modified);
    return (it.uploaded ? 'You uploaded • ' : 'You created • ') + d(it.created);
  }
  function contentText(it) {
    if (it.textContent) return it.textContent;
    const c = it.content;
    if (!c) return '';
    if (it.type === 'doc') return c.text || '';
    if (it.type === 'sheet') return Object.values(c.cells || {}).join(' ');
    if (it.type === 'slide') return (c.slides || []).map(s => s.title + ' ' + s.body).join(' ');
    if (it.type === 'form') return [c.title, c.desc].concat((c.questions || []).map(q => q.q + ' ' + q.options.join(' '))).join(' ');
    return '';
  }
  function defaultContent(type) {
    if (type === 'doc') return { html: '', text: '' };
    if (type === 'sheet') return { cells: {} };
    if (type === 'slide') return { slides: [{ title: '', body: '' }] };
    return { title: 'Untitled form', desc: '', questions: [{ q: 'Untitled Question', options: ['Option 1'] }] };
  }

  /* ---------- Routing ---------- */
  const VIEWS = ['home', 'my-drive', 'computers', 'shared-with-me', 'recent', 'starred', 'spam', 'trash', 'quota'];
  const TITLES = {
    home: 'Welcome to Drive', 'my-drive': 'My Drive', computers: 'Computers', 'shared-with-me': 'Shared with me',
    recent: 'Recent', starred: 'Starred', spam: 'Spam', trash: 'Trash', quota: 'Storage', search: 'Search results'
  };
  let lastRouteKey = '', pendingSelect = null, pendingOpen = null;

  function go(hash) {
    if (location.hash === '#' + hash) parseHash();
    else location.hash = hash;
  }
  function runSearch(q) { lastRouteKey = ''; go('search?q=' + encodeURIComponent(q)); }

  function parseHash() {
    let hs = location.hash.replace(/^#/, '');
    if (!hs) hs = S.startPage;
    if (hs.startsWith('file/')) {
      const it = get(hs.slice(5));
      if (it && Store.alive(it)) {
        pendingSelect = it.id; pendingOpen = it.id;
        history.replaceState(null, '', '#' + folderHash(it.parent));
        hs = folderHash(it.parent);
      } else { history.replaceState(null, '', '#my-drive'); hs = 'my-drive'; UI.snack('That file is no longer available'); }
    }
    if (hs.startsWith('search')) {
      S.view = 'search';
      S.query = new URLSearchParams(hs.split('?')[1] || '').get('q') || '';
    } else if (hs.startsWith('folders/')) {
      const f = get(hs.slice(8));
      if (!f || !isFolder(f) || !Store.alive(f)) {
        history.replaceState(null, '', '#my-drive');
        S.view = 'my-drive'; S.folderId = 'root';
        UI.snack(f ? 'That folder is in the trash' : "That folder doesn't exist any more");
      } else { S.view = 'folders'; S.folderId = f.id; }
    } else {
      S.view = VIEWS.includes(hs) ? hs : 'home';
      if (S.view === 'my-drive') S.folderId = 'root';
    }
    const key = [S.view, S.view === 'folders' ? S.folderId : '', S.view === 'search' ? S.query : ''].join('|');
    if (key !== lastRouteKey) {
      lastRouteKey = key;
      S.selection.clear(); S.anchor = null; S.focusId = null;
      if (S.view !== 'search') { S.filters = Store.emptyFilters(); S.adv = null; }
      $('#content').scrollTop = 0;
      closeDrawer();
      if (S.view === 'folders') {
        Store.touchOpened(S.folderId);
        Bus.emit('folder:open', { id: S.folderId, name: get(S.folderId).name });
      }
      if (S.view === 'search') Bus.emit('search:run', { query: S.query, filters: Object.assign({}, S.filters), adv: S.adv });
    }
    if (pendingSelect && get(pendingSelect)) {
      S.selection = new Set([pendingSelect]); S.anchor = S.focusId = pendingSelect;
      if (S.view !== 'search') S.filters = Store.emptyFilters();
    }
    const si = $('#search-input');
    if (S.view === 'search') si.value = S.query; else if (document.activeElement !== si) si.value = '';
    $('#search-clear').hidden = !si.value;
    render();
    if (pendingSelect) { scrollToItem(pendingSelect); pendingSelect = null; }
    if (pendingOpen) { const it = get(pendingOpen); pendingOpen = null; if (it) openItem(it); }
  }

  /* ---------- Render ---------- */
  function render() {
    document.body.classList.toggle('compact', S.density === 'compact');
    document.body.classList.toggle('details-open', S.detailsOpen);
    renderNav();
    renderStorage();
    renderTitle();
    renderToolbar();
    renderContent();
    renderDetails();
    Bus.emit('render', { view: S.view, folderId: S.folderId });
  }

  /* ----- Sidebar ----- */
  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'my-drive', label: 'My Drive', icon: 'hard_drive', tree: true, drop: 'root' },
    { id: 'computers', label: 'Computers', icon: 'computer' },
    { sep: true },
    { id: 'shared-with-me', label: 'Shared with me', icon: 'group' },
    { sep: true },
    { id: 'recent', label: 'Recent', icon: 'schedule' },
    { id: 'starred', label: 'Starred', icon: 'star' },
    { sep: true },
    { id: 'spam', label: 'Spam', icon: 'report' },
    { id: 'trash', label: 'Trash', icon: 'delete', dropTrash: true },
    { id: 'quota', label: 'Storage', icon: 'cloud' }
  ];
  function activeNav() {
    if (S.view === 'folders') {
      const a = Store.ancestors(S.folderId);
      return a.length && a[0].id === 'shared' ? 'shared-with-me' : 'my-drive';
    }
    return S.view === 'search' ? '' : S.view;
  }
  function treeShowsCurrent() {
    if (S.view !== 'folders' || !S.treeOpen.root) return false;
    const a = Store.ancestors(S.folderId);
    if (!a.length || a[0].id !== 'root') return false;
    return a.slice(1).every(x => S.treeOpen[x.id]);
  }
  function renderNav() {
    const ul = $('#nav');
    ul.textContent = '';
    const act = activeNav(), treeAct = treeShowsCurrent();
    NAV.forEach(n => {
      if (n.sep) { ul.appendChild(h('li', { class: 'nav-sep', role: 'presentation' })); return; }
      const isAct = n.id === act && !(n.tree && treeAct);
      const caret = n.tree
        ? h('button', {
          type: 'button', class: 'caret' + (S.treeOpen.root ? ' open' : ''),
          'aria-label': S.treeOpen.root ? 'Collapse My Drive' : 'Expand My Drive', 'aria-expanded': String(!!S.treeOpen.root),
          onclick: e => { e.preventDefault(); e.stopPropagation(); S.treeOpen.root = !S.treeOpen.root; renderNav(); }
        }, icon('arrow_right'))
        : h('span', { class: 'caret-sp' });
      const row = h('a', {
        class: 'nav-item' + (isAct ? ' active' : ''), href: '#' + n.id, 'data-nav': n.id,
        'aria-current': isAct ? 'page' : null, 'data-drop-folder': n.drop || null, 'data-drop-trash': n.dropTrash ? '1' : null
      }, caret, icon(n.icon, isAct ? 'fill' : ''), h('span', { class: 'nav-lbl' }, n.label));
      row.addEventListener('click', e => { e.preventDefault(); closeDrawer(); go(n.id); });
      const li = h('li', null, row);
      if (n.tree && S.treeOpen.root) li.appendChild(renderTree('root', 1));
      ul.appendChild(li);
    });
  }
  function renderTree(pid, depth) {
    const ul = h('ul', { role: 'group' });
    sortByName(Store.children(pid).filter(f => isFolder(f) && !f.shortcutOf)).forEach(f => {
      const hasKids = Store.children(f.id).some(c => isFolder(c) && !c.shortcutOf);
      const isAct = S.view === 'folders' && S.folderId === f.id;
      const caret = hasKids
        ? h('button', {
          type: 'button', class: 'caret' + (S.treeOpen[f.id] ? ' open' : ''), 'aria-label': (S.treeOpen[f.id] ? 'Collapse ' : 'Expand ') + f.name,
          onclick: e => { e.preventDefault(); e.stopPropagation(); S.treeOpen[f.id] = !S.treeOpen[f.id]; renderNav(); }
        }, icon('arrow_right'))
        : h('span', { class: 'caret-sp' });
      const row = h('a', {
        class: 'nav-item tree-node' + (isAct ? ' active' : ''), href: '#folders/' + f.id,
        style: { paddingLeft: (4 + depth * 16) + 'px' }, 'data-drop-folder': f.id, 'aria-current': isAct ? 'page' : null
      }, caret, icon('folder', isAct ? 'fill' : ''), h('span', { class: 'nav-lbl' }, f.name));
      row.addEventListener('click', e => { e.preventDefault(); closeDrawer(); go(folderHash(f.id)); });
      row.addEventListener('contextmenu', e => { e.preventDefault(); openContextMenu([f.id], { x: e.clientX, y: e.clientY }); });
      const li = h('li', null, row);
      if (hasKids && S.treeOpen[f.id]) li.appendChild(renderTree(f.id, depth + 1));
      ul.appendChild(li);
    });
    return ul;
  }
  function renderStorage() {
    const used = Store.usedBytes(), pct = Math.min(100, used / Store.quotaBytes() * 100);
    const el = $('#storage');
    el.textContent = '';
    el.append(
      h('div', { class: 'meter' + (pct > 90 ? ' warn' : ''), role: 'progressbar', 'aria-label': 'Storage used', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) },
        h('i', { style: { width: (used ? Math.max(pct, 0.6) : 0) + '%' } })),
      h('div', { class: 'storage-text' }, `${Store.fmtSize(used)} of ${C.quotaGB} GB used`),
      h('button', { type: 'button', class: 'btn-outline', onclick: () => NA('Buying more storage') }, 'Get more storage'));
  }
  function closeDrawer() { document.body.classList.remove('drawer-open'); }

  /* ----- Title row ----- */
  function renderTitle() {
    const row = $('#title-row');
    row.textContent = '';
    const left = h('div', { class: 'title-left' });
    if (S.view === 'folders' || S.view === 'my-drive') left.appendChild(breadcrumbs());
    else left.appendChild(h('h1', { class: 'page-title' }, TITLES[S.view]));
    const right = h('div', { class: 'title-right' });
    if (!['quota', 'computers', 'spam'].includes(S.view)) right.appendChild(layoutToggle());
    right.appendChild(iconBtn('info', S.detailsOpen ? 'Hide details' : 'View details', toggleDetails,
      { fill: S.detailsOpen, attrs: { id: 'btn-details', 'aria-pressed': String(S.detailsOpen) } }));
    row.append(left, right);
  }
  function breadcrumbs() {
    const nav = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
    const chain = S.view === 'my-drive'
      ? [{ id: 'root', name: 'My Drive' }]
      : Store.ancestors(S.folderId).concat([{ id: S.folderId, name: get(S.folderId).name }]);
    const shown = chain.length > 3 ? [chain[0], { more: chain.slice(1, -2) }].concat(chain.slice(-2)) : chain;
    shown.forEach((c, i) => {
      if (i) nav.appendChild(icon('chevron_right', 'crumb-sep'));
      if (c.more) {
        nav.appendChild(h('button', {
          type: 'button', class: 'crumb', 'data-tip': 'Show path', 'aria-label': 'Show hidden folders in path',
          onclick: e => UI.menu(e.currentTarget, c.more.map(m => ({ label: m.name, icon: 'folder', action: () => go(folderHash(m.id)) })))
        }, '…'));
        return;
      }
      const last = i === shown.length - 1;
      const b = h('button', {
        type: 'button', class: 'crumb' + (last ? ' last' : ''),
        'data-drop-folder': c.id !== 'shared' ? c.id : null, 'aria-haspopup': last ? 'menu' : null,
        'aria-current': last ? 'page' : null
      }, h('span', { class: 'crumb-txt' }, c.name), last && c.id !== 'shared' ? icon('arrow_drop_down') : null);
      b.addEventListener('click', e => {
        if (!last) return go(folderHash(c.id));
        if (c.id === 'root') openNewMenu(e.currentTarget);
        else if (c.id !== 'shared') openContextMenu([c.id], e.currentTarget, { here: true });
      });
      nav.appendChild(b);
    });
    const wrap = h('h1', { class: 'page-title', style: { paddingLeft: '0', display: 'flex', minWidth: '0' } }, nav);
    return wrap;
  }
  function layoutToggle() {
    const mk = (mode, ic, label) => h('button', {
      type: 'button', class: S.layout === mode ? 'on' : '', 'aria-pressed': String(S.layout === mode),
      'data-tip': label, 'aria-label': label, onclick: () => setLayout(mode)
    }, S.layout === mode ? icon('check') : null, icon(ic));
    return h('div', { class: 'seg', id: 'layout-toggle', role: 'group', 'aria-label': 'Layout' },
      mk('list', 'list', 'List layout'), mk('grid', 'grid_view', 'Grid layout'));
  }
  function setLayout(mode) {
    if (S.layout === mode) return;
    S.layout = mode;
    render();
    Bus.emit('view:' + mode, {});
  }
  function toggleDetails() { if (S.detailsOpen) { S.detailsOpen = false; render(); } else openDetails(S.detailsTab); }
  function openDetails(tab) {
    const was = S.detailsOpen;
    S.detailsOpen = true;
    S.detailsTab = tab || 'details';
    render();
    if (!was) Bus.emit('details:open', { tab: S.detailsTab, ids: Array.from(S.selection) });
  }

  /* ----- Toolbar: chips or selection bar ----- */
  const CHIP_VIEWS = ['home', 'my-drive', 'folders', 'shared-with-me', 'recent', 'starred', 'trash', 'search'];
  const Y = new Date().getFullYear();
  const MODIFIED_OPTS = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['year', `This year (${Y})`], ['lastyear', `Last year (${Y - 1})`], ['custom', 'Custom date range']];
  const LOC_OPTS = [['anywhere', 'Anywhere in Drive'], ['my-drive', 'My Drive'], ['shared', 'Shared with me'], ['starred', 'Starred'], ['trash', 'In trash']];
  const anyFilters = () => Object.values(S.filters).some(Boolean);

  function renderToolbar() {
    const tb = $('#toolbar');
    tb.textContent = '';
    tb.classList.toggle('has-sel', S.selection.size > 0);
    if (S.selection.size) { tb.appendChild(selectionBar()); return; }
    if (!CHIP_VIEWS.includes(S.view)) return;
    tb.append(chip('type'), chip('people'), chip('modified'));
    if (S.view === 'search' || S.view === 'home') tb.append(chip('location'));
    if (anyFilters()) tb.append(h('button', { type: 'button', class: 'btn-text clear-filters', onclick: clearFilters }, 'Clear filters'));
  }
  function clearFilters() { S.filters = Store.emptyFilters(); render(); }
  function chipLabel(kind, val) {
    if (kind === 'type') return Icons.group(val).label;
    if (kind === 'people') return val === 'me' ? 'Owned by me' : val;
    if (kind === 'modified') return MODIFIED_OPTS.find(o => o[0] === val)[1];
    return LOC_OPTS.find(o => o[0] === val)[1];
  }
  function chip(kind) {
    const val = S.filters[kind];
    const base = { type: 'Type', people: 'People', modified: 'Modified', location: 'Location' }[kind];
    const b = h('button', { type: 'button', class: 'chip' + (val ? ' on' : ''), 'aria-haspopup': 'menu', 'data-chip': kind },
      h('span', null, val ? chipLabel(kind, val) : base),
      val ? h('span', {
        class: 'chip-x', role: 'button', tabindex: '0', 'aria-label': `Clear ${base} filter`,
        onclick: e => { e.stopPropagation(); S.filters[kind] = null; render(); }
      }, icon('close')) : icon('arrow_drop_down'));
    b.addEventListener('click', () => openChipMenu(kind, b));
    return b;
  }
  function peopleOptions() {
    const m = new Map([['me', 'Owned by me']]);
    Store.all().forEach(i => {
      if (i.owner !== 'me') m.set(i.owner, i.owner);
      i.access.forEach(a => { if (a.email !== C.user.email) m.set(a.email, a.email); });
    });
    return Array.from(m.entries());
  }
  function openChipMenu(kind, anchor) {
    const set = v => () => { S.filters[kind] = v; render(); };
    let items;
    if (kind === 'type') items = Icons.TYPE_GROUPS.map(g => ({ label: g.label, svg: Icons.groupIcon(g), checked: S.filters.type === g.id, action: set(g.id) }));
    else if (kind === 'people') {
      items = peopleOptions().map(([v, l]) => ({ label: l, checked: S.filters.people === v, action: set(v) }));
      if (items.length === 1) items.push('-', { label: 'Share files to see more people here', disabled: true });
    } else if (kind === 'modified') {
      items = MODIFIED_OPTS.map(([v, l]) => v === 'custom'
        ? { label: l, checked: false, action: () => NA('Custom date ranges', true) }
        : { label: l, checked: S.filters.modified === v, action: set(v) });
    } else items = LOC_OPTS.map(([v, l]) => ({ label: l, checked: (S.filters.location || 'anywhere') === v, action: set(v === 'anywhere' ? null : v) }));
    UI.menu(anchor, items);
  }
  function modifiedIn(ts, k) {
    const n = new Date(), start = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(), DAY = 864e5;
    switch (k) {
      case 'today': return ts >= start;
      case '7d': return ts >= start - 6 * DAY;
      case '30d': return ts >= start - 29 * DAY;
      case '90d': return ts >= start - 89 * DAY;
      case 'year': return new Date(ts).getFullYear() === n.getFullYear();
      case 'lastyear': return new Date(ts).getFullYear() === n.getFullYear() - 1;
      default: return true;
    }
  }
  function passFilters(it) {
    const f = S.filters;
    if (f.type && !Icons.inGroup(Icons.group(f.type), it)) return false;
    if (f.people) {
      if (f.people === 'me' ? it.owner !== 'me' : !(it.owner === f.people || it.access.some(a => a.email === f.people))) return false;
    }
    if (f.modified && !modifiedIn(it.modified, f.modified)) return false;
    return true;
  }
  function filterLocation(pool, loc) {
    if (loc === 'my-drive') return pool.filter(inMyDrive);
    if (loc === 'shared') return pool.filter(i => !inMyDrive(i));
    if (loc === 'starred') return pool.filter(i => i.starred);
    if (loc === 'trash') return [];
    return pool;
  }

  function selectionBar() {
    const ids = Array.from(S.selection);
    const bar = h('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'Selection actions' },
      iconBtn('close', 'Clear selection', clearSelection, { cls: 'sm' }),
      h('span', { class: 'sel-count', 'aria-live': 'polite' }, ids.length + ' selected'),
      h('span', { class: 'sel-sep' }));
    if (S.view === 'trash') {
      bar.append(
        iconBtn('restore_from_trash', 'Restore from trash', () => doRestore(ids), { cls: 'sm' }),
        iconBtn('delete_forever', 'Delete forever', () => doDeleteForever(ids), { cls: 'sm' }));
    } else {
      bar.append(
        iconBtn('person_add', 'Share', () => openShare(ids), { cls: 'sm' }),
        iconBtn('download', 'Download', () => doDownload(ids), { cls: 'sm' }),
        iconBtn('drive_file_move', 'Move', () => openMove(ids), { cls: 'sm' }),
        iconBtn('delete', 'Move to trash', () => doTrash(ids), { cls: 'sm' }),
        iconBtn('link', 'Copy link', () => copyLink(ids), { cls: 'sm' }));
    }
    bar.append(iconBtn('more_vert', 'More actions', e => openContextMenu(ids, e.currentTarget), { cls: 'sm' }));
    return bar;
  }

  /* ----- Content ----- */
  let lastIds = [];
  const COLS = {
    name: { label: 'Name', sort: 'name' },
    owner: { label: 'Owner', w: 200 },
    modified: { label: 'Last modified', sort: 'modified', w: 200 },
    size: { label: 'File size', sort: 'size', w: 120 },
    location: { label: 'Location', w: 200 },
    reason: { label: 'Reason suggested', w: 220 },
    trashed: { label: 'Date trashed', sort: 'trashed', w: 160 },
    origin: { label: 'Original location', w: 200 },
    sharedby: { label: 'Shared by', w: 200 },
    shareddate: { label: 'Date shared', sort: 'modified', w: 160 },
    opened: { label: 'Last opened by me', sort: 'opened', w: 180 },
    used: { label: 'Storage used', sort: 'size', w: 150 }
  };
  const EMPTY = {
    home: ['Welcome to Drive, the home for all your files', 'Use the “New” button to upload files or create Docs, Sheets and more', 'add_to_drive'],
    'my-drive': ['A place for all of your files', 'Drag your files and folders here or use the “New” button to upload', 'hard_drive'],
    folder: ['Drop files here', 'or use the “New” button', 'folder_open'],
    computers: ['No computers syncing', 'Folders on your computer that you sync with Drive using Drive for desktop will show up here', 'computer'],
    'shared-with-me': ['Files shared with you', 'Files and folders others have shared with you will appear here', 'group'],
    recent: ['No recent files', "See all the files you've recently edited or opened", 'schedule'],
    starred: ['No starred files', 'Add stars to things that you want to easily find later', 'star'],
    spam: ['Your spam is empty', `Files in spam won't appear anywhere else in Drive. Files are permanently removed after ${C.trashRetentionDays} days.`, 'report'],
    trash: ['Nothing in trash', `Move items you don't need to trash. Items in trash will be deleted forever after ${C.trashRetentionDays} days.`, 'delete'],
    search: ['None of your files or folders matched this search', 'Try another search, or use search options to find a file by type, owner and more', 'search'],
    filtered: ['No items match your filters', 'Try different filters, or clear them to see everything', 'filter_alt']
  };
  function emptyArt(glyph, small) {
    return h('div', { class: 'empty-art' + (small ? ' sm' : ''), 'aria-hidden': 'true' },
      h('span', {
        html: '<svg viewBox="0 0 220 170" width="100%" height="100%"><circle cx="110" cy="88" r="66" fill="#d3e3fd"/>' +
          '<circle cx="46" cy="38" r="10" fill="#fdd663"/><circle cx="184" cy="132" r="13" fill="#81c995"/>' +
          '<rect x="168" y="28" width="18" height="18" rx="4" fill="#f6aea9" transform="rotate(18 177 37)"/>' +
          '<circle cx="34" cy="128" r="6" fill="#a8c7fa"/></svg>'
      }),
      icon(glyph, 'fill'));
  }
  function emptyState(key) {
    const [t, s, glyph] = EMPTY[key];
    const el = h('div', { class: 'empty' }, emptyArt(glyph), h('h2', null, t), h('p', null, s));
    if (key === 'filtered') el.appendChild(h('button', { type: 'button', class: 'btn-text', onclick: clearFilters }, 'Clear filters'));
    if (key === 'search') el.appendChild(h('button', { type: 'button', class: 'btn-text', onclick: openAdvanced }, icon('tune'), 'Advanced search'));
    if (key === 'home' || key === 'my-drive' || key === 'folder') el.appendChild(h('button', { type: 'button', class: 'btn-outline', onclick: e => openNewMenu(e.currentTarget) }, icon('add'), 'New'));
    return el;
  }

  function sortByName(arr) { return arr.slice().sort((a, b) => collator.compare(a.name, b.name)); }
  function sortItems(arr) {
    const key = S.sort.key, dir = S.sort.dir;
    const val = i => key === 'size' ? (isFolder(i) ? -1 : i.size || 0)
      : key === 'opened' ? (i.opened || 0) : key === 'trashed' ? (i.trashedAt || 0) : i.modified;
    return arr.slice().sort((a, b) => {
      if (S.foldersFirst) { const fa = isFolder(a), fb = isFolder(b); if (fa !== fb) return fa ? -1 : 1; }
      const c = key === 'name' ? collator.compare(a.name, b.name) : val(a) - val(b);
      return (c || collator.compare(a.name, b.name)) * dir;
    });
  }
  function setSort(key) {
    if (S.sort.key === key) S.sort.dir *= -1;
    else S.sort = { key, dir: key === 'name' ? 1 : -1 };
    renderContent();
  }
  const SORT_LABEL = { name: 'Name', modified: 'Last modified', opened: 'Last opened by me', size: 'File size', trashed: 'Date trashed' };
  function sortMenu(anchor) {
    const keys = S.view === 'trash' ? ['name', 'trashed', 'size'] : ['name', 'modified', 'opened', 'size'];
    const asc = S.sort.key === 'name' ? 'A to Z' : S.sort.key === 'size' ? 'Smallest first' : 'Oldest first';
    const desc = S.sort.key === 'name' ? 'Z to A' : S.sort.key === 'size' ? 'Largest first' : 'Newest first';
    UI.menu(anchor, [
      { header: 'Sort by' },
      ...keys.map(k => ({ label: SORT_LABEL[k], checked: S.sort.key === k, action: () => { S.sort = { key: k, dir: k === 'name' ? 1 : -1 }; renderContent(); } })),
      '-', { header: 'Sort direction' },
      { label: asc, checked: S.sort.dir > 0, action: () => { S.sort.dir = 1; renderContent(); } },
      { label: desc, checked: S.sort.dir < 0, action: () => { S.sort.dir = -1; renderContent(); } },
      '-', { header: 'Folders' },
      { label: 'On top', checked: S.foldersFirst, action: () => { S.foldersFirst = true; renderContent(); } },
      { label: 'Mixed with files', checked: !S.foldersFirst, action: () => { S.foldersFirst = false; renderContent(); } }
    ]);
  }

  function searchResults() {
    const q = S.query.trim().toLowerCase(), a = S.adv || {};
    const loc = S.filters.location || a.location || null;
    const trashMode = a.inTrash || loc === 'trash';
    let pool = Store.all().filter(i => trashMode ? i.trashed : Store.alive(i));
    if (!trashMode) pool = filterLocation(pool, loc);
    if (a.starred) pool = pool.filter(i => i.starred);
    const has = (i, s) => i.name.toLowerCase().includes(s) || (i.description || '').toLowerCase().includes(s) || contentText(i).toLowerCase().includes(s);
    return pool.filter(i => {
      if (q && !has(i, q)) return false;
      if (a.name && !i.name.toLowerCase().includes(a.name.toLowerCase())) return false;
      if (a.words && !has(i, a.words.toLowerCase())) return false;
      if (a.type && !Icons.inGroup(Icons.group(a.type), i)) return false;
      if (a.owner === 'me' && i.owner !== 'me') return false;
      if (a.owner === 'notme' && i.owner === 'me') return false;
      if (a.owner === 'specific' && a.ownerName) {
        const n = a.ownerName.toLowerCase();
        const ownerText = i.owner === 'me' ? (C.user.name + ' ' + C.user.email + ' me').toLowerCase() : i.owner.toLowerCase();
        if (!ownerText.includes(n)) return false;
      }
      if (a.modified && !modifiedIn(i.modified, a.modified)) return false;
      return passFilters(i);
    });
  }

  function viewModel() {
    const f = arr => arr.filter(passFilters);
    switch (S.view) {
      case 'my-drive':
      case 'folders':
        return { items: sortItems(f(Store.children(S.view === 'folders' ? S.folderId : 'root'))), cols: ['name', 'owner', 'modified', 'size'], empty: S.view === 'my-drive' ? 'my-drive' : 'folder', sortable: true };
      case 'shared-with-me':
        return { items: sortItems(f(Store.all().filter(i => i.parent === 'shared' && !i.trashed))), cols: ['name', 'sharedby', 'shareddate'], empty: 'shared-with-me', sortable: true };
      case 'recent': {
        const items = f(Store.all().filter(i => !isFolder(i) && Store.alive(i))).sort(byTouch);
        const groups = [];
        items.forEach(i => {
          const label = Store.dayBucket(lastTouch(i));
          let g = groups.find(x => x.label === label);
          if (!g) { g = { label, items: [] }; groups.push(g); }
          g.items.push(i);
        });
        return { items, groups, cols: ['name', 'owner', 'modified', 'location'], empty: 'recent' };
      }
      case 'starred':
        return { items: sortItems(f(Store.all().filter(i => i.starred && Store.alive(i)))), cols: ['name', 'owner', 'modified', 'size', 'location'], empty: 'starred', sortable: true };
      case 'trash': {
        const top = Store.all().filter(i => i.trashed && (i.parent === 'root' || i.parent === 'shared' || !Store.trashedDeep(get(i.parent))));
        return { items: sortItems(f(top)), cols: ['name', 'owner', 'trashed', 'size', 'origin'], empty: 'trash', sortable: true, banner: true };
      }
      case 'search':
        return { items: sortItems(searchResults()), cols: ['name', 'owner', 'modified', 'location'], empty: 'search', sortable: true };
      default:
        return { items: [], empty: S.view };
    }
  }

  function renderContent() {
    const c = $('#content');
    const scroll = c.scrollTop;
    c.textContent = '';
    lastIds = [];
    c.className = 'content view-' + S.view + ' layout-' + S.layout;
    if (S.view === 'home') renderHome(c);
    else if (S.view === 'quota') renderQuota(c);
    else {
      const m = viewModel();
      if (m.banner && m.items.length) c.appendChild(trashBanner());
      if (!m.items.length) c.appendChild(emptyState(anyFilters() && S.view !== 'search' ? 'filtered' : m.empty));
      else if (S.layout === 'grid') renderGrid(c, m);
      else c.appendChild(listEl(m.items, m.cols, m));
    }
    c.scrollTop = scroll;
    fitColumns();
    markFocus();
  }

  function trashBanner() {
    return h('div', { class: 'banner' },
      h('span', null, `Items in trash will be deleted forever after ${C.trashRetentionDays} days`),
      h('button', { type: 'button', class: 'btn-text', onclick: doEmptyTrash }, 'Empty trash'));
  }

  function listEl(items, cols, m) {
    m = m || {};
    const list = h('div', { class: 'list', role: 'grid', 'aria-label': 'Files', 'aria-multiselectable': 'true' });
    list._cols = cols;
    const head = h('div', { class: 'lhead', role: 'row' });
    cols.forEach(k => {
      const def = COLS[k];
      const sortable = def.sort && m.sortable;
      const active = sortable && S.sort.key === def.sort;
      const cell = h('div', {
        class: 'hcell' + (sortable ? ' sortable' : ''), 'data-col': k, role: 'columnheader',
        'aria-sort': active ? (S.sort.dir > 0 ? 'ascending' : 'descending') : null, tabindex: sortable ? '0' : null
      }, def.label, active ? icon(S.sort.dir > 0 ? 'arrow_upward' : 'arrow_downward', 'sort-ic') : null);
      if (sortable) {
        cell.addEventListener('click', () => setSort(def.sort));
        cell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSort(def.sort); } });
      }
      head.appendChild(cell);
    });
    head.appendChild(h('div', { class: 'hcell act', 'data-col': 'act', role: 'columnheader' },
      m.sortable ? iconBtn('sort', 'Sort options', e => sortMenu(e.currentTarget), { cls: 'sm' }) : null));
    list.appendChild(head);
    if (m.groups) m.groups.forEach(g => {
      list.appendChild(h('div', { class: 'lgroup', role: 'row' }, g.label));
      g.items.forEach(it => list.appendChild(rowFor(it, cols)));
    });
    else items.forEach(it => list.appendChild(rowFor(it, cols)));
    return list;
  }

  function cellContent(it, key) {
    switch (key) {
      case 'owner': return h('span', { class: 'owner' }, avatarMini(it.owner), it.owner === 'me' ? 'me' : it.owner);
      case 'modified': return [Store.fmtDate(it.modified), it.owner === 'me' ? h('span', { class: 'by' }, ' me') : null];
      case 'size': case 'used': return sizeText(it) + (key === 'used' && it.trashed ? ' (in trash)' : '');
      case 'location': return h('span', { class: 'loc' }, icon(locIcon(it)), locationName(it));
      case 'reason': return reasonText(it);
      case 'trashed': return Store.fmtDate(it.trashedAt);
      case 'origin': { const p = it.parent === 'root' ? 'My Drive' : it.parent === 'shared' ? 'Shared with me' : (get(it.parent) || { name: 'My Drive' }).name; return h('span', { class: 'loc' }, icon(it.parent === 'root' ? 'hard_drive' : 'folder'), p); }
      case 'sharedby': return h('span', { class: 'owner' }, avatarMini(it.owner), it.owner === 'me' ? 'me' : it.owner);
      case 'shareddate': return Store.fmtDate(it.created);
      case 'opened': return it.opened ? Store.fmtDate(it.opened) : '—';
    }
    return '';
  }
  function badges(it) {
    const b = h('span', { class: 'badges' });
    if (isShared(it)) b.appendChild(h('span', { class: 'badge', 'data-tip': 'Shared', 'aria-label': 'Shared' }, icon('group')));
    if (it.starred) b.appendChild(h('span', { class: 'badge star', 'data-tip': 'Starred', 'aria-label': 'Starred' }, icon('star', 'fill')));
    return b;
  }
  function rowFor(it, cols) {
    lastIds.push(it.id);
    const sel = S.selection.has(it.id);
    const row = h('div', {
      class: 'row' + (sel ? ' selected' : '') + (it.trashed ? ' trashed' : ''), role: 'row',
      'aria-selected': String(sel), 'data-id': it.id, draggable: it.trashed ? null : 'true',
      'data-drop-folder': isFolder(it) && !it.trashed ? (it.shortcutOf || it.id) : null
    });
    cols.forEach(k => {
      if (k === 'name') {
        row.appendChild(h('div', { class: 'cell name', 'data-col': 'name', role: 'gridcell' },
          h('span', { class: 'ficon', html: itemIcon(it) }),
          h('span', { class: 'nm', title: it.name }, it.name),
          badges(it)));
      } else row.appendChild(h('div', { class: 'cell', 'data-col': k, role: 'gridcell' }, cellContent(it, k)));
    });
    if (!it.trashed) row.appendChild(quickActions(it));
    row.appendChild(h('div', { class: 'cell act', 'data-col': 'act', role: 'gridcell' },
      iconBtn('more_vert', 'More actions', null, { cls: 'sm', attrs: { 'data-act': 'more' } })));
    return row;
  }
  function quickActions(it) {
    return h('div', { class: 'quick' },
      iconBtn('person_add', 'Share', null, { cls: 'sm', attrs: { 'data-act': 'share' } }),
      iconBtn('download', 'Download', null, { cls: 'sm', attrs: { 'data-act': 'download' } }),
      iconBtn('drive_file_rename_outline', 'Rename', null, { cls: 'sm', attrs: { 'data-act': 'rename' } }),
      iconBtn('star', it.starred ? 'Remove from starred' : 'Add to starred', null, { cls: 'sm', fill: it.starred, attrs: { 'data-act': 'star' } }));
  }

  /** Drop right-most columns first when space runs out (driven by a ResizeObserver). */
  function fitColumns() {
    $$('#content .list').forEach(list => {
      const cols = list._cols;
      if (!cols) return;
      const w = list.clientWidth;
      if (!w) return;
      const visible = cols.slice();
      const need = () => 220 + 48 + visible.filter(k => k !== 'name').reduce((s, k) => s + COLS[k].w, 0);
      while (visible.length > 1 && (need() > w || window.innerWidth <= 600)) visible.pop();
      list.style.setProperty('--cols', visible.map(k => k === 'name' ? 'minmax(0, 1fr)' : COLS[k].w + 'px').join(' ') + ' 48px');
      list.dataset.hide = cols.filter(k => !visible.includes(k)).join(' ');
    });
  }

  function renderGrid(c, m) {
    if (m.groups) {
      m.groups.forEach(g => { c.appendChild(h('div', { class: 'sec-head' }, g.label)); c.appendChild(gridOf(g.items)); });
      return;
    }
    const sortBtn = () => m.sortable ? h('button', { type: 'button', class: 'sort-btn', onclick: e => sortMenu(e.currentTarget) },
      SORT_LABEL[S.sort.key] || 'Name', icon(S.sort.dir > 0 ? 'arrow_upward' : 'arrow_downward')) : null;
    const head = (label, withSort) => h('div', { class: 'sec-row' }, h('div', { class: 'sec-head' }, label), withSort ? sortBtn() : null);
    if (!S.foldersFirst) { c.append(head('Files and folders', true), gridOf(m.items)); return; }
    const folders = m.items.filter(isFolder), files = m.items.filter(i => !isFolder(i));
    if (folders.length) c.append(head('Folders', true), gridOf(folders));
    if (files.length) c.append(head('Files', !folders.length), gridOf(files));
  }
  function gridOf(items) {
    const g = h('div', { class: 'grid', role: 'grid', 'aria-multiselectable': 'true' });
    items.forEach(it => g.appendChild(isFolder(it) ? folderCard(it) : fileCard(it)));
    return g;
  }
  function folderCard(it, sub) {
    lastIds.push(it.id);
    const sel = S.selection.has(it.id);
    return h('div', {
      class: 'fcard' + (sub ? ' tall' : '') + (sel ? ' selected' : ''), role: 'gridcell', 'data-id': it.id,
      'aria-selected': String(sel), draggable: it.trashed ? null : 'true',
      'data-drop-folder': it.trashed ? null : (it.shortcutOf || it.id)
    },
      h('span', { class: 'ficon', html: itemIcon(it, 24) }),
      h('div', { class: 'fc-text' }, h('div', { class: 'nm', title: it.name }, it.name), sub ? h('div', { class: 'fc-sub' }, sub) : null),
      badges(it),
      iconBtn('more_vert', 'More actions', null, { cls: 'sm', attrs: { 'data-act': 'more' } }));
  }
  function nativeThumb(it) {
    const c = it.content || {};
    if (it.type === 'doc') return h('div', { class: 'nthumb' }, (c.text || '').slice(0, 400));
    if (it.type === 'sheet') return h('div', { class: 'nthumb sheet' });
    if (it.type === 'slide') { const s = (c.slides || [])[0] || {}; return h('div', { class: 'nthumb slide' }, h('b', null, s.title || ''), h('span', null, s.body || '')); }
    return h('div', { class: 'nthumb form' }, c.title || '');
  }
  function fileCard(it) {
    lastIds.push(it.id);
    const sel = S.selection.has(it.id);
    const t = realOf(it) || it;
    const thumb = h('div', { class: 'thumb' });
    if (t.type === 'image' && t.blobUrl) thumb.appendChild(h('img', { src: t.blobUrl, alt: '', loading: 'lazy', draggable: 'false' }));
    else if (isNative(t)) thumb.appendChild(nativeThumb(t));
    else thumb.appendChild(h('span', { html: itemIcon(it, 64) }));
    return h('div', {
      class: 'gcard' + (sel ? ' selected' : ''), role: 'gridcell', 'data-id': it.id,
      'aria-selected': String(sel), draggable: it.trashed ? null : 'true'
    },
      h('div', { class: 'ghead' }, h('span', { class: 'ficon', html: itemIcon(it) }), h('span', { class: 'nm', title: it.name }, it.name), badges(it),
        iconBtn('more_vert', 'More actions', null, { cls: 'sm', attrs: { 'data-act': 'more' } })),
      thumb,
      h('div', { class: 'gfoot' }, avatarMini(it.owner, 20), h('span', null, it.trashed ? 'Trashed • ' + Store.fmtDate(it.trashedAt) : reasonText(it))));
  }

  /* ----- Home ----- */
  function renderHome(c) {
    const all = Store.all().filter(i => Store.alive(i));
    if (!all.length) { c.appendChild(emptyState('home')); return; }
    const pool = filterLocation(all.filter(passFilters), S.filters.location);
    const folders = pool.filter(isFolder).sort(byTouch).slice(0, 8);
    const files = pool.filter(i => !isFolder(i)).sort(byTouch).slice(0, 30);
    if (!folders.length && !files.length) { c.appendChild(emptyState('filtered')); return; }
    const head = (key, label) => h('button', {
      type: 'button', class: 'sec-head toggle', 'aria-expanded': String(S.homeOpen[key]),
      onclick: () => { S.homeOpen[key] = !S.homeOpen[key]; renderContent(); }
    }, icon(S.homeOpen[key] ? 'arrow_drop_down' : 'arrow_right'), label);
    if (folders.length) {
      const sec = h('section', { class: 'home-sec' }, head('folders', 'Suggested folders'));
      if (S.homeOpen.folders) {
        const g = h('div', { class: 'grid home-folders', role: 'grid' });
        folders.forEach(f => g.appendChild(folderCard(f, 'In ' + locationName(f))));
        sec.appendChild(g);
      }
      c.appendChild(sec);
    }
    if (files.length) {
      const sec = h('section', { class: 'home-sec' }, head('files', 'Suggested files'));
      if (S.homeOpen.files) sec.appendChild(S.layout === 'grid' ? gridOf(files) : listEl(files, ['name', 'reason', 'owner', 'location'], {}));
      c.appendChild(sec);
    }
  }

  /* ----- Storage ----- */
  function renderQuota(c) {
    const used = Store.usedBytes(), pct = Math.min(100, used / Store.quotaBytes() * 100);
    const legend = (label, bytes, color) => h('span', null, h('i', { style: { background: color } }), `${label} · ${Store.fmtSize(bytes)}`);
    c.appendChild(h('div', { class: 'quota-sum' },
      h('div', null, h('span', { class: 'qb-num' }, Store.fmtSize(used)), h('span', { class: 'qb-of' }, ` of ${C.quotaGB} GB used`)),
      h('div', { class: 'meter big' + (pct > 90 ? ' warn' : '') }, h('i', { style: { width: (used ? Math.max(pct, 0.4) : 0) + '%' } })),
      h('div', { class: 'quota-legend' }, legend('Drive', used, '#0b57d0'), legend('Gmail', 0, '#d93025'), legend('Photos', 0, '#f9ab00')),
      h('div', { class: 'quota-btns' },
        h('button', { type: 'button', class: 'btn-outline', onclick: () => NA('Cleaning up space') }, 'Clean up space'),
        h('button', { type: 'button', class: 'btn-filled', onclick: () => NA('Buying more storage') }, 'Get more storage'))));
    const files = Store.all().filter(i => !isFolder(i) && !i.shortcutOf && i.owner === 'me' && !isNative(i)).sort((a, b) => b.size - a.size);
    c.appendChild(h('h2', { class: 'sec-head' }, 'Files using Drive storage'));
    if (!files.length) c.appendChild(h('p', { class: 'muted pad' }, "You don't have any files using storage yet. Files you upload will be listed here, largest first. Files in Google Docs, Sheets, Slides and Forms don't use storage."));
    else c.appendChild(listEl(files, ['name', 'location', 'used'], {}));
  }

  /* ---------- Details panel ---------- */
  function renderDetails() {
    const panel = $('#details');
    panel.hidden = !S.detailsOpen;
    if (!S.detailsOpen) return;
    panel.textContent = '';
    const items = Array.from(S.selection).map(get).filter(Boolean);
    let subject = null, headIcon = null, headName;
    if (items.length === 1) { subject = items[0]; headName = subject.name; headIcon = itemIcon(subject, 24); }
    else if (items.length > 1) headName = items.length + ' items selected';
    else if (S.view === 'folders') { subject = get(S.folderId); headName = subject.name; headIcon = itemIcon(subject, 24); }
    else headName = S.view === 'home' ? 'Home' : TITLES[S.view];
    const navIcon = (NAV.find(n => n.id === S.view) || {}).icon || 'info';
    panel.append(
      h('div', { class: 'dt-head' },
        headIcon ? h('span', { class: 'ficon', html: headIcon }) : icon(items.length > 1 ? 'library_add_check' : navIcon),
        h('h2', { class: 'dt-title', title: headName }, headName),
        iconBtn('close', 'Close details', () => { S.detailsOpen = false; render(); })),
      h('div', { class: 'tabs', role: 'tablist' },
        ['details', 'activity'].map(t => h('button', {
          type: 'button', class: 'tab' + (S.detailsTab === t ? ' on' : ''), role: 'tab', 'aria-selected': String(S.detailsTab === t),
          onclick: () => { S.detailsTab = t; renderDetails(); }
        }, t === 'details' ? 'Details' : 'Activity'))));
    const body = h('div', { class: 'dt-body', role: 'tabpanel' });
    if (S.detailsTab === 'details') detailsBody(body, subject, items);
    else activityBody(body, subject, items);
    panel.appendChild(body);
  }

  function detailsBody(body, it, items) {
    if (!it) {
      if (items.length > 1) {
        const total = items.reduce((s, i) => s + (isFolder(i) || isNative(i) ? 0 : i.size || 0), 0);
        body.append(h('div', { class: 'dt-empty' }, emptyArt('library_add_check', true),
          h('p', null, `${items.length} items selected`), h('p', { class: 'small' }, `Total size of selected files: ${Store.fmtSize(total)}`)));
      } else {
        body.append(h('div', { class: 'dt-empty' }, emptyArt('info', true), h('p', null, 'Select a file or folder to view its details')));
      }
      return;
    }
    const prev = h('div', { class: 'dt-preview' });
    const r = realOf(it) || it;
    if (r.type === 'image' && r.blobUrl) prev.appendChild(h('img', { src: r.blobUrl, alt: '' }));
    else prev.appendChild(h('span', { html: itemIcon(it, 64) }));
    body.appendChild(prev);

    const n = it.access.length;
    const accessText = n ? `Shared with ${n} ${n === 1 ? 'person' : 'people'}` : it.owner === 'me' ? 'Private to you' : `Owned by ${it.owner}`;
    const avs = h('div', { class: 'dt-avatars' }, avatarMini(it.owner, 32), it.access.slice(0, 6).map(a => avatarMini(a.email, 32)));
    if (it.general === 'anyone') avs.appendChild(h('span', { class: 'av-link', 'data-tip': 'Anyone with the link' }, icon('link')));
    body.appendChild(h('section', { class: 'dt-sec' },
      h('h3', null, 'Who has access'), avs,
      h('div', { class: 'muted' }, accessText + (it.general === 'anyone' ? '. Anyone with the link can view' : '')),
      h('button', { type: 'button', class: 'btn-outline sm', onclick: () => openShare([it.id]) }, 'Manage access')));

    const dl = h('dl', { class: 'dt-dl' });
    const add = (k, v) => dl.append(h('dt', null, k), h('dd', null, v));
    add('Type', it.shortcutOf ? 'Shortcut' : Icons.TYPE_LABEL[it.type]);
    if (!isFolder(it)) {
      add('Size', it.shortcutOf ? '—' : isNative(it) ? '0 bytes' : Store.fmtSize(it.size) + (it.size >= 1024 ? ` (${it.size.toLocaleString()} bytes)` : ''));
      add('Storage used', (it.shortcutOf || isNative(it) || it.owner !== 'me') ? '0 bytes' : Store.fmtSize(it.size));
    }
    add('Location', h('button', {
      type: 'button', class: 'loc-chip', 'data-tip': 'Go to location',
      onclick: () => showLocation(it, true)
    }, icon(locIcon(it)), h('span', null, locationName(it))));
    add('Owner', it.owner === 'me' ? 'me' : it.owner);
    add('Modified', Store.fmtFull(it.modified) + (it.owner === 'me' ? ' by me' : ''));
    add('Opened', it.opened ? Store.fmtFull(it.opened) + ' by me' : '—');
    add('Created', Store.fmtFull(it.created));
    if (it.trashed) add('Trashed', Store.fmtFull(it.trashedAt));
    if (it.shortcutOf) { const t = get(it.shortcutOf); add('Shortcut to', t ? t.name : 'A deleted item'); }
    const ta = h('textarea', { class: 'dt-desc', placeholder: 'Add description', 'aria-label': 'Description', rows: '3', maxlength: '25000' });
    ta.value = it.description || '';
    ta.addEventListener('change', () => Store.setDescription(it.id, ta.value.trim()));
    add('Description', ta);
    body.appendChild(h('section', { class: 'dt-sec' }, h('h3', null, isFolder(it) ? 'Folder details' : 'File details'), dl));
  }

  function actVerb(a) {
    const n = a.ids.length, w = n === 1 ? 'an item' : n + ' items';
    switch (a.action) {
      case 'create': return 'created ' + w;
      case 'upload': return 'uploaded ' + w;
      case 'rename': return 'renamed an item';
      case 'move': return 'moved ' + w + ' to ' + (a.extra.to === 'root' ? 'My Drive' : a.extra.to === 'shared' ? 'Shared with me' : '“' + ((get(a.extra.to) || {}).name || 'a folder') + '”');
      case 'trash': return 'moved ' + w + ' to the trash';
      case 'restore': return 'restored ' + w + ' from the trash';
      case 'delete': return 'permanently deleted ' + w;
      case 'copy': return 'made a copy';
      case 'share': return 'changed sharing on ' + w;
      case 'star': return 'starred ' + w;
      case 'unstar': return 'removed ' + w + ' from starred';
      case 'color': return 'changed the colour of ' + w;
      case 'description': return 'edited the description of ' + w;
      case 'shortcut': return 'added a shortcut';
      case 'edit': return 'edited ' + w;
      default: return a.action + ' ' + w;
    }
  }
  function activityBody(body, it, items) {
    let scope = null;
    if (it) scope = [it.id].concat(isFolder(it) ? Store.descendants(it.id).map(d => d.id) : []);
    else if (items.length) scope = items.map(i => i.id);
    const acts = S.activity.filter(a => !scope || a.ids.some(id => scope.includes(id)));
    if (!acts.length) {
      body.append(h('div', { class: 'dt-empty' }, emptyArt('history', true),
        h('p', null, it ? 'No activity for this item yet' : 'No recent activity'),
        h('p', { class: 'small' }, 'Things you do, like creating, renaming or sharing, will appear here.')));
      return;
    }
    let lastDay = '';
    acts.forEach(a => {
      const day = Store.dayBucket(a.t);
      if (day !== lastDay) { body.append(h('h3', { class: 'act-day' }, day)); lastDay = day; }
      body.append(h('div', { class: 'act' }, avatarMini('me', 32), h('div', { class: 'act-main' },
        h('div', null, h('b', null, 'You'), ' ', actVerb(a)),
        h('div', { class: 'muted small' }, Store.fmtTime(a.t)),
        a.action === 'rename' ? h('div', { class: 'act-extra' }, `“${a.extra.from}” → “${a.extra.to}”`) : null,
        a.action === 'share' ? h('div', { class: 'act-extra' }, `${a.extra.count} ${a.extra.count === 1 ? 'person' : 'people'} with access${a.extra.general === 'anyone' ? ' · anyone with the link' : ''}`) : null,
        h('div', { class: 'act-items' },
          a.names.slice(0, 3).map((nm, i) => h('span', { class: 'act-chip' }, h('span', { html: Icons.svg(a.types[i], { size: 16 }) }), h('span', null, nm))),
          a.names.length > 3 ? h('span', { class: 'muted small' }, `+${a.names.length - 3} more`) : null))));
    });
  }

  /* ---------- Selection ---------- */
  function syncSelection() {
    $$('#content [data-id]').forEach(el => {
      const on = S.selection.has(el.dataset.id);
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', String(on));
    });
    renderToolbar();
    renderDetails();
    markFocus();
  }
  function markFocus() {
    $$('#content .focused').forEach(e => e.classList.remove('focused'));
    if (kbFocus && S.focusId) { const el = $(`#content [data-id="${S.focusId}"]`); if (el) el.classList.add('focused'); }
  }
  let kbFocus = false;
  function selectOnly(id) { S.selection = new Set([id]); S.anchor = id; S.focusId = id; syncSelection(); }
  function clearSelection() { if (!S.selection.size) return; S.selection.clear(); S.anchor = null; syncSelection(); }
  function onItemClick(e, id) {
    kbFocus = false;
    if (e.shiftKey && S.anchor && lastIds.includes(S.anchor)) {
      const a = lastIds.indexOf(S.anchor), b = lastIds.indexOf(id);
      const base = (e.metaKey || e.ctrlKey) ? new Set(S.selection) : new Set();
      lastIds.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => base.add(x));
      S.selection = base;
    } else if (e.metaKey || e.ctrlKey) {
      if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id);
      S.anchor = id;
    } else { S.selection = new Set([id]); S.anchor = id; }
    S.focusId = id;
    syncSelection();
  }
  function scrollToItem(id) { const el = $(`#content [data-id="${id}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }

  function bindContent() {
    const c = $('#content');
    c.addEventListener('click', e => {
      const itemEl = e.target.closest('[data-id]');
      const act = e.target.closest('[data-act]');
      if (act && itemEl) {
        e.stopPropagation();
        const id = itemEl.dataset.id;
        if (act.dataset.act === 'more') {
          if (!S.selection.has(id)) selectOnly(id);
          openContextMenu(Array.from(S.selection), act);
        } else runQuick(act.dataset.act, id);
        return;
      }
      if (itemEl) { onItemClick(e, itemEl.dataset.id); return; }
      if (!e.target.closest('button, a, input, textarea, .lhead, .banner, .sec-head, .sec-row, .quota-sum')) clearSelection();
    });
    c.addEventListener('dblclick', e => {
      const el = e.target.closest('[data-id]');
      if (!el || e.target.closest('[data-act]')) return;
      const it = get(el.dataset.id);
      if (it) openItem(it);
    });
    c.addEventListener('contextmenu', e => {
      const el = e.target.closest('[data-id]');
      if (!el) {
        if (S.view === 'my-drive' || S.view === 'folders') { e.preventDefault(); clearSelection(); openNewMenu({ x: e.clientX, y: e.clientY }); }
        return;
      }
      e.preventDefault();
      const id = el.dataset.id;
      if (!S.selection.has(id)) selectOnly(id);
      openContextMenu(Array.from(S.selection), { x: e.clientX, y: e.clientY });
    });
  }
  function runQuick(act, id) {
    if (act === 'share') openShare([id]);
    else if (act === 'download') doDownload([id]);
    else if (act === 'rename') openRename(id);
    else if (act === 'star') toggleStar([id]);
  }

  /* ---------- Opening ---------- */
  function openItem(it) {
    if (Store.trashedDeep(it)) return trashedPrompt(it);
    if (it.shortcutOf) {
      const t = get(it.shortcutOf);
      if (!t || !Store.alive(t)) { UI.snack('The original item was moved to trash or deleted'); return; }
      return openItem(t);
    }
    if (isFolder(it)) { go(folderHash(it.id)); return; }
    Store.touchOpened(it.id);
    Bus.emit('file:open', { id: it.id, name: it.name, type: it.type });
    if (isNative(it)) openEditor(it); else openViewer(it);
  }
  function trashedPrompt(it) {
    const top = topTrashed(it);
    UI.dialog({
      title: 'This item is in your trash', width: 440,
      body: `To open “${it.name}”, restore it from the trash first.`,
      actions: [{ label: 'Cancel' }, { label: 'Restore', primary: true, onClick: () => doRestore([top.id]) }]
    });
  }
  function showLocation(it, viaDetails) {
    if (!it) return;
    pendingSelect = it.id;
    const target = it.trashed ? 'trash' : folderHash(it.parent);
    if (viaDetails) lastRouteKey = '';
    go(target);
  }

  /* ---------- Context menu ---------- */
  const FOLDER_COLORS = [
    ['#ac725e', 'Chocolate ice cream'], ['#d06b64', 'Old brick red'], ['#f83a22', 'Cardinal'], ['#fa573c', 'Wild strawberries'],
    ['#ff7537', 'Mars orange'], ['#ffad46', 'Yellow cab'], ['#42d692', 'Spearmint'], ['#16a765', 'Vern fern'],
    ['#7bd148', 'Asparagus'], ['#b3dc6c', 'Slime green'], ['#fbe983', 'Desert sand'], ['#fad165', 'Macaroni'],
    ['#92e1c0', 'Sea foam'], ['#9fe1e7', 'Pool'], ['#9fc6e7', 'Denim'], ['#4986e7', 'Rainy sky'],
    ['#9a9cff', 'Blue velvet'], ['#b99aff', 'Purple dino'], ['#8f8f8f', 'Mouse'], ['#cabdbf', 'Mountain grey'],
    ['#cca6ac', 'Earthworm'], ['#f691b2', 'Bubble gum'], ['#cd74e6', 'Purple rain'], ['#a47ae2', 'Toy eggplant']
  ];
  function colorPalette(ids, close) {
    const cur = (get(ids[0]) || {}).color;
    const grid = h('div', { class: 'palette', role: 'listbox', 'aria-label': 'Folder colour' });
    FOLDER_COLORS.forEach(([c, name]) => grid.appendChild(h('button', {
      type: 'button', class: 'swatch' + (cur === c ? ' on' : ''), style: { background: c },
      'data-tip': name, 'aria-label': name, role: 'option', 'aria-selected': String(cur === c),
      onclick: () => { close(); Store.setColor(ids, c); render(); }
    }, cur === c ? icon('check') : null)));
    return h('div', { class: 'palette-wrap' }, grid);
  }
  function openWithMenu(it) {
    const m = [];
    if (isNative(it)) m.push({ svg: Icons.product(PRODUCT[it.type], 20), label: APP_NAME[it.type], action: () => openItem(it) });
    else m.push({ icon: 'visibility', label: 'Preview', action: () => openItem(it) });
    if (['word', 'text'].includes(it.type)) m.push({ svg: Icons.product('docs', 20), label: 'Google Docs', action: () => NA('Converting files to Google Docs') });
    if (it.type === 'excel') m.push({ svg: Icons.product('sheets', 20), label: 'Google Sheets', action: () => NA('Converting files to Google Sheets') });
    if (it.type === 'powerpoint') m.push({ svg: Icons.product('slides', 20), label: 'Google Slides', action: () => NA('Converting files to Google Slides') });
    m.push('-',
      { icon: 'add', label: 'Connect more apps', action: () => NA('Connecting more apps') },
      { icon: 'computer', label: 'Apps on your computer', action: () => NA('Opening apps on your computer') });
    return m;
  }
  function openContextMenu(ids, anchor) {
    const items = ids.map(get).filter(Boolean);
    if (!items.length) return;
    const one = items.length === 1 ? items[0] : null;
    if (items.some(i => i.trashed)) {
      UI.menu(anchor, [
        { label: 'Restore', icon: 'restore_from_trash', action: () => doRestore(ids) },
        { label: 'Delete forever', icon: 'delete_forever', action: () => doDeleteForever(ids) },
        '-',
        { label: 'Details', icon: 'info', action: () => openDetails('details') }
      ]);
      return;
    }
    const anyFolder = items.some(isFolder), allFolders = items.every(isFolder);
    const starred = items.every(i => i.starred);
    const m = [];
    if (one) {
      if (isFolder(one)) m.push({ label: 'Open', icon: 'folder_open', action: () => openItem(one) });
      else m.push({ label: 'Open with', icon: 'open_with', submenu: openWithMenu(realOf(one) || one) });
      m.push('-');
    }
    m.push({ label: 'Download', icon: 'download', action: () => doDownload(ids) });
    if (one) m.push({ label: 'Rename', icon: 'drive_file_rename_outline', kbd: 'N', action: () => openRename(one.id) });
    if (!anyFolder && items.every(i => !i.shortcutOf)) m.push({ label: 'Make a copy', icon: 'content_copy', action: () => doCopy(ids) });
    m.push('-');
    m.push({
      label: 'Share', icon: 'person_add', submenu: [
        { label: 'Share', icon: 'person_add', kbd: '.', action: () => openShare(ids) },
        { label: 'Copy link', icon: 'link', action: () => copyLink(ids) }
      ]
    });
    const org = [
      { label: 'Move', icon: 'drive_file_move', kbd: 'Z', action: () => openMove(ids) },
      { label: 'Add shortcut', icon: 'add_to_drive', action: () => doShortcut(ids) },
      { label: starred ? 'Remove from starred' : 'Add to starred', icon: 'star', fill: starred, kbd: 'S', action: () => doStar(ids, !starred) }
    ];
    if (allFolders) org.push({ label: 'Change colour', icon: 'palette', subcustom: close => colorPalette(ids, close) });
    m.push({ label: 'Organise', icon: 'folder_open', submenu: org });
    m.push({
      label: one && isFolder(one) ? 'Folder information' : 'File information', icon: 'info', submenu: [
        { label: 'Details', icon: 'info', action: () => openDetails('details') },
        { label: 'Activity', icon: 'history', action: () => openDetails('activity') }
      ]
    });
    m.push('-');
    m.push({ label: items.some(i => i.sharedWithMe) ? 'Remove' : 'Move to trash', icon: 'delete', kbd: 'Delete', action: () => doTrash(ids) });
    UI.menu(anchor, m);
  }

  /* ---------- Actions ---------- */
  function doTrash(ids) {
    const list = Store.trash(ids);
    if (!list.length) return;
    S.selection.clear();
    const n = list.length;
    render();
    UI.snack(n === 1 ? `“${list[0].name}” moved to trash` : `${n} items moved to trash`, {
      action: 'Undo', onAction: () => { Store.restore(list.map(i => i.id)); render(); UI.snack('Action undone'); }
    });
    Bus.emit('item:trash', { ids: list.map(i => i.id), count: n });
    if (S.view === 'folders' && !Store.alive(get(S.folderId))) {
      const f = get(S.folderId);
      go(f && !f.trashed ? folderHash(f.parent) : (f ? folderHash(f.parent) : 'my-drive'));
    }
  }
  function doRestore(ids) {
    const list = Store.restore(ids);
    if (!list.length) return;
    S.selection.clear();
    render();
    UI.snack(list.length === 1 ? `“${list[0].name}” restored` : `${list.length} items restored`, {
      action: 'Show location', onAction: () => showLocation(list[0])
    });
    Bus.emit('item:restore', { ids: list.map(i => i.id), count: list.length });
  }
  async function doDeleteForever(ids) {
    const items = ids.map(get).filter(Boolean);
    if (!items.length) return;
    const ok = await UI.confirm({
      title: 'Delete forever?', ok: 'Delete forever',
      text: items.length === 1 ? `“${items[0].name}” will be deleted forever and you won't be able to restore it.` : `${items.length} items will be deleted forever and you won't be able to restore them.`
    });
    if (!ok) return;
    Store.deleteForever(ids);
    S.selection.clear();
    render();
    UI.snack(items.length === 1 ? `“${items[0].name}” deleted forever` : `${items.length} items deleted forever`);
  }
  async function doEmptyTrash() {
    const n = Store.all().filter(i => i.trashed).length;
    if (!n) return;
    const ok = await UI.confirm({ title: 'Delete forever?', ok: 'Delete forever', text: "All items in the trash will be deleted forever and you won't be able to restore them." });
    if (!ok) return;
    Store.emptyTrash();
    S.selection.clear();
    render();
    UI.snack('Trash emptied');
  }
  function doCopy(ids) {
    const copies = ids.map(id => Store.copy(id)).filter(Boolean);
    if (!copies.length) return;
    S.selection = new Set(copies.map(c => c.id));
    render();
    UI.snack(copies.length === 1 ? `Created “${copies[0].name}”` : `Created ${copies.length} copies`, {
      action: 'Undo', onAction: () => { Store.deleteForever(copies.map(c => c.id)); render(); UI.snack('Action undone'); }
    });
  }
  function doStar(ids, val) {
    const list = Store.star(ids, val);
    if (!list.length) return;
    render();
    if (val) Bus.emit('item:star', { ids: list.map(i => i.id), count: list.length });
  }
  const toggleStar = ids => doStar(ids, !ids.every(id => (get(id) || {}).starred));
  function doShortcut(ids) {
    const made = ids.map(id => { const t = realOf(get(id)); return t ? Store.addShortcut(t.id, 'root') : null; }).filter(Boolean);
    if (!made.length) return;
    render();
    UI.snack(made.length === 1 ? 'Shortcut added to My Drive' : `${made.length} shortcuts added to My Drive`, {
      actions: [
        { label: 'Undo', onClick: () => { Store.deleteForever(made.map(m => m.id)); render(); } },
        { label: 'Show location', onClick: () => showLocation(made[0]) }
      ]
    });
  }
  function zipName(n) {
    const d = new Date(), p = x => String(x).padStart(2, '0');
    return `${n}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}Z-001.zip`;
  }
  function doDownload(ids) {
    const items = ids.map(get).filter(Boolean);
    if (!items.length) return;
    if (items.length > 1 || isFolder(items[0])) {
      const name = items.length === 1 ? items[0].name : 'drive-download';
      UI.alert('Download as zip', `In Drive, ${items.length === 1 ? '“' + name + '”' : 'these ' + items.length + ' items'} would be compressed and downloaded as ${zipName(name)}. Zip downloads aren't available in this practice simulation.`);
      return;
    }
    const it = realOf(items[0]) || items[0];
    if (isNative(it)) {
      if (it.type === 'form') return UI.snack("Google Forms can't be downloaded. In Drive you'd download the responses instead.");
      const ext = { doc: 'docx', sheet: 'xlsx', slide: 'pptx' }[it.type];
      UI.snack(`In Drive, “${it.name}” would download as ${it.name}.${ext}. Converting isn't available in this practice simulation.`);
      return;
    }
    if (!it.blobUrl) { UI.snack(`“${it.name}” is a sample file, so there's nothing to download`); return; }
    const a = h('a', { href: it.blobUrl, download: it.name, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    a.remove();
    UI.snack(`Downloading “${it.name}”`);
  }
  function practiceUrl(it) {
    const base = location.href.split('#')[0];
    return base + (isFolder(it) ? '#folders/' : '#file/') + it.id;
  }
  function copyLink(ids) {
    const text = ids.map(get).filter(Boolean).map(practiceUrl).join('\n');
    const done = () => UI.snack(ids.length === 1 ? 'Practice link copied' : 'Practice links copied');
    const fallback = () => {
      const ta = h('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else UI.alert('Copy link', text);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ----- Rename ----- */
  function openRename(id) {
    const it = get(id);
    if (!it) return;
    const input = h('input', { class: 'input', 'aria-label': 'New name', maxlength: '255', spellcheck: 'false' });
    input.value = it.name;
    const d = UI.dialog({
      title: 'Rename', body: input, width: 400,
      actions: [{ label: 'Cancel' }, {
        label: 'OK', primary: true, onClick: () => {
          const v = input.value.trim();
          if (!v) return false;
          doRename(id, v);
        }
      }],
      select: el => {
        const dot = it.name.lastIndexOf('.');
        el.setSelectionRange(0, !isFolder(it) && !isNative(it) && dot > 0 ? dot : it.name.length);
      }
    });
    input.addEventListener('input', () => { d.primary.disabled = !input.value.trim(); });
  }
  function doRename(id, name) {
    const from = Store.rename(id, name);
    if (from == null) return;
    render();
    UI.snack(`Renamed “${from}” to “${name}”`, { action: 'Undo', onAction: () => { Store.rename(id, from); render(); } });
    Bus.emit('item:rename', { id, from, to: name });
  }

  /* ----- Create ----- */
  function createTarget() {
    const inPlace = S.view === 'my-drive' || S.view === 'folders';
    let parent = 'root';
    if (S.view === 'folders' && Store.alive(get(S.folderId))) parent = S.folderId;
    return { parent, inPlace };
  }
  function newFolder(parentOverride, after) {
    const t = parentOverride ? { parent: parentOverride, inPlace: false } : createTarget();
    const input = h('input', { class: 'input', 'aria-label': 'Folder name', maxlength: '255', spellcheck: 'false' });
    input.value = 'Untitled folder';
    UI.dialog({
      title: 'New folder', body: input, width: 400,
      actions: [{ label: 'Cancel' }, {
        label: 'Create', primary: true, onClick: () => {
          const name = input.value.trim() || 'Untitled folder';
          const f = Store.create({ type: 'folder', name, parent: t.parent });
          Bus.emit('folder:create', { id: f.id, name, parent: t.parent });
          if (after) { render(); after(f); return; }
          afterCreate(f, t.inPlace);
        }
      }],
      select: el => el.select()
    });
  }
  function afterCreate(it, inPlace) {
    if (inPlace) {
      S.selection = new Set([it.id]); S.anchor = S.focusId = it.id;
      render();
      scrollToItem(it.id);
    } else {
      render();
      UI.snack(`“${it.name}” created in My Drive`, { action: 'Show location', onAction: () => showLocation(it) });
    }
  }
  function newNative(type) {
    const t = createTarget();
    const it = Store.create({ type, name: NATIVE_NAME[type], parent: t.parent, content: defaultContent(type) });
    Bus.emit('doc:create', { id: it.id, type, name: it.name });
    if (t.inPlace) { S.selection = new Set([it.id]); S.anchor = S.focusId = it.id; }
    render();
    openEditor(it, { isNew: true, inPlace: t.inPlace });
  }
  function openNewMenu(anchor) {
    const nat = (type) => ({
      label: APP_NAME[type], svg: Icons.product(PRODUCT[type], 20), submenu: [
        { label: BLANK[type], action: () => newNative(type) },
        { label: 'From a template', action: () => NA('Templates', true) }
      ]
    });
    const more = (type, label) => ({ label, svg: Icons.svg(type), action: () => NA(label) });
    UI.menu(anchor, [
      { label: 'New folder', icon: 'create_new_folder', kbd: 'Alt+C then F', action: () => newFolder() },
      '-',
      { label: 'File upload', icon: 'upload_file', kbd: 'Alt+C then U', action: pickFiles },
      { label: 'Folder upload', icon: 'drive_folder_upload', kbd: 'Alt+C then I', action: pickFolder },
      '-',
      nat('doc'), nat('sheet'), nat('slide'), nat('form'),
      {
        label: 'More', icon: 'more_horiz', submenu: [
          more('drawing', 'Google Drawings'), more('mymaps', 'Google My Maps'), more('sites', 'Google Sites'), more('script', 'Google Apps Script'),
          '-', { label: 'Connect more apps', icon: 'add', action: () => NA('Connecting more apps') }
        ]
      }
    ], { className: 'tall' });
  }

  /* ---------- Share dialog ---------- */
  function roleMenu(anchor, current, onPick, withRemove) {
    const items = Object.keys(ROLE_LABEL).map(r => ({ label: ROLE_LABEL[r], checked: current === r, action: () => onPick(r) }));
    if (withRemove) items.push('-', { label: 'Remove access', action: () => onPick('remove') });
    UI.menu(anchor, items);
  }
  function personRow(name, mail, avatarWho, right) {
    return h('div', { class: 'person' }, avatarMini(avatarWho, 36),
      h('div', { class: 'person-txt' }, h('div', { class: 'person-name' }, name), mail ? h('div', { class: 'person-mail muted' }, mail) : null),
      right);
  }
  function openShare(ids) {
    const items = ids.map(get).filter(Boolean).map(i => realOf(i) || i);
    if (!items.length) return;
    const one = items.length === 1 ? items[0] : null;
    const access = one ? one.access.map(a => Object.assign({}, a)) : [];
    let general = one ? one.general : 'restricted';
    let generalChanged = false, changed = false, role = 'editor';
    const chips = [];

    const input = h('input', { class: 'chip-input', placeholder: 'Add people, groups and calendar events', 'aria-label': 'Add people by email', autocomplete: 'off', spellcheck: 'false' });
    const chipBox = h('div', { class: 'chipbox', onclick: () => input.focus() }, input);
    const roleBtn = h('button', { type: 'button', class: 'role-btn', 'aria-haspopup': 'menu', onclick: e => roleMenu(e.currentTarget, role, r => { role = r; draw(); }) });
    const notify = h('input', { type: 'checkbox', checked: true });
    const msg = h('textarea', { placeholder: 'Message', 'aria-label': 'Message' });
    const inviteSec = h('div', { class: 'invite' },
      h('label', { class: 'cb' }, notify, 'Notify people'), msg,
      h('div', { class: 'share-note muted' }, icon('info'), 'Practice only: no email is ever sent.'));
    notify.addEventListener('change', () => { msg.hidden = !notify.checked; });
    const accessSec = h('div', { class: 'access' });
    const body = h('div', { class: 'share' }, h('div', { class: 'share-field' }, chipBox, roleBtn), inviteSec, accessSec);

    function commit() {
      input.value.split(/[\s,;]+/).filter(Boolean).forEach(p => {
        if (!chips.some(c => c.email.toLowerCase() === p.toLowerCase())) chips.push({ email: p, valid: EMAIL.test(p) });
      });
      input.value = '';
      draw();
    }
    input.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === ';') && input.value.trim()) { e.preventDefault(); e.stopPropagation(); commit(); }
      else if (e.key === 'Backspace' && !input.value && chips.length) { chips.pop(); draw(); }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) commit(); });

    function drawAccess() {
      accessSec.textContent = '';
      accessSec.appendChild(h('h3', { class: 'share-h' }, 'People with access'));
      if (!one || one.owner === 'me') accessSec.appendChild(personRow(C.user.name + ' (you)', C.user.email, 'me', h('span', { class: 'muted' }, 'Owner')));
      else {
        accessSec.appendChild(personRow(one.owner, '', one.owner, h('span', { class: 'muted' }, 'Owner')));
      }
      if (!one && items.length > 1) accessSec.appendChild(h('p', { class: 'muted small' }, 'People you add here get access to all selected items.'));
      access.forEach((a, i) => {
        const isMe = a.email === C.user.email;
        accessSec.appendChild(personRow(isMe ? C.user.name + ' (you)' : a.email, isMe ? a.email : '', a.email,
          isMe ? h('span', { class: 'muted' }, ROLE_LABEL[a.role]) :
            h('button', {
              type: 'button', class: 'role-btn', 'aria-haspopup': 'menu', 'aria-label': `Role for ${a.email}`,
              onclick: e => roleMenu(e.currentTarget, a.role, r => {
                if (r === 'remove') access.splice(i, 1); else a.role = r;
                changed = true;
                drawAccess();
              }, true)
            }, ROLE_LABEL[a.role], icon('arrow_drop_down'))));
      });
      accessSec.appendChild(h('h3', { class: 'share-h' }, 'General access'));
      const setGeneral = g => () => { general = g; generalChanged = true; changed = true; drawAccess(); };
      accessSec.appendChild(h('div', { class: 'g-row' },
        h('span', { class: 'g-ic ' + general }, icon(general === 'anyone' ? 'public' : 'lock')),
        h('div', { class: 'g-text' },
          h('button', {
            type: 'button', class: 'g-btn', 'aria-haspopup': 'menu',
            onclick: e => UI.menu(e.currentTarget, [
              { label: 'Restricted', checked: general === 'restricted', action: setGeneral('restricted') },
              { label: 'Anyone with the link', checked: general === 'anyone', action: setGeneral('anyone') }
            ])
          }, general === 'anyone' ? 'Anyone with the link' : 'Restricted', icon('arrow_drop_down')),
          h('div', { class: 'muted small' }, general === 'anyone' ? 'Anyone on the internet with the link can view' : 'Only people with access can open with the link')),
        general === 'anyone' ? h('span', { class: 'muted' }, 'Viewer') : null));
    }

    let dlg = null;
    function draw() {
      chipBox.querySelectorAll('.pchip').forEach(n => n.remove());
      chips.forEach((c, i) => chipBox.insertBefore(h('span', { class: 'pchip' + (c.valid ? '' : ' bad'), 'data-tip': c.valid ? null : 'Enter a valid email address' },
        avatarMini(c.email, 24), h('span', null, c.email),
        h('button', { type: 'button', class: 'pchip-x', 'aria-label': 'Remove ' + c.email, onclick: e => { e.stopPropagation(); chips.splice(i, 1); draw(); } }, icon('close'))), input));
      const inviting = chips.length > 0;
      roleBtn.hidden = !inviting;
      roleBtn.textContent = '';
      roleBtn.append(ROLE_LABEL[role], icon('arrow_drop_down'));
      inviteSec.hidden = !inviting;
      accessSec.hidden = inviting;
      if (!inviting) drawAccess();
      if (dlg) {
        dlg.buttons.copy.hidden = inviting;
        dlg.buttons.cancel.hidden = !inviting;
        dlg.primary.textContent = inviting ? 'Send' : 'Done';
        dlg.primary.disabled = inviting && chips.some(c => !c.valid);
      }
    }
    function apply(send) {
      items.forEach(it => {
        const acc = one ? access.map(a => Object.assign({}, a)) : it.access.map(a => Object.assign({}, a));
        if (send) chips.forEach(c => {
          const ex = acc.find(a => a.email.toLowerCase() === c.email.toLowerCase());
          if (ex) ex.role = role; else acc.push({ email: c.email, role });
        });
        Store.share(it.id, { access: acc, general: (one || generalChanged) ? general : it.general });
      });
      render();
    }
    dlg = UI.dialog({
      title: one ? `Share “${one.name}”` : `Share ${items.length} items`, body, className: 'share-dialog', width: 520,
      initialFocus: input,
      actions: [
        { label: 'Copy link', id: 'copy', outline: true, icon: 'link', onClick: () => { copyLink(items.map(i => i.id)); return false; } },
        { spacer: true },
        { label: 'Cancel', id: 'cancel', onClick: () => { chips.length = 0; input.value = ''; draw(); input.focus(); return false; } },
        {
          label: 'Done', primary: true, onClick: () => {
            if (chips.length) {
              if (chips.some(c => !c.valid)) return false;
              const added = chips.map(c => c.email);
              apply(true);
              UI.snack(`Shared with ${added.length === 1 ? added[0] : added.length + ' people'}. No email was sent (practice).`);
              Bus.emit('item:share', { ids: items.map(i => i.id), added, role, notify: notify.checked });
              return;
            }
            if (changed) {
              apply(false);
              UI.snack('Sharing settings updated');
              Bus.emit('item:share', { ids: items.map(i => i.id), added: [], general });
            }
          }
        }
      ]
    });
    draw();
  }

  /* ---------- Move dialog ---------- */
  function openMove(ids) {
    const items = ids.map(get).filter(Boolean);
    if (!items.length) return;
    const curParent = items[0].parent;
    let tab = 'suggested', browse = null, picked = null;
    const blocked = fid => fid !== 'root' && ids.some(id => Store.isInside(fid, id));
    const body = h('div', { class: 'move' });
    let dlg = null;

    const dest = () => picked || (tab === 'all' ? browse : null);
    function folderRow(id, name, sub, iconEl, browsable) {
      const isBlocked = blocked(id);
      const row = h('div', {
        class: 'mrow' + (picked === id ? ' on' : '') + (isBlocked ? ' disabled' : ''), role: 'option',
        'aria-selected': String(picked === id), 'aria-disabled': isBlocked ? 'true' : null, tabindex: '0',
        'data-tip': isBlocked ? "You can't move a folder into itself" : null
      },
        iconEl,
        h('div', { class: 'mrow-txt' }, h('div', null, name), sub ? h('div', { class: 'mrow-sub' }, sub) : null),
        browsable ? iconBtn('chevron_right', 'Open ' + name, e => { e.stopPropagation(); tab = 'all'; browse = id; picked = null; draw(); }, { cls: 'sm' }) : null);
      row.addEventListener('click', () => { if (isBlocked) return; picked = picked === id ? null : id; draw(); });
      row.addEventListener('dblclick', () => { if (!browsable) return; tab = 'all'; browse = id; picked = null; draw(); });
      row.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); row.click(); } });
      return row;
    }
    const subFolders = pid => sortByName(Store.children(pid).filter(f => isFolder(f) && !f.shortcutOf));
    const fRow = f => folderRow(f.id, f.name, 'In ' + locationName(f), h('span', { class: 'ficon', html: itemIcon(f) }), true);
    const rootRow = () => folderRow('root', 'My Drive', null, icon('hard_drive'), true);

    function draw() {
      body.textContent = '';
      body.appendChild(h('div', { class: 'move-cur' }, h('span', { class: 'muted' }, 'Current location:'),
        h('span', { class: 'loc-chip' }, icon(locIcon(items[0])), h('span', null, locationName(items[0])))));
      body.appendChild(h('div', { class: 'tabs', role: 'tablist' },
        [['suggested', 'Suggested'], ['starred', 'Starred'], ['all', 'All locations']].map(([t, l]) => h('button', {
          type: 'button', class: 'tab' + (tab === t ? ' on' : ''), role: 'tab', 'aria-selected': String(tab === t),
          onclick: () => { tab = t; browse = null; picked = null; draw(); }
        }, l))));
      const list = h('div', { class: 'move-list', role: 'listbox', 'aria-label': 'Folders' });
      if (tab === 'all' && browse) {
        const name = browse === 'root' ? 'My Drive' : get(browse).name;
        const up = browse === 'root' ? null : (get(browse).parent === 'shared' ? 'root' : get(browse).parent);
        body.appendChild(h('div', { class: 'move-crumb' },
          iconBtn('arrow_back', 'Back', () => { browse = up; picked = null; draw(); }, { cls: 'sm' }), h('span', null, name)));
        const kids = subFolders(browse);
        kids.forEach(f => list.appendChild(fRow(f)));
        if (!kids.length) list.appendChild(h('div', { class: 'move-empty' }, 'No folders here. Use the button below to create one, or click “Move here”.'));
      } else if (tab === 'all') {
        list.appendChild(rootRow());
      } else if (tab === 'suggested') {
        list.appendChild(rootRow());
        Store.all().filter(f => isFolder(f) && !f.shortcutOf && Store.alive(f)).sort(byTouch).slice(0, 8).forEach(f => list.appendChild(fRow(f)));
      } else {
        const st = Store.all().filter(f => isFolder(f) && !f.shortcutOf && f.starred && Store.alive(f));
        st.forEach(f => list.appendChild(fRow(f)));
        if (!st.length) list.appendChild(h('div', { class: 'move-empty' }, 'No starred folders'));
      }
      body.appendChild(list);
      if (dlg) {
        const d = dest();
        dlg.primary.textContent = !picked && tab === 'all' && browse ? 'Move here' : 'Move';
        dlg.primary.disabled = !d || blocked(d) || items.every(i => i.parent === d);
        dlg.buttons.newf.hidden = !(tab === 'all' && browse);
      }
    }
    const newBtn = iconBtn('create_new_folder', 'New folder', () => {
      newFolder(browse, f => { picked = f.id; draw(); });
    }, { attrs: { 'data-newf': '1' } });
    dlg = UI.dialog({
      title: items.length === 1 ? `Move “${items[0].name}”` : `Move ${items.length} items`, body, className: 'move-dialog', width: 560,
      actions: [{ node: newBtn }, { spacer: true }, { label: 'Cancel' }, {
        label: 'Move', primary: true, onClick: () => {
          const d = dest();
          if (!d || blocked(d)) return false;
          moveWithUndo(ids, d);
        }
      }]
    });
    dlg.buttons.newf = newBtn;
    draw();
  }
  function moveWithUndo(ids, destId) {
    const r = Store.move(ids, destId);
    if (!r.ok) { UI.snack("You can't move a folder into itself"); return; }
    if (!r.moved.length) return;
    S.selection.clear();
    render();
    const destName = destId === 'root' ? 'My Drive' : (get(destId) || {}).name;
    const first = get(r.moved[0].id);
    UI.snack(r.moved.length === 1 ? `Moved “${first.name}” to “${destName}”` : `Moved ${r.moved.length} items to “${destName}”`, {
      action: 'Undo', onAction: () => { r.moved.forEach(m => Store.move([m.id], m.from)); render(); UI.snack('Action undone'); }
    });
    Bus.emit('item:move', { ids: r.moved.map(m => m.id), to: destId });
  }

  /* ---------- Uploads ---------- */
  const uploads = [];
  let trayMin = false, uploadTarget = { parent: 'root', inPlace: true };
  function pickFiles() { uploadTarget = createTarget(); const fi = $('#file-input'); fi.value = ''; fi.click(); }
  function pickFolder() { uploadTarget = createTarget(); const fi = $('#folder-input'); fi.value = ''; fi.click(); }
  function bindUploads() {
    $('#file-input').addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      if (files.length) startUploads(files.map(f => ({ file: f, parent: uploadTarget.parent })), !uploadTarget.inPlace);
    });
    $('#folder-input').addEventListener('change', e => uploadFolder(Array.from(e.target.files || []), uploadTarget));
  }
  function uploadFolder(files, tgt) {
    if (!files.length) return;
    const map = {}, jobs = [];
    let rootFolder = null;
    files.forEach(f => {
      const parts = (f.webkitRelativePath || f.name).split('/');
      const fname = parts.pop();
      let parent = tgt.parent, path = '';
      parts.forEach(p => {
        path += '/' + p;
        if (!map[path]) {
          const fo = Store.create({ type: 'folder', name: p, parent, uploaded: true });
          map[path] = fo.id;
          if (!rootFolder) rootFolder = fo;
        }
        parent = map[path];
      });
      if (fname.startsWith('.')) return;
      jobs.push({ file: f, parent });
    });
    Bus.emit('folder:upload', { id: rootFolder && rootFolder.id, name: rootFolder && rootFolder.name, files: jobs.length });
    render();
    startUploads(jobs, !tgt.inPlace);
  }
  function startUploads(jobs, notInPlace) {
    let pending = uploads.filter(u => u.state === 'uploading').reduce((s, u) => s + u.size, 0);
    let quotaHit = false;
    jobs.forEach((j, i) => {
      const u = { id: Store.uid(), name: j.file.name, size: j.file.size, type: Icons.typeFromName(j.file.name, j.file.type), parent: j.parent, progress: 0, state: 'uploading', file: j.file };
      if (Store.usedBytes() + pending + u.size > Store.quotaBytes()) { u.state = 'error'; u.error = 'Not enough storage'; quotaHit = true; }
      else pending += u.size;
      uploads.push(u);
      if (u.state === 'uploading') runUpload(u, i * 200);
    });
    trayMin = false;
    renderTray();
    if (quotaHit) UI.snack(`Not enough storage. Uploads beyond your ${C.quotaGB} GB were refused.`, { action: 'Get storage', onAction: () => NA('Buying more storage') });
    else if (notInPlace) UI.snack('Uploading to My Drive', { action: 'Show location', onAction: () => go('my-drive') });
  }
  function runUpload(u, delay) {
    const dur = C.uploadSpeedMs * (0.8 + Math.random() * 0.4) + Math.min(u.size / (25 * 1024 * 1024), 1) * C.uploadSpeedMs;
    const t0 = Date.now() + delay;
    const step = () => {
      if (u.state !== 'uploading') return;
      u.progress = Math.max(0, Math.min(1, (Date.now() - t0) / dur));
      updateRing(u);
      if (u.progress >= 1) finishUpload(u); else setTimeout(step, 40);
    };
    setTimeout(step, 40);
  }
  const isTextLike = u => u.type === 'text' || /^text\//.test(u.file.type) || /\.(csv|md|json|txt|log|xml|html?|css|js|ts|py)$/i.test(u.name);
  async function finishUpload(u) {
    let textContent = null;
    if (isTextLike(u) && u.file.size <= 1024 * 1024) { try { textContent = await u.file.text(); } catch (e) { textContent = null; } }
    if (u.state !== 'uploading') return;
    const parent = u.parent === 'root' || Store.alive(get(u.parent)) ? u.parent : 'root';
    const it = Store.create({ type: u.type, name: u.name, parent, size: u.size, mime: u.file.type, blobUrl: URL.createObjectURL(u.file), textContent, uploaded: true });
    u.state = 'done';
    u.itemId = it.id;
    u.file = null;
    renderTray();
    render();
    Bus.emit('file:upload', { id: it.id, name: it.name, size: it.size, type: it.type });
  }
  function ringSvg(p) {
    const c = 2 * Math.PI * 9;
    return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#e1e3e1" stroke-width="3"/><circle class="ring-fg" cx="12" cy="12" r="9" fill="none" stroke="#0b57d0" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" transform="rotate(-90 12 12)"/></svg>`;
  }
  function updateRing(u) {
    const fg = $(`#upload-tray [data-uid="${u.id}"] .ring-fg`);
    if (fg) fg.setAttribute('stroke-dashoffset', (2 * Math.PI * 9 * (1 - u.progress)).toFixed(2));
  }
  function renderTray() {
    const tray = $('#upload-tray');
    if (!uploads.length) {
      tray.hidden = true;
      document.body.classList.remove('tray-open');
      document.documentElement.style.setProperty('--tray-h', '0px');
      return;
    }
    tray.hidden = false;
    document.body.classList.add('tray-open');
    const active = uploads.filter(u => u.state === 'uploading').length;
    const done = uploads.filter(u => u.state === 'done').length;
    const title = active ? `Uploading ${active} item${active === 1 ? '' : 's'}` : `${done} upload${done === 1 ? '' : 's'} complete`;
    tray.textContent = '';
    tray.appendChild(h('div', { class: 'ut-head' },
      h('span', { class: 'ut-title', 'aria-live': 'polite' }, title),
      iconBtn(trayMin ? 'expand_less' : 'expand_more', trayMin ? 'Maximise' : 'Minimise', () => { trayMin = !trayMin; renderTray(); }),
      iconBtn('close', 'Close', closeTray)));
    if (active && !trayMin) tray.appendChild(h('div', { class: 'ut-sub' }, h('span', null, 'Less than a minute left…'),
      h('button', { type: 'button', class: 'btn-text sm', onclick: cancelAll }, 'Cancel')));
    if (!trayMin) {
      const list = h('div', { class: 'ut-list' });
      uploads.forEach(u => list.appendChild(trayRow(u)));
      tray.appendChild(list);
    }
    document.documentElement.style.setProperty('--tray-h', tray.offsetHeight + 'px');
  }
  function trayRow(u) {
    let status;
    if (u.state === 'uploading') status = h('span', { class: 'ut-prog' }, h('span', { class: 'ring', html: ringSvg(u.progress) }),
      h('button', { type: 'button', class: 'icon-btn sm ut-cancel', 'aria-label': 'Cancel upload', 'data-tip': 'Cancel upload', onclick: e => { e.stopPropagation(); u.state = 'cancelled'; renderTray(); } }, icon('close')));
    else if (u.state === 'done') status = icon('check_circle', 'fill ok');
    else if (u.state === 'cancelled') status = h('span', { class: 'ut-note' }, 'Cancelled');
    else status = h('span', { class: 'ut-note err' }, icon('error', 'fill'), u.error);
    const row = h('div', {
      class: 'ut-row ' + u.state, 'data-uid': u.id,
      role: u.state === 'done' ? 'button' : null, tabindex: u.state === 'done' ? '0' : null,
      'data-tip': u.state === 'done' ? 'Show file location' : null
    }, h('span', { class: 'ficon', html: Icons.svg(u.type) }), h('span', { class: 'ut-name', title: u.name }, u.name), h('span', { class: 'ut-status' }, status));
    if (u.state === 'done') {
      const show = () => { const it = get(u.itemId); if (it && Store.alive(it)) showLocation(it, true); else UI.snack('This file was moved to trash or deleted'); };
      row.addEventListener('click', show);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
    }
    return row;
  }
  async function cancelAll() {
    const ok = await UI.confirm({ title: 'Cancel all uploads?', text: 'Your uploads are not complete. Would you like to cancel all ongoing uploads?', ok: 'Cancel uploads', cancel: 'Continue uploads' });
    if (!ok) return;
    uploads.forEach(u => { if (u.state === 'uploading') u.state = 'cancelled'; });
    renderTray();
  }
  async function closeTray() {
    if (uploads.some(u => u.state === 'uploading')) {
      await cancelAll();
      if (uploads.some(u => u.state === 'uploading')) return;
    }
    uploads.length = 0;
    renderTray();
  }

  /* ---------- Drag and drop ---------- */
  let dragIds = null, dropHoverEl = null, osTimer = null;
  function setDropHover(el) {
    if (dropHoverEl === el) return;
    if (dropHoverEl) dropHoverEl.classList.remove('drop-hover');
    dropHoverEl = el;
    if (el) el.classList.add('drop-hover');
  }
  function dropDefault() {
    if (S.view === 'folders' && Store.alive(get(S.folderId))) return { parent: S.folderId, inPlace: true };
    return { parent: 'root', inPlace: S.view === 'my-drive' };
  }
  const folderUnder = node => node && node.closest ? node.closest('#content [data-drop-folder]') : null;
  function showDropOverlay(folderEl) {
    const fid = folderEl ? folderEl.dataset.dropFolder : dropDefault().parent;
    $('#drop-name').textContent = fid === 'root' ? 'My Drive' : (get(fid) || { name: 'My Drive' }).name;
    $('#drop-overlay').hidden = false;
    setDropHover(folderEl || null);
  }
  function hideDropOverlay() { $('#drop-overlay').hidden = true; if (!dragIds) setDropHover(null); }
  function dropTargetFor(node) {
    if (!node || !node.closest || !dragIds) return null;
    const tr = node.closest('[data-drop-trash]');
    if (tr) return { el: tr, trash: true };
    const el = node.closest('[data-drop-folder]');
    if (!el) return null;
    const fid = el.dataset.dropFolder;
    if (dragIds.includes(fid) || dragIds.includes(el.dataset.id)) return null;
    if (fid !== 'root' && dragIds.some(id => Store.isInside(fid, id))) return null;
    if (dragIds.every(id => (get(id) || {}).parent === fid)) return null;
    return { el, folder: fid };
  }
  function bindDnD() {
    document.addEventListener('dragstart', e => {
      const el = e.target.closest ? e.target.closest('[data-id][draggable="true"]') : null;
      if (!el) return;
      const id = el.dataset.id;
      if (!S.selection.has(id)) selectOnly(id);
      dragIds = Array.from(S.selection);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragIds.map(i => (get(i) || {}).name).join(', '));
      const ghost = h('div', { class: 'drag-ghost' }, h('span', { class: 'ficon', html: itemIcon(get(id)) }), dragIds.length === 1 ? get(id).name : dragIds.length + ' items');
      document.body.appendChild(ghost);
      try { e.dataTransfer.setDragImage(ghost, 20, 20); } catch (err) { /* ignore */ }
      setTimeout(() => ghost.remove());
    });
    document.addEventListener('dragend', () => { dragIds = null; setDropHover(null); });
    document.addEventListener('dragover', e => {
      if (dragIds) {
        const t = dropTargetFor(e.target);
        if (t) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropHover(t.el); }
        else setDropHover(null);
        return;
      }
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes('Files')) return;
      e.preventDefault();
      const inMain = e.target.closest && e.target.closest('#main');
      e.dataTransfer.dropEffect = inMain ? 'copy' : 'none';
      if (inMain) showDropOverlay(folderUnder(e.target)); else hideDropOverlay();
      clearTimeout(osTimer);
      osTimer = setTimeout(hideDropOverlay, 250);
    });
    document.addEventListener('drop', e => {
      if (dragIds) {
        e.preventDefault();
        const t = dropTargetFor(e.target);
        const ids = dragIds;
        dragIds = null;
        setDropHover(null);
        if (t) { if (t.trash) doTrash(ids); else moveWithUndo(ids, t.folder); }
        return;
      }
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes('Files')) return;
      e.preventDefault();
      const fEl = folderUnder(e.target);
      hideDropOverlay();
      setDropHover(null);
      if (!e.target.closest || !e.target.closest('#main')) return;
      const entries = Array.from(e.dataTransfer.items || []).map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
      if (entries.some(en => en && en.isDirectory)) {
        UI.snack('To upload a folder, use New › Folder upload', { action: 'Folder upload', onAction: pickFolder });
        return;
      }
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const d = fEl ? { parent: fEl.dataset.dropFolder, inPlace: true } : dropDefault();
      startUploads(files.map(f => ({ file: f, parent: d.parent })), !d.inPlace);
    });
  }

  /* ---------- Viewer ---------- */
  let viewer = null;
  function openViewer(it) {
    closeViewer(true);
    let list = lastIds.map(get).filter(i => i && !isFolder(i) && !isNative(realOf(i) || i) && !i.trashed).map(i => realOf(i) || i);
    list = list.filter((x, i) => list.findIndex(y => y.id === x.id) === i);
    let idx = list.findIndex(i => i.id === it.id);
    if (idx < 0) { list = [it]; idx = 0; }
    const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'File preview', tabindex: '-1' });
    document.body.appendChild(el);
    viewer = { el, list, idx, prevFocus: document.activeElement };
    el.addEventListener('keydown', e => {
      if (UI.dialogOpen() || UI.menuOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeViewer(); }
      else if (e.key === 'ArrowLeft' && !e.target.closest('video, audio')) { e.preventDefault(); stepViewer(-1); }
      else if (e.key === 'ArrowRight' && !e.target.closest('video, audio')) { e.preventDefault(); stepViewer(1); }
    });
    drawViewer();
    el.focus();
  }
  function stepViewer(d) {
    if (!viewer) return;
    const n = viewer.idx + d;
    if (n < 0 || n >= viewer.list.length) return;
    viewer.idx = n;
    drawViewer();
    viewer.el.focus();
  }
  function drawViewer() {
    const { el, list, idx } = viewer;
    const it = list[idx];
    Store.touchOpened(it.id);
    el.textContent = '';
    el.appendChild(h('div', { class: 'vbar' },
      iconBtn('arrow_back', 'Close', () => closeViewer()),
      h('span', { class: 'ficon', html: itemIcon(it, 24) }),
      h('span', { class: 'vname', title: it.name }, it.name),
      h('span', { class: 'spacer' }),
      iconBtn('person_add', 'Share', () => openShare([it.id])),
      iconBtn('download', 'Download', () => doDownload([it.id])),
      iconBtn('more_vert', 'More actions', e => openContextMenu([it.id], e.currentTarget))));
    const stage = h('div', { class: 'vbody' }, previewFor(it));
    if (idx > 0) stage.appendChild(h('button', { type: 'button', class: 'vnav prev', 'aria-label': 'Previous file', 'data-tip': 'Previous', onclick: () => stepViewer(-1) }, icon('chevron_left')));
    if (idx < list.length - 1) stage.appendChild(h('button', { type: 'button', class: 'vnav next', 'aria-label': 'Next file', 'data-tip': 'Next', onclick: () => stepViewer(1) }, icon('chevron_right')));
    el.appendChild(stage);
    if (list.length > 1) el.appendChild(h('div', { class: 'vcount' }, `${idx + 1} of ${list.length}`));
  }
  function previewFor(it) {
    const url = it.blobUrl, t = it.type;
    if (url && t === 'image') return h('img', { class: 'v-img', src: url, alt: it.name });
    if (url && t === 'video') return h('video', { class: 'v-media', src: url, controls: true });
    if (url && t === 'audio') return h('div', { class: 'v-audio' }, h('span', { html: itemIcon(it, 96) }), h('audio', { src: url, controls: true }));
    if (url && t === 'pdf') return h('iframe', { class: 'v-pdf', src: url, title: it.name });
    if (it.textContent != null) return h('pre', { class: 'v-text', tabindex: '0' }, it.textContent);
    return h('div', { class: 'v-none' }, h('span', { html: itemIcon(it, 64) }),
      h('h2', null, 'No preview available'),
      h('p', null, url ? "This file type can't be previewed here. Download it to open it on your computer." : 'This is a sample practice file, so there is nothing to preview.'),
      url ? h('button', { type: 'button', class: 'btn-filled', onclick: () => doDownload([it.id]) }, icon('download'), 'Download') : null);
  }
  function closeViewer(silent) {
    if (!viewer) return;
    const v = viewer;
    viewer = null;
    v.el.remove();
    if (!silent) { render(); if (v.prevFocus && document.contains(v.prevFocus)) v.prevFocus.focus({ preventScroll: true }); else $('#content').focus({ preventScroll: true }); }
  }

  /* ---------- Simulated editors ---------- */
  let editor = null;
  function markEdited(it) {
    it.modified = Date.now();
    if (editor && !editor.edited) { editor.edited = true; Store.log('edit', it); }
  }
  function openEditor(it, opts) {
    opts = opts || {};
    closeEditor(true);
    Store.touchOpened(it.id);
    if (!it.content) it.content = defaultContent(it.type);
    const title = h('input', { class: 'ed-title', 'aria-label': 'Rename', 'data-tip': 'Rename', spellcheck: 'false' });
    title.value = it.name;
    const commitTitle = () => {
      const v = title.value.trim();
      if (!v) { title.value = it.name; return; }
      if (v === it.name) return;
      const from = Store.rename(it.id, v);
      render();
      Bus.emit('item:rename', { id: it.id, from, to: v });
    };
    title.addEventListener('change', commitTitle);
    title.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); title.value = it.name; title.blur(); }
    });
    const starBtn = iconBtn('star', it.starred ? 'Remove from starred' : 'Star', () => {
      doStar([it.id], !it.starred);
      starBtn.replaceWith(starBtn2());
    }, { cls: 'sm', fill: it.starred });
    const starBtn2 = () => { const b = iconBtn('star', it.starred ? 'Remove from starred' : 'Star', () => { doStar([it.id], !it.starred); b.replaceWith(starBtn2()); }, { cls: 'sm', fill: it.starred }); return b; };
    const el = h('div', { class: 'editor ed-' + it.type, role: 'dialog', 'aria-modal': 'true', 'aria-label': APP_NAME[it.type] + ' (simulated editor)' },
      h('header', { class: 'ed-head' },
        h('button', { type: 'button', class: 'ed-logo', 'data-tip': 'Back to Drive', 'aria-label': 'Back to Drive', onclick: () => closeEditor(), html: Icons.product(PRODUCT[it.type], 40) }),
        h('div', { class: 'ed-titles' },
          h('div', { class: 'ed-row1' }, title, starBtn,
            iconBtn('drive_file_move', 'Move', () => openMove([it.id]), { cls: 'sm' }),
            h('span', { class: 'ed-badge', 'data-tip': 'This is a practice copy of the editor. Only basic typing works.' }, icon('school'), 'Simulated editor')),
          h('nav', { class: 'ed-menus', 'aria-label': 'Editor menus' },
            ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Extensions', 'Help'].map(m => h('button', { type: 'button', onclick: () => NA(`The ${m} menu`) }, m)))),
        h('button', { type: 'button', class: 'ed-share', onclick: () => openShare([it.id]) }, icon(isShared(it) ? 'group' : 'lock'), 'Share'),
        h('span', { class: 'avatar hide-sm', 'data-tip': C.user.name + ' (you)' }, C.user.initial),
        iconBtn('close', 'Close editor', () => closeEditor())));
    const body = h('div', { class: 'ed-body' });
    el.appendChild(body);
    ({ doc: docEditor, sheet: sheetEditor, slide: slideEditor, form: formEditor })[it.type](body, it);
    document.body.appendChild(el);
    editor = { el, it, opts, edited: false, prevFocus: document.activeElement };
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !UI.dialogOpen() && !UI.menuOpen() && !e.target.closest('[contenteditable], input, textarea')) { e.preventDefault(); closeEditor(); }
    });
    setTimeout(() => { const f = el.querySelector('.doc-page, .sl-title, .cell-in, .f-in'); if (f) f.focus(); else title.focus(); });
  }
  function closeEditor(silent) {
    if (!editor) return;
    const e = editor;
    editor = null;
    e.el.remove();
    if (silent) return;
    render();
    if (e.opts.isNew && !e.opts.inPlace && Store.alive(e.it)) {
      UI.snack(`“${e.it.name}” saved in My Drive`, { action: 'Show location', onAction: () => showLocation(e.it) });
    }
    if (e.opts.inPlace) scrollToItem(e.it.id);
  }
  function edToolbar(extra) {
    const tool = (ic, tip, fn) => iconBtn(ic, tip, fn || (() => NA(tip)), { cls: 'sm' });
    return h('div', { class: 'ed-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
      tool('undo', 'Undo', () => document.execCommand('undo')), tool('redo', 'Redo', () => document.execCommand('redo')), tool('print', 'Print'),
      h('span', { class: 'ed-tsep' }), h('span', { class: 'ed-tlabel' }, '100%'), h('span', { class: 'ed-tsep' }), extra || null);
  }
  function docEditor(body, it) {
    const exec = (cmd, tip, ic) => iconBtn(ic, tip, () => { document.execCommand(cmd); page.focus(); }, { cls: 'sm', attrs: { onmousedown: e => e.preventDefault() } });
    const page = h('div', { class: 'doc-page', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document text', spellcheck: 'true', 'data-placeholder': 'Start typing your document…' });
    page.innerHTML = it.content.html || '';
    page.addEventListener('input', () => { it.content.html = page.innerHTML; it.content.text = page.innerText; markEdited(it); });
    body.append(
      edToolbar([h('span', { class: 'ed-tlabel' }, 'Normal text'), h('span', { class: 'ed-tlabel' }, 'Arial'), h('span', { class: 'ed-tsep' }),
        exec('bold', 'Bold', 'format_bold'), exec('italic', 'Italic', 'format_italic'), exec('underline', 'Underline', 'format_underlined'),
        h('span', { class: 'ed-tsep' }), exec('insertUnorderedList', 'Bulleted list', 'format_list_bulleted'), exec('insertOrderedList', 'Numbered list', 'format_list_numbered')]),
      h('div', { class: 'doc-canvas' }, page));
  }
  function sheetEditor(body, it) {
    const cells = it.content.cells;
    const COLN = 26, ROWS = 60;
    const nameBox = h('div', { class: 'name-box', 'aria-live': 'polite' }, 'A1');
    const fx = h('input', { class: 'fx-in', 'aria-label': 'Formula bar', spellcheck: 'false' });
    let active = null;
    const table = h('table', { class: 'sheet', role: 'grid', 'aria-label': 'Spreadsheet' });
    const head = h('tr', null, h('th', { class: 'corner' }));
    for (let c = 0; c < COLN; c++) head.appendChild(h('th', { scope: 'col' }, String.fromCharCode(65 + c)));
    table.appendChild(h('thead', null, head));
    const tb = h('tbody');
    for (let r = 1; r <= ROWS; r++) {
      const tr = h('tr', null, h('th', { scope: 'row' }, r));
      for (let c = 0; c < COLN; c++) {
        const key = String.fromCharCode(65 + c) + r;
        const inp = h('input', { class: 'cell-in', 'data-key': key, 'data-r': r, 'data-c': c, 'aria-label': 'Cell ' + key, spellcheck: 'false' });
        if (cells[key]) inp.value = cells[key];
        tr.appendChild(h('td', null, inp));
      }
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const setCell = (inp, v) => { if (v) cells[inp.dataset.key] = v; else delete cells[inp.dataset.key]; markEdited(it); };
    table.addEventListener('focusin', e => { if (e.target.classList.contains('cell-in')) { active = e.target; nameBox.textContent = active.dataset.key; fx.value = active.value; } });
    table.addEventListener('input', e => { if (e.target.classList.contains('cell-in')) { setCell(e.target, e.target.value); fx.value = e.target.value; } });
    table.addEventListener('keydown', e => {
      const t = e.target;
      if (!t.classList.contains('cell-in')) return;
      const r = +t.dataset.r, c = +t.dataset.c;
      let nr = r, nc = c;
      if (e.key === 'Enter' || e.key === 'ArrowDown') nr = r + (e.shiftKey && e.key === 'Enter' ? -1 : 1);
      else if (e.key === 'ArrowUp') nr = r - 1;
      else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) nc = c + 1;
      else if (e.key === 'ArrowLeft' && t.selectionStart === 0) nc = c - 1;
      else return;
      const n = table.querySelector(`.cell-in[data-r="${nr}"][data-c="${nc}"]`);
      if (n) { e.preventDefault(); n.focus(); n.select(); }
    });
    fx.addEventListener('input', () => { if (active) { active.value = fx.value; setCell(active, fx.value); } });
    body.append(
      edToolbar([iconBtn('format_bold', 'Bold', () => NA('Cell formatting'), { cls: 'sm' }), iconBtn('format_color_fill', 'Fill colour', () => NA('Cell formatting'), { cls: 'sm' }), iconBtn('functions', 'Functions', () => NA('Functions', true), { cls: 'sm' })]),
      h('div', { class: 'fx-bar' }, nameBox, h('span', { class: 'fx' }, 'fx'), fx),
      h('div', { class: 'sheet-wrap' }, table),
      h('div', { class: 'sheet-tabs' }, iconBtn('add', 'Add sheet', () => NA('Adding sheets'), { cls: 'sm' }), h('span', { class: 'sheet-tab' }, 'Sheet1')));
  }
  function slideEditor(body, it) {
    const c = it.content;
    let cur = 0;
    const strip = h('div', { class: 'filmstrip', 'aria-label': 'Slides' });
    const stage = h('div', { class: 'slide-stage' });
    function drawStrip() {
      strip.textContent = '';
      c.slides.forEach((s, i) => strip.appendChild(h('button', {
        type: 'button', class: 'thumb-slide' + (i === cur ? ' on' : ''), 'aria-label': 'Slide ' + (i + 1), 'aria-current': i === cur ? 'true' : null,
        onclick: () => { cur = i; draw(); }
      }, h('span', { class: 'tn' }, i + 1), h('div', { class: 'mini' }, h('div', { class: 'mini-t' }, s.title), h('div', { class: 'mini-b' }, s.body)))));
      strip.appendChild(h('button', {
        type: 'button', class: 'btn-text add-slide',
        onclick: () => { c.slides.push({ title: '', body: '' }); cur = c.slides.length - 1; markEdited(it); draw(); }
      }, icon('add'), 'New slide'));
    }
    function draw() {
      drawStrip();
      stage.textContent = '';
      const s = c.slides[cur];
      const t = h('div', { class: 'sl-title', contenteditable: 'true', role: 'textbox', 'aria-label': 'Slide title', 'data-placeholder': 'Click to add title' });
      const b = h('div', { class: 'sl-sub', contenteditable: 'true', role: 'textbox', 'aria-label': 'Slide subtitle', 'data-placeholder': 'Click to add subtitle' });
      t.textContent = s.title;
      b.textContent = s.body;
      const sync = () => { s.title = t.textContent; s.body = b.textContent; markEdited(it); const on = strip.querySelector('.on'); if (on) { on.querySelector('.mini-t').textContent = s.title; on.querySelector('.mini-b').textContent = s.body; } };
      t.addEventListener('input', sync);
      b.addEventListener('input', sync);
      stage.appendChild(h('div', { class: 'slide' }, t, b));
    }
    draw();
    body.append(
      edToolbar([iconBtn('add_box', 'New slide', () => { c.slides.push({ title: '', body: '' }); cur = c.slides.length - 1; markEdited(it); draw(); }, { cls: 'sm' }),
        iconBtn('image', 'Insert image', () => NA('Inserting images'), { cls: 'sm' }), iconBtn('slideshow', 'Slideshow', () => NA('Presenting'), { cls: 'sm' })]),
      h('div', { class: 'slides' }, strip, stage));
  }
  function formEditor(body, it) {
    const c = it.content;
    const wrap = h('div', { class: 'form-wrap' });
    const field = (cls, val, ph, onInput, label) => {
      const i = h('input', { class: 'f-in ' + cls, placeholder: ph, 'aria-label': label || ph, spellcheck: 'false' });
      i.value = val;
      i.addEventListener('input', () => { onInput(i.value); markEdited(it); });
      return i;
    };
    function draw() {
      wrap.textContent = '';
      wrap.appendChild(h('div', { class: 'fcard-ed head' },
        field('title', c.title, 'Form title', v => { c.title = v; }),
        field('', c.desc, 'Form description', v => { c.desc = v; })));
      c.questions.forEach((q, qi) => {
        const card = h('div', { class: 'fcard-ed' }, field('q', q.q, 'Question', v => { q.q = v; }, 'Question ' + (qi + 1)));
        q.options.forEach((o, oi) => card.appendChild(h('div', { class: 'f-opt' }, icon('radio_button_unchecked'),
          field('', o, 'Option', v => { q.options[oi] = v; }, `Question ${qi + 1}, option ${oi + 1}`),
          q.options.length > 1 ? iconBtn('close', 'Remove option', () => { q.options.splice(oi, 1); markEdited(it); draw(); }, { cls: 'sm' }) : null)));
        card.appendChild(h('div', { class: 'f-actions' },
          h('button', { type: 'button', class: 'btn-text sm', onclick: () => { q.options.push('Option ' + (q.options.length + 1)); markEdited(it); draw(); } }, icon('add'), 'Add option'),
          c.questions.length > 1 ? iconBtn('delete', 'Delete question', () => { c.questions.splice(qi, 1); markEdited(it); draw(); }, { cls: 'sm' }) : null));
        wrap.appendChild(card);
      });
      wrap.appendChild(h('button', {
        type: 'button', class: 'btn-outline', style: { alignSelf: 'center' },
        onclick: () => { c.questions.push({ q: 'Untitled Question', options: ['Option 1'] }); markEdited(it); draw(); }
      }, icon('add_circle'), 'Add question'));
    }
    draw();
    body.appendChild(wrap);
  }

  /* ---------- Search ---------- */
  function highlight(name, q) {
    if (!q) return UI.esc(name);
    const i = name.toLowerCase().indexOf(q);
    if (i < 0) return UI.esc(name);
    return UI.esc(name.slice(0, i)) + '<b>' + UI.esc(name.slice(i, i + q.length)) + '</b>' + UI.esc(name.slice(i + q.length));
  }
  function bindSearch() {
    const wrap = $('#search-wrap'), input = $('#search-input'), dd = $('#search-dd'), form = $('#search-form'), clear = $('#search-clear');
    let hi = -1;
    const closeDD = () => { dd.hidden = true; wrap.classList.remove('open'); hi = -1; input.removeAttribute('aria-activedescendant'); };
    const keep = e => e.preventDefault();
    function opt(i, q) {
      return h('button', {
        type: 'button', class: 'dd-opt', role: 'option', id: 'dd-' + i.id, onmousedown: keep,
        onclick: () => { closeDD(); input.blur(); openItem(i); }
      },
        h('span', { class: 'ficon', html: itemIcon(i) }),
        h('span', { class: 'dd-name', html: highlight(i.name, q) }),
        h('span', { class: 'dd-loc' }, locationName(i)),
        h('span', { class: 'dd-date' }, Store.fmtDate(lastTouch(i))));
    }
    function openDD() {
      const q = input.value.trim().toLowerCase();
      dd.textContent = '';
      if (!q) {
        dd.appendChild(h('div', { class: 'dd-chips' }, ['documents', 'spreadsheets', 'presentations', 'pdfs', 'photos', 'videos', 'folders'].map(gid => {
          const g = Icons.group(gid);
          return h('button', {
            type: 'button', class: 'chip', onmousedown: keep,
            onclick: () => { S.filters = Store.emptyFilters(); S.filters.type = gid; S.adv = null; closeDD(); input.blur(); runSearch(''); }
          }, h('span', { class: 'chip-ic', html: Icons.groupIcon(g, 18) }), g.label);
        })));
        const rec = Store.all().filter(i => !isFolder(i) && Store.alive(i)).sort(byTouch).slice(0, 5);
        if (rec.length) { dd.appendChild(h('div', { class: 'dd-head' }, 'Recent files')); rec.forEach(i => dd.appendChild(opt(i, ''))); }
        else dd.appendChild(h('div', { class: 'dd-empty' }, 'Files you open or create will appear here'));
      } else {
        const matches = Store.all().filter(i => Store.alive(i) && i.name.toLowerCase().includes(q)).sort(byTouch).slice(0, 8);
        matches.forEach(i => dd.appendChild(opt(i, q)));
        if (!matches.length) dd.appendChild(h('div', { class: 'dd-empty' }, 'No names match. Press Enter to search everything.'));
        dd.appendChild(h('button', { type: 'button', class: 'dd-opt', role: 'option', id: 'dd-all', onmousedown: keep, onclick: submit },
          icon('search'), h('span', { class: 'dd-name' }, `See all results for “${input.value.trim()}”`), h('span'), h('span')));
      }
      dd.appendChild(h('div', { class: 'dd-foot' }, h('button', { type: 'button', class: 'btn-text sm', onmousedown: keep, onclick: () => { closeDD(); input.blur(); openAdvanced(); } }, icon('tune'), 'Advanced search')));
      dd.hidden = false;
      wrap.classList.add('open');
      hi = -1;
    }
    function moveHi(d) {
      const opts = $$('.dd-opt', dd);
      if (!opts.length) return;
      hi = hi < 0 ? (d > 0 ? 0 : opts.length - 1) : (hi + d + opts.length) % opts.length;
      opts.forEach((o, k) => o.classList.toggle('hi', k === hi));
      opts[hi].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', opts[hi].id);
    }
    function submit() {
      const q = input.value.trim();
      if (!q) return;
      closeDD();
      input.blur();
      S.adv = null;
      runSearch(q);
    }
    input.addEventListener('focus', () => { wrap.classList.add('focus'); openDD(); });
    input.addEventListener('blur', () => setTimeout(() => { if (!wrap.contains(document.activeElement)) { wrap.classList.remove('focus'); closeDD(); } }, 120));
    input.addEventListener('input', () => { clear.hidden = !input.value; openDD(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHi(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHi(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDD(); input.blur(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const opts = $$('.dd-opt', dd);
        if (hi >= 0 && opts[hi]) opts[hi].click(); else submit();
      }
    });
    form.addEventListener('submit', e => { e.preventDefault(); submit(); });
    document.addEventListener('mousedown', e => { if (!wrap.contains(e.target)) { closeDD(); wrap.classList.remove('focus'); } });
    clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; input.focus(); openDD(); });
    $('#btn-adv').addEventListener('click', openAdvanced);
  }
  function openAdvanced() {
    const a = Object.assign({ type: '', owner: 'any', ownerName: '', words: '', name: '', location: '', modified: '', inTrash: false, starred: false }, S.adv || {});
    if (!S.adv && $('#search-input').value.trim()) a.words = $('#search-input').value.trim();
    const sel = (opts, val, label) => {
      const s = h('select', { class: 'input', 'aria-label': label });
      opts.forEach(([v, l]) => s.appendChild(h('option', { value: v, selected: v === val ? true : null }, l)));
      return s;
    };
    const fType = sel([['', 'Any']].concat(Icons.TYPE_GROUPS.map(g => [g.id, g.label])), a.type, 'Type');
    const fOwner = sel([['any', 'Anyone'], ['me', 'Owned by me'], ['notme', 'Not owned by me'], ['specific', 'Specific person…']], a.owner, 'Owner');
    const fOwnerName = h('input', { class: 'input', placeholder: 'Enter a name or email address', 'aria-label': 'Owner name or email', hidden: a.owner !== 'specific' ? true : null });
    fOwnerName.value = a.ownerName;
    fOwner.addEventListener('change', () => { fOwnerName.hidden = fOwner.value !== 'specific'; });
    const text = (val, ph, label) => { const i = h('input', { class: 'input', placeholder: ph, 'aria-label': label }); i.value = val; return i; };
    const fWords = text(a.words, 'Enter words found in the file', 'Has the words');
    const fName = text(a.name, 'Enter a term that matches part of the file name', 'Item name');
    const fLoc = sel([['', 'Anywhere'], ['my-drive', 'My Drive'], ['shared', 'Shared with me']], a.location, 'Location');
    const fMod = sel([['', 'Any time'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['year', 'This year'], ['lastyear', 'Last year']], a.modified, 'Date modified');
    const fTrash = h('input', { type: 'checkbox', checked: a.inTrash ? true : null });
    const fStar = h('input', { type: 'checkbox', checked: a.starred ? true : null });
    const row = (label, ctrl) => h('div', { class: 'adv-row' }, h('span', { class: 'adv-lbl' }, label), ctrl);
    const body = h('div', { class: 'adv' },
      row('Type', fType),
      row('Owner', h('div', { class: 'adv-stack' }, fOwner, fOwnerName)),
      row('Has the words', fWords),
      row('Item name', fName),
      row('Location', h('div', { class: 'adv-stack' }, fLoc, h('div', { class: 'adv-checks' }, h('label', { class: 'cb' }, fTrash, 'In trash'), h('label', { class: 'cb' }, fStar, 'Starred')))),
      row('Date modified', fMod));
    UI.dialog({
      title: 'Advanced search', body, className: 'adv-dialog', width: 640,
      actions: [
        { label: 'Learn more', onClick: () => { NA('Help articles', true); return false; } },
        { spacer: true },
        {
          label: 'Reset', onClick: () => {
            fType.value = ''; fOwner.value = 'any'; fOwnerName.value = ''; fOwnerName.hidden = true; fWords.value = ''; fName.value = '';
            fLoc.value = ''; fMod.value = ''; fTrash.checked = false; fStar.checked = false;
            return false;
          }
        },
        {
          label: 'Search', primary: true, onClick: () => {
            const adv = {
              type: fType.value, owner: fOwner.value, ownerName: fOwnerName.value.trim(), words: fWords.value.trim(), name: fName.value.trim(),
              location: fLoc.value, modified: fMod.value, inTrash: fTrash.checked, starred: fStar.checked
            };
            const isEmpty = !adv.type && adv.owner === 'any' && !adv.words && !adv.name && !adv.location && !adv.modified && !adv.inTrash && !adv.starred;
            S.adv = isEmpty ? null : adv;
            S.filters = Store.emptyFilters();
            runSearch(adv.words || adv.name || '');
          }
        }
      ]
    });
  }

  /* ---------- Header, settings, rail ---------- */
  const SHORTCUTS = [
    [['/'], 'Search'], [['V'], 'Toggle list / grid'], [['D'], 'Show or hide details'],
    [['Shift', 'F'], 'New folder'], [['Shift', 'T'], 'New document'], [['Shift', 'S'], 'New spreadsheet'],
    [['Shift', 'P'], 'New presentation'], [['Shift', 'O'], 'New form'],
    [['Alt', 'C'], 'then F / U / I: new folder, upload files, upload folder'],
    [['N'], 'Rename'], [['S'], 'Star or unstar'], [['Enter'], 'Open (or O)'], [['Z'], 'Move'],
    [['Delete'], 'Move to trash (or #)'], [['.'], 'Share'], [['↑', '↓', '←', '→'], 'Move selection (add Shift to extend)'],
    [['Ctrl/⌘', 'A'], 'Select all'], [['Esc'], 'Clear selection / close'], [['?'], 'Show these shortcuts (or Ctrl + /)']
  ];
  function showShortcuts() {
    const tbody = h('tbody');
    SHORTCUTS.forEach(([keys, label]) => tbody.appendChild(h('tr', null,
      h('td', null, keys.map((k, i) => [i ? (keys.length === 4 ? ' ' : ' + ') : '', h('kbd', null, k)])), h('td', null, label))));
    UI.dialog({ title: 'Keyboard shortcuts', body: h('table', { class: 'kbd-table' }, tbody), width: 560, actions: [{ label: 'Close', primary: true }] });
  }
  function openSettings() {
    const radio = (name, val, cur, label) => h('label', { class: 'radio' }, h('input', { type: 'radio', name, value: val, checked: cur === val ? true : null }), label);
    const body = h('div', { class: 'settings' },
      h('section', null, h('h3', null, 'Start page'), h('div', { class: 'muted small' }, 'Where Drive opens, and where the logo takes you'),
        radio('start', 'home', S.startPage, 'Home'), radio('start', 'my-drive', S.startPage, 'My Drive')),
      h('section', null, h('h3', null, 'Density'), radio('density', 'comfortable', S.density, 'Comfortable'), radio('density', 'compact', S.density, 'Compact')),
      h('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Settings last until you reload the page.'));
    UI.dialog({
      title: 'Settings', body, width: 480,
      actions: [{ label: 'Cancel' }, {
        label: 'Done', primary: true, onClick: () => {
          S.startPage = body.querySelector('[name=start]:checked').value;
          S.density = body.querySelector('[name=density]:checked').value;
          $('#brand').setAttribute('href', '#' + S.startPage);
          render();
          UI.snack('Settings saved');
        }
      }]
    });
  }
  // Product icons only; Search and other tiles that carry the Google "G" are left out on purpose.
  const APPS = [
    ['account', 'Account'], ['gmail', 'Gmail'], ['drive', 'Drive'], ['docs', 'Docs'], ['sheets', 'Sheets'],
    ['slides', 'Slides'], ['calendar', 'Calendar'], ['meet', 'Meet'], ['chat', 'Chat'], ['forms', 'Forms'],
    ['keep', 'Keep'], ['contacts', 'Contacts'], ['maps', 'Maps'], ['photos', 'Photos'], ['youtube', 'YouTube']
  ];
  function bindHeader() {
    const av = $('#avatar');
    av.textContent = C.user.initial;
    document.documentElement.style.setProperty('--user-color', C.user.color);
    $('#btn-avatar').setAttribute('data-tip', `Account: ${C.user.name} (${C.user.email})`);
    $('#btn-avatar').setAttribute('aria-label', `Account: ${C.user.name}`);
    $('#brand').setAttribute('href', '#' + S.startPage);
    $('#brand').addEventListener('click', e => { e.preventDefault(); go(S.startPage); });
    $('#btn-menu').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
    $('#drawer-scrim').addEventListener('click', closeDrawer);
    $('#btn-new').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); openNewMenu({ x: r.left, y: r.top }); });
    $('#btn-offline').addEventListener('click', () => NA('Offline mode'));
    $('#btn-ai').addEventListener('click', () => NA('AI features', true));
    $('#btn-upgrade').addEventListener('click', () => NA('Upgrading storage'));
    $('#btn-support').addEventListener('click', e => UI.menu(e.currentTarget, [
      { label: 'Help', icon: 'help', action: () => NA('The Help Centre') },
      { label: 'Training', icon: 'school', action: () => (window.Tutor ? window.Tutor.open() : UI.snack('Practice tasks are turned off for this link')) },
      { label: 'Watch walkthrough', icon: 'smart_display', action: () => window.Walkthrough && window.Walkthrough.open() },
      '-',
      { label: 'Keyboard shortcuts', icon: 'keyboard', action: showShortcuts }
    ], { align: 'right' }));
    $('#btn-settings').addEventListener('click', e => UI.menu(e.currentTarget, [
      { label: 'Settings', icon: 'settings', action: openSettings },
      { label: 'Get Drive for desktop', icon: 'computer', action: () => NA('Drive for desktop') },
      { label: 'Keyboard shortcuts', icon: 'keyboard', action: showShortcuts }
    ], { align: 'right' }));
    $('#btn-apps').addEventListener('click', e => UI.popover(e.currentTarget, close => h('div', { class: 'apps', role: 'menu' },
      APPS.map(([key, name]) => h('button', {
        type: 'button', class: 'app-tile', role: 'menuitem',
        onclick: () => { close(); if (name === 'Drive') go(S.startPage); else NA(name); }
      }, key === 'account' ? h('span', { class: 'avatar app-ic' }, C.user.initial) : h('span', { class: 'app-ic', html: Icons.product(key, 40) }), name)),
      h('div', { class: 'apps-note' }, 'Only Drive works in this practice simulation')), { align: 'right' }));
    $('#btn-avatar').addEventListener('click', e => UI.popover(e.currentTarget, close => h('div', { class: 'acct' },
      h('div', { class: 'acct-email' }, C.user.email),
      h('span', { class: 'avatar xl' }, C.user.initial),
      h('div', { class: 'acct-hi' }, `Hi, ${C.user.name}!`),
      h('button', { type: 'button', class: 'btn-outline', onclick: () => { close(); NA('Managing your account'); } }, 'Manage your Account'),
      h('div', { class: 'acct-storage' }, icon('cloud'), `${Store.fmtSize(Store.usedBytes())} of ${C.quotaGB} GB used`),
      h('button', { type: 'button', class: 'btn-text', onclick: () => { close(); NA('Signing out'); } }, icon('logout'), 'Sign out'),
      h('div', { class: 'muted small' }, 'Practice account: nothing is saved when you reload.')), { align: 'right' }));
    $$('.rail-btn[data-app]').forEach(b => b.addEventListener('click', () => NA(b.dataset.app)));
    $('#rail-hide').addEventListener('click', () => { document.body.classList.add('rail-hidden'); $('#rail-show').hidden = false; });
    $('#rail-show').addEventListener('click', () => { document.body.classList.remove('rail-hidden'); $('#rail-show').hidden = true; });
  }

  /* ---------- Keyboard shortcuts ---------- */
  let chordUntil = 0;
  function arrowNav(e) {
    if (!lastIds.length) return;
    e.preventDefault();
    kbFocus = true;
    const cur = S.focusId && lastIds.includes(S.focusId) ? lastIds.indexOf(S.focusId) : -1;
    let delta = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
    const isGrid = S.layout === 'grid' || $(`#content [data-id="${lastIds[Math.max(cur, 0)]}"]`)?.closest('.grid');
    if (isGrid && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && cur >= 0) {
      const el = $(`#content [data-id="${lastIds[cur]}"]`);
      const g = el && el.closest('.grid');
      if (g) { const top = g.firstElementChild.offsetTop; const cols = Array.from(g.children).filter(c => c.offsetTop === top).length || 1; delta *= cols; }
    } else if (!isGrid && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    const next = cur < 0 ? 0 : Math.max(0, Math.min(lastIds.length - 1, cur + delta));
    const id = lastIds[next];
    if (e.shiftKey && S.anchor && lastIds.includes(S.anchor)) {
      const a = lastIds.indexOf(S.anchor);
      S.selection = new Set(lastIds.slice(Math.min(a, next), Math.max(a, next) + 1));
    } else { S.selection = new Set([id]); S.anchor = id; }
    S.focusId = id;
    syncSelection();
    scrollToItem(id);
  }
  function onKey(e) {
    if (e.defaultPrevented || editor || viewer || UI.dialogOpen() || UI.menuOpen() || document.body.hasAttribute('data-overlay')) return;
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const k = e.key, mod = e.metaKey || e.ctrlKey;
    if ((k === 'Enter' || k === ' ') && t.closest && t.closest('button, a, [role="button"], [tabindex="0"]:not(#content)')) return;

    if (chordUntil && Date.now() < chordUntil && !mod) {
      chordUntil = 0;
      if (e.code === 'KeyF') { e.preventDefault(); newFolder(); return; }
      if (e.code === 'KeyU') { e.preventDefault(); pickFiles(); return; }
      if (e.code === 'KeyI') { e.preventDefault(); pickFolder(); return; }
    }
    chordUntil = 0;
    if (e.altKey && e.code === 'KeyC') { e.preventDefault(); chordUntil = Date.now() + 2000; return; }
    if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); S.selection = new Set(lastIds); syncSelection(); return; }
    if (mod && k === '/') { e.preventDefault(); showShortcuts(); return; }
    if (mod || e.altKey) return;

    const sel = Array.from(S.selection).filter(id => get(id));
    const one = sel.length === 1 ? get(sel[0]) : null;
    if (e.shiftKey) {
      const m = { KeyF: 'folder', KeyT: 'doc', KeyS: 'sheet', KeyP: 'slide', KeyO: 'form' }[e.code];
      if (m) { e.preventDefault(); if (m === 'folder') newFolder(); else newNative(m); return; }
    }
    switch (k) {
      case '/': e.preventDefault(); $('#search-input').focus(); return;
      case '?': e.preventDefault(); showShortcuts(); return;
      case 'v': case 'V': if (!e.shiftKey) { e.preventDefault(); setLayout(S.layout === 'list' ? 'grid' : 'list'); } return;
      case 'd': case 'D': e.preventDefault(); toggleDetails(); return;
      case 'n': case 'N': if (one && !one.trashed) { e.preventDefault(); openRename(one.id); } return;
      case 's': case 'S': if (sel.length && S.view !== 'trash') { e.preventDefault(); toggleStar(sel); } return;
      case 'z': case 'Z': if (sel.length && S.view !== 'trash') { e.preventDefault(); openMove(sel); } return;
      case '.': if (sel.length && S.view !== 'trash') { e.preventDefault(); openShare(sel); } return;
      case 'Delete': case 'Backspace': case '#':
        if (sel.length) { e.preventDefault(); if (S.view === 'trash') doDeleteForever(sel); else doTrash(sel); }
        return;
      case 'Enter': case 'o': case 'O': if (one) { e.preventDefault(); openItem(one); } return;
      case 'Escape': if (sel.length) clearSelection(); closeDrawer(); return;
      case 'ArrowDown': case 'ArrowUp': case 'ArrowLeft': case 'ArrowRight': arrowNav(e); return;
    }
  }

  /* ---------- Init ---------- */
  function init() {
    Store.seed();
    bindHeader();
    bindSearch();
    bindContent();
    bindDnD();
    bindUploads();
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', parseHash);
    let raf = 0;
    if (window.ResizeObserver) new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitColumns); }).observe($('#content'));
    else window.addEventListener('resize', fitColumns);
    if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#' + S.startPage);
    parseHash();
  }

  window.App = { render, go, openItem, openNewMenu, newFolder, newNative, openShare, openMove, openDetails, showShortcuts, NA };
  init();
})();
