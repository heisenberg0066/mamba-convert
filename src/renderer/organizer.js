'use strict';
/* global PageModel, api, el, t, toast, $, $$, describe, fmtBytes */
// Page organiser for the Merge PDFs and Split PDF tools: lazy thumbnail grid, drag & drop, multi-select, undo/redo.
const PM = PageModel;
const POOL_COLOR = '#9aa1ad';
const ORG_ACCEPT = { 'merge-pdf': ['pdf', 'image'], 'split-pdf': ['pdf'] };

// ---------- page info + lazy thumbnails (shared by all organisers) ----------
const PageInfo = new Map(); // path -> Promise<{ pages, sizes, bookmarks }>
const pageInfo = (p) => { if (!PageInfo.has(p)) PageInfo.set(p, api.pagesInfo(p).catch((e) => { PageInfo.delete(p); throw e; })); return PageInfo.get(p); };
const Thumbs = {
  url: new Map(), wait: [], busy: 0, max: 3, W: 220,
  key: (path, page) => `${path}#${page}`,
  want(path, page, img) {
    const k = this.key(path, page); const u = this.url.get(k);
    if (u) { img.src = u; return; }
    img.dataset.k = k; this.wait.push({ k, path, page, img }); this.pump();
  },
  pump() {
    while (this.busy < this.max && this.wait.length) {
      // newest requests first: what is on screen now beats what was scrolled past
      const job = this.wait.pop(); if (!job.img.isConnected || job.img.dataset.k !== job.k) continue;
      if (this.url.has(job.k)) { job.img.src = this.url.get(job.k); continue; }
      this.busy++;
      api.pageThumb(job.path, job.page, this.W * Math.min(2, window.devicePixelRatio || 1))
        .then((buf) => { const u = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })); this.url.set(job.k, u); $$(`img[data-k="${CSS.escape(job.k)}"]`).forEach((i) => { i.src = u; }); })
        .catch(() => { job.img.classList.add('bad'); })
        .finally(() => { this.busy--; this.pump(); });
    }
  },
};

/**
 * One organiser view. kind 'merge' | 'split'. state = { hist, sel, anchor, focus, name } is owned by the caller so it
 * survives re-renders (language switch, re-opening the tool). onRun(job) enqueues.
 */
class Organizer {
  constructor(kind, state, { onRun, onFilesChanged } = {}) {
    this.kind = kind; this.s = state; this.onRun = onRun; this.onFilesChanged = onFilesChanged; this.size = state.size || 120;
    this.root = el('div', { class: 'org org-' + kind });
    this.io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { const im = e.target; this.io.unobserve(im); Thumbs.want(im.dataset.path, +im.dataset.page, im); } }), { rootMargin: '400px' });
    this.render();
  }
  get doc() { return this.s.hist.doc; }
  commit(doc, sel) {
    if (!this.s.hist.push(doc)) return;
    if (sel) this.s.sel = sel;
    this.prune(); this.render(); this.changed();
  }
  changed() { if (this.onFilesChanged) this.onFilesChanged(this.doc); }
  prune() { const ids = new Set(PM.order(this.doc)); this.s.sel = this.s.sel.filter((x) => ids.has(x)); if (!ids.has(this.s.focus)) this.s.focus = this.s.sel[0] || null; if (!ids.has(this.s.anchor)) this.s.anchor = this.s.focus; }
  undo() { if (this.s.hist.undo()) { this.prune(); this.render(); this.changed(); } }
  redo() { if (this.s.hist.redo()) { this.prune(); this.render(); this.changed(); } }
  colorOf(it, secIndex) {
    if (this.kind === 'merge') { const f = PM.fileById(this.doc, it.f); return PM.color(f ? f.ci : 0); }
    return secIndex < 0 ? POOL_COLOR : PM.color(secIndex);
  }

  // ---------- rendering ----------
  render() {
    this.io.disconnect(); const d = this.doc; const keepScroll = this.grid ? this.grid.scrollTop : 0; const hadFocus = this.grid && document.activeElement === this.grid;
    const btn = (key, fn, extra = {}) => el('button', { class: 'ghost small', title: t(key + '_tip') !== key + '_tip' ? t(key + '_tip') : '', onclick: fn, ...extra }, t(key));
    const n = this.s.sel.length;
    const tools = el('div', { class: 'org-bar' },
      btn('org_selectAll', () => this.selectAll()),
      btn('org_rotL', () => this.rotate(-90), { disabled: !n }), btn('org_rotR', () => this.rotate(90), { disabled: !n }),
      btn('org_dup', () => this.duplicate(), { disabled: !n }),
      btn(this.kind === 'merge' ? 'org_del' : 'org_unassign', () => this.del(), { disabled: !n }),
      btn('org_undo', () => this.undo(), { disabled: !this.s.hist.canUndo }), btn('org_redo', () => this.redo(), { disabled: !this.s.hist.canRedo }),
      this.kind === 'merge' ? btn('org_insert', () => this.pickInsert()) : null,
      el('span', { class: 'org-sp' }),
      el('span', { class: 'muted org-count' }, n ? t('org_sel', { n }) : t('org_total', { n: PM.order(d).length })),
      el('label', { class: 'org-zoom', title: t('org_size') }, '🔍', el('input', { type: 'range', min: 80, max: 220, value: this.size, oninput: (e) => { this.size = this.s.size = +e.target.value; this.grid.style.setProperty('--th', this.size + 'px'); } })));
    const head = this.kind === 'merge' ? this.legend() : this.splitBar();
    this.grid = el('div', { class: 'org-grid', tabindex: 0, style: `--th:${this.size}px` });
    this.bindGrid();
    if (this.kind === 'merge') this.grid.append(this.section(d.sections[0], 0, false));
    else { d.sections.forEach((s, i) => this.grid.append(this.section(s, i, true))); this.grid.append(this.section({ id: 'pool', name: t('org_unassigned'), items: d.pool || [] }, -1, true)); }
    const foot = el('div', { class: 'org-foot' }, this.kind === 'merge' ? el('label', { class: 'inline' }, el('span', {}, t('org_outName')), el('input', { type: 'text', value: this.s.name || '', placeholder: t('org_outNamePh'), oninput: (e) => { this.s.name = e.target.value; } })) : this.outputsSummary(),
      el('span', { class: 'org-sp' }), el('button', { class: 'primary', onclick: () => this.preview() }, t('org_preview')));
    this.root.replaceChildren(el('div', { class: 'muted org-hint' }, t(this.kind === 'merge' ? 'org_hintMerge' : 'org_hintSplit')), head, tools, this.grid, foot);
    this.grid.scrollTop = keepScroll; if (hadFocus) this.grid.focus({ preventScroll: true });
  }
  legend() {
    const d = this.doc; const order = PM.fileOrder(d); const counts = new Map(); d.sections[0].items.forEach((x) => counts.set(x.f, (counts.get(x.f) || 0) + 1));
    return el('div', { class: 'org-legend' }, order.map((fid, i) => {
      const f = PM.fileById(d, fid);
      const chip = el('div', { class: 'org-file', draggable: 'true', title: f.path, style: `--c:${PM.color(f.ci)}` },
        el('span', { class: 'sw' }, letter(f.ci)), el('span', { class: 'n' }, f.name), el('span', { class: 'muted' }, t('org_pages', { n: counts.get(fid) || 0 })),
        el('button', { title: t('org_up'), disabled: i === 0, onclick: () => this.commit(PM.shiftFile(d, fid, -1)) }, '↑'),
        el('button', { title: t('org_down'), disabled: i === order.length - 1, onclick: () => this.commit(PM.shiftFile(d, fid, 1)) }, '↓'),
        el('button', { title: t('org_selFile'), onclick: () => { this.s.sel = d.sections[0].items.filter((x) => x.f === fid).map((x) => x.id); this.s.anchor = this.s.focus = this.s.sel[0]; this.render(); } }, '☐'),
        el('button', { title: t('org_removeFile'), onclick: () => this.commit(PM.removeFile(d, fid)) }, '✕'));
      chip.addEventListener('dragstart', (e) => { this.dragFile = fid; e.dataTransfer.setData('application/x-mamba-file', fid); e.dataTransfer.effectAllowed = 'move'; });
      chip.addEventListener('dragend', () => { this.dragFile = null; });
      chip.addEventListener('dragover', (e) => { if (this.dragFile && this.dragFile !== fid) { e.preventDefault(); chip.classList.add('ins'); } });
      chip.addEventListener('dragleave', () => chip.classList.remove('ins'));
      chip.addEventListener('drop', (e) => { if (!this.dragFile) return; e.preventDefault(); e.stopPropagation(); chip.classList.remove('ins'); const from = this.dragFile; this.dragFile = null; if (from !== fid) this.commit(PM.moveFile(this.doc, from, fid)); });
      return chip;
    }), el('span', { class: 'muted small' }, t('org_fileHint')));
  }
  splitBar() {
    const d = this.doc; const f = d.files[0];
    const everyN = el('input', { type: 'number', min: 1, max: f.pages, value: this.s.everyN || 2, class: 'n3', oninput: (e) => { this.s.everyN = +e.target.value; } });
    const ranges = el('input', { type: 'text', class: 'rng', placeholder: t('org_rangesPh'), value: this.s.ranges || '', oninput: (e) => { this.s.ranges = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') applyRanges(); } });
    const applyRanges = () => { const r = PM.presetRanges(this.doc, ranges.value); if (!r.count) return toast(t('org_badRanges', { x: ranges.value || '—' })); this.commit(r.doc, []); if (r.errors.length) toast(t('org_badRanges', { x: r.errors.join(' ') })); };
    const bms = (f.bookmarks || []).filter((b) => (b.depth || 0) === 0 && b.page >= 0);
    const presets = el('div', { class: 'org-presets' }, el('b', {}, t('org_presets')),
      el('button', { class: 'ghost small', onclick: () => this.commit(PM.presetEvery(this.doc, 1), []) }, t('org_every')),
      el('span', { class: 'grp' }, t('org_everyN'), everyN, t('org_pagesWord'), el('button', { class: 'ghost small', onclick: () => this.commit(PM.presetEvery(this.doc, +everyN.value || 1), []) }, t('org_apply'))),
      el('span', { class: 'grp' }, t('org_ranges'), ranges, el('button', { class: 'ghost small', onclick: applyRanges }, t('org_apply'))),
      el('button', { class: 'ghost small', disabled: !bms.length, title: bms.length ? t('org_bmCount', { n: bms.length }) : t('org_noBookmarks'), onclick: () => { const r = PM.presetBookmarks(this.doc, f.bookmarks); if (!r.count) return toast(t('org_noBookmarks')); this.commit(r.doc, []); } }, t('org_bookmarks')),
      el('button', { class: 'ghost small', onclick: () => this.commit(PM.setGroups(this.doc, []), []) }, t('org_resetGroups')));
    const n = this.s.sel.length;
    const assign = el('div', { class: 'org-assign' }, el('b', {}, t('org_assign')),
      d.sections.map((s, i) => el('button', { class: 'gbtn', style: `--c:${PM.color(i)}`, disabled: !n, title: i < 9 ? `${i + 1}` : '', onclick: () => this.assign(i + 1) }, `${i < 9 ? i + 1 + ' · ' : ''}${s.name || t('org_group', { n: i + 1 })}`)),
      el('button', { class: 'gbtn new', disabled: !n, onclick: () => this.assign(d.sections.length + 1) }, t('org_newGroup')),
      el('button', { class: 'ghost small', onclick: () => this.commit(PM.addGroup(this.doc)) }, t('org_addGroup')));
    return el('div', {}, presets, assign);
  }
  section(s, idx, headed) {
    const d = this.doc; const pool = s.id === 'pool'; const col = pool ? POOL_COLOR : PM.color(idx);
    const sec = el('div', { class: 'org-sec' + (pool ? ' pool' : ''), 'data-sec': s.id, style: `--c:${col}` });
    if (headed) {
      const name = el('input', { type: 'text', class: 'gname', value: s.name, title: t('org_outName'), onchange: (e) => this.commit(PM.renameGroup(this.doc, s.id, e.target.value)), onkeydown: (e) => e.stopPropagation() });
      sec.append(el('div', { class: 'org-sh' }, el('span', { class: 'sw' }, pool ? '–' : String(idx + 1)), pool ? el('b', {}, s.name) : name, pool ? null : el('span', { class: 'muted' }, '.pdf'),
        el('span', { class: 'muted' }, t('org_pages', { n: s.items.length }) + (s.items.length ? ` · ${PM.summarize(s.items.map((x) => x.p))}` : '')),
        el('span', { class: 'org-sp' }),
        pool ? null : el('button', { class: 'ghost small', title: t('org_selGroup'), disabled: !s.items.length, onclick: () => { this.s.sel = s.items.map((x) => x.id); this.s.anchor = this.s.focus = this.s.sel[0]; this.render(); } }, '☐'),
        pool ? null : el('button', { class: 'ghost small', title: t('org_removeGroup'), onclick: () => this.commit(PM.removeGroup(this.doc, s.id)) }, '✕')));
    }
    const wrap = el('div', { class: 'org-pages' });
    if (!s.items.length) wrap.append(el('div', { class: 'org-empty' }, pool ? t('org_allAssigned') : t('org_dropHere')));
    const sel = new Set(this.s.sel);
    s.items.forEach((it) => wrap.append(this.thumb(it, this.kind === 'merge' ? null : idx, sel.has(it.id))));
    sec.append(wrap); return sec;
  }
  thumb(it, secIdx, selected) {
    const d = this.doc; const f = PM.fileById(d, it.f); const size = (f.sizes && (f.sizes[it.p] || f.sizes[0])) || [595, 842];
    const rot = it.r % 180 !== 0; const ar = rot ? size[1] / size[0] : size[0] / size[1];
    const img = el('img', { alt: '', draggable: 'false', 'data-path': f.path, 'data-page': it.p, style: rot ? `transform:rotate(${it.r}deg);width:${(1 / ar) * 100}%;max-width:none` : (it.r ? `transform:rotate(${it.r}deg)` : '') });
    const k = Thumbs.key(f.path, it.p); if (Thumbs.url.has(k)) img.src = Thumbs.url.get(k); else this.io.observe(img);
    const col = this.kind === 'merge' ? PM.color(f.ci) : (secIdx < 0 ? POOL_COLOR : PM.color(secIdx));
    const lab = this.kind === 'merge' ? `${letter(f.ci)}·${it.p + 1}` : `${it.p + 1}`;
    const mini = (txt, tip, fn) => el('button', { title: tip, onclick: (e) => { e.stopPropagation(); fn(); } }, txt);
    const box = el('div', { class: 'pg' + (selected ? ' on' : '') + (this.s.focus === it.id ? ' focus' : ''), draggable: 'true', 'data-id': it.id, title: `${f.name} · ${t('org_page')} ${it.p + 1}${it.r ? ` · ${it.r}°` : ''}`, style: `--c:${col}` },
      el('div', { class: 'im', style: `aspect-ratio:${ar}` }, img),
      el('div', { class: 'lb' }, el('span', { class: 'tag' }, lab), it.r ? el('span', { class: 'rot' }, `↻${it.r}°`) : null),
      el('div', { class: 'acts' }, mini('⟲', t('org_rotL'), () => this.rotate(-90, [it.id])), mini('⟳', t('org_rotR'), () => this.rotate(90, [it.id])), mini('×2', t('org_dup'), () => this.duplicate([it.id])), mini('✕', t(this.kind === 'merge' ? 'org_del' : 'org_unassign'), () => this.del([it.id]))));
    box.addEventListener('click', (e) => this.click(it.id, e));
    box.addEventListener('dragstart', (e) => {
      if (!this.s.sel.includes(it.id)) { this.s.sel = [it.id]; this.s.anchor = this.s.focus = it.id; this.markSel(); }
      this.dragging = this.s.sel.slice(); e.dataTransfer.setData('application/x-mamba-pages', this.dragging.join(',')); e.dataTransfer.effectAllowed = 'move';
      const ghost = el('div', { class: 'org-ghost' }, t('org_pages', { n: this.dragging.length })); document.body.append(ghost); e.dataTransfer.setDragImage(ghost, 20, 16); setTimeout(() => ghost.remove(), 0);
      setTimeout(() => this.dragging && this.dragging.forEach((id) => { const n = this.grid.querySelector(`[data-id="${id}"]`); if (n) n.classList.add('dragging'); }), 0);
    });
    box.addEventListener('dragend', () => { this.dragging = null; this.clearIns(); $$('.pg.dragging', this.grid).forEach((n) => n.classList.remove('dragging')); });
    return box;
  }
  outputsSummary() {
    const outs = PM.outputs(this.doc);
    return el('span', { class: 'muted' }, outs.length ? t('org_outCount', { n: outs.length }) : t('org_noOutput'));
  }
  markSel() { const sel = new Set(this.s.sel); $$('.pg', this.grid).forEach((n) => { n.classList.toggle('on', sel.has(n.dataset.id)); n.classList.toggle('focus', n.dataset.id === this.s.focus); }); const c = $('.org-count', this.root); if (c) c.textContent = sel.size ? t('org_sel', { n: sel.size }) : t('org_total', { n: PM.order(this.doc).length }); $$('.org-bar button[disabled], .org-assign button', this.root).forEach(() => {}); this.refreshButtons(); }
  refreshButtons() { const n = this.s.sel.length; $$('.org-bar button', this.root).forEach((b, i) => { if (i >= 1 && i <= 4) b.disabled = !n; }); $$('.org-assign .gbtn', this.root).forEach((b) => { b.disabled = !n; }); }

  // ---------- selection ----------
  click(id, e) {
    const r = PM.select(this.doc, this.s.sel, id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, anchor: this.s.anchor });
    this.s.sel = r.sel; this.s.anchor = r.anchor; this.s.focus = id; this.markSel(); this.grid.focus({ preventScroll: true });
  }
  selectAll() { this.s.sel = PM.order(this.doc); this.s.anchor = this.s.sel[0]; this.s.focus = this.s.focus || this.s.sel[0]; this.markSel(); }
  targets(ids) { return ids || this.s.sel; }

  // ---------- actions ----------
  rotate(delta, ids) { const x = this.targets(ids); if (x.length) this.commit(PM.rotate(this.doc, x, delta)); }
  duplicate(ids) { const x = this.targets(ids); if (!x.length) return; const r = PM.duplicate(this.doc, x); this.commit(r.doc, r.ids); }
  del(ids) {
    const x = this.targets(ids); if (!x.length) return;
    const order = PM.order(this.doc); const last = Math.max(...x.map((id) => order.indexOf(id)));
    const next = order.slice(last + 1).find((id) => !x.includes(id)) || order.slice(0, last).reverse().find((id) => !x.includes(id));
    const nd = PM.unassign(this.doc, x); this.s.focus = this.kind === 'merge' ? next : x[0]; this.commit(nd, this.kind === 'merge' ? (next ? [next] : []) : this.s.sel);
  }
  assign(k) { if (!this.s.sel.length) return; this.commit(PM.assign(this.doc, this.s.sel, k)); }
  /** insertion point after the focused (or last selected) page */
  insertPoint() {
    const d = this.doc; const id = this.s.focus || this.s.sel[this.s.sel.length - 1];
    const loc = id && PM.locate(d, id); if (!loc || loc.sec === 'pool') return { sec: d.sections[0].id, index: null };
    return { sec: loc.sec, index: loc.index + 1 };
  }
  async pickInsert() { const p = await api.pickFiles({ filters: [{ name: 'PDF / images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif', 'bmp', 'heic', 'avif'] }] }); if (p.length) this.insertPaths(p, this.insertPoint()); }
  async insertPaths(paths, { sec, index }) {
    const list = (await describe(paths)).filter((f) => ORG_ACCEPT['merge-pdf'].includes(f.kind)); if (!list.length) return;
    let d = this.doc; let at = index; const ids = [];
    for (const f of list) {
      let info; try { info = await pageInfo(f.path); } catch (e) { toast(`${f.name}: ${String(e.message || e).replace(/^Error invoking remote method '[^']+': /, '')}`); continue; }
      const r = PM.insertFile(d, { path: f.path, name: f.name, pages: info.pages, sizes: info.sizes }, sec, at); d = r.doc; ids.push(...r.ids); if (at != null) at += r.ids.length;
    }
    if (ids.length) { this.s.focus = ids[0]; this.s.anchor = ids[0]; this.commit(d, ids); toast(t('org_inserted', { n: ids.length })); }
  }

  // ---------- drag & drop / keyboard ----------
  clearIns() { $$('.ins-b, .ins-a', this.grid).forEach((n) => n.classList.remove('ins-b', 'ins-a')); $$('.org-sec.ins', this.grid).forEach((n) => n.classList.remove('ins')); }
  dropPoint(e) {
    const sec = e.target.closest && e.target.closest('.org-sec'); if (!sec) return null;
    const rtl = document.documentElement.dir === 'rtl';
    const pages = $$('.pg', sec); let index = pages.length, node = null, after = false;
    for (let i = 0; i < pages.length; i++) {
      const r = pages[i].getBoundingClientRect(); if (e.clientY < r.top) { index = i; node = pages[i]; break; }
      if (e.clientY <= r.bottom) { const mid = r.left + r.width / 2; const before = rtl ? e.clientX > mid : e.clientX < mid; if (before) { index = i; node = pages[i]; break; } }
    }
    if (!node && pages.length) { node = pages[pages.length - 1]; after = true; }
    return { sec: sec.dataset.sec, index, node, after, secEl: sec };
  }
  bindGrid() {
    const g = this.grid;
    g.addEventListener('dragover', (e) => {
      const internal = !!this.dragging; const files = !internal && this.kind === 'merge' && [...e.dataTransfer.types].includes('Files');
      if (!internal && !files) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
      const p = this.dropPoint(e); this.clearIns(); if (!p) return;
      if (p.node) p.node.classList.add(p.after ? 'ins-a' : 'ins-b'); else p.secEl.classList.add('ins');
      // auto-scroll near the edges while dragging
      const r = g.getBoundingClientRect(); if (e.clientY < r.top + 40) g.scrollTop -= 14; else if (e.clientY > r.bottom - 40) g.scrollTop += 14;
    });
    g.addEventListener('dragleave', (e) => { if (!g.contains(e.relatedTarget)) this.clearIns(); });
    g.addEventListener('drop', (e) => {
      const p = this.dropPoint(e); this.clearIns();
      if (this.dragging) { e.preventDefault(); e.stopPropagation(); const ids = this.dragging; this.dragging = null; if (p) this.commit(PM.move(this.doc, ids, p.sec, p.index), ids); return; }
      if (this.kind === 'merge' && e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean); if (paths.length && p) this.insertPaths(paths, { sec: p.sec, index: p.index }); }
    });
    g.addEventListener('click', (e) => { if (e.target === g || e.target.classList.contains('org-pages')) { this.s.sel = []; this.markSel(); } });
    g.addEventListener('keydown', (e) => this.key(e));
  }
  key(e) {
    const ctrl = e.ctrlKey || e.metaKey; const k = e.key;
    if (ctrl && (k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if (ctrl && (k === 'y' || k === 'Y' || ((k === 'z' || k === 'Z') && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); this.selectAll(); return; }
    if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); this.duplicate(); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.del(); return; }
    if (k === 'Escape') { this.s.sel = []; this.markSel(); return; }
    if ((k === 'r' || k === 'R') && !ctrl) { e.preventDefault(); this.rotate(e.shiftKey ? -90 : 90); return; }
    if (this.kind === 'split' && !ctrl && /^[1-9]$/.test(k)) { e.preventDefault(); this.assign(+k); return; }
    if (this.kind === 'split' && !ctrl && k === '0') { e.preventDefault(); this.del(); return; }
    const arrows = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' };
    if (!(k in arrows)) return; e.preventDefault();
    const rtl = document.documentElement.dir === 'rtl'; let step = arrows[k]; if (rtl && typeof step === 'number') step = -step;
    if (ctrl && this.s.sel.length && typeof step === 'number') { this.commit(PM.nudge(this.doc, this.s.sel, step)); this.scrollToFocus(); return; }
    const order = PM.order(this.doc); if (!order.length) return;
    const cur = order.indexOf(this.s.focus); let nx;
    if (step === 'home') nx = 0; else if (step === 'end') nx = order.length - 1;
    else if (typeof step === 'number') nx = cur < 0 ? 0 : cur + step;
    else nx = this.vertical(cur, step === 'up' ? -1 : 1, order);
    nx = Math.max(0, Math.min(order.length - 1, nx)); const id = order[nx];
    if (e.shiftKey) { const r = PM.select(this.doc, this.s.sel, id, { shift: true, anchor: this.s.anchor || this.s.focus || id }); this.s.sel = r.sel; this.s.anchor = r.anchor; }
    else { this.s.sel = [id]; this.s.anchor = id; }
    this.s.focus = id; this.markSel(); this.scrollToFocus();
  }
  /** page index one row up/down: the nearest page by x in the next visual row */
  vertical(cur, dir, order) {
    if (cur < 0) return 0; const n = this.grid.querySelector(`[data-id="${order[cur]}"]`); if (!n) return cur;
    const r = n.getBoundingClientRect(); const cx = r.left + r.width / 2; const nodes = $$('.pg', this.grid);
    const rows = nodes.map((x) => ({ x, r: x.getBoundingClientRect() })).filter((o) => (dir > 0 ? o.r.top > r.top + r.height / 2 : o.r.bottom < r.top + r.height / 2));
    if (!rows.length) return cur; const ty = dir > 0 ? Math.min(...rows.map((o) => o.r.top)) : Math.max(...rows.map((o) => o.r.top));
    const row = rows.filter((o) => Math.abs(o.r.top - ty) < 4); let best = row[0];
    row.forEach((o) => { if (Math.abs(o.r.left + o.r.width / 2 - cx) < Math.abs(best.r.left + best.r.width / 2 - cx)) best = o; });
    return order.indexOf(best.x.dataset.id);
  }
  scrollToFocus() { const n = this.s.focus && this.grid.querySelector(`[data-id="${this.s.focus}"]`); if (n) n.scrollIntoView({ block: 'nearest' }); }

  // ---------- output preview + save ----------
  job() {
    const d = this.doc; const outs = PM.outputs(d); const files = [...new Set(d.files.map((f) => f.path))];
    if (this.kind === 'merge') return { type: 'tool', tool: 'merge-pdf', files, options: { ...(this.s.extra || {}), layout: outs[0] ? outs[0].pages : [], name: PM.safeName(this.s.name) || undefined } };
    return { type: 'tool', tool: 'split-pdf', files: [d.files[0].path], options: { groups: outs } };
  }
  preview() {
    const d = this.doc; const outs = PM.outputs(d);
    if (!outs.length || !outs.some((o) => o.pages.length)) return toast(this.kind === 'merge' ? t('org_empty') : t('org_noOutput'));
    const first = d.files[0]; const base = first.name.replace(/\.[^.]+$/, '');
    const nonEmpty = d.sections.map((sec, i) => ({ sec, i })).filter((x) => x.sec.items.length);
    const rows = outs.map((o, i) => {
      const nm = (o.name || `${base}-merged`) + '.pdf'; const col = this.kind === 'merge' ? 'var(--accent)' : PM.color(nonEmpty[i].i);
      const src = nonEmpty[i].sec;
      const strip = el('div', { class: 'org-strip' }, src.items.slice(0, 12).map((it) => { const f = PM.fileById(d, it.f); const img = el('img', { alt: '', style: it.r ? `transform:rotate(${it.r}deg)` : '' }); Thumbs.want(f.path, it.p, img); return el('div', { class: 'mini', style: `--c:${this.kind === 'merge' ? PM.color(f.ci) : col}` }, img, el('span', {}, this.kind === 'merge' ? `${letter(f.ci)}·${it.p + 1}` : it.p + 1)); }), src.items.length > 12 ? el('span', { class: 'muted' }, `+${src.items.length - 12}`) : null);
      const detail = this.kind === 'merge' ? t('org_mergeSummary', { n: o.pages.length, m: new Set(o.pages.map((p) => p.path)).size }) : `${t('org_pages', { n: o.pages.length })} · ${PM.summarize(o.pages.map((p) => p.page))}`;
      const rotN = o.pages.filter((p) => p.rotate).length;
      return el('div', { class: 'org-out', style: `--c:${col}` }, el('div', { class: 'h' }, el('span', { class: 'sw' }, String(i + 1)), el('b', {}, nm), el('span', { class: 'muted' }, detail + (rotN ? ` · ${t('org_rotated', { n: rotN })}` : ''))), strip);
    });
    const skipped = d.pool ? d.pool.length : 0;
    const close = () => ov.remove();
    const ov = el('div', { class: 'org-modal', onclick: (e) => { if (e.target === ov) close(); } },
      el('div', { class: 'box' }, el('h3', {}, `${t('org_outputs')} · ${outs.length}`), el('div', { class: 'muted' }, t('org_whereSaved')),
        skipped ? el('div', { class: 'note warn' }, t('org_skipped', { n: skipped })) : null,
        el('div', { class: 'list' }, rows),
        el('div', { class: 'row end' }, el('button', { class: 'ghost', onclick: close }, t('org_back')), el('button', { class: 'primary', id: 'orgSave', onclick: async () => { close(); await this.onRun(this.job(), outs.length); } }, t('org_save', { n: outs.length })))));
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.append(ov); $('#orgSave').focus();
  }
}
const letter = (i) => { let s = ''; i = i | 0; do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0); return s; };

/** Glue for the Tools pane: keeps one organiser state per tool (per PDF for Split) in sync with the tool's file list. */
const OrgTools = {
  states: {},
  supports: (id) => id === 'merge-pdf' || id === 'split-pdf',
  newState: (doc) => ({ hist: new PM.History(doc), sel: [], anchor: null, focus: null, name: '' }),
  /** returns the organiser element for the pane (or a placeholder) */
  async mount(id, list, host, { vals, enqueue, cur, setCur, refreshList }) {
    const kind = id === 'merge-pdf' ? 'merge' : 'split';
    host.replaceChildren(el('div', { class: 'muted org-hint' }, list.length ? t('org_loading') : t('org_addFirst')));
    if (!list.length) { if (kind === 'merge') delete this.states[id]; return null; }
    const run = async (job, n) => { await enqueue([{ ...job, label: kind === 'merge' ? `${job.files.length} ${t('files')}` : list.find((f) => f.path === job.files[0]).name, op: `${t('tool.' + id)} · ${t('org_outCount', { n })}` }]); };
    const infos = new Map();
    for (const f of list) { try { infos.set(f.path, await pageInfo(f.path)); } catch (e) { toast(`${f.name}: ${String(e.message || e).replace(/^Error invoking remote method '[^']+': /, '')}`); } }
    if (!host.isConnected) return null;
    const usable = list.filter((f) => infos.has(f.path));
    if (!usable.length) { host.replaceChildren(el('div', { class: 'muted org-hint' }, t('org_addFirst'))); return null; }
    const entry = (f) => ({ path: f.path, name: f.name, pages: infos.get(f.path).pages, sizes: infos.get(f.path).sizes, bookmarks: infos.get(f.path).bookmarks });
    let st;
    if (kind === 'merge') {
      st = this.states[id];
      if (!st) st = this.states[id] = this.newState(PM.createMerge(usable.map(entry)));
      else { // sync: files added in the list go to the end, files removed from the list leave
        let d = st.hist.doc; const have = new Set(d.files.map((f) => f.path)); const want = new Set(usable.map((f) => f.path));
        d.files.filter((f) => !want.has(f.path)).forEach((f) => { d = PM.removeFile(d, f.id); });
        usable.filter((f) => !have.has(f.path)).forEach((f) => { d = PM.insertFile(d, entry(f), 'out', null).doc; });
        st.hist.push(d);
      }
      st.extra = vals;
    } else {
      const by = (this.states[id] = this.states[id] || {}); const path = usable.some((f) => f.path === cur) ? cur : usable[0].path; setCur(path);
      st = by[path] = by[path] || this.newState(PM.createSplit(entry(usable.find((f) => f.path === path))));
    }
    const org = new Organizer(kind, st, {
      onRun: run,
      onFilesChanged: kind === 'merge' ? (d) => { // pages deleted file by file: keep the Tools file list in step
        const keep = new Set(d.files.map((f) => f.path)); for (let i = list.length - 1; i >= 0; i--) if (!keep.has(list[i].path) && infos.has(list[i].path)) list.splice(i, 1);
        d.files.forEach((f) => { if (!list.some((x) => x.path === f.path)) list.push({ path: f.path, name: f.name, kind: /\.pdf$/i.test(f.path) ? 'pdf' : 'image', size: 0 }); });
        if (refreshList) refreshList();
      } : null,
    });
    const parts = [];
    if (kind === 'split' && usable.length > 1) parts.push(el('label', { class: 'inline org-pick' }, el('span', {}, t('org_file')), el('select', { onchange: (e) => { setCur(e.target.value); this.mount(id, list, host, { vals, enqueue, cur: e.target.value, setCur, refreshList }); } }, usable.map((f) => el('option', { value: f.path, selected: f.path === (cur || usable[0].path) }, f.name)))));
    host.replaceChildren(...parts, org.root); window.__org = org; return org;
  },
};
window.__orgTools = OrgTools;
