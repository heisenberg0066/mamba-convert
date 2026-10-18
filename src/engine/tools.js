'use strict';
// Tool catalogue shared with the UI (rendered as forms). Labels are i18n keys.
const T = (id, icon, accepts, params, extra = {}) => ({ id, icon, accepts, params, ...extra });
const P = {
  num: (key, def, min, max, step = 1) => ({ key, type: 'number', def, min, max, step }),
  range: (key, def, min, max, step = 1) => ({ key, type: 'range', def, min, max, step }),
  sel: (key, def, options) => ({ key, type: 'select', def, options }),
  chk: (key, def = false) => ({ key, type: 'checkbox', def }),
  time: (key, def = '') => ({ key, type: 'time', def }),
  text: (key, def = '') => ({ key, type: 'text', def }),
};
const RES = ['', '2160', '1440', '1080', '720', '480', '360', '240'];

const TOOLS = [
  T('make-flipbook', '📖', ['pdf', 'image', 'doc', 'ebook'], [P.sel('mode', 'single', ['single', 'folder']), P.num('pageWidth', 1400, 400, 4000, 50), P.range('quality', 82, 30, 100), P.chk('rtl', false), P.text('title', '')], { multi: true, minFiles: 1 }),
  T('compress-image', '🗜️', ['image'], [P.range('quality', 70, 1, 100), P.num('targetKB', '', 1, 100000), P.sel('format', 'same', ['same', 'jpg', 'webp', 'avif', 'png']), P.num('maxWidth', '', 16, 20000)]),
  T('compress-video', '🎬', ['video'], [P.sel('mode', 'crf', ['crf', 'size']), P.range('crf', 28, 18, 40), P.num('targetMB', 10, 1, 100000, 0.5), P.sel('height', '', RES), P.sel('format', 'mp4', ['mp4', 'webm', 'mkv'])]),
  T('compress-audio', '🎧', ['audio'], [P.sel('audioBitrate', '96', ['32', '48', '64', '96', '128', '160', '192', '256', '320']), P.sel('format', 'mp3', ['mp3', 'm4a', 'opus', 'ogg'])]),
  T('compress-pdf', '📉', ['pdf'], [P.sel('level', 'lossless', ['lossless', 'strong']), P.num('dpi', 110, 50, 300), P.range('quality', 60, 10, 95)]),
  T('trim', '✂️', ['video', 'audio'], [P.time('start', '0:00'), P.time('end', ''), P.chk('fast', false)]),
  T('merge-pdf', '📑', ['pdf', 'image'], [P.sel('pageSize', 'fit', ['fit', 'a4', 'letter'])], { multi: true }),
  T('merge-audio', '🎼', ['audio', 'video'], [P.sel('format', 'mp3', ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'])], { multi: true }),
  T('merge-video', '🎞️', ['video'], [P.sel('format', 'mp4', ['mp4', 'mkv', 'webm', 'mov'])], { multi: true }),
  T('images-to-pdf', '🖼️', ['image'], [P.sel('pageSize', 'fit', ['fit', 'a4', 'letter']), P.range('quality', 90, 30, 100)], { multi: true }),
  T('split-pdf', '🔪', ['pdf'], [P.sel('mode', 'each', ['each', 'ranges']), P.text('ranges', '1-3,4-')]),
  T('extract-pages', '📄', ['pdf'], [P.text('pages', '1-2')]),
  T('rotate-pdf', '🔄', ['pdf'], [P.sel('angle', '90', ['90', '180', '270']), P.text('pages', '')]),
  T('pdf-to-images', '🧩', ['pdf', 'ebook'], [P.sel('format', 'png', ['png', 'jpg', 'webp', 'tiff']), P.num('dpi', 150, 36, 600), P.text('pages', '')]),
  T('pdf-to-text', '🔤', ['pdf', 'ebook'], [P.sel('format', 'txt', ['txt', 'html'])]),
  T('page-numbers', '🔢', ['pdf'], []),
  T('protect-pdf', '🔒', ['pdf'], [P.text('password', '')]),
  T('resize-image', '📐', ['image'], [P.sel('mode', 'px', ['px', 'percent']), P.num('width', 1280, 1, 30000), P.num('height', '', 1, 30000), P.num('percent', 50, 1, 1000), P.chk('keepAspect', true)]),
  T('rotate-image', '↻', ['image'], [P.sel('angle', '90', ['0', '90', '180', '270']), P.chk('flipH'), P.chk('flipV')]),
  T('remove-background', '🪄', ['image'], [P.range('tolerance', 25, 1, 100), P.text('color', ''), P.sel('format', 'png', ['png', 'webp'])]),
  T('rotate-video', '🔃', ['video'], [P.sel('angle', '90', ['0', '90', '180', '270']), P.chk('flipH'), P.chk('flipV')]),
  T('extract-audio', '🎵', ['video'], [P.sel('format', 'mp3', ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus']), P.sel('audioBitrate', '192', ['96', '128', '192', '256', '320'])]),
  T('video-to-gif', '🌀', ['video'], [P.time('start', '0:00'), P.time('end', ''), P.num('gifFps', 12, 1, 50), P.num('gifWidth', 480, 64, 1920)]),
  T('change-resolution', '🖥️', ['video'], [P.sel('height', '720', RES), P.num('width', '', 16, 8000), P.num('customHeight', '', 16, 8000)]),
  T('change-bitrate', '📶', ['video', 'audio'], [P.num('videoBitrate', 2500, 100, 100000), P.sel('audioBitrate', '128', ['64', '96', '128', '160', '192', '256', '320'])]),
  T('change-fps', '⏱️', ['video'], [P.sel('fps', '30', ['15', '24', '25', '30', '50', '60'])]),
  T('change-speed', '⏩', ['video', 'audio'], [P.sel('speed', '1.5', ['0.25', '0.5', '0.75', '1.25', '1.5', '2', '3', '4'])]),
  T('mute-video', '🔇', ['video'], []),
  T('normalize-audio', '🔊', ['audio', 'video'], [P.chk('normalize', true), P.num('volume', 0, -30, 30)]),
  T('video-thumbnail', '📸', ['video'], [P.time('at', '0:01'), P.sel('format', 'jpg', ['jpg', 'png'])]),
  T('strip-metadata', '🧹', ['image', 'video', 'audio', 'pdf'], []),
];
module.exports = { TOOLS };
