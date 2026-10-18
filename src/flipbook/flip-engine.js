/*! Mamba flip engine v2 (v1-compatible) — shared by Mamba Convert (flipbook export) and Mamba Reader.
 *  Zero dependencies, works from file:// (no fetch/XHR).  Usage:
 *    const fb = new MambaFlip(document.body, { title, pages:[{src,w,h}], thumbs:[src], rtl:false });
 *  API: fb.next() fb.prev() fb.go(pageIndex) fb.zoomBy(f) fb.state()
 *  v2 options: embedded (fill parent instead of window), toolbar:false, thumbs:false,
 *    renderPage(index, el, w, h) to draw custom page content (overlays), onChange(state), setNavLocked(bool), relayout()
 */
(function (global) {
  'use strict';
  const h = (tag, cls, attrs) => { const e = document.createElement(tag); if (cls) e.className = cls; if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  class MambaFlip {
    constructor(mount, opts) {
      this.o = Object.assign({ title: 'Flipbook', pages: [], thumbs: [], rtl: false, duration: 650, cover: true }, opts || {});
      this.pages = this.o.pages; this.n = this.pages.length; this.cur = 0; // index of first visible page
      this.zoom = 1; this.panX = 0; this.panY = 0; this.anim = null;
      const aspect = this.pages.length ? this.pages[0].w / this.pages[0].h : 0.707; this.aspect = aspect;
      this.build(mount); this.layout(); this.render();
      this._onResize = () => this.relayout(); addEventListener('resize', this._onResize);
      if (location.hash && /^#p\d+$/.test(location.hash)) this.go(parseInt(location.hash.slice(2), 10) - 1, true);
    }
    // ---------- structure ----------
    build(mount) {
      const r = this.root = h('div', 'mf-root' + (this.o.embedded ? ' mf-embedded' : '') + (this.o.toolbar === false ? ' mf-notoolbar' : '') + (this.o.thumbs === false ? ' mf-nothumbs' : '')); r.dir = this.o.rtl ? 'rtl' : 'ltr';
      const bar = h('div', 'mf-bar');
      const btn = (txt, title, fn) => { const b = h('button', '', { title, type: 'button' }); b.textContent = txt; b.addEventListener('click', fn); bar.appendChild(b); return b; };
      this.bThumbs = btn('☰', 'Thumbnails (T)', () => this.toggleThumbs()); this.bThumbs.classList.add('on');
      const ttl = h('div', 'mf-title'); ttl.textContent = this.o.title; bar.appendChild(ttl);
      btn('⏮', 'First (Home)', () => this.go(0)); btn(this.o.rtl ? '▶' : '◀', 'Previous (←)', () => this.o.rtl ? this.next() : this.prev());
      this.inp = h('input', '', { type: 'text', inputmode: 'numeric', 'aria-label': 'Page' }); bar.appendChild(this.inp);
      this.inp.addEventListener('change', () => { const v = parseInt(this.inp.value, 10); if (v) this.go(v - 1); });
      const tot = h('span'); tot.textContent = '/ ' + this.n; tot.style.opacity = .7; bar.appendChild(tot);
      btn(this.o.rtl ? '◀' : '▶', 'Next (→)', () => this.o.rtl ? this.prev() : this.next()); btn('⏭', 'Last (End)', () => this.go(this.n - 1));
      btn('−', 'Zoom out (-)', () => this.zoomBy(1 / 1.25)); this.bZoom = btn('100%', 'Reset zoom (0)', () => this.setZoom(1)); btn('+', 'Zoom in (+)', () => this.zoomBy(1.25));
      this.bSpread = btn('▯▯', 'Single / double page (S)', () => { this.forceSingle = !this.isSingle(); this.layout(); this.render(); });
      btn('⛶', 'Full screen (F)', () => { if (document.fullscreenElement) document.exitFullscreen(); else (r.requestFullscreen || r.webkitRequestFullscreen || function () {}).call(r); });
      r.appendChild(bar);
      const main = h('div', 'mf-main'); r.appendChild(main);
      this.thumbsEl = h('div', 'mf-thumbs'); main.appendChild(this.thumbsEl);
      this.pages.forEach((p, i) => { const t = h('div', 'mf-thumb'); const im = h('img', '', { alt: 'Page ' + (i + 1), loading: 'lazy' }); im.src = this.o.thumbs[i] || p.src; const s = h('span'); s.textContent = i + 1; t.appendChild(im); t.appendChild(s); t.addEventListener('click', () => this.go(i)); this.thumbsEl.appendChild(t); });
      this.stage = h('div', 'mf-stage'); main.appendChild(this.stage);
      this.zoomEl = h('div', 'mf-zoom'); this.stage.appendChild(this.zoomEl);
      this.book = h('div', 'mf-book' + (this.o.rtl ? ' mf-rtl' : '')); this.zoomEl.appendChild(this.book);
      this.slotL = h('div', 'mf-slot l'); this.slotR = h('div', 'mf-slot r'); this.book.appendChild(this.slotL); this.book.appendChild(this.slotR);
      this.hotPrev = h('div', 'mf-hot prev'); this.hotNext = h('div', 'mf-hot next'); this.book.appendChild(this.hotPrev); this.book.appendChild(this.hotNext);
      const help = h('div', 'mf-help'); help.textContent = 'Click or drag page corners · ← → keys · Ctrl+wheel or double-click to zoom'; this.stage.appendChild(help); setTimeout(() => { help.style.transition = 'opacity 1s'; help.style.opacity = 0; }, 4000);
      mount.appendChild(r);
      this.bindInput();
    }
    relayout() { if (!this.root.isConnected) return; this.layout(); this.render(); }
    setNavLocked(b) { this.locked = !!b; this.root.classList.toggle('mf-locked', this.locked); }
    destroy() { removeEventListener('resize', this._onResize); removeEventListener('keydown', this._onKey); this.root.remove(); }
    isSingle() { return this.forceSingle != null ? this.forceSingle : this.stage.clientWidth / this.stage.clientHeight < this.aspect * 1.45; }
    layout() {
      const single = this.isSingle(); this.single = single;
      const W = this.stage.clientWidth - 40, H = this.stage.clientHeight - 40;
      let ph = H, pw = ph * this.aspect; const cols = single ? 1 : 2;
      if (pw * cols > W) { pw = W / cols; ph = pw / this.aspect; }
      this.pw = Math.floor(pw); this.ph = Math.floor(ph);
      Object.assign(this.book.style, { width: this.pw * cols + 'px', height: this.ph + 'px' });
      this.slotL.style.width = this.slotR.style.width = this.pw + 'px'; this.slotR.style.left = (single ? 0 : this.pw) + 'px';
      this.slotL.style.display = single ? 'none' : '';
      this.bSpread.classList.toggle('on', !single); this.applyZoom();
      if (!single && this.cur % 2 === (this.o.cover ? 0 : 1) && this.cur !== 0) this.cur -= 1; // keep spreads aligned
    }
    // spread model: cover alone on the right, then (1,2), (3,4) ... ; single mode: one page
    spreadOf(i) { if (this.single) return [null, i]; if (!this.o.cover) { const l = i - (i % 2); return [l, l + 1 < this.n ? l + 1 : null]; } if (i <= 0) return [null, 0]; const l = i % 2 ? i : i - 1; return [l, l + 1 < this.n ? l + 1 : null]; }
    stepFwd(i) { if (this.single) return i + 1; const [l, r] = this.spreadOf(i); return (r != null ? r : l) + 1; }
    stepBack(i) { if (this.single) return i - 1; const [l] = this.spreadOf(i); return l == null ? -1 : this.spreadOf(l - 1)[0] ?? this.spreadOf(l - 1)[1]; }
    pageEl(i) { const d = h('div', 'mf-pg'); if (i != null && i >= 0 && i < this.n && this.o.renderPage) { this.o.renderPage(i, d, this.pw, this.ph); return d; } if (i != null && i >= 0 && i < this.n) { const im = h('img', '', { alt: 'Page ' + (i + 1), draggable: 'false' }); im.src = this.pages[i].src; d.appendChild(im); } return d; }
    fill(slot, i) { slot.replaceChildren(this.pageEl(i)); slot.classList.toggle('mf-empty', i == null || i < 0 || i >= this.n); }
    render() {
      const [l, r] = this.spreadOf(this.cur); this.fill(this.slotL, l); this.fill(this.slotR, r);
      const vis = [l, r].filter((x) => x != null);
      this.inp.value = vis.map((x) => x + 1).join('–');
      [...this.thumbsEl.children].forEach((t, i) => t.classList.toggle('on', vis.includes(i)));
      const on = this.thumbsEl.children[vis[0]]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
      // preload neighbours
      if (!this.o.renderPage) [this.stepFwd(this.cur), this.stepFwd(this.cur) + 1, this.stepBack(this.cur)].forEach((k) => { if (k >= 0 && k < this.n) { const im = new Image(); im.src = this.pages[k].src; } });
      if (!this.o.embedded) { try { history.replaceState(null, '', '#p' + (vis[0] + 1)); } catch (_) { /* file:// in some browsers */ } }
      if (this.o.onChange) this.o.onChange(this.state());
    }
    // ---------- flipping ----------
    canNext() { return this.stepFwd(this.cur) < this.n; }
    canPrev() { return this.cur > 0; }
    next() { if (this.canNext()) this.flip(1); }
    prev() { if (this.canPrev()) this.flip(-1); }
    go(i, instant) { i = Math.max(0, Math.min(this.n - 1, i | 0)); const [l, r] = this.spreadOf(i); const target = l != null ? l : r; const [cl, cr] = this.spreadOf(this.cur); if (target === (cl != null ? cl : cr)) return; if (instant || this.anim) { this.cur = target; this.render(); return; } this.flip(target > this.cur ? 1 : -1, target); }
    /** dir 1 = forward. Builds a leaf: front = page being turned, back = page revealed on the other side. */
    makeLeaf(dir, target) {
      const [l, r] = this.spreadOf(this.cur); const [nl, nr] = this.spreadOf(target);
      const leaf = h('div', 'mf-leaf'); const front = h('div', 'mf-face f'); const back = h('div', 'mf-face b');
      const sF = h('div', 'mf-shade'), sB = h('div', 'mf-shade');
      leaf.style.width = this.pw + 'px';
      if (this.single) {
        leaf.style.left = '0px'; leaf.style.transformOrigin = dir > 0 ? 'left center' : 'left center';
        if (dir > 0) { front.appendChild(this.pageEl(this.cur)); back.appendChild(this.pageEl(null)); this.fill(this.slotR, target); }
        else { front.appendChild(this.pageEl(target)); back.appendChild(this.pageEl(null)); }
      } else if (dir > 0) {
        leaf.style.left = this.pw + 'px'; leaf.style.transformOrigin = 'left center';
        front.appendChild(this.pageEl(r)); back.appendChild(this.pageEl(nl)); this.fill(this.slotR, nr);
      } else {
        leaf.style.left = '0px'; leaf.style.transformOrigin = 'right center';
        front.appendChild(this.pageEl(l)); back.appendChild(this.pageEl(nr)); this.fill(this.slotL, nl);
      }
      front.appendChild(sF); back.appendChild(sB); leaf.appendChild(front); leaf.appendChild(back); this.book.appendChild(leaf);
      return { leaf, sF, sB };
    }
    setAngle(L, dir, p) { // p: 0..1 progress
      const ang = (this.single ? (dir > 0 ? -p : -(1 - p)) : dir > 0 ? -p : p) * 180;
      L.leaf.style.transform = `rotateY(${ang}deg)`;
      const s = Math.sin(p * Math.PI);
      L.sF.style.background = `linear-gradient(${dir > 0 ? 90 : 270}deg, rgba(0,0,0,${0.35 * s}), rgba(0,0,0,0) 60%)`;
      L.sB.style.background = `linear-gradient(${dir > 0 ? 270 : 90}deg, rgba(0,0,0,${0.3 * s}), rgba(255,255,255,${0.12 * s}) 70%)`;
      if (this.single) L.leaf.style.opacity = dir > 0 ? 1 - Math.max(0, p - 0.5) * 2 : Math.min(1, p * 2);
    }
    flip(dir, target, fromP = 0, toP = 1, onDone) {
      if (this.anim) { this.finishAnim(); }
      if (target == null) target = dir > 0 ? this.stepFwd(this.cur) : this.stepBack(this.cur);
      if (target < 0 || target >= this.n) return;
      const L = this.makeLeaf(dir, target); this.setAngle(L, dir, fromP);
      if (this.single && dir < 0) this.fill(this.slotR, this.cur);
      const t0 = performance.now(), dur = this.o.duration * Math.abs(toP - fromP);
      const a = this.anim = { L, dir, target, toP, done: false };
      const step = (now) => {
        if (a.done) return; const k = Math.min(1, (now - t0) / (dur || 1)); this.setAngle(L, dir, fromP + (toP - fromP) * ease(k));
        if (k < 1) a.raf = requestAnimationFrame(step); else this.finishAnim(onDone);
      };
      a.raf = requestAnimationFrame(step);
      return a;
    }
    finishAnim(cb) { const a = this.anim; if (!a) return; a.done = true; cancelAnimationFrame(a.raf); a.L.leaf.remove(); this.anim = null; if (a.toP >= 1) this.cur = a.target; this.render(); cb && cb(); }
    // ---------- zoom ----------
    setZoom(z, cx, cy) {
      z = Math.max(1, Math.min(5, z)); const st = this.stage.getBoundingClientRect();
      if (cx == null) { cx = st.width / 2; cy = st.height / 2; }
      // keep the point under the cursor fixed
      const k = z / this.zoom; this.panX = cx - (cx - this.panX) * k; this.panY = cy - (cy - this.panY) * k; this.zoom = z;
      if (z === 1) { this.panX = 0; this.panY = 0; }
      this.applyZoom();
    }
    zoomBy(f, cx, cy) { this.setZoom(this.zoom * f, cx, cy); }
    applyZoom() { if (!this.zoomEl) return; this.zoomEl.style.transform = `translate(${this.panX}px,${this.panY}px) scale(${this.zoom})`; this.root.classList.toggle('mf-zoomed', this.zoom > 1); this.bZoom.textContent = Math.round(this.zoom * 100) + '%'; }
    toggleThumbs() { this.thumbsEl.classList.toggle('mf-hide'); this.bThumbs.classList.toggle('on', !this.thumbsEl.classList.contains('mf-hide')); setTimeout(() => { this.layout(); this.render(); }, 260); }
    // ---------- input ----------
    bindInput() {
      const fwd = () => this.next(), back = () => this.prev();
      this.hotNext.addEventListener('click', fwd); this.hotPrev.addEventListener('click', back);
      this._onKey = (e) => {
        if (e.target === this.inp || this.o.keyboard === false || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return; const k = e.key; const rtl = this.o.rtl;
        if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); (rtl && k === 'ArrowRight') ? back() : fwd(); }
        else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); (rtl && k === 'ArrowLeft') ? fwd() : back(); }
        else if (k === 'Home') this.go(0); else if (k === 'End') this.go(this.n - 1);
        else if (k === '+' || k === '=') this.zoomBy(1.25); else if (k === '-') this.zoomBy(0.8); else if (k === '0') this.setZoom(1);
        else if (k === 't' || k === 'T') this.toggleThumbs(); else if (k === 'f' || k === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else if (this.root.requestFullscreen) this.root.requestFullscreen(); }
        else if (k === 's' || k === 'S') { this.forceSingle = !this.isSingle(); this.layout(); this.render(); }
      };
      addEventListener('keydown', this._onKey);
      this.stage.addEventListener('wheel', (e) => {
        const r = this.stage.getBoundingClientRect();
        if (e.ctrlKey || this.zoom > 1) { e.preventDefault(); if (e.ctrlKey) this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); else { this.panX -= e.deltaX; this.panY -= e.deltaY; this.applyZoom(); } }
        else if (Math.abs(e.deltaY) > 30 && !this.anim && !this.locked) { e.deltaY > 0 ? fwd() : back(); }
      }, { passive: false });
      this.stage.addEventListener('dblclick', (e) => { if (this.locked) return; const r = this.stage.getBoundingClientRect(); if (this.zoom > 1) this.setZoom(1); else this.setZoom(2.2, e.clientX - r.left, e.clientY - r.top); });
      // drag: pan when zoomed, otherwise drag a page corner to turn it
      let drag = null;
      this.stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || this.locked || (this.o.noDrag && e.target.closest && e.target.closest(this.o.noDrag))) return;
        if (this.zoom > 1) { drag = { pan: true, x: e.clientX, y: e.clientY, px: this.panX, py: this.panY }; this.stage.setPointerCapture(e.pointerId); return; }
        const b = this.book.getBoundingClientRect(); let x = (e.clientX - b.left) / b.width; if (this.o.rtl) x = 1 - x;
        if (x > 0.8 && this.canNext()) drag = { dir: 1 }; else if (x < 0.2 && this.canPrev()) drag = { dir: -1 }; else return;
        drag.x0 = e.clientX; drag.moved = false; this.stage.setPointerCapture(e.pointerId);
      });
      this.stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (drag.pan) { this.panX = drag.px + e.clientX - drag.x; this.panY = drag.py + e.clientY - drag.y; this.applyZoom(); return; }
        const dx = (e.clientX - drag.x0) * (this.o.rtl ? -1 : 1);
        if (!drag.moved && Math.abs(dx) < 6) return;
        if (!drag.moved) { drag.moved = true; if (this.anim) this.finishAnim(); const target = drag.dir > 0 ? this.stepFwd(this.cur) : this.stepBack(this.cur); drag.L = this.makeLeaf(drag.dir, target); drag.target = target; if (this.single && drag.dir < 0) this.fill(this.slotR, this.cur); }
        const span = this.book.getBoundingClientRect().width * (this.single ? 1 : 0.9);
        drag.p = Math.max(0, Math.min(1, (drag.dir > 0 ? -dx : dx) / span)); this.setAngle(drag.L, drag.dir, drag.p);
      });
      const up = () => {
        if (!drag) return; const d = drag; drag = null; if (d.pan || !d.moved) return;
        d.L.leaf.remove(); this.render();
        const complete = d.p > 0.25; this.flip(d.dir, d.target, d.p, complete ? 1 : 0);
      };
      this.stage.addEventListener('pointerup', up); this.stage.addEventListener('pointercancel', up);
      // swipe on touch screens is covered by the corner drag; tap on hot zones flips
    }
    state() { const [l, r] = this.spreadOf(this.cur); return { cur: this.cur, visible: [l, r].filter((x) => x != null), pages: this.n, single: this.single, zoom: this.zoom, animating: !!this.anim }; }
  }
  global.MambaFlip = MambaFlip;
  if (typeof module !== 'undefined' && module.exports) module.exports = MambaFlip;
})(typeof window !== 'undefined' ? window : globalThis);
