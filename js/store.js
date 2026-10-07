/* store.js — data model, every file operation, activity log, event bus, formatters.
 * All mutations go through Store.* so the Activity tab sees them.
 */
(function () {
  'use strict';
  const C = window.CONFIG;

  /* ---------- Event bus ---------- */
  const handlers = {};
  const Bus = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return () => Bus.off(ev, fn); },
    off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter(f => f !== fn); },
    emit(ev, data) {
      (handlers[ev] || []).slice().forEach(fn => { try { fn(data, ev); } catch (e) { console.error(e); } });
      (handlers['*'] || []).slice().forEach(fn => { try { fn(ev, data); } catch (e) { console.error(e); } });
    }
  };
  window.Bus = Bus;

  let seq = 0;
  const uid = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
  const now = () => Date.now();

  /* ---------- State ---------- */
  const emptyFilters = () => ({ type: null, people: null, modified: null, location: null });
  const S = {
    items: {},
    activity: [],
    view: 'home',
    folderId: 'root',
    layout: 'list',
    sort: { key: 'name', dir: 1 },
    foldersFirst: true,
    selection: new Set(),
    anchor: null,
    focusId: null,
    filters: emptyFilters(),
    query: '',
    adv: null,
    detailsOpen: false,
    detailsTab: 'details',
    density: 'comfortable',
    treeOpen: {},
    startPage: C.startPage === 'my-drive' ? 'my-drive' : 'home',
    homeOpen: { folders: true, files: true }
  };

  /* ---------- Queries ---------- */
  const get = id => S.items[id] || null;
  const all = () => Object.values(S.items);
  const isFolder = it => !!it && it.type === 'folder';

  /** Ancestors from the top (My Drive / Shared with me) down to the direct parent. */
  function ancestors(id) {
    const out = [];
    let it = get(id);
    for (let g = 0; it && g < 100; g++) {
      if (it.parent === 'root') { out.unshift({ id: 'root', name: 'My Drive' }); break; }
      if (it.parent === 'shared') { out.unshift({ id: 'shared', name: 'Shared with me' }); break; }
      const p = get(it.parent);
      if (!p) break;
      out.unshift({ id: p.id, name: p.name });
      it = p;
    }
    return out;
  }

  /** True if the item or any ancestor is in the trash (or the item is orphaned). */
  function trashedDeep(it) {
    for (let g = 0; it && g < 100; g++) {
      if (it.trashed) return true;
      if (it.parent === 'root' || it.parent === 'shared') return false;
      it = get(it.parent);
    }
    return true;
  }
  const alive = it => !!it && !trashedDeep(it);
  const children = pid => all().filter(i => i.parent === pid && !i.trashed);

  function descendants(id) {
    const out = [];
    const walk = p => all().forEach(i => { if (i.parent === p) { out.push(i); walk(i.id); } });
    walk(id);
    return out;
  }

  /** Is `id` the same as, or inside, `ancestorId`? */
  function isInside(id, ancestorId) {
    let it = get(id);
    for (let g = 0; it && g < 100; g++) {
      if (it.id === ancestorId) return true;
      it = get(it.parent);
    }
    return false;
  }

  /* ---------- Activity ---------- */
  function log(action, items, extra) {
    const list = [].concat(items).filter(Boolean);
    if (!list.length) return;
    S.activity.unshift({
      id: uid(), t: now(), action,
      ids: list.map(i => i.id), names: list.map(i => i.name), types: list.map(i => i.type),
      extra: extra || {}
    });
  }

  /* ---------- Mutations ---------- */
  function create(props, opts) {
    opts = opts || {};
    const t = now();
    const it = Object.assign({
      id: uid(), type: 'file', name: 'Untitled', parent: 'root', owner: 'me',
      created: t, modified: t, opened: null, size: 0,
      starred: false, trashed: false, trashedAt: null, color: null,
      access: [], general: 'restricted', description: '',
      blobUrl: null, mime: '', textContent: null, content: null,
      shortcutOf: null, uploaded: false, copiedFrom: null, sharedWithMe: false
    }, props);
    S.items[it.id] = it;
    if (!opts.silent) log(opts.action || (it.uploaded ? 'upload' : 'create'), it);
    return it;
  }

  function rename(id, name) {
    const it = get(id);
    name = (name || '').trim();
    if (!it || !name || it.name === name) return null;
    const from = it.name;
    it.name = name;
    it.modified = now();
    log('rename', it, { from, to: name });
    return from;
  }

  function trash(ids) {
    const t = now();
    const list = ids.map(get).filter(i => i && !i.trashed);
    list.forEach(i => { i.trashed = true; i.trashedAt = t; });
    log('trash', list);
    return list;
  }

  function restore(ids) {
    const list = ids.map(get).filter(i => i && i.trashed);
    list.forEach(i => {
      i.trashed = false;
      i.trashedAt = null;
      if (i.parent !== 'root' && i.parent !== 'shared') {
        const p = get(i.parent);
        if (!p || trashedDeep(p)) i.parent = 'root';
      }
    });
    log('restore', list);
    return list;
  }

  function deleteForever(ids) {
    const list = ids.map(get).filter(Boolean);
    const gone = [];
    list.forEach(i => {
      [i].concat(descendants(i.id)).forEach(d => {
        if (S.items[d.id]) { gone.push(d); delete S.items[d.id]; }
      });
    });
    const remaining = all();
    gone.forEach(d => {
      if (d.blobUrl && !remaining.some(o => o.blobUrl === d.blobUrl)) URL.revokeObjectURL(d.blobUrl);
    });
    log('delete', list);
    Array.from(S.selection).forEach(id => { if (!S.items[id]) S.selection.delete(id); });
    return gone;
  }

  const emptyTrash = () => deleteForever(all().filter(i => i.trashed).map(i => i.id));

  /** Move items into `parent`. Moving a folder into itself is blocked. */
  function move(ids, parent) {
    if (parent !== 'root' && parent !== 'shared' && ids.some(id => isInside(parent, id))) {
      return { ok: false, reason: 'self', moved: [] };
    }
    const moved = [];
    ids.forEach(id => {
      const it = get(id);
      if (!it || it.parent === parent) return;
      moved.push({ id, from: it.parent });
      it.parent = parent;
    });
    log('move', moved.map(m => get(m.id)), { to: parent });
    return { ok: true, moved };
  }

  function copy(id) {
    const src = get(id);
    if (!src || src.type === 'folder' || src.shortcutOf) return null;
    const t = now();
    return create(Object.assign({}, src, {
      id: uid(), name: 'Copy of ' + src.name, created: t, modified: t, opened: null,
      starred: false, trashed: false, trashedAt: null, access: [], general: 'restricted',
      owner: 'me', sharedWithMe: false, description: '',
      parent: src.sharedWithMe ? 'root' : src.parent, copiedFrom: src.id,
      content: src.content ? JSON.parse(JSON.stringify(src.content)) : null
    }), { action: 'copy' });
  }

  function star(ids, val) {
    const list = ids.map(get).filter(Boolean);
    list.forEach(i => { i.starred = val; });
    log(val ? 'star' : 'unstar', list);
    return list;
  }

  function setColor(ids, color) {
    const list = ids.map(get).filter(isFolder);
    list.forEach(i => { i.color = color; });
    log('color', list, { color });
    return list;
  }

  function share(id, s) {
    const it = get(id);
    if (!it) return;
    it.access = s.access;
    it.general = s.general;
    log('share', it, { count: s.access.length, general: s.general });
  }

  function addShortcut(id, parent) {
    const t = get(id);
    if (!t) return null;
    return create({ type: t.type, name: t.name, parent: parent || 'root', shortcutOf: t.id, color: t.color }, { action: 'shortcut' });
  }

  function setDescription(id, text) {
    const it = get(id);
    if (!it || it.description === text) return;
    it.description = text;
    log('description', it);
  }

  function touchOpened(id) { const it = get(id); if (it) it.opened = now(); }

  const usedBytes = () => all()
    .filter(i => !i.shortcutOf && !i.sharedWithMe && i.owner === 'me')
    .reduce((s, i) => s + (i.size || 0), 0);
  const quotaBytes = () => C.quotaGB * 1024 * 1024 * 1024;

  /* ---------- Formatters ---------- */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function fmtSize(b) {
    if (!b) return '0 bytes';
    if (b < 1024) return b + (b === 1 ? ' byte' : ' bytes');
    const u = ['KB', 'MB', 'GB', 'TB'];
    let v = b / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v < 10 && i > 0 ? Math.round(v * 10) / 10 : Math.round(v)) + ' ' + u[i];
  }
  const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts), n = new Date();
    if (sameDay(d, n)) return fmtTime(ts);
    if (d.getFullYear() === n.getFullYear()) return MON[d.getMonth()] + ' ' + d.getDate();
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function fmtFull(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${fmtTime(ts)}`;
  }
  function dayBucket(ts) {
    const d = new Date(ts), n = new Date();
    const start = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    if (ts >= start) return 'Today';
    if (ts >= start - 864e5) return 'Yesterday';
    const weekStart = start - n.getDay() * 864e5;
    if (ts >= weekStart) return 'Earlier this week';
    if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return 'Earlier this month';
    if (d.getFullYear() === n.getFullYear()) return 'Earlier this year';
    return 'Older';
  }

  /* ---------- Seed data from config ---------- */
  function seed() {
    (C.seedSharedWithMe || []).forEach((s, i) => {
      const t = now() - (s.daysAgo != null ? s.daysAgo : i + 1) * 864e5;
      create({
        name: s.name, type: s.type || Icons.typeFromName(s.name), owner: s.owner || 'A colleague',
        size: s.size || 0, parent: 'shared', sharedWithMe: true, created: t, modified: t,
        access: [{ email: C.user.email, role: s.role || 'viewer' }], description: s.description || '',
        textContent: s.text || null
      }, { silent: true });
    });
    const addTree = (list, parent) => list.forEach(s => {
      const it = create({
        name: s.name, type: s.type || (s.children ? 'folder' : Icons.typeFromName(s.name)),
        size: s.size || 0, parent, starred: !!s.starred, color: s.color || null, textContent: s.text || null
      }, { silent: true });
      if (s.children) addTree(s.children, it.id);
    });
    addTree(C.seedMyDrive || [], 'root');
  }

  window.Store = {
    S, emptyFilters, uid, get, all, isFolder, ancestors, trashedDeep, alive, children, descendants, isInside,
    log, create, rename, trash, restore, deleteForever, emptyTrash, move, copy, star, setColor, share,
    addShortcut, setDescription, touchOpened, usedBytes, quotaBytes,
    fmtSize, fmtTime, fmtDate, fmtFull, dayBucket, seed
  };
})();
