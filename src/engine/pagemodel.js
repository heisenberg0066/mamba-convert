/* Page organiser model for Merge PDFs and Split PDF (shared by the renderer and the engine; no dependencies).
 * A document is { files, sections, pool }:
 *   files    [{ id, ci, path, name, pages, sizes? }]   sources; ci = stable colour index
 *   sections [{ id, name, items: [Item] }]         outputs in order (Merge: one section; Split: one per group)
 *   pool     [Item] | null                         Split only: pages not yet in any group (never written)
 *   Item     { id, f: fileId, p: 0-based page, r: extra rotation 0|90|180|270 }
 * Every operation is pure: it returns a new document and leaves the old one untouched (that is what undo keeps). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PageModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  let seq = 0;
  const uid = (p = 'i') => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const clone = (d) => ({ ...d, files: d.files.slice(), sections: d.sections.map((s) => ({ ...s, items: s.items.slice() })), pool: d.pool ? d.pool.slice() : null });
  const item = (f, p, r = 0) => ({ id: uid(), f, p, r });
  const norm = (a) => ((Math.round(a / 90) * 90) % 360 + 360) % 360;
  const COLORS = ['#ff7a00', '#0a84ff', '#22a559', '#d63384', '#8b5cf6', '#e0a800', '#14b8a6', '#ef4444', '#6366f1', '#84cc16'];
  const color = (i) => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];

  function fileEntry(f, ci = 0) { return { id: f.id || uid('f'), ci: f.ci != null ? f.ci : ci, path: f.path, name: f.name || String(f.path).split(/[\\/]/).pop(), pages: Math.max(1, f.pages | 0), sizes: f.sizes, bookmarks: f.bookmarks }; }
  function pagesOf(file) { return Array.from({ length: file.pages }, (_, p) => item(file.id, p)); }

  /** Merge: every page of every file, in file order, in one output section. */
  function createMerge(files, name = '') {
    const fs = files.map((f, i) => fileEntry(f, i));
    return { files: fs, sections: [{ id: 'out', name, items: fs.flatMap(pagesOf) }], pool: null };
  }
  /** Split: all pages start unassigned, with one empty group ready. */
  function createSplit(file, { baseName } = {}) {
    const f = fileEntry(file);
    const d = { files: [f], sections: [], pool: pagesOf(f), baseName: baseName || f.name.replace(/\.[^.]+$/, '') };
    return addGroup(d);
  }

  // ---------- lookups ----------
  const allItems = (d) => [...d.sections.flatMap((s) => s.items), ...(d.pool || [])];
  /** where an item lives: { sec: section id or 'pool', index } */
  function locate(d, id) {
    for (const s of d.sections) { const i = s.items.findIndex((x) => x.id === id); if (i >= 0) return { sec: s.id, index: i }; }
    if (d.pool) { const i = d.pool.findIndex((x) => x.id === id); if (i >= 0) return { sec: 'pool', index: i }; }
    return null;
  }
  const listOf = (d, sec) => (sec === 'pool' ? d.pool : (d.sections.find((s) => s.id === sec) || {}).items);
  function setList(d, sec, items) { if (sec === 'pool') d.pool = items; else { const s = d.sections.find((x) => x.id === sec); if (s) s.items = items; } }
  /** ids in document order (sections first, then pool) */
  function inOrder(d, ids) { const want = new Set(ids); return allItems(d).filter((x) => want.has(x.id)); }
  const fileById = (d, fid) => d.files.find((f) => f.id === fid);
  const fileIndex = (d, fid) => d.files.findIndex((f) => f.id === fid);

  // ---------- page operations ----------
  /** Move items (any sections) to `sec` before position `index` (index counted in the target list before the move). */
  function move(d, ids, sec, index) {
    const moving = inOrder(d, ids); if (!moving.length) return d;
    const target = listOf(d, sec); if (!target) return d;
    const set = new Set(moving.map((x) => x.id));
    const idx = Math.max(0, Math.min(index == null ? target.length : index, target.length));
    const before = target.slice(0, idx).filter((x) => !set.has(x.id)).length;
    const n = clone(d);
    n.sections.forEach((s) => { s.items = s.items.filter((x) => !set.has(x.id)); });
    if (n.pool) n.pool = n.pool.filter((x) => !set.has(x.id));
    const t = listOf(n, sec).slice(); t.splice(before, 0, ...moving); setList(n, sec, t);
    return n;
  }
  /** Shift the selection one step (delta -1 / +1) inside its own list. */
  function nudge(d, ids, delta) {
    const first = inOrder(d, ids)[0]; if (!first) return d;
    const loc = locate(d, first.id); const list = listOf(d, loc.sec); const set = new Set(ids);
    const pos = list.map((x, i) => (set.has(x.id) ? i : -1)).filter((i) => i >= 0);
    const lo = pos[0], hi = pos[pos.length - 1];
    if (delta < 0 && lo === 0) return d; if (delta > 0 && hi === list.length - 1) return d;
    return move(d, ids.filter((id) => list.some((x) => x.id === id)), loc.sec, delta < 0 ? lo - 1 : hi + 2);
  }
  function remove(d, ids) { const set = new Set(ids); const n = clone(d); n.sections.forEach((s) => { s.items = s.items.filter((x) => !set.has(x.id)); }); if (n.pool) n.pool = n.pool.filter((x) => !set.has(x.id)); return n; }
  function rotate(d, ids, delta) {
    const set = new Set(ids); const n = clone(d); const f = (x) => (set.has(x.id) ? { ...x, r: norm(x.r + delta) } : x);
    n.sections.forEach((s) => { s.items = s.items.map(f); }); if (n.pool) n.pool = n.pool.map(f); return n;
  }
  /** Each selected page gets a copy right after it. Returns { doc, ids: new copies }. */
  function duplicate(d, ids) {
    const set = new Set(ids); const n = clone(d); const made = [];
    const dup = (list) => list.flatMap((x) => { if (!set.has(x.id)) return [x]; const c = { ...x, id: uid() }; made.push(c.id); return [x, c]; });
    n.sections.forEach((s) => { s.items = dup(s.items); }); if (n.pool) n.pool = dup(n.pool);
    return { doc: n, ids: made };
  }
  /** Add a new source file and put its pages (all, or `pages` 0-based) at sec/index. Returns { doc, ids }. */
  function insertFile(d, file, sec, index, pages) {
    const f = fileEntry(file, d.files.reduce((a, x) => Math.max(a, x.ci + 1), 0)); const n = clone(d); n.files.push(f);
    const items = (pages && pages.length ? pages : [...Array(f.pages).keys()]).filter((p) => p >= 0 && p < f.pages).map((p) => item(f.id, p));
    const s = sec || (n.sections[0] && n.sections[0].id); const t = listOf(n, s).slice();
    t.splice(index == null ? t.length : Math.max(0, Math.min(index, t.length)), 0, ...items); setList(n, s, t);
    return { doc: n, ids: items.map((x) => x.id), file: f };
  }
  /** Merge: move all pages of one file, as a block in their current order, to just before `beforeFileId`'s first page (null = end). */
  function moveFile(d, fileId, beforeFileId) {
    const sec = d.sections[0]; if (!sec || fileId === beforeFileId) return d;
    const ids = sec.items.filter((x) => x.f === fileId).map((x) => x.id);
    let at = beforeFileId ? sec.items.findIndex((x) => x.f === beforeFileId) : sec.items.length;
    if (at < 0) at = sec.items.length;
    const n = move(d, ids, sec.id, at);
    // keep the file list (legend / colours order) in step with the page order
    const fi = n.files.findIndex((f) => f.id === fileId); const files = n.files.slice(); const [f] = files.splice(fi, 1);
    const bi = beforeFileId ? files.findIndex((x) => x.id === beforeFileId) : files.length; files.splice(bi < 0 ? files.length : bi, 0, f); n.files = files;
    return n;
  }
  /** Merge: one step up/down in the order of file blocks (by each file's first page). */
  function shiftFile(d, fileId, delta) {
    const order = fileOrder(d); const i = order.indexOf(fileId); const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return d;
    return delta < 0 ? moveFile(d, fileId, order[j]) : moveFile(d, order[j], fileId);
  }
  /** file ids in the order their first page appears in the output (files with no pages left go last) */
  function fileOrder(d) {
    const seen = []; (d.sections[0] ? d.sections[0].items : []).forEach((x) => { if (!seen.includes(x.f)) seen.push(x.f); });
    d.files.forEach((f) => { if (!seen.includes(f.id)) seen.push(f.id); }); return seen;
  }
  /** Drop a file (and all its pages) from a merge. */
  function removeFile(d, fileId) { const n = remove(d, allItems(d).filter((x) => x.f === fileId).map((x) => x.id)); n.files = n.files.filter((f) => f.id !== fileId); return n; }

  // ---------- split groups ----------
  function addGroup(d, name) {
    const n = clone(d); Object.assign(n, { baseName: d.baseName });
    const k = n.sections.length + 1; n.sections.push({ id: uid('g'), name: name || defaultName(d, k), items: [] }); return n;
  }
  const defaultName = (d, k) => `${d.baseName || 'part'}-part${k}`;
  /** Remove a group; its pages go back to the unassigned pool in page order. */
  function removeGroup(d, gid) {
    const s = d.sections.find((x) => x.id === gid); if (!s) return d;
    const n = clone(d); Object.assign(n, { baseName: d.baseName }); n.sections = n.sections.filter((x) => x.id !== gid);
    if (n.pool) n.pool = sortPool([...n.pool, ...s.items]); return n;
  }
  function renameGroup(d, gid, name) { const n = clone(d); Object.assign(n, { baseName: d.baseName }); const s = n.sections.find((x) => x.id === gid); if (s) s.name = name; return n; }
  /** Put the items at the end of a group (creating groups up to number k when gid is a number). */
  function assign(d, ids, gid) {
    let n = d;
    if (typeof gid === 'number') { while (n.sections.length < gid) n = addGroup(n); gid = n.sections[gid - 1].id; }
    const r = move(n, ids, gid, null); r.baseName = d.baseName; return r;
  }
  /** Take items out of their group, back to the pool (Split) - or delete them (Merge). */
  function unassign(d, ids) {
    if (!d.pool) return remove(d, ids);
    const set = new Set(ids); const moving = d.sections.flatMap((s) => s.items.filter((x) => set.has(x.id)));
    const n = remove(d, moving.map((x) => x.id)); n.baseName = d.baseName; n.pool = sortPool([...n.pool, ...moving]); return n;
  }
  const sortPool = (list) => list.slice().sort((a, b) => a.p - b.p);
  /** Replace all groups with `groups` = [{ name, pages: [0-based] }]; pages not used go to the pool. */
  function setGroups(d, groups) {
    const f = d.files[0]; const used = new Set();
    const sections = groups.filter((g) => g.pages.length).map((g) => ({ id: uid('g'), name: g.name, items: g.pages.map((p) => { used.add(p); return item(f.id, p); }) }));
    const pool = [...Array(f.pages).keys()].filter((p) => !used.has(p)).map((p) => item(f.id, p));
    return { files: d.files.slice(), sections: sections.length ? sections : [{ id: uid('g'), name: defaultName(d, 1), items: [] }], pool, baseName: d.baseName };
  }

  // ---------- presets ----------
  const label = (pages) => { const a = pages[0] + 1, b = pages[pages.length - 1] + 1; return pages.length === 1 ? `p${a}` : `p${a}-${b}`; };
  function presetEvery(d, n = 1) {
    const count = d.files[0].pages; n = Math.max(1, n | 0); const groups = [];
    for (let i = 0; i < count; i += n) { const pages = []; for (let k = i; k < Math.min(count, i + n); k++) pages.push(k); groups.push({ name: `${d.baseName}-${label(pages)}`, pages }); }
    return setGroups(d, groups);
  }
  /** "1-3, 5, 8-10" -> one group per comma part; "9-" runs to the end; returns { groups, errors } */
  function parseRangeGroups(spec, count) {
    const groups = [], errors = [];
    for (const raw of String(spec || '').split(/[,;]+/)) {
      const part = raw.trim().replace(/\s*-\s*/g, '-'); if (!part) continue; const pages = [];
      for (const tok of part.split(/\s+/)) {
        const m = tok.match(/^(\d*)\s*-\s*(\d*)$/);
        if (m && (m[1] || m[2])) {
          const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : count;
          if (a < 1 || a > count) { errors.push(tok); continue; }
          if (a <= b) for (let i = a; i <= Math.min(b, count); i++) pages.push(i - 1); else for (let i = Math.min(a, count); i >= b; i--) pages.push(i - 1);
        } else if (/^\d+$/.test(tok) && +tok >= 1 && +tok <= count) pages.push(+tok - 1);
        else errors.push(tok);
      }
      if (pages.length) groups.push(pages);
    }
    return { groups, errors };
  }
  function presetRanges(d, spec) {
    const { groups, errors } = parseRangeGroups(spec, d.files[0].pages);
    return { doc: setGroups(d, groups.map((pages) => ({ name: `${d.baseName}-${label(pages)}`, pages }))), errors, count: groups.length };
  }
  /** Bookmarks [{ title, page (0-based), depth }]: one group per top-level bookmark, from its page to the page before the next one. */
  function presetBookmarks(d, bookmarks) {
    const count = d.files[0].pages;
    const top = (bookmarks || []).filter((b) => (b.depth || 0) === 0 && b.page >= 0 && b.page < count).sort((a, b) => a.page - b.page);
    const starts = []; top.forEach((b) => { if (!starts.length || starts[starts.length - 1].page !== b.page) starts.push(b); });
    if (!starts.length) return { doc: d, count: 0 };
    if (starts[0].page > 0) starts.unshift({ title: d.baseName, page: 0 });
    const names = new Map();
    const groups = starts.map((b, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].page : count; const pages = []; for (let p = b.page; p < end; p++) pages.push(p);
      let nm = safeName(b.title) || `${d.baseName}-${label(pages)}`; const k = names.get(nm) || 0; names.set(nm, k + 1); if (k) nm += ` (${k + 1})`;
      return { name: nm, pages };
    });
    return { doc: setGroups(d, groups), count: groups.length };
  }

  // ---------- output ----------
  /** File-name-safe (Windows) output name, no extension. */
  function safeName(s) { return String(s || '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120); }
  /** The outputs to write: [{ name, pages: [{ path, page, rotate }] }] (empty sections skipped, names made unique). */
  function outputs(d) {
    const seen = new Map();
    return d.sections.filter((s) => s.items.length).map((s, i) => {
      let name = safeName(s.name) || (d.pool ? defaultName(d, i + 1) : ''); const key = name.toLowerCase();
      if (name) { const k = seen.get(key) || 0; seen.set(key, k + 1); if (k) name += ` (${k + 1})`; }
      return { name, pages: s.items.map((x) => ({ path: fileById(d, x.f).path, page: x.p, rotate: x.r })) };
    });
  }
  /** "1-3, 5" style summary of a list of 0-based pages (for previews). */
  function summarize(pages) {
    const out = []; let a = null, b = null;
    for (const p of pages) { if (a !== null && p === b + 1) { b = p; continue; } if (a !== null) out.push(a === b ? `${a + 1}` : `${a + 1}-${b + 1}`); a = b = p; }
    if (a !== null) out.push(a === b ? `${a + 1}` : `${a + 1}-${b + 1}`); return out.join(', ');
  }

  // ---------- selection helpers (click / Shift / Ctrl) ----------
  /** visible order of item ids, as the grid shows them */
  const order = (d) => allItems(d).map((x) => x.id);
  function select(d, sel, id, { shift, ctrl, anchor } = {}) {
    const ids = order(d);
    if (shift && anchor && ids.includes(anchor)) {
      const a = ids.indexOf(anchor), b = ids.indexOf(id); const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      return { sel: ctrl ? [...new Set([...sel, ...range])] : range, anchor };
    }
    if (ctrl) return { sel: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id], anchor: id };
    return { sel: [id], anchor: id };
  }

  // ---------- undo / redo ----------
  class History {
    constructor(doc, limit = 200) { this.past = []; this.future = []; this.doc = doc; this.limit = limit; }
    push(doc) { if (doc === this.doc) return false; this.past.push(this.doc); if (this.past.length > this.limit) this.past.shift(); this.doc = doc; this.future = []; return true; }
    undo() { if (!this.past.length) return false; this.future.push(this.doc); this.doc = this.past.pop(); return true; }
    redo() { if (!this.future.length) return false; this.past.push(this.doc); this.doc = this.future.pop(); return true; }
    get canUndo() { return this.past.length > 0; } get canRedo() { return this.future.length > 0; }
  }

  return { COLORS, color, uid, createMerge, createSplit, locate, allItems, inOrder, fileById, fileIndex, fileOrder, move, nudge, remove, rotate, duplicate, insertFile, moveFile, shiftFile, removeFile, addGroup, removeGroup, renameGroup, assign, unassign, setGroups, presetEvery, parseRangeGroups, presetRanges, presetBookmarks, outputs, summarize, safeName, order, select, History };
}));
