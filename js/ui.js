/* ui.js — primitives: element builder, menus with cascading submenus, dialogs,
 * snackbar, tooltips and popovers. No Drive-specific logic lives here.
 */
(function () {
  'use strict';

  /* ---------- Element builder ---------- */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const kids = Array.prototype.slice.call(arguments, 2).flat(Infinity);
    kids.forEach(c => {
      if (c == null || c === false) return;
      el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  const icon = (name, cls) => h('span', { class: 'ms' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, name);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const layer = () => document.getElementById('layer');

  function iconBtn(name, tip, onClick, o) {
    o = o || {};
    return h('button', Object.assign({
      type: 'button',
      class: 'icon-btn' + (o.cls ? ' ' + o.cls : ''),
      'data-tip': tip, 'aria-label': tip,
      onclick: onClick || null
    }, o.attrs || {}), icon(name, o.fill ? 'fill' : ''));
  }

  /* ---------- Menus ---------- */
  let openMenus = [];          // stack: { el, owner, onClose }
  let menuCleanup = null;
  let suppressAnchor = null;   // lets a second click on the anchor close the menu

  function closeMenus(level) {
    level = level || 0;
    while (openMenus.length > level) {
      const m = openMenus.pop();
      m.el.remove();
      if (m.onClose) m.onClose();
    }
    if (!openMenus.length && menuCleanup) { const c = menuCleanup; menuCleanup = null; c(); }
  }
  const menuOpen = () => openMenus.length > 0;

  /** Position `el` against a DOMRect (below / to the right) or a point, clamped to the viewport. */
  function place(el, ref, opts) {
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    el.style.maxHeight = (vh - 2 * m) + 'px';
    el.style.left = '0px'; el.style.top = '0px';
    const r = el.getBoundingClientRect();
    let x, y;
    if (opts.side === 'right') {
      x = ref.right; y = ref.top - 8;
      if (x + r.width > vw - m) x = ref.left - r.width;
    } else if (ref.width !== undefined) {
      x = opts.align === 'right' ? ref.right - r.width : ref.left;
      y = ref.bottom + (opts.gap != null ? opts.gap : 4);
      if (y + r.height > vh - m) {
        const above = ref.top - r.height - 4;
        y = above >= m ? above : vh - m - r.height;
      }
    } else {
      x = ref.x; y = ref.y;
      if (x + r.width > vw - m) x = Math.max(m, ref.x - r.width);
      if (y + r.height > vh - m) y = Math.max(m, vh - m - r.height);
    }
    x = Math.max(m, Math.min(x, vw - m - r.width));
    y = Math.max(m, Math.min(y, vh - m - r.height));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function setActive(el, btn, focus) {
    el.querySelectorAll(':scope > .mi.active').forEach(b => b.classList.remove('active'));
    if (btn) { btn.classList.add('active'); if (focus) btn.focus({ preventScroll: true }); }
  }

  function buildMenu(items, level, opts) {
    items = items.filter(Boolean);
    const el = h('div', { class: 'menu' + (opts.className ? ' ' + opts.className : ''), role: 'menu', tabindex: '-1' });
    const hasIcons = items.some(i => i !== '-' && (i.icon || i.svg || i.checked !== undefined));
    items.forEach(it => {
      if (it === '-' || it.divider) { el.appendChild(h('div', { class: 'msep', role: 'separator' })); return; }
      if (it.header) { el.appendChild(h('div', { class: 'mhead' }, it.header)); return; }
      if (it.custom) { el.appendChild(it.custom(() => closeMenus())); return; }
      const hasSub = !!(it.submenu || it.subcustom);
      let lead = null;
      if (it.svg) lead = h('span', { class: 'mi-svg', html: it.svg });
      else if (it.icon) lead = icon(it.icon, it.fill ? 'fill' : '');
      else if (it.checked) lead = icon('check');
      else if (hasIcons) lead = h('span', { class: 'mi-pad' });
      const btn = h('button', {
        type: 'button', class: 'mi', role: it.checked !== undefined ? 'menuitemradio' : 'menuitem',
        'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
        disabled: it.disabled || null, 'aria-haspopup': hasSub ? 'menu' : null
      },
        lead,
        h('span', { class: 'lbl' }, it.label),
        it.kbd ? h('span', { class: 'kbd' }, it.kbd) : null,
        (it.svg || it.icon) && it.checked ? icon('check', 'mi-check') : null,
        hasSub ? icon('arrow_right', 'mi-sub') : null);
      let timer;
      btn.addEventListener('mouseenter', () => {
        setActive(el, btn);
        clearTimeout(timer);
        if (hasSub) timer = setTimeout(() => openSub(btn, it, level, opts), 120);
        else if (openMenus.length > level + 1) timer = setTimeout(() => closeMenus(level + 1), 120);
      });
      btn.addEventListener('mouseleave', () => clearTimeout(timer));
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (hasSub) { openSub(btn, it, level, opts); return; }
        closeMenus();
        if (it.action) it.action();
      });
      btn._item = it;
      el.appendChild(btn);
    });
    el.addEventListener('keydown', e => menuKey(e, el, level, opts));
    return el;
  }

  function openSub(btn, it, level, opts) {
    if (openMenus[level + 1] && openMenus[level + 1].owner === btn) return;
    closeMenus(level + 1);
    let sub;
    if (it.subcustom) {
      sub = h('div', { class: 'menu', role: 'menu', tabindex: '-1' });
      sub.appendChild(it.subcustom(() => closeMenus()));
      sub.addEventListener('keydown', e => menuKey(e, sub, level + 1, opts));
    } else sub = buildMenu(it.submenu, level + 1, Object.assign({}, opts, { className: opts.subClassName || '' }));
    layer().appendChild(sub);
    openMenus.push({ el: sub, owner: btn });
    place(sub, btn.getBoundingClientRect(), { side: 'right' });
  }

  function menuKey(e, el, level, opts) {
    const items = Array.from(el.querySelectorAll(':scope > .mi:not([disabled])'));
    const cur = el.querySelector(':scope > .mi.active');
    const i = items.indexOf(cur);
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!items.length) return;
      const n = k === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      setActive(el, items[i < 0 && k === 'ArrowDown' ? 0 : n], true);
    } else if (k === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      if (cur && (cur._item.submenu || cur._item.subcustom)) {
        openSub(cur, cur._item, level, opts);
        const s = openMenus[level + 1];
        if (s) {
          const f = s.el.querySelector('.mi:not([disabled]), button');
          if (f && f.classList.contains('mi')) setActive(s.el, f, true); else if (f) f.focus(); else s.el.focus();
        }
      }
    } else if (k === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      if (level > 0) { closeMenus(level); const p = openMenus[level - 1]; if (p) { const a = p.el.querySelector('.mi.active'); (a || p.el).focus(); } }
    } else if (k === 'Enter' || k === ' ') {
      if (cur && document.activeElement === cur) { e.preventDefault(); e.stopPropagation(); cur.click(); }
    } else if (k === 'Escape') {
      e.preventDefault(); e.stopPropagation(); closeMenus();
    } else if (k === 'Tab') {
      e.preventDefault(); closeMenus();
    }
  }

  /** Open a menu. anchor: an element (opens below it) or a point {x, y}. */
  function menu(anchor, items, opts) {
    opts = opts || {};
    const isEl = anchor && anchor.nodeType === 1;
    if (isEl && suppressAnchor === anchor) { suppressAnchor = null; return null; }
    closeMenus(); hideTip();
    const prevFocus = document.activeElement;
    const el = buildMenu(items, 0, opts);
    layer().appendChild(el);
    openMenus.push({ el, owner: isEl ? anchor : null, onClose: opts.onClose });
    place(el, isEl ? anchor.getBoundingClientRect() : anchor, opts);
    if (isEl) anchor.setAttribute('aria-expanded', 'true');
    el.focus({ preventScroll: true });
    if (opts.focusFirst) { const f = el.querySelector('.mi:not([disabled])'); if (f) setActive(el, f, true); }

    const onDown = e => {
      if (openMenus.some(m => m.el.contains(e.target))) return;
      if (isEl && anchor.contains(e.target)) { suppressAnchor = anchor; setTimeout(() => { suppressAnchor = null; }, 400); }
      closeMenus();
    };
    const onScroll = e => { if (!openMenus.some(m => m.el.contains(e.target))) closeMenus(); };
    const onResize = () => closeMenus();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    menuCleanup = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
      if (isEl) anchor.removeAttribute('aria-expanded');
      const a = document.activeElement;
      if (prevFocus && document.contains(prevFocus) && (!a || a === document.body || !document.contains(a) || a.closest('#layer'))) {
        try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
    };
    return el;
  }

  /** A menu-shaped floating card with custom content. */
  function popover(anchor, render, opts) {
    return menu(anchor, [{ custom: close => render(close) }], Object.assign({ className: 'popover' }, opts || {}));
  }

  /* ---------- Dialogs ---------- */
  const dialogs = [];
  const dialogOpen = () => dialogs.length > 0;

  function dialog(o) {
    closeMenus(); hideTip();
    const prevFocus = document.activeElement;
    const scrim = h('div', { class: 'scrim' });
    const dlg = h('div', {
      class: 'dialog' + (o.className ? ' ' + o.className : ''), role: 'dialog', 'aria-modal': 'true',
      'aria-label': typeof o.title === 'string' ? o.title : null,
      style: o.width ? { maxWidth: o.width + 'px' } : null
    });
    if (o.title) dlg.appendChild(h('h2', { class: 'dtitle' }, o.title));
    const body = h('div', { class: 'dbody' });
    if (o.body != null) [].concat(o.body).forEach(b => body.appendChild(b.nodeType ? b : h('p', null, b)));
    dlg.appendChild(body);

    let closed = false;
    const api = { el: dlg, body, close, buttons: {}, primary: null };
    const actions = h('div', { class: 'dactions' });
    (o.actions || []).forEach(a => {
      if (a.spacer) { actions.appendChild(h('span', { class: 'spacer' })); return; }
      if (a.node) { actions.appendChild(a.node); return; }
      const b = h('button', {
        type: 'button',
        class: a.primary ? 'btn-filled' : a.outline ? 'btn-outline' : a.danger ? 'btn-text danger' : 'btn-text',
        disabled: a.disabled || null
      }, a.icon ? icon(a.icon) : null, a.label);
      b.addEventListener('click', () => {
        const r = a.onClick ? a.onClick(api) : undefined;
        if (r !== false) close();
      });
      if (a.primary) api.primary = b;
      if (a.id) api.buttons[a.id] = b;
      actions.appendChild(b);
    });
    if (o.actions && o.actions.length) dlg.appendChild(actions);
    scrim.appendChild(dlg);
    layer().appendChild(scrim);

    scrim.addEventListener('mousedown', e => { if (e.target === scrim && o.dismissible !== false) close(); });
    dlg.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (menuOpen()) closeMenus(); else close();
      } else if (e.key === 'Enter' && !e.shiftKey && !o.noEnter && api.primary && !api.primary.disabled && !api.primary.hidden) {
        const t = e.target;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'SELECT' || t.isContentEditable) return;
        e.preventDefault(); e.stopPropagation();
        api.primary.click();
      } else if (e.key === 'Tab') {
        const f = Array.from(dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'))
          .filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    function close() {
      if (closed) return;
      closed = true;
      scrim.remove();
      const i = dialogs.indexOf(api);
      if (i >= 0) dialogs.splice(i, 1);
      if (o.onClose) o.onClose();
      if (prevFocus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }

    dialogs.push(api);
    const focusFirst = () => {
      let f = o.initialFocus;
      if (typeof f === 'string') f = dlg.querySelector(f);
      if (!f) f = dlg.querySelector('input:not([type=checkbox]):not([type=radio]), textarea') || api.primary || dlg.querySelector('button');
      if (f) { f.focus({ preventScroll: true }); if (o.select) o.select(f); }
    };
    // Focus synchronously so a fast Enter goes to the dialog, then re-check once
    // callers (like a closing menu) have finished moving focus around.
    focusFirst();
    setTimeout(() => {
      if (!closed && !dlg.contains(document.activeElement) && !menuOpen()) focusFirst();
      if (o.onOpen) o.onOpen(api);
    });
    return api;
  }

  function confirm(o) {
    return new Promise(resolve => {
      let result = false;
      dialog({
        title: o.title, body: o.text, width: o.width || 440,
        actions: [{ label: o.cancel || 'Cancel' }, { label: o.ok || 'OK', primary: true, onClick: () => { result = true; } }],
        onClose: () => resolve(result)
      });
    });
  }

  function alert(title, text, ok) {
    return dialog({ title, body: text, width: 440, actions: [{ label: ok || 'OK', primary: true }] });
  }

  /* ---------- Snackbar ---------- */
  let snackEl = null, snackTimer = null;
  function snack(text, o) {
    o = o || {};
    if (snackEl) snackEl.remove();
    clearTimeout(snackTimer);
    const el = h('div', { class: 'snack', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'snack-text' }, text));
    const acts = o.actions || (o.action ? [{ label: o.action, onClick: o.onAction }] : []);
    acts.forEach(a => el.appendChild(h('button', { type: 'button', class: 'act', onclick: () => { hide(); if (a.onClick) a.onClick(); } }, a.label)));
    el.appendChild(h('button', { type: 'button', class: 'icon-btn sm x', 'aria-label': 'Dismiss', onclick: () => hide() }, icon('close')));
    document.body.appendChild(el);
    snackEl = el;
    const dur = o.duration || 6000;
    snackTimer = setTimeout(hide, dur);
    el.addEventListener('mouseenter', () => clearTimeout(snackTimer));
    el.addEventListener('mouseleave', () => { clearTimeout(snackTimer); snackTimer = setTimeout(hide, 3000); });
    function hide() {
      clearTimeout(snackTimer);
      if (snackEl === el) snackEl = null;
      el.classList.add('out');
      setTimeout(() => el.remove(), 150);
    }
    return { hide };
  }

  /* ---------- Tooltips ---------- */
  let tipEl = null, tipTimer = null, tipTarget = null;
  function hideTip() {
    clearTimeout(tipTimer);
    tipTarget = null;
    if (tipEl) { tipEl.remove(); tipEl = null; }
  }
  function showTip(t) {
    if (!document.contains(t)) return;
    const text = t.getAttribute('data-tip');
    if (!text) return;
    tipEl = h('div', { class: 'tip', role: 'tooltip' }, text);
    document.body.appendChild(tipEl);
    const r = t.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 6;
    if (y + tr.height > window.innerHeight - 4) y = r.top - tr.height - 6;
    x = Math.max(4, Math.min(x, window.innerWidth - tr.width - 4));
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  }
  document.addEventListener('mouseover', e => {
    const t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t === tipTarget) return;
    hideTip();
    if (!t) return;
    tipTarget = t;
    tipTimer = setTimeout(() => showTip(t), 500);
  });
  document.addEventListener('mousedown', hideTip, true);
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
  document.addEventListener('dragstart', hideTip, true);

  window.UI = { h, icon, esc, iconBtn, menu, closeMenus, menuOpen, popover, dialog, dialogOpen, confirm, alert, snack, hideTip };
})();
