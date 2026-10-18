'use strict';
const util = require('./util');
const formats = require('./formats');
const image = require('./image');
const media = require('./media');
const pdf = require('./pdf');
const doc = require('./doc');
const data = require('./data');
const { TOOLS } = require('./tools');
const flipbook = require('./flipbook');
const { ext } = util;

const kind = (f) => formats.kindOf(ext(f));

/** Plain conversion of one file to a target format, with optional edit options (studio settings). */
async function convertFile(file, target, o = {}, ctl = {}) {
  const k = kind(file);
  const e = formats.norm(ext(file));
  if (target === 'flipbook') return flipbook.makeFlipbook([file], o, ctl);
  switch (k) {
    case 'image':
      if (target === 'mp4' || target === 'webm') return media.convert(file, target, o, ctl);
      return image.convert(file, target, o);
    case 'video': case 'audio': return media.convert(file, target, o, ctl);
    case 'pdf':
      if (['png', 'jpg', 'webp', 'tiff'].includes(target)) return pdf.toImages(file, target, o, ctl);
      if (target === 'txt' || target === 'html') return pdf.toText(file, target, o);
      break;
    case 'ebook':
      if (target === 'pdf') return pdf.docToPdf(file, o);
      if (['png', 'jpg'].includes(target)) return pdf.toImages(file, target, o, ctl);
      if (target === 'txt') return pdf.toText(file, 'txt', o);
      break;
    case 'doc': return doc.convert(file, target, o);
    case 'data': return data.convert(file, target, o);
  }
  throw new Error(`Cannot convert .${e} to .${target}`);
}

const sameFmt = (f) => { const e = formats.norm(ext(f)); return e; };

async function runTool(id, files, o = {}, ctl = {}) {
  const one = (fn) => seq(files, fn, ctl);
  const sfx = (s) => ({ ...o, suffix: s });
  switch (id) {
    case 'compress-image': return one((f) => { const fmt = o.format && o.format !== 'same' ? o.format : (['png', 'jpg', 'webp', 'avif', 'tiff', 'gif'].includes(sameFmt(f)) ? sameFmt(f) : 'jpg'); return image.convert(f, fmt, { ...sfx('-compressed'), quality: o.quality, targetKB: o.targetKB, resize: o.maxWidth ? { mode: 'px', width: o.maxWidth, keepAspect: true, noEnlarge: true } : null }); });
    case 'compress-video': return one((f, c) => media.convert(f, o.format || 'mp4', { ...sfx('-compressed'), crf: o.mode === 'crf' ? o.crf : undefined, targetMB: o.mode === 'size' ? o.targetMB : undefined, height: o.height || undefined }, c));
    case 'compress-audio': return one((f, c) => media.convert(f, o.format || 'mp3', { ...sfx('-compressed'), audioBitrate: o.audioBitrate }, c));
    case 'compress-pdf': return one((f, c) => pdf.compress(f, o, c));
    case 'trim': return one((f, c) => o.fast ? media.trimFast(f, o, c) : media.convert(f, sameFmt(f), { ...sfx('-trimmed'), crf: 18 }, c));
    case 'make-flipbook': return [await flipbook.makeFlipbook(files, o, ctl)];
    case 'merge-pdf': return [await pdf.merge(files, o)];
    case 'merge-audio': return [await media.mergeAudio(files, o.format || 'mp3', o, ctl)];
    case 'merge-video': return [await media.mergeVideo(files, o.format || 'mp4', o, ctl)];
    case 'images-to-pdf': return [await image.imagesToPdf(files, o)];
    case 'split-pdf': return (await seq(files, (f) => pdf.split(f, o), ctl)).flat();
    case 'extract-pages': return one((f) => pdf.extractPages(f, o));
    case 'rotate-pdf': return one((f) => pdf.rotate(f, o));
    case 'pdf-to-images': return (await seq(files, (f, c) => pdf.toImages(f, o.format || 'png', o, c), ctl)).flat();
    case 'pdf-to-text': return one((f) => pdf.toText(f, o.format || 'txt', o));
    case 'page-numbers': return one((f) => pdf.pageNumbers(f, o));
    case 'protect-pdf': return one((f) => pdf.protect(f, o));
    case 'resize-image': return one((f) => image.convert(f, imgOut(f), { ...sfx('-resized'), resize: { mode: o.mode, width: o.width, height: o.height, percent: o.percent, keepAspect: o.keepAspect } }));
    case 'rotate-image': return one((f) => image.convert(f, imgOut(f), { ...sfx('-rotated'), rotate: Number(o.angle), flipH: o.flipH, flipV: o.flipV }));
    case 'remove-background': return one((f) => image.convert(f, o.format || 'png', { ...sfx('-nobg'), removeBg: { tolerance: o.tolerance, color: o.color } }));
    case 'rotate-video': return one((f, c) => media.convert(f, vidOut(f), { ...sfx('-rotated'), rotate: Number(o.angle), flipH: o.flipH, flipV: o.flipV, crf: 20 }, c));
    case 'extract-audio': return one((f, c) => media.convert(f, o.format || 'mp3', o, c));
    case 'video-to-gif': return one((f, c) => media.convert(f, 'gif', o, c));
    case 'change-resolution': return one((f, c) => media.convert(f, vidOut(f), { ...sfx(`-${o.customHeight || o.height || 'resized'}p`), height: o.customHeight || o.height, width: o.width, crf: 21 }, c));
    case 'change-bitrate': return one((f, c) => media.convert(f, kind(f) === 'audio' ? audOut(f) : vidOut(f), { ...sfx('-bitrate'), videoBitrate: kind(f) === 'audio' ? undefined : o.videoBitrate, audioBitrate: o.audioBitrate }, c));
    case 'change-fps': return one((f, c) => media.convert(f, vidOut(f), { ...sfx(`-${o.fps}fps`), fps: o.fps, crf: 20 }, c));
    case 'change-speed': return one((f, c) => media.convert(f, kind(f) === 'audio' ? audOut(f) : vidOut(f), { ...sfx(`-${o.speed}x`), speed: Number(o.speed), crf: 20 }, c));
    case 'mute-video': return one((f, c) => media.convert(f, vidOut(f), { ...sfx('-muted'), mute: true, crf: 20 }, c));
    case 'normalize-audio': return one((f, c) => media.convert(f, kind(f) === 'audio' ? audOut(f) : vidOut(f), { ...sfx('-normalized'), normalize: o.normalize, volume: o.volume, crf: 20 }, c));
    case 'video-thumbnail': return one((f, c) => media.convert(f, o.format || 'jpg', { ...sfx('-thumb'), at: o.at }, c));
    case 'strip-metadata': return one((f, c) => {
      const k = kind(f);
      if (k === 'image') return image.convert(f, imgOut(f), { ...sfx('-clean'), stripMetadata: true, quality: 95 });
      if (k === 'pdf') return pdf.stripMetadata(f, o);
      return media.stripMetadata(f, o, c);
    });
  }
  throw new Error(`Unknown tool ${id}`);
}
const imgOut = (f) => { const e = sameFmt(f); return ['png', 'jpg', 'webp', 'avif', 'tiff', 'gif'].includes(e) ? e : 'png'; };
const vidOut = (f) => { const e = sameFmt(f); return ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'mpg', 'ts', 'ogv', '3gp'].includes(e) ? e : 'mp4'; };
const audOut = (f) => { const e = sameFmt(f); return formats.AUDIO_OUT.includes(e) ? e : 'mp3'; };

/** Run fn over files one at a time, splitting progress across them. */
async function seq(files, fn, ctl = {}) {
  const outs = [];
  for (let i = 0; i < files.length; i++) {
    if (ctl.signal && ctl.signal.aborted) throw new Error('Cancelled');
    const c = { ...ctl, onProgress: (p) => ctl.onProgress && ctl.onProgress((i + p) / files.length) };
    const r = await fn(files[i], c);
    outs.push(...(Array.isArray(r) ? r : [r]));
    ctl.onProgress && ctl.onProgress((i + 1) / files.length);
  }
  return outs;
}

/** Entry point used by main process and the test runner. */
async function runJob(job, ctl = {}) {
  const o = { ...(job.options || {}), outputDir: job.outputDir || undefined };
  if (job.type === 'convert') { const r = await convertFile(job.files[0], job.target, o, ctl); return Array.isArray(r) ? r : [r]; }
  if (job.type === 'tool') return runTool(job.tool, job.files, o, ctl);
  throw new Error('Bad job');
}

module.exports = { runJob, convertFile, runTool, TOOLS, formats, image, media, pdf, doc, data, util, kind, flipbook };
