'use strict';
// Radial (pie) menu model for the Explorer integration. Pure: no Electron, unit-testable.
// menuFor(files) -> tree of { id, icon, label, children? , action? , disabled? }
// An action is an "intent" that resolveJobs() turns into concrete engine jobs per file kind.
const formats = require('../engine/formats');

const POPULAR = {
  image: ['jpg', 'png', 'webp', 'pdf', 'avif', 'gif', 'tiff', 'ico', 'bmp'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'gif', 'mp3', 'avi', 'm4a', 'wav', 'webp', 'png', 'jpg'],
  audio: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma', 'aiff'],
  pdf: ['jpg', 'png', 'txt', 'html', 'webp', 'tiff'],
  ebook: ['pdf', 'jpg', 'png', 'txt'],
  doc: ['pdf', 'docx', 'html', 'md', 'txt'],
  data: ['json', 'csv', 'tsv', 'html'],
};
const MAX_RING = 8;
const L = (id, icon, label, extra = {}) => ({ id, icon, label, ...extra });

function describe(files) {
  return files.map((f) => { const p = typeof f === 'string' ? f : f.path; const e = String(p.split('.').pop() || '').toLowerCase(); return { path: p, ext: e, kind: (f && f.kind) || formats.kindOf(e) }; }).filter((f) => f.kind);
}

/** Split a long list into the first (MAX_RING-1) items + a "More" node holding the rest (nested rings). */
function ring(items, idp) {
  if (items.length <= MAX_RING) return items;
  const head = items.slice(0, MAX_RING - 1); const rest = items.slice(MAX_RING - 1);
  return [...head, L(idp + ':more', '⋯', 'more', { children: ring(rest, idp + ':more') })];
}

function menuFor(input, opts = {}) {
  const files = describe(input); const kinds = [...new Set(files.map((f) => f.kind))]; const only = (...k) => kinds.length > 0 && kinds.every((x) => k.includes(x));
  const n = files.length; const root = [];
  if (!n) return { files, kinds, items: [] };
  // ---- Convert: formats every selected file can become
  let common = null;
  for (const f of files) { const t = formats.targetsFor(f.ext).filter((x) => x !== 'flipbook'); common = common ? common.filter((x) => t.includes(x)) : t; }
  if (common && common.length) {
    const pop = kinds.length === 1 ? POPULAR[kinds[0]] || [] : [];
    const sorted = [...common].sort((a, b) => ((pop.indexOf(a) + 1 || 99) - (pop.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    root.push(L('convert', '🔁', 'convert', { children: ring(sorted.map((t) => L('convert:' + t, fmtIcon(t), t.toUpperCase(), { action: { type: 'convert', target: t } })), 'convert') }));
  }
  // ---- Compress
  if (only('image', 'video', 'audio', 'pdf')) root.push(L('compress', '🗜️', 'compress', { children: ['low', 'medium', 'strong'].map((lv) => L('compress:' + lv, { low: '🟢', medium: '🟡', strong: '🔴' }[lv], lv, { action: { type: 'compress', level: lv } })) }));
  // ---- Edit / Studio
  if (only('image')) root.push(L('edit', '🎨', 'edit', { children: [
    L('edit:resize', '📐', 'resize', { children: [['50%', { mode: 'percent', percent: 50 }], ['25%', { mode: 'percent', percent: 25 }], ['3840px', { mode: 'px', width: 3840 }], ['1920px', { mode: 'px', width: 1920 }], ['1280px', { mode: 'px', width: 1280 }], ['800px', { mode: 'px', width: 800 }]].map(([lab, p]) => L('edit:resize:' + lab, '↔', lab, { action: { type: 'tool', tool: 'resize-image', params: { keepAspect: true, ...p } } })) }),
    L('edit:rotate', '↻', 'rotate', { children: [['90°', { angle: '90' }], ['180°', { angle: '180' }], ['270°', { angle: '270' }], ['flipH', { angle: '0', flipH: true }], ['flipV', { angle: '0', flipV: true }]].map(([lab, p]) => L('edit:rotate:' + lab, lab.startsWith('flip') ? '⇋' : '↻', lab, { action: { type: 'tool', tool: 'rotate-image', params: p } })) }),
    L('edit:removebg', '🪄', 'removeBg', { action: { type: 'tool', tool: 'remove-background', params: { tolerance: 25, format: 'png' } } }),
    L('edit:gray', '◐', 'grayscale', { action: { type: 'edit', options: { grayscale: true }, suffix: '-gray' } }),
    L('edit:studio', '🖌️', 'openStudio', { action: { type: 'studio', tab: 'image' } }),
  ] }));
  else if (only('video')) root.push(L('edit', '🎬', 'edit', { children: [
    L('edit:res', '🖥️', 'resolution', { children: ['1080', '720', '480'].map((h) => L('edit:res:' + h, '▭', h + 'p', { action: { type: 'tool', tool: 'change-resolution', params: { height: h } } })) }),
    L('edit:rotate', '↻', 'rotate', { children: ['90', '180', '270'].map((a) => L('edit:rotate:' + a, '↻', a + '°', { action: { type: 'tool', tool: 'rotate-video', params: { angle: a } } })) }),
    L('edit:speed', '⏩', 'speed', { children: ['0.5', '1.5', '2'].map((s) => L('edit:speed:' + s, '⏩', s + '×', { action: { type: 'tool', tool: 'change-speed', params: { speed: s } } })) }),
    L('edit:fps', '⏱️', 'fps', { children: ['24', '30', '60'].map((f) => L('edit:fps:' + f, '⏱', f + ' fps', { action: { type: 'tool', tool: 'change-fps', params: { fps: f } } })) }),
    L('edit:studio', '🖌️', 'openStudio', { action: { type: 'studio', tab: 'video' } }),
  ] }));
  // ---- Flipbook
  if (only('pdf', 'image', 'doc', 'ebook') && files.every((f) => formats.targetsFor(f.ext).includes('flipbook'))) root.push(L('flipbook', '📖', 'flipbook', { children: [
    L('flipbook:single', '📄', 'fbSingle', { action: { type: 'tool', tool: 'make-flipbook', params: { mode: 'single' }, combine: true } }),
    L('flipbook:folder', '📁', 'fbFolder', { action: { type: 'tool', tool: 'make-flipbook', params: { mode: 'folder' }, combine: true } }),
    L('flipbook:rtl', '⇠', 'fbRtl', { action: { type: 'tool', tool: 'make-flipbook', params: { mode: 'single', rtl: true }, combine: true } }),
  ] }));
  // ---- PDF tools
  if (only('pdf')) root.push(L('pdf', '📑', 'pdfTools', { children: [
    ...(n === 1 ? [L('pdf:edit', '✏️', 'editPdf', { action: { type: 'reader', edit: true }, disabled: opts.readerAvailable === false })] : []),
    ...(n > 1 ? [L('pdf:merge', '📑', 'merge', { action: { type: 'tool', tool: 'merge-pdf', params: {}, combine: true } })] : []),
    L('pdf:split', '🔪', 'split', { action: { type: 'tool', tool: 'split-pdf', params: { mode: 'each' } } }),
    L('pdf:rotate', '🔄', 'rotate', { children: ['90', '180', '270'].map((a) => L('pdf:rotate:' + a, '↻', a + '°', { action: { type: 'tool', tool: 'rotate-pdf', params: { angle: a } } })) }),
    L('pdf:images', '🧩', 'toImages', { children: ['png', 'jpg'].map((f) => L('pdf:images:' + f, fmtIcon(f), f.toUpperCase(), { action: { type: 'tool', tool: 'pdf-to-images', params: { format: f, dpi: 150 } } })) }),
    L('pdf:text', '🔤', 'toText', { action: { type: 'tool', tool: 'pdf-to-text', params: { format: 'txt' } } }),
    L('pdf:numbers', '🔢', 'pageNumbers', { action: { type: 'tool', tool: 'page-numbers', params: {} } }),
  ] }));
  else if (only('image')) root.push(L('pdf', '📑', 'pdfTools', { children: [
    L('pdf:fromimages', '🖼️', n > 1 ? 'imagesToOnePdf' : 'imageToPdf', { action: { type: 'tool', tool: 'images-to-pdf', params: { pageSize: 'fit' }, combine: true } }),
    L('pdf:fromimagesA4', '📄', 'imagesToPdfA4', { action: { type: 'tool', tool: 'images-to-pdf', params: { pageSize: 'a4' }, combine: true } }),
  ] }));
  // ---- Audio / Video tools
  if (only('video')) root.push(L('av', '🎞️', 'avTools', { children: [
    L('av:audio', '🎵', 'extractAudio', { children: ['mp3', 'm4a', 'wav', 'flac'].map((f) => L('av:audio:' + f, '🎵', f.toUpperCase(), { action: { type: 'tool', tool: 'extract-audio', params: { format: f, audioBitrate: '192' } } })) }),
    L('av:gif', '🌀', 'toGif', { action: { type: 'tool', tool: 'video-to-gif', params: { gifFps: 12, gifWidth: 480 } } }),
    L('av:thumb', '📸', 'thumbnail', { action: { type: 'tool', tool: 'video-thumbnail', params: { at: '0:01', format: 'jpg' } } }),
    L('av:mute', '🔇', 'mute', { action: { type: 'tool', tool: 'mute-video', params: {} } }),
    L('av:normalize', '🔊', 'normalize', { action: { type: 'tool', tool: 'normalize-audio', params: { normalize: true, volume: 0 } } }),
    ...(n > 1 ? [L('av:merge', '🎞️', 'mergeVideos', { action: { type: 'tool', tool: 'merge-video', params: { format: 'mp4' }, combine: true } })] : []),
  ] }));
  else if (only('audio')) root.push(L('av', '🎧', 'avTools', { children: [
    L('av:normalize', '🔊', 'normalize', { action: { type: 'tool', tool: 'normalize-audio', params: { normalize: true, volume: 0 } } }),
    L('av:speed', '⏩', 'speed', { children: ['0.75', '1.25', '1.5', '2'].map((s) => L('av:speed:' + s, '⏩', s + '×', { action: { type: 'tool', tool: 'change-speed', params: { speed: s } } })) }),
    ...(n > 1 ? [L('av:merge', '🎼', 'mergeAudio', { action: { type: 'tool', tool: 'merge-audio', params: { format: 'mp3' }, combine: true } })] : []),
  ] }));
  // ---- Strip metadata
  if (only('image', 'video', 'audio', 'pdf')) root.push(L('strip', '🧹', 'strip', { action: { type: 'tool', tool: 'strip-metadata', params: {} } }));
  // ---- Open in Mamba Reader
  if (only('pdf', 'ebook', 'image') || files.every((f) => f.ext === 'html' || f.ext === 'htm')) root.push(L('reader', '📖', 'openReader', { action: { type: 'reader' }, disabled: opts.readerAvailable === false }));
  return { files, kinds, items: root.slice(0, MAX_RING + 1) };
}

const COMPRESS = {
  image: { low: { quality: 85 }, medium: { quality: 70 }, strong: { quality: 45, maxWidth: 2560 } },
  video: { low: { mode: 'crf', crf: 23 }, medium: { mode: 'crf', crf: 28 }, strong: { mode: 'crf', crf: 33, height: '720' } },
  audio: { low: { audioBitrate: '160' }, medium: { audioBitrate: '96' }, strong: { audioBitrate: '64' } },
  pdf: { low: { level: 'lossless' }, medium: { level: 'strong', dpi: 150, quality: 70 }, strong: { level: 'strong', dpi: 96, quality: 50 } },
};
const COMPRESS_TOOL = { image: 'compress-image', video: 'compress-video', audio: 'compress-audio', pdf: 'compress-pdf' };

/** Turn a menu action + files into engine jobs ({type:'convert'|'tool', ...}). Non-job actions return { special }. */
function resolveJobs(action, input) {
  const files = describe(input);
  if (!action) return [];
  if (action.type === 'reader' || action.type === 'studio') return [{ special: action.type, tab: action.tab, edit: !!action.edit, files: files.map((f) => f.path) }];
  if (action.type === 'convert') return files.map((f) => ({ type: 'convert', files: [f.path], target: action.target, label: `${base(f.path)} → ${action.target.toUpperCase()}` }));
  if (action.type === 'edit') return files.map((f) => ({ type: 'convert', files: [f.path], target: imgSame(f.ext), options: { ...action.options, suffix: action.suffix }, label: base(f.path) }));
  if (action.type === 'compress') return files.map((f) => ({ type: 'tool', tool: COMPRESS_TOOL[f.kind], files: [f.path], options: { ...(f.kind === 'image' ? { format: 'same' } : {}), ...(f.kind === 'video' ? { format: 'mp4' } : {}), ...(f.kind === 'audio' ? { format: 'mp3' } : {}), ...COMPRESS[f.kind][action.level] }, label: `${base(f.path)} · ${action.level}` }));
  if (action.type === 'tool') {
    if (action.combine) return [{ type: 'tool', tool: action.tool, files: files.map((f) => f.path), options: { ...action.params }, label: files.length > 1 ? `${files.length} files · ${action.tool}` : `${base(files[0].path)} · ${action.tool}` }];
    return files.map((f) => ({ type: 'tool', tool: action.tool, files: [f.path], options: { ...action.params }, label: `${base(f.path)} · ${action.tool}` }));
  }
  return [];
}
const base = (p) => String(p).split(/[\\/]/).pop();
const imgSame = (e) => { e = formats.norm(e); return ['png', 'jpg', 'webp', 'avif', 'tiff', 'gif'].includes(e) ? e : 'png'; };
function fmtIcon(t) { const k = formats.kindOf(t); return t === 'pdf' ? '📕' : t === 'gif' ? '🌀' : k === 'image' ? '🖼️' : k === 'video' ? '🎬' : k === 'audio' ? '🎵' : k === 'doc' || t === 'txt' ? '📝' : t === 'ico' ? '🔷' : '📄'; }
/** Find a node by id path like "convert:png" or "compress:medium" (used by tests and --radial-pick). */
function find(items, id) { for (const it of items) { if (it.id === id) return it; if (it.children) { const r = find(it.children, id); if (r) return r; } } return null; }

module.exports = { menuFor, resolveJobs, find, MAX_RING, describe };
