'use strict';
// Single source of truth for what converts to what.
const IMAGE_IN = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'tif', 'tiff', 'gif', 'bmp', 'heic', 'heif', 'svg', 'ico', 'tga', 'jp2', 'ppm', 'pgm', 'pcx'];
const IMAGE_OUT = ['jpg', 'png', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico', 'pdf'];
const VIDEO_IN = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'mts', 'm2ts', 'ogv', 'vob', 'f4v', 'asf'];
const VIDEO_OUT = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'ts', 'ogv', '3gp', 'gif', 'webp'];
const AUDIO_IN = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka', 'caf', 'm4b', 'wv', 'mp2', 'au'];
const AUDIO_OUT = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'ac3', 'mp2', 'amr'];
const PDF_IN = ['pdf'];
const PDF_OUT = ['png', 'jpg', 'webp', 'tiff', 'txt', 'html'];
const EBOOK_IN = ['epub', 'xps', 'oxps', 'cbz', 'fb2', 'mobi'];
const EBOOK_OUT = ['pdf', 'png', 'jpg', 'txt'];
const DOC_IN = ['md', 'markdown', 'html', 'htm', 'txt', 'docx'];
const DATA_IN = ['csv', 'tsv', 'json'];

const SNAP_OUT = ['png', 'jpg']; // video -> still frame

function kindOf(e) {
  e = String(e).toLowerCase();
  if (e === 'gif') return 'image';
  if (IMAGE_IN.includes(e)) return 'image';
  if (VIDEO_IN.includes(e)) return 'video';
  if (AUDIO_IN.includes(e)) return 'audio';
  if (PDF_IN.includes(e)) return 'pdf';
  if (EBOOK_IN.includes(e)) return 'ebook';
  if (DOC_IN.includes(e)) return 'doc';
  if (DATA_IN.includes(e)) return 'data';
  return null;
}

const norm = (e) => ({ jpeg: 'jpg', jfif: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', aif: 'aiff', oga: 'ogg', mpeg: 'mpg' }[e] || e);

function targetsFor(e) {
  e = String(e).toLowerCase();
  const n = norm(e);
  const k = kindOf(e);
  let t = [];
  switch (k) {
    case 'image': t = [...IMAGE_OUT]; if (n === 'gif') t.push('mp4', 'webm'); break;
    case 'video': t = [...VIDEO_OUT, ...AUDIO_OUT, ...SNAP_OUT]; break;
    case 'audio': t = [...AUDIO_OUT]; break;
    case 'pdf': t = [...PDF_OUT]; break;
    case 'ebook': t = [...EBOOK_OUT]; break;
    case 'doc':
      if (n === 'md') t = ['html', 'pdf', 'txt', 'docx'];
      else if (n === 'html') t = ['pdf', 'txt', 'md', 'docx'];
      else if (n === 'txt') t = ['pdf', 'html', 'md', 'docx'];
      else if (n === 'docx') t = ['pdf', 'html', 'txt', 'md'];
      break;
    case 'data': t = { csv: ['json', 'tsv', 'html'], tsv: ['json', 'csv', 'html'], json: ['csv', 'tsv'] }[n] || []; break;
    default: t = [];
  }
  return [...new Set(t)].filter((x) => x !== n);
}

function allConversions() {
  const all = [...IMAGE_IN, ...VIDEO_IN, ...AUDIO_IN, ...PDF_IN, ...EBOOK_IN, ...DOC_IN, ...DATA_IN];
  const rows = [];
  for (const e of all) for (const t of targetsFor(e)) rows.push([e, t]);
  return rows;
}

module.exports = { IMAGE_IN, IMAGE_OUT, VIDEO_IN, VIDEO_OUT, AUDIO_IN, AUDIO_OUT, PDF_IN, EBOOK_IN, DOC_IN, DATA_IN, kindOf, targetsFor, allConversions, norm };
