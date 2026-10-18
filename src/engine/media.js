'use strict';
const { ffmpeg, probe, outPath, parseTime, tmpDir, fsp, path, ext } = require('./util');
const { AUDIO_OUT } = require('./formats');

const AUDIO_CODEC = {
  mp3: ['-c:a', 'libmp3lame'], wav: ['-c:a', 'pcm_s16le'], aac: ['-c:a', 'aac', '-f', 'adts'], m4a: ['-c:a', 'aac', '-f', 'ipod'],
  flac: ['-c:a', 'flac'], ogg: ['-c:a', 'libvorbis'], opus: ['-c:a', 'libopus'], wma: ['-c:a', 'wmav2'], aiff: ['-c:a', 'pcm_s16be'],
  ac3: ['-c:a', 'ac3'], mp2: ['-c:a', 'mp2'], amr: ['-c:a', 'libopencore_amrnb', '-ar', '8000', '-ac', '1'],
};
const LOSSLESS = ['wav', 'flac', 'aiff'];
const DEFAULT_ABR = { mp3: 192, aac: 192, m4a: 192, ogg: 192, opus: 128, wma: 192, ac3: 192, mp2: 192, amr: 12.2 };

// container -> [videoCodec, audioCodec, extra]
const VIDEO_CODEC = {
  mp4: ['libx264', 'aac', ['-movflags', '+faststart']], m4v: ['libx264', 'aac', ['-movflags', '+faststart']], mov: ['libx264', 'aac', ['-movflags', '+faststart']],
  mkv: ['libx264', 'aac', []], flv: ['libx264', 'aac', []], ts: ['libx264', 'aac', ['-f', 'mpegts']], '3gp': ['libx264', 'aac', ['-profile:v', 'baseline']],
  webm: ['libvpx-vp9', 'libopus', ['-row-mt', '1', '-deadline', 'good', '-cpu-used', '5']],
  avi: ['mpeg4', 'libmp3lame', ['-vtag', 'xvid']], wmv: ['wmv2', 'wmav2', []], mpg: ['mpeg2video', 'mp2', ['-f', 'mpeg']],
  ogv: ['libtheora', 'libvorbis', []],
};
const QSCALE_CODECS = ['mpeg4', 'wmv2', 'mpeg2video', 'libtheora'];

function atempoChain(speed) {
  const out = []; let s = speed;
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  out.push(`atempo=${s.toFixed(4)}`); return out.join(',');
}

function videoFilters(o, { forGif = false } = {}) {
  const f = [];
  if (o.crop && o.crop.w > 0 && o.crop.h > 0 && (o.crop.w < 0.999 || o.crop.h < 0.999)) {
    const c = o.crop; f.push(`crop=trunc(iw*${c.w.toFixed(5)}/2)*2:trunc(ih*${c.h.toFixed(5)}/2)*2:trunc(iw*${c.x.toFixed(5)}):trunc(ih*${c.y.toFixed(5)})`);
  }
  const r = Number(o.rotate || 0) % 360;
  if (r === 90 || r === -270) f.push('transpose=1'); else if (r === 270 || r === -90) f.push('transpose=2'); else if (Math.abs(r) === 180) f.push('hflip,vflip');
  if (o.flipH) f.push('hflip'); if (o.flipV) f.push('vflip');
  const b = Number(o.brightness || 0), c = Number(o.contrast || 0), s = Number(o.saturation || 0);
  if (b || c || s) f.push(`eq=brightness=${(b / 100).toFixed(3)}:contrast=${(1 + c / 100).toFixed(3)}:saturation=${Math.max(0, 1 + s / 100).toFixed(3)}`);
  if (o.hue) f.push(`hue=h=${Number(o.hue)}`);
  if (o.grayscale) f.push('hue=s=0');
  if (o.invert) f.push('negate');
  const w = Number(o.width) || 0, h = Number(o.height) || 0;
  if (forGif) {
    const gw = Number(o.gifWidth) || (w || 480);
    f.push(`fps=${Number(o.gifFps || o.fps) || 12}`, `scale=${gw}:-1:flags=lanczos`);
  } else {
    if (w && h) f.push(o.keepAspect === false ? `scale=${w}:${h}` : `scale=${w}:${h}:force_original_aspect_ratio=decrease`);
    else if (h) f.push(`scale=-2:${h}`); else if (w) f.push(`scale=${w}:-2`);
    if (o.fps) f.push(`fps=${Number(o.fps)}`);
  }
  const sp = Number(o.speed || 1);
  if (sp && sp !== 1) f.push(`setpts=PTS/${sp}`);
  if (!forGif) f.push('scale=trunc(iw/2)*2:trunc(ih/2)*2', 'format=yuv420p');
  return f;
}

function audioFilters(o) {
  const f = [];
  const sp = Number(o.speed || 1); if (sp && sp !== 1) f.push(atempoChain(sp));
  if (o.volume) f.push(`volume=${Number(o.volume)}dB`);
  if (o.normalize) f.push('loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=48000');
  if (o.fadeIn) f.push(`afade=t=in:d=${Number(o.fadeIn)}`);
  return f;
}

function trimArgs(o, dur) {
  const s = parseTime(o.start), e = parseTime(o.end);
  const pre = [], post = [];
  if (s) pre.push('-ss', String(s));
  if (e && e > (s || 0)) post.push('-t', String(e - (s || 0)));
  const len = Math.max(0.1, ((e && e > (s || 0)) ? e : dur) - (s || 0)) / (Number(o.speed) || 1);
  return { pre, post, len };
}

function metaArgs(o) { return o.stripMetadata ? ['-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact'] : []; }

async function convert(file, fmt, o = {}, { onProgress, signal } = {}) {
  const info = await probe(file);
  const dest = o.dest || outPath(file, fmt, o);
  const { pre, post, len } = trimArgs(o, info.duration);
  const P = { onProgress, signal, durationSec: len };

  // ---- audio outputs (from audio or video) ----
  if (AUDIO_OUT.includes(fmt)) {
    if (!info.hasAudio) throw new Error('This file has no audio track');
    const af = audioFilters(o);
    const args = [...pre, '-i', file, ...post, '-vn', '-sn', ...AUDIO_CODEC[fmt]];
    if (!LOSSLESS.includes(fmt) && fmt !== 'amr') args.push('-b:a', `${o.audioBitrate || DEFAULT_ABR[fmt] || 192}k`);
    if (fmt === 'amr') args.push('-b:a', '12.2k');
    if (o.sampleRate && fmt !== 'amr') args.push('-ar', String(o.sampleRate));
    if (o.channels && fmt !== 'amr') args.push('-ac', String(o.channels));
    if (fmt === 'opus' && !o.sampleRate) args.push('-ar', '48000');
    if (af.length) args.push('-af', af.join(','));
    args.push(...metaArgs(o), dest);
    await ffmpeg(args, P); return dest;
  }
  if (!info.hasVideo) throw new Error('This file has no video stream');

  // ---- still frame ----
  if (fmt === 'png' || fmt === 'jpg') {
    const at = parseTime(o.at) ?? (parseTime(o.start) || Math.min(1, info.duration / 10));
    const vf = videoFilters({ ...o, speed: 1 }).filter((x) => !x.startsWith('format='));
    await ffmpeg(['-ss', String(at), '-i', file, '-frames:v', '1', ...(vf.length ? ['-vf', vf.join(',')] : []), ...(fmt === 'jpg' ? ['-q:v', '2'] : []), '-update', '1', dest], { signal });
    return dest;
  }

  // ---- animated GIF / WebP ----
  if (fmt === 'gif' || fmt === 'webp') {
    const vf = videoFilters(o, { forGif: true }).join(',');
    if (fmt === 'gif') {
      const dither = o.dither || 'sierra2_4a';
      await ffmpeg([...pre, '-i', file, ...post, '-filter_complex', `[0:v]${vf},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=${dither}`, '-loop', String(o.loop ?? 0), dest], P);
    } else {
      await ffmpeg([...pre, '-i', file, ...post, '-vf', vf, '-c:v', 'libwebp_anim', '-loop', '0', '-q:v', String(o.quality || 70), '-an', dest], P);
    }
    return dest;
  }

  // ---- video containers ----
  const [vc, ac, extra] = VIDEO_CODEC[fmt] || VIDEO_CODEC.mp4;
  const vf = videoFilters(o); const af = audioFilters(o);
  const crf = Number(o.crf || 23);
  const vArgs = ['-c:v', vc];
  let twoPass = false, vk = 0;
  const audioK = Number(o.audioBitrate || 128);
  if (o.targetMB) {
    const totalK = Number(o.targetMB) * 8388.608 / len * (vc === 'libvpx-vp9' ? 0.88 : 0.95);
    vk = Math.max(50, Math.floor(totalK - (o.mute || !info.hasAudio ? 0 : audioK)));
    twoPass = ['libx264', 'libvpx-vp9'].includes(vc);
    vArgs.push('-b:v', `${vk}k`, ...(twoPass ? [] : ['-maxrate', `${Math.round(vk * 1.2)}k`, '-bufsize', `${vk * 2}k`]));
  } else if (o.videoBitrate) {
    vArgs.push('-b:v', `${Number(o.videoBitrate)}k`, '-maxrate', `${Math.round(o.videoBitrate * 1.3)}k`, '-bufsize', `${o.videoBitrate * 2}k`);
  } else if (QSCALE_CODECS.includes(vc)) {
    vArgs.push('-q:v', String(Math.max(2, Math.min(31, Math.round((crf - 10) / 2.5)))));
    if (vc === 'libtheora') vArgs.splice(-2, 2, '-q:v', String(Math.max(1, Math.min(10, Math.round(14 - crf / 3)))));
  } else if (vc === 'libvpx-vp9') vArgs.push('-crf', String(Math.min(63, crf + 8)), '-b:v', '0');
  else vArgs.push('-crf', String(crf), '-preset', o.preset || 'medium');
  if (vc === 'libx264' && o.targetMB) vArgs.push('-preset', o.preset || 'medium');
  if (vc === 'wmv2' && !o.targetMB && !o.videoBitrate) vArgs.splice(-2, 2, '-b:v', `${Math.round((info.width * info.height || 921600) / 300)}k`);

  const aArgs = o.mute || !info.hasAudio ? ['-an'] : ['-c:a', ac, '-b:a', `${audioK}k`, ...(ac === 'libopus' || ac === 'mp2' ? ['-ar', '48000'] : []), ...(af.length ? ['-af', af.join(',')] : [])];
  const common = [...pre, '-i', file, ...post, '-map', '0:v:0', ...(o.mute || !info.hasAudio ? [] : ['-map', '0:a:0?']), '-vf', vf.join(','), ...vArgs];
  if (twoPass) {
    const td = await tmpDir(); const log = path.join(td, 'pass');
    try {
      await ffmpeg([...common, '-pass', '1', '-passlogfile', log, '-an', '-f', 'null', '-'], { ...P, onProgress: (p) => onProgress && onProgress(p * 0.5) });
      await ffmpeg([...common, '-pass', '2', '-passlogfile', log, ...aArgs, ...extra, ...metaArgs(o), dest], { ...P, onProgress: (p) => onProgress && onProgress(0.5 + p * 0.5) });
    } finally { fsp.rm(td, { recursive: true, force: true }).catch(() => {}); }
  } else {
    await ffmpeg([...common, ...aArgs, ...extra, ...metaArgs(o), dest], P);
  }
  return dest;
}

async function trimFast(file, o = {}, { signal } = {}) {
  const dest = o.dest || outPath(file, ext(file), { ...o, suffix: '-trimmed' });
  const s = parseTime(o.start) || 0, e = parseTime(o.end);
  await ffmpeg(['-ss', String(s), '-i', file, ...(e ? ['-t', String(e - s)] : []), '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', dest], { signal });
  return dest;
}

async function stripMetadata(file, o = {}, { signal } = {}) {
  const dest = o.dest || outPath(file, ext(file), { ...o, suffix: '-clean' });
  await ffmpeg(['-i', file, '-map', '0', '-c', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact', dest], { signal });
  return dest;
}

async function mergeAudio(files, fmt, o = {}, { onProgress, signal } = {}) {
  const infos = await Promise.all(files.map(probe));
  const dur = infos.reduce((s, i) => s + i.duration, 0);
  const dest = o.dest || outPath(files[0], fmt, { ...o, suffix: '-merged' });
  const ins = files.flatMap((f) => ['-i', f]);
  const fc = files.map((_, i) => `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`).join(';') + ';' + files.map((_, i) => `[a${i}]`).join('') + `concat=n=${files.length}:v=0:a=1[out]`;
  const codec = AUDIO_CODEC[fmt] || AUDIO_CODEC.mp3;
  await ffmpeg([...ins, '-filter_complex', fc, '-map', '[out]', ...codec, ...(LOSSLESS.includes(fmt) ? [] : ['-b:a', `${o.audioBitrate || DEFAULT_ABR[fmt] || 192}k`]), dest], { onProgress, signal, durationSec: dur });
  return dest;
}

async function mergeVideo(files, fmt, o = {}, { onProgress, signal } = {}) {
  const infos = await Promise.all(files.map(probe));
  const W = Number(o.width) || (infos[0].width + (infos[0].width % 2)), H = Number(o.height) || (infos[0].height + (infos[0].height % 2));
  const F = Number(o.fps) || Math.round(infos[0].fps || 30);
  const dur = infos.reduce((s, i) => s + i.duration, 0);
  const dest = o.dest || outPath(files[0], fmt, { ...o, suffix: '-merged' });
  const ins = files.flatMap((f) => ['-i', f]);
  const parts = []; const pairs = []; let extra = files.length;
  infos.forEach((inf, i) => {
    parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${F},format=yuv420p[v${i}]`);
    if (inf.hasAudio) parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    else { ins.push('-f', 'lavfi', '-t', String(inf.duration || 1), '-i', 'anullsrc=r=48000:cl=stereo'); parts.push(`[${extra++}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`); }
    pairs.push(`[v${i}][a${i}]`);
  });
  const fc = parts.join(';') + ';' + pairs.join('') + `concat=n=${files.length}:v=1:a=1[v][a]`;
  const [vc, ac, ex] = VIDEO_CODEC[fmt] || VIDEO_CODEC.mp4;
  const q = QSCALE_CODECS.includes(vc) ? ['-q:v', '4'] : vc === 'libvpx-vp9' ? ['-crf', '32', '-b:v', '0'] : ['-crf', String(o.crf || 21), '-preset', 'medium'];
  await ffmpeg([...ins, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-c:v', vc, ...q, '-c:a', ac, '-b:a', '160k', ...ex, dest], { onProgress, signal, durationSec: dur });
  return dest;
}

/** A single frame (optionally with edits applied) as a PNG data URL for the Video Studio preview. */
async function frame(file, at = 0, o = {}) {
  const vf = [...videoFilters({ ...o, width: 0, height: 0, fps: 0, speed: 1 }).filter((x) => !x.startsWith('format=')), 'scale=\'min(960,iw)\':-2'];
  const { stdout } = await ffmpeg(['-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', vf.join(','), '-f', 'image2pipe', '-c:v', 'png', 'pipe:1']);
  return 'data:image/png;base64,' + stdout.toString('base64');
}

/** Estimate of output size for the studio panel. */
function estimate(info, o = {}) {
  const { len } = trimArgs(o, info.duration);
  if (o.targetMB) return Number(o.targetMB) * 1048576;
  if (o.videoBitrate) return (Number(o.videoBitrate) + (o.mute ? 0 : Number(o.audioBitrate || 128))) * 125 * len;
  return null;
}

module.exports = { convert, trimFast, stripMetadata, mergeAudio, mergeVideo, frame, probe, estimate, videoFilters };
