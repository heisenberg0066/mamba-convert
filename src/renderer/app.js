'use strict';
/* global I18N, api */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v); } kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : String(c))); return e; };
const debounce = (fn, ms) => { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
const fmtBytes = (b) => { if (b == null || isNaN(b)) return '–'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return `${b.toFixed(i && b < 10 ? 1 : 0)} ${u[i]}`; };
const fmtTime = (s) => { if (s == null || isNaN(s)) return ''; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const parseTime = (v) => { if (v === '' || v == null) return null; const p = String(v).trim().split(':').map(Number); if (p.some(isNaN)) return null; return p.reduce((a, x) => a * 60 + x, 0); };
const BROWSER_IMG = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'avif', 'svg', 'bmp', 'ico'];

let S = { lang: 'en' };
let catalog = { tools: [], conversions: [] };
const t = (k, vars) => { let s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.en[k] ?? k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b); return s; };
function toast(msg, ms = 2600) { const e = $('#toast'); e.textContent = msg; e.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.add('hidden'), ms); }

function applyI18n() {
  document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  $$('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === S.lang));
  renderOutPick(); renderConvert(); renderSupported(); renderToolGrid(); if (Tools.current) Tools.open(Tools.current); renderQueue();
}

// ---------------- tabs / settings ----------------
$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) { $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name)); $$('.page').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`)); }
$$('.lang button').forEach((b) => b.addEventListener('click', async () => { S = await api.setSettings({ lang: b.dataset.lang }); applyI18n(); }));
$('#outMode').addEventListener('change', async (e) => {
  if (e.target.value === 'folder' && !S.outputDir) { const d = await api.pickFolder(); if (!d) { e.target.value = 'same'; return; } S = await api.setSettings({ outputDir: d }); }
  S = await api.setSettings({ outputMode: e.target.value }); renderOutPick();
});
$('#outPick').addEventListener('click', async () => { const d = await api.pickFolder(); if (d) { S = await api.setSettings({ outputDir: d, outputMode: 'folder' }); renderOutPick(); } });
function renderOutPick() { $('#outMode').value = S.outputMode || 'same'; const b = $('#outPick'); b.classList.toggle('hidden', S.outputMode !== 'folder'); b.textContent = S.outputDir ? '📁 ' + S.outputDir.split(/[\\/]/).slice(-2).join('/') : t('change'); b.title = S.outputDir || ''; }

// ---------------- drag & drop ----------------
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
function dropZone(zone, onPaths, { click = true, filters } = {}) {
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean); if (paths.length) onPaths(paths); });
  if (click) zone.addEventListener('click', async () => { const p = await api.pickFiles({ filters }); if (p.length) onPaths(p); });
}
async function describe(paths) { return api.describe(paths); }
const uniqAdd = (list, items) => { const have = new Set(list.map((f) => f.path)); items.forEach((f) => { if (!have.has(f.path)) { list.push(f); have.add(f.path); } }); return list; };

// ---------------- CONVERT ----------------
let files = [];
dropZone($('#drop'), async (p) => { uniqAdd(files, await describe(p)); renderConvert(); routeToStudios(); });
$('#addMore').addEventListener('click', async () => { const p = await api.pickFiles(); if (p.length) { uniqAdd(files, await describe(p)); renderConvert(); routeToStudios(); } });
$('#clearFiles').addEventListener('click', () => { files = []; renderConvert(); });
$('#convertArea').addEventListener('drop', async (e) => { const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)); if (paths.length) { uniqAdd(files, await describe(paths)); renderConvert(); } });
['cvQuality', 'cvCrf'].forEach((id) => $('#' + id).addEventListener('input', (e) => { $(id === 'cvQuality' ? '#cvQv' : '#cvCv').textContent = e.target.value; }));
function routeToStudios() { /* files dropped on Convert are offered to the studios via the "Use files" buttons */ }

function renderConvert() {
  const has = files.length > 0;
  $('#drop').classList.toggle('hidden', has); $('#convertArea').classList.toggle('hidden', !has);
  const chips = $('#fileChips'); chips.replaceChildren(...files.map((f, i) => el('div', { class: 'chip', title: f.path }, el('span', { class: 'k' }, f.ext), el('span', { class: 'n' }, f.name), el('span', { class: 'muted' }, fmtBytes(f.size)), el('button', { class: 'x', title: t('removed'), onclick: () => { files.splice(i, 1); renderConvert(); } }, '✕'))));
  const groups = {};
  files.forEach((f) => { (groups[f.kind] = groups[f.kind] || []).push(f); });
  const box = $('#targetGroups'); box.replaceChildren();
  for (const [kind, list] of Object.entries(groups)) {
    let common = null; list.forEach((f) => { common = common ? common.filter((x) => f.targets.includes(x)) : [...f.targets]; });
    common = common || [];
    const g = el('div', { class: 'group' }, el('h3', {}, `${t('kind_' + kind)} `, el('small', {}, `· ${list.length} ${t('files')} · ${t('convertTo')}`)));
    if (!common.length) g.append(el('div', { class: 'muted' }, t('noTargets')));
    const row = el('div', { class: 'fmts' }, common.map((tg) => el('button', { class: 'fmt' + (tg === 'flipbook' ? ' flip' : ''), onclick: () => convertGroup(list, tg) }, tg === 'flipbook' ? '📖 ' + t('flipbook') : tg)));
    g.append(row); box.append(g);
  }
}
function convertOptions(kind) {
  const q = +$('#cvQuality').value, crf = +$('#cvCrf').value, abr = +$('#cvAbr').value, keep = $('#cvKeepMeta').checked;
  if (kind === 'image') return { quality: q, stripMetadata: !keep };
  if (kind === 'video' || kind === 'audio') return { crf, audioBitrate: abr, stripMetadata: !keep };
  if (kind === 'pdf' || kind === 'ebook') return { dpi: +$('#cvDpi').value || 150, quality: q };
  return {};
}
async function convertGroup(list, target) {
  if (target === 'flipbook' && list.length > 1 && list.every((f) => f.kind === 'image')) return enqueue([{ type: 'tool', tool: 'make-flipbook', files: list.map((f) => f.path), options: {}, label: `${list.length} ${t('files')}`, op: '→ ' + t('flipbook'), flip: true }]);
  const jobs = list.map((f) => ({ type: 'convert', files: [f.path], target, options: target === 'flipbook' ? {} : convertOptions(f.kind), label: f.name, op: target === 'flipbook' ? '→ ' + t('flipbook') : `→ ${target.toUpperCase()}`, flip: target === 'flipbook' }));
  await enqueue(jobs);
}
function renderSupported() {
  const by = {}; catalog.conversions.forEach(([a, b]) => { (by[a] = by[a] || []).push(b); });
  $('#supportedList').replaceChildren(el('div', {}, `${catalog.conversions.length} input → output pairs, ${catalog.tools.length} tools`), ...Object.entries(by).map(([a, bs]) => el('div', {}, el('b', {}, a.toUpperCase()), ' → ', bs.join(', '))));
}

// ---------------- crop overlay ----------------
class Crop {
  constructor(layer, onChange) { this.layer = layer; this.onChange = onChange; this.rect = null; this.aspect = 0; this.box = el('div', { class: 'crop-box hidden' }, ...['nw', 'ne', 'sw', 'se'].map((h) => el('div', { class: 'h ' + h, 'data-h': h }))); layer.append(this.box); this.bind(); }
  set(rect) { this.rect = rect; this.draw(); }
  draw() { const r = this.rect; this.box.classList.toggle('hidden', !r); if (!r) return; Object.assign(this.box.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }); }
  bind() {
    let mode = null, sx = 0, sy = 0, start = null, handle = null;
    const pos = (e) => { const b = this.layer.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)), b]; };
    this.layer.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.layer.setPointerCapture(e.pointerId); const [x, y] = pos(e); sx = x; sy = y; start = this.rect && { ...this.rect };
      handle = e.target.dataset.h; mode = handle ? 'resize' : (e.target === this.box ? 'move' : 'new');
      if (mode === 'new') { this.rect = { x, y, w: 0.001, h: 0.001 }; start = { ...this.rect }; handle = 'se'; mode = 'resize'; }
    });
    this.layer.addEventListener('pointermove', (e) => {
      if (!mode) return; const [x, y, b] = pos(e); let r = { ...start };
      if (mode === 'move') { r.x = Math.min(1 - r.w, Math.max(0, start.x + x - sx)); r.y = Math.min(1 - r.h, Math.max(0, start.y + y - sy)); }
      else {
        let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h;
        if (handle.includes('w')) x0 = x; if (handle.includes('e')) x1 = x; if (handle.includes('n')) y0 = y; if (handle.includes('s')) y1 = y;
        if (this.aspect) { // aspect in pixels -> fractions
          const ar = this.aspect * b.height / b.width; const w = Math.abs(x1 - x0); const h = w / ar;
          if (handle.includes('s')) y1 = y0 + Math.sign(y1 - y0 || 1) * h; else y0 = y1 - Math.sign(y1 - y0 || 1) * h;
        }
        r = { x: Math.max(0, Math.min(x0, x1)), y: Math.max(0, Math.min(y0, y1)), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        r.w = Math.min(r.w, 1 - r.x); r.h = Math.min(r.h, 1 - r.y);
      }
      this.rect = r; this.draw();
    });
    const end = () => { if (!mode) return; mode = null; if (this.rect && (this.rect.w < 0.01 || this.rect.h < 0.01)) this.rect = null; this.draw(); this.onChange(this.rect); };
    this.layer.addEventListener('pointerup', end); this.layer.addEventListener('pointercancel', end);
  }
}

// ---------------- IMAGE STUDIO ----------------
const Img = {
  files: [], cur: null, cropping: false, quickRot: 0, srcCache: new Map(), meta: new Map(),
  init() {
    dropZone($('#imgDrop'), (p) => this.add(p));
    $('#imgUseConvert').addEventListener('click', () => this.addDescribed(files.filter((f) => f.kind === 'image')));
    this.crop = new Crop($('#imgCrop'), () => { this.updateCropBtns(); this.preview(); });
    $('#imgCropBtn').addEventListener('click', () => this.toggleCrop());
    $('#imgCropClear').addEventListener('click', () => { this.crop.set(null); this.updateCropBtns(); this.preview(); });
    $('#imgCropAspect').addEventListener('change', (e) => { this.crop.aspect = +e.target.value || 0; });
    $$('#imgResizeMode button').forEach((b) => b.addEventListener('click', () => { $$('#imgResizeMode button').forEach((x) => x.classList.toggle('on', x === b)); this.resizeVis(); this.preview(); }));
    $('#imgRotL').addEventListener('click', () => { this.quickRot = (this.quickRot + 270) % 360; this.preview(); });
    $('#imgRotR').addEventListener('click', () => { this.quickRot = (this.quickRot + 90) % 360; this.preview(); });
    $('#imgRot180').addEventListener('click', () => { this.quickRot = (this.quickRot + 180) % 360; this.preview(); });
    $('#imgW').addEventListener('input', () => this.linkAspect('w')); $('#imgH').addEventListener('input', () => this.linkAspect('h'));
    $$('#imgPanel input, #imgPanel select').forEach((i) => i.addEventListener('input', () => { const o = i.parentElement.querySelector('output'); if (o) o.textContent = i.value; this.preview(); }));
    const before = $('#imgBefore');
    before.addEventListener('pointerdown', () => this.showSource(true)); ['pointerup', 'pointerleave'].forEach((ev) => before.addEventListener(ev, () => { if (!this.cropping) this.showResult(); }));
    $('#imgReset').addEventListener('click', () => this.reset());
    $('#imgOne').addEventListener('click', () => this.cur && this.export([this.cur]));
    $('#imgAll').addEventListener('click', () => this.export(this.files));
    this.resizeVis();
  },
  async add(paths) { this.addDescribed((await describe(paths)).filter((f) => f.kind === 'image')); },
  addDescribed(list) { uniqAdd(this.files, list); this.renderList(); if (!this.cur && this.files.length) this.select(this.files[0]); },
  renderList() {
    $('#imgList').replaceChildren(...this.files.map((f, i) => {
      const img = el('img', { alt: f.name, loading: 'lazy' });
      if (BROWSER_IMG.includes(f.ext)) img.src = api.fileUrl(f.path); else this.source(f).then((u) => { img.src = u; }).catch(() => {});
      return el('div', { class: 't' + (this.cur === f ? ' on' : ''), title: f.name, onclick: () => this.select(f) }, img, el('button', { class: 'x', onclick: (e) => { e.stopPropagation(); this.files.splice(i, 1); if (this.cur === f) { this.cur = null; if (this.files[0]) this.select(this.files[0]); else { $('#imgView').removeAttribute('src'); $('#imgInfo').textContent = ''; } } this.renderList(); } }, '✕'));
    }));
  },
  async source(f) { if (!this.srcCache.has(f.path)) this.srcCache.set(f.path, api.imagePreview(f.path, { format: 'png' }).then((r) => { this.meta.set(f.path, r); return r.dataUrl; })); return this.srcCache.get(f.path); },
  async select(f) { this.cur = f; this.renderList(); if (!this.meta.has(f.path)) await this.source(f); if (this.cropping) this.showSource(); else this.preview(); },
  resizeVis() { const m = this.mode(); $$('.rz-px').forEach((e) => e.classList.toggle('hidden', m !== 'px')); $$('.rz-pc').forEach((e) => e.classList.toggle('hidden', m !== 'percent')); },
  mode() { return ($('#imgResizeMode .on') || {}).dataset?.v || 'none'; },
  srcAspect() { const m = this.cur && this.meta.get(this.cur.path); if (!m) return 1; let w = m.srcWidth, h = m.srcHeight; const c = this.crop.rect; if (c) { w *= c.w; h *= c.h; } const r = (this.quickRot + +$('#imgAng').value) % 180; if (Math.abs(r) === 90) [w, h] = [h, w]; return w / h; },
  linkAspect(which) { if (!$('#imgKeep').checked) return; const a = this.srcAspect(); if (which === 'w' && $('#imgW').value) $('#imgH').value = Math.round($('#imgW').value / a); if (which === 'h' && $('#imgH').value) $('#imgW').value = Math.round($('#imgH').value * a); },
  options() {
    const adj = {}; $$('[data-adj]').forEach((i) => { const v = +i.value; if (v) adj[i.dataset.adj] = v; });
    const m = this.mode(); const kb = +$('#imgKB').value; const dpi = +$('#imgDpi').value;
    return {
      crop: this.crop.rect || undefined, rotate: (this.quickRot + +$('#imgAng').value + 360) % 360 || undefined, flipH: $('#imgFlipH').checked, flipV: $('#imgFlipV').checked,
      resize: m === 'none' ? undefined : { mode: m, width: +$('#imgW').value || undefined, height: +$('#imgH').value || undefined, percent: +$('#imgPc').value, keepAspect: $('#imgKeep').checked, fit: $('#imgFit').value },
      ...adj, grayscale: $('#imgGray').checked, invert: $('#imgInv').checked, sharpen: $('#imgSharp').checked,
      removeBg: $('#imgBg').checked ? { tolerance: +$('#imgTol').value, color: $('#imgBgColor').value.trim() || undefined } : undefined,
      quality: +$('#imgQ').value, targetKB: kb || undefined, dpi: dpi || undefined, stripMetadata: $('#imgStrip').checked,
    };
  },
  preview: debounce(async function () {
    if (!this.cur || this.cropping) return; const f = this.cur; const fmt = $('#imgFmt').value; const o = this.options();
    $('#imgSpin').classList.remove('hidden');
    try {
      const r = await api.imagePreview(f.path, { ...o, format: fmt });
      if (this.cur !== f || this.cropping) return;
      this.last = r; this.showResult();
      $('#imgInfo').textContent = `${f.name} · ${r.srcWidth}×${r.srcHeight} → ${r.width}×${r.height} · ${t('estSize')} ${fmt.toUpperCase()} ${r.bytes ? fmtBytes(r.bytes) : '–'} (${t('original')} ${fmtBytes(f.size)})`;
    } catch (e) { $('#imgInfo').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': /, ''); }
    finally { $('#imgSpin').classList.add('hidden'); }
  }, 220),
  showResult() { if (this.last) $('#imgView').src = this.last.dataUrl; },
  async showSource() { if (this.cur) $('#imgView').src = await this.source(this.cur); },
  toggleCrop() { this.cropping = !this.cropping; $('#imgCrop').classList.toggle('hidden', !this.cropping); this.updateCropBtns(); if (this.cropping) this.showSource(); else this.preview(); },
  updateCropBtns() { $('#imgCropBtn').textContent = this.cropping ? t('doneCrop') : t('editCrop'); $('#imgCropClear').classList.toggle('hidden', !this.crop.rect); },
  reset() {
    this.crop.set(null); this.quickRot = 0; $$('[data-adj]').forEach((i) => { i.value = 0; i.parentElement.querySelector('output').textContent = '0'; });
    ['imgFlipH', 'imgFlipV', 'imgGray', 'imgInv', 'imgSharp', 'imgBg'].forEach((id) => { $('#' + id).checked = false; });
    $('#imgAng').value = 0; $('#imgAngV').textContent = 0; $('#imgW').value = ''; $('#imgH').value = ''; $('#imgKB').value = ''; $('#imgDpi').value = '';
    $$('#imgResizeMode button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'none')); this.resizeVis(); this.updateCropBtns(); this.preview();
  },
  async export(list) { if (!list.length) return; const fmt = $('#imgFmt').value; const o = { ...this.options(), suffix: '-edited' }; await enqueue(list.map((f) => ({ type: 'convert', files: [f.path], target: fmt, options: o, label: f.name, op: `${t('tabImage')} → ${fmt.toUpperCase()}` }))); },
};

// ---------------- VIDEO STUDIO ----------------
const AUDIO_FMTS = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac'];
const Vid = {
  files: [], cur: null, info: new Map(), trim: new Map(), cropping: false, frameMode: false, rot: 0,
  init() {
    const v = $('#vidView');
    dropZone($('#vidDrop'), (p) => this.add(p));
    $('#vidUseConvert').addEventListener('click', () => this.addDescribed(files.filter((f) => f.kind === 'video')));
    this.crop = new Crop($('#vidCrop'), () => { this.updateCropBtns(); this.refreshFrame(); this.estimate(); });
    $('#vidCropBtn').addEventListener('click', () => { this.cropping = !this.cropping; $('#vidCrop').classList.toggle('hidden', !this.cropping); if (this.cropping) { $('#vidProcessed').checked = false; this.applyView(); } this.updateCropBtns(); });
    $('#vidCropClear').addEventListener('click', () => { this.crop.set(null); this.updateCropBtns(); this.refreshFrame(); });
    $('#vidCropAspect').addEventListener('change', (e) => { this.crop.aspect = +e.target.value || 0; });
    v.addEventListener('error', () => { if (this.cur && v.getAttribute('src')) { this.frameMode = true; $('#vidNote').classList.remove('hidden'); this.applyView(); } });
    v.addEventListener('loadedmetadata', () => { this.frameMode = false; $('#vidNote').classList.add('hidden'); this.applyView(); });
    v.addEventListener('timeupdate', () => this.drawTimeline());
    $('#vidPlay').addEventListener('click', () => { if (this.frameMode) return; if (v.paused) { const tr = this.curTrim(); if (tr.end && v.currentTime >= tr.end) v.currentTime = tr.start || 0; v.play(); } else v.pause(); });
    v.addEventListener('play', () => { $('#vidPlay').textContent = '❚❚'; }); v.addEventListener('pause', () => { $('#vidPlay').textContent = '▶'; this.refreshFrame(); });
    v.addEventListener('timeupdate', () => { const tr = this.curTrim(); if (!v.paused && tr.end && v.currentTime >= tr.end) v.pause(); });
    const track = $('#vidTrack'); let dragging = false;
    const seek = (e) => { const b = track.getBoundingClientRect(); const d = this.dur(); let x = (e.clientX - b.left) / b.width; if (document.documentElement.dir === 'rtl') x = x; this.seek(Math.max(0, Math.min(1, x)) * d); };
    track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seek(e); }); track.addEventListener('pointermove', (e) => dragging && seek(e)); track.addEventListener('pointerup', () => { dragging = false; this.refreshFrame(); });
    $('#vidSetStart').addEventListener('click', () => { this.setTrim({ start: this.now() }); });
    $('#vidSetEnd').addEventListener('click', () => { this.setTrim({ end: this.now() }); });
    $('#vidStart').addEventListener('change', (e) => this.setTrim({ start: parseTime(e.target.value) || 0 }));
    $('#vidEnd').addEventListener('change', (e) => this.setTrim({ end: parseTime(e.target.value) }));
    $$('#vidRate button').forEach((b) => b.addEventListener('click', () => { $$('#vidRate button').forEach((x) => x.classList.toggle('on', x === b)); ['crf', 'bitrate', 'size'].forEach((k) => $$('.r-' + k).forEach((e) => e.classList.toggle('hidden', k !== b.dataset.v))); this.estimate(); }));
    $$('#vidRot button').forEach((b) => b.addEventListener('click', () => { $$('#vidRot button').forEach((x) => x.classList.toggle('on', x === b)); this.rot = +b.dataset.v; this.refreshFrame(); }));
    $('#vidRes').addEventListener('change', (e) => $('#vidCustom').classList.toggle('hidden', e.target.value !== 'custom'));
    $('#vidFmt').addEventListener('change', () => this.fmtVis());
    $('#vidProcessed').addEventListener('change', () => { if ($('#vidProcessed').checked && this.cropping) $('#vidCropBtn').click(); this.applyView(); this.refreshFrame(); });
    $$('#vidPanel input, #vidPanel select').forEach((i) => i.addEventListener('input', () => { const o = i.parentElement.querySelector('output'); if (o) o.textContent = i.value; this.estimate(); this.refreshFrame(); }));
    $('#vidReset').addEventListener('click', () => this.reset());
    $('#vidOne').addEventListener('click', () => this.cur && this.export([this.cur]));
    $('#vidAll').addEventListener('click', () => this.export(this.files));
    this.fmtVis();
  },
  async add(paths) { this.addDescribed((await describe(paths)).filter((f) => f.kind === 'video')); },
  addDescribed(list) { uniqAdd(this.files, list); this.renderList(); if (!this.cur && this.files.length) this.select(this.files[0]); },
  renderList() { $('#vidList').replaceChildren(...this.files.map((f, i) => el('div', { class: 't' + (this.cur === f ? ' on' : ''), title: f.path, onclick: () => this.select(f) }, '🎬 ' + f.name, el('button', { class: 'x', onclick: (e) => { e.stopPropagation(); this.files.splice(i, 1); if (this.cur === f) { this.cur = null; $('#vidView').removeAttribute('src'); if (this.files[0]) this.select(this.files[0]); } this.renderList(); } }, '✕')))); },
  async select(f) {
    this.cur = f; this.renderList(); this.frameMode = false; $('#vidNote').classList.add('hidden');
    if (!this.info.has(f.path)) { try { this.info.set(f.path, await api.probe(f.path)); } catch (e) { toast(String(e.message || e)); return; } }
    const inf = this.info.get(f.path);
    $('#vidInfo').textContent = `${f.name} · ${inf.width}×${inf.height} · ${inf.fps ? inf.fps.toFixed(2) + ' fps · ' : ''}${fmtTime(inf.duration)} · ${fmtBytes(f.size)} · ${inf.vcodec || ''}/${inf.acodec || '—'}`;
    const v = $('#vidView'); v.src = api.fileUrl(f.path); this._ft = 0;
    this.applyView(); this.syncTrimInputs(); this.drawTimeline(); this.estimate();
  },
  dur() { const i = this.cur && this.info.get(this.cur.path); return (i && i.duration) || $('#vidView').duration || 0; },
  now() { return this.frameMode || $('#vidProcessed').checked ? (this._ft || 0) : $('#vidView').currentTime || 0; },
  seek(s) { this._ft = s; const v = $('#vidView'); if (!this.frameMode) v.currentTime = s; this.drawTimeline(); if (this.frameMode || $('#vidProcessed').checked) this.refreshFrame(); },
  curTrim() { return (this.cur && this.trim.get(this.cur.path)) || { start: 0, end: null }; },
  setTrim(p) { if (!this.cur) return; const tr = { ...this.curTrim(), ...p }; if (tr.end != null && tr.end <= tr.start) tr.end = null; this.trim.set(this.cur.path, tr); this.syncTrimInputs(); this.drawTimeline(); this.estimate(); },
  syncTrimInputs() { const tr = this.curTrim(); $('#vidStart').value = fmtTime(tr.start || 0); $('#vidEnd').value = tr.end != null ? fmtTime(tr.end) : ''; $('#vidLen').textContent = fmtTime((tr.end ?? this.dur()) - (tr.start || 0)); },
  drawTimeline() { const d = this.dur() || 1; const tr = this.curTrim(); const s = (tr.start || 0) / d, e = (tr.end ?? d) / d; Object.assign($('#vidSel').style, { left: s * 100 + '%', width: (e - s) * 100 + '%' }); $('#vidHead').style.left = (this.now() / d) * 100 + '%'; $('#vidTime').textContent = fmtTime(this.now()); },
  applyView() { const useFrame = this.frameMode || $('#vidProcessed').checked; $('#vidView').classList.toggle('hidden', useFrame); $('#vidFrame').classList.toggle('hidden', !useFrame); if (useFrame) this.refreshFrame(); },
  refreshFrame: debounce(async function () {
    if (!this.cur || !(this.frameMode || $('#vidProcessed').checked)) return;
    const f = this.cur; $('#vidSpin').classList.remove('hidden');
    try { const o = $('#vidProcessed').checked ? this.options() : {}; const url = await api.videoFrame(f.path, this.now(), o); if (this.cur === f) $('#vidFrame').src = url; }
    catch (e) { toast(String(e.message || e).slice(0, 160)); } finally { $('#vidSpin').classList.add('hidden'); }
  }, 200),
  updateCropBtns() { $('#vidCropBtn').textContent = this.cropping ? t('doneCrop') : t('editCrop'); $('#vidCropClear').classList.toggle('hidden', !this.crop.rect); },
  fmtVis() { const f = $('#vidFmt').value; const audio = AUDIO_FMTS.includes(f), anim = f === 'gif' || f === 'webp', still = f === 'png' || f === 'jpg'; $$('#vidPanel .v-only').forEach((e) => e.classList.toggle('hidden', audio)); $$('#vidPanel .enc-only').forEach((e) => e.classList.toggle('hidden', audio || anim || still)); $$('#vidPanel .gif-only').forEach((e) => e.classList.toggle('hidden', !anim)); this.estimate(); },
  rateMode() { return $('#vidRate .on').dataset.v; },
  options() {
    const res = $('#vidRes').value; const adj = {}; $$('[data-vadj]').forEach((i) => { if (+i.value) adj[i.dataset.vadj] = +i.value; });
    const rm = this.rateMode();
    return {
      crop: this.crop.rect || undefined, rotate: this.rot || undefined, flipH: $('#vidFlipH').checked, flipV: $('#vidFlipV').checked, ...adj, grayscale: $('#vidGray').checked,
      height: res === 'custom' ? (+$('#vidH').value || undefined) : (+res || undefined), width: res === 'custom' ? (+$('#vidW').value || undefined) : undefined,
      fps: +$('#vidFps').value || undefined, crf: rm === 'crf' ? +$('#vidCrf').value : undefined, videoBitrate: rm === 'bitrate' ? +$('#vidBr').value : undefined, targetMB: rm === 'size' ? +$('#vidMB').value : undefined,
      audioBitrate: +$('#vidAbr').value, mute: $('#vidMute').checked, normalize: $('#vidNorm').checked, speed: +$('#vidSpeed').value, stripMetadata: $('#vidStrip').checked,
      gifFps: +$('#vidGifFps').value, gifWidth: +$('#vidGifW').value,
    };
  },
  estimate() {
    const out = $('#vidEst'); if (!this.cur) { out.textContent = '–'; return; } const inf = this.info.get(this.cur.path); if (!inf) return;
    const o = this.options(); const tr = this.curTrim(); const len = ((tr.end ?? inf.duration) - (tr.start || 0)) / (o.speed || 1);
    if (o.targetMB) { out.textContent = `≤ ${o.targetMB} MB`; return; }
    const ak = o.mute ? 0 : o.audioBitrate;
    if (o.videoBitrate) { out.textContent = fmtBytes((o.videoBitrate + ak) * 125 * len); return; }
    let w = inf.width, h = inf.height; if (o.crop) { w *= o.crop.w; h *= o.crop.h; } if (o.height) { w = w * o.height / h; h = o.height; }
    const fps = o.fps || inf.fps || 30; const bpp = 0.09 * Math.pow(2, (23 - (o.crf || 23)) / 6);
    out.textContent = '≈ ' + fmtBytes((w * h * fps * bpp / 1000 + ak) * 125 * len);
  },
  reset() { this.crop.set(null); this.rot = 0; $$('#vidRot button').forEach((x) => x.classList.toggle('on', x.dataset.v === '0')); $$('[data-vadj]').forEach((i) => { i.value = 0; i.parentElement.querySelector('output').textContent = 0; }); ['vidFlipH', 'vidFlipV', 'vidGray', 'vidMute', 'vidNorm', 'vidStrip'].forEach((id) => { $('#' + id).checked = false; }); $('#vidRes').value = ''; $('#vidFps').value = ''; $('#vidSpeed').value = '1'; $('#vidCustom').classList.add('hidden'); if (this.cur) this.trim.delete(this.cur.path); this.syncTrimInputs(); this.drawTimeline(); this.updateCropBtns(); this.estimate(); this.refreshFrame(); },
  async export(list) {
    if (!list.length) return; const fmt = $('#vidFmt').value; const base = this.options();
    const jobs = list.map((f) => { const tr = this.trim.get(f.path) || {}; const o = { ...base, suffix: '-edited', start: tr.start || undefined, end: tr.end ?? undefined }; if (fmt === 'png' || fmt === 'jpg') o.at = f === this.cur ? this.now() : (tr.start || 0); return { type: 'convert', files: [f.path], target: fmt, options: o, label: f.name, op: `${t('tabVideo')} → ${fmt.toUpperCase()}` }; });
    await enqueue(jobs);
  },
};

// ---------------- TOOLS ----------------
const SHOW_IF = {
  'compress-video': { crf: (o) => o.mode === 'crf', targetMB: (o) => o.mode === 'size' },
  'resize-image': { width: (o) => o.mode === 'px', height: (o) => o.mode === 'px', keepAspect: (o) => o.mode === 'px', percent: (o) => o.mode === 'percent' },
  'compress-pdf': { dpi: (o) => o.level === 'strong', quality: (o) => o.level === 'strong' },
  'split-pdf': { ranges: (o) => o.mode === 'ranges' },
};
const Tools = {
  current: null, files: {}, values: {},
  open(tool) {
    this.current = tool; renderToolGrid(); const pane = $('#toolPane'); const id = tool.id;
    const list = (this.files[id] = this.files[id] || []); const vals = (this.values[id] = this.values[id] || Object.fromEntries(tool.params.map((p) => [p.key, p.def])));
    const form = el('div', { class: 'form' });
    const renderForm = () => {
      form.replaceChildren(...tool.params.filter((p) => !(SHOW_IF[id] && SHOW_IF[id][p.key]) || SHOW_IF[id][p.key](vals)).map((p) => {
        const lab = t('p.' + p.key); let input;
        if (p.type === 'select') input = el('select', { onchange: (e) => { vals[p.key] = e.target.value; renderForm(); } }, p.options.map((o) => el('option', { value: o, selected: String(vals[p.key]) === String(o) }, I18N.en['o.' + o] !== undefined ? t('o.' + o) : (p.key === 'height' && o ? o + 'p' : o))));
        else if (p.type === 'checkbox') return el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!vals[p.key], onchange: (e) => { vals[p.key] = e.target.checked; } }), ' ', lab);
        else if (p.type === 'range') { const o = el('output', {}, vals[p.key]); input = el('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: vals[p.key], oninput: (e) => { vals[p.key] = +e.target.value; o.textContent = e.target.value; } }); return el('label', {}, lab, ' ', o, input); }
        else input = el('input', { type: p.type === 'number' ? 'number' : 'text', min: p.min, max: p.max, step: p.step, value: vals[p.key] ?? '', placeholder: p.type === 'time' ? 'm:ss' : '', oninput: (e) => { vals[p.key] = p.type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value; } });
        return el('label', {}, el('span', {}, lab), input);
      }));
    };
    renderForm();
    const fileBox = el('div', { class: 'tfiles' });
    const renderFiles = () => fileBox.replaceChildren(...(list.length ? list.map((f, i) => el('div', { class: 'tfile' }, el('span', {}, i + 1 + '.'), el('span', { class: 'n', title: f.path }, f.name), el('span', { class: 'muted' }, fmtBytes(f.size)),
      tool.multi ? el('button', { title: '↑', onclick: () => { if (i) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; renderFiles(); } } }, '↑') : null,
      el('button', { onclick: () => { list.splice(i, 1); renderFiles(); } }, '✕'))) : [el('div', { class: 'muted' }, '—')]));
    const addPaths = async (paths) => { const d = (await describe(paths)).filter((f) => tool.accepts.includes(f.kind)); uniqAdd(list, d); renderFiles(); };
    const drop = el('div', { class: 'drop mini' }, el('span', {}, `${t('dropTitle')} · ${t('accepts')}: ${tool.accepts.map((k) => t('kind_' + k)).join(', ')}`));
    dropZone(drop, addPaths);
    renderFiles();
    const run = tool.reader ? el('button', { class: 'primary', onclick: async () => {
      if (!list.length) return toast(t('addFiles'));
      for (const f of list.slice(0, 1)) { const r = await api.openInReader(f.path, { edit: true }); if (!r || !r.ok) return toast(t('readerMissing')); toast(t('editOpened')); }
    } }, t('openEditor')) : el('button', { class: 'primary', onclick: async () => {
      if (!list.length) return toast(t('addFiles')); if (tool.multi && list.length < (tool.minFiles || 2) && id !== 'images-to-pdf') return toast(t('needTwo'));
      const options = { ...vals }; const name = t('tool.' + id);
      const jobs = tool.multi ? [{ type: 'tool', tool: id, files: list.map((f) => f.path), options, label: `${list.length} ${t('files')}`, op: name }] : list.map((f) => ({ type: 'tool', tool: id, files: [f.path], options, label: f.name, op: name }));
      await enqueue(jobs);
    } }, t('run'));
    const useConv = el('button', { class: 'ghost small', onclick: () => { uniqAdd(list, files.filter((f) => tool.accepts.includes(f.kind))); renderFiles(); } }, t('useConvertFiles'));
    const clr = el('button', { class: 'ghost small', onclick: () => { list.length = 0; renderFiles(); } }, t('clear'));
    pane.replaceChildren(el('h2', {}, `${tool.icon} ${t('tool.' + id)}`), el('div', { class: 'muted' }, tool.reader ? t('editPdfSub') : t('toolsSub')), el('div', { style: 'margin-top:14px' }, drop), el('div', { class: 'row', style: 'margin-top:8px' }, useConv, clr), fileBox, form, el('div', { class: 'row' }, run));
  },
};
const EDIT_TOOL = { id: 'edit-pdf', icon: '✏️', accepts: ['pdf'], params: [], reader: true };
function renderToolGrid() { $('#toolGrid').replaceChildren(...[EDIT_TOOL, ...catalog.tools].map((tl) => el('button', { class: 'toolcard' + (Tools.current && Tools.current.id === tl.id ? ' on' : ''), onclick: () => Tools.open(tl) }, el('span', { class: 'i' }, tl.icon), el('span', {}, t('tool.' + tl.id))))); }

// ---------------- QUEUE ----------------
const Q = { jobs: [], byId: new Map() };
async function enqueue(jobs) {
  const ids = await api.enqueue(jobs.map(({ label, op, flip, ...j }) => j));
  ids.forEach((id, i) => { const rec = { id, label: jobs[i].label, op: jobs[i].op, flip: jobs[i].flip || jobs[i].tool === 'make-flipbook', status: 'queued', progress: 0 }; Q.jobs.unshift(rec); Q.byId.set(id, rec); });
  $('#queue').classList.remove('collapsed'); $('#qToggle').textContent = '▾'; renderQueue(); toast(t('addedN', { n: ids.length }));
}
api.onJob((u) => { const r = Q.byId.get(u.id); if (!r) return; Object.assign(r, u); renderJob(r); renderTotals(); if (u.status === 'done' || u.status === 'error') { const active = Q.jobs.some((j) => j.status === 'queued' || j.status === 'running'); if (!active) toast(Q.jobs.some((j) => j.status === 'error') ? `⚠ ${t('error')}` : `✓ ${t('done')}`); } });
function renderJob(r) {
  let row = document.getElementById('job-' + r.id);
  const icon = { queued: '⏳', running: '⚙️', done: '✅', error: '⚠️', cancelled: '⏹' }[r.status];
  const btns = el('div', { class: 'btns' });
  if (r.status === 'done' && r.outputs && r.outputs.length) { btns.append(el('button', { onclick: () => api.showItem(r.outputs[0]) }, t('show')), el('button', { onclick: () => api.openPath(r.outputs[0]) }, r.flip ? t('openBrowser') : t('open')));
    if (r.flip) btns.append(el('button', { class: readerOK ? 'reader' : 'reader off', title: readerOK ? '' : t('readerMissing'), onclick: async () => { const res = await api.openInReader(r.outputs[0]); if (!res.ok) toast(t('readerMissing')); } }, '📖 ' + t('openInReader'))); }
  if (r.status === 'queued' || r.status === 'running') btns.append(el('button', { onclick: () => api.cancel(r.id) }, t('cancel')));
  if (r.status === 'error' || r.status === 'cancelled') btns.append(el('button', { onclick: () => api.retry(r.id) }, t('retry')));
  const st = r.status === 'done' ? `${t('done')} · ${(r.outputs || []).length > 1 ? r.outputs.length + ' ' + t('files') + ' · ' : ''}${fmtBytes((r.sizes || []).reduce((a, b) => a + b, 0))}` : r.status === 'error' ? (r.error || '').replace(/^Error invoking remote method '[^']+': /, '').slice(0, 220) : r.status === 'running' ? `${t('running')} ${Math.round((r.progress || 0) * 100)}%` : t(r.status);
  const fresh = el('div', { class: `job ${r.status}`, id: 'job-' + r.id, title: (r.outputs || []).join('\n') }, el('span', {}, icon), el('span', { class: 'nm' }, r.label), el('span', { class: 'op' }, r.op), el('div', {}, el('div', { class: 'pb' }, el('div', { style: `width:${Math.round((r.status === 'done' ? 1 : r.progress || 0) * 100)}%` })), el('div', { class: 'st' }, st)), btns);
  if (row) row.replaceWith(fresh); else $('#qList').prepend(fresh);
}
function renderQueue() { const l = $('#qList'); l.replaceChildren(); if (!Q.jobs.length) l.append(el('div', { class: 'empty' }, t('emptyQueue'))); [...Q.jobs].reverse().forEach(renderJob); renderTotals(); }
function renderTotals() { const n = Q.jobs.length; $('#qCount').textContent = n; const p = n ? Q.jobs.reduce((a, j) => a + (j.status === 'done' || j.status === 'error' || j.status === 'cancelled' ? 1 : j.progress || 0), 0) / n : 0; $('#qTotal').style.width = p * 100 + '%'; }
$('#qClear').addEventListener('click', () => { Q.jobs = Q.jobs.filter((j) => j.status === 'queued' || j.status === 'running'); renderQueue(); });
$('#qToggle').addEventListener('click', () => { $('#queue').classList.toggle('collapsed'); $('#qToggle').textContent = $('#queue').classList.contains('collapsed') ? '▴' : '▾'; });
$('#qOpen').addEventListener('click', () => { const last = Q.jobs.find((j) => j.status === 'done' && j.outputs && j.outputs.length); if (S.outputMode === 'folder' && S.outputDir) api.openOutputFolder(S.outputDir); else if (last) api.showItem(last.outputs[0]); else api.openOutputFolder(); });

let readerOK = false;
async function refreshReader() { const was = readerOK; readerOK = await api.readerStatus().catch(() => false); if (was !== readerOK) renderQueue(); }
window.addEventListener('focus', refreshReader);
// ---------------- Explorer wheel / helper settings ----------------
$('#wheelBtn').addEventListener('click', async (e) => {
  e.stopPropagation(); const p = $('#wheelPop'); p.classList.toggle('hidden'); if (p.classList.contains('hidden')) return;
  const h = await api.helperSettings(); $('#wpBubble').checked = h.bubble; $('#wpHotkey').checked = h.hotkey; $('#wpLogin').checked = h.startAtLogin;
  $$('#wheelPop input').forEach((i) => (i.disabled = !h.helper && i.id !== 'wpBubble'));
});
document.addEventListener('click', (e) => { if (!e.target.closest('#wheelPop') && e.target.id !== 'wheelBtn') $('#wheelPop').classList.add('hidden'); });
$('#wpBubble').addEventListener('change', (e) => api.helperSet({ bubble: e.target.checked }));
$('#wpHotkey').addEventListener('change', (e) => api.helperSet({ hotkey: e.target.checked }));
$('#wpLogin').addEventListener('change', (e) => api.helperSet({ startAtLogin: e.target.checked }));
api.onOpenFiles(async ({ paths, tab }) => {
  if (tab === 'image') { await Img.add(paths); showTab('image'); }
  else if (tab === 'video') { await Vid.add(paths); showTab('video'); }
  else { uniqAdd(files, await describe(paths)); renderConvert(); showTab('convert'); }
});
// ---------------- boot ----------------
(async () => {
  S = await api.getSettings(); catalog = await api.catalog();
  Img.init(); Vid.init(); await refreshReader(); applyI18n();
  window.__mamba = { EDIT_TOOL, Img, Vid, Tools, files, describe, showTab, renderConvert, uniqAdd, catalog, setFiles: async (p) => { uniqAdd(files, await describe(p)); renderConvert(); } };
})();
