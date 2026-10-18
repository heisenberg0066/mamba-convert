'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const config = {
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
};
function setBinaries({ ffmpeg, ffprobe }) {
  if (ffmpeg) config.ffmpeg = ffmpeg;
  if (ffprobe) config.ffprobe = ffprobe;
}

function ext(p) { return path.extname(p).slice(1).toLowerCase(); }
function base(p) { return path.basename(p, path.extname(p)); }

/** Pick an output path that does not overwrite anything. */
function outPath(input, newExt, { outputDir, suffix = '' } = {}) {
  const dir = outputDir || path.dirname(input);
  let name = base(input) + suffix;
  let candidate = path.join(dir, `${name}.${newExt}`);
  let i = 1;
  while (fs.existsSync(candidate) || path.resolve(candidate) === path.resolve(input)) {
    candidate = path.join(dir, `${name} (${i++}).${newExt}`);
  }
  return candidate;
}

async function tmpDir() { return fsp.mkdtemp(path.join(os.tmpdir(), 'mamba-')); }

function parseTime(t) {
  if (t === undefined || t === null || t === '') return null;
  if (typeof t === 'number') return t;
  const s = String(t).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(parseFloat);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

/** Run a process; reports progress (0..1) from ffmpeg's -progress output when durationSec is known. */
function run(bin, args, { onProgress, durationSec, signal, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    const out = [];
    child.stdout.on('data', (d) => {
      out.push(d);
      if (onProgress && durationSec) {
        const m = /out_time_(?:ms|us)=(\d+)/g; let mm, last = null;
        const s = d.toString();
        while ((mm = m.exec(s))) last = mm[1];
        if (last) onProgress(Math.min(0.999, (parseInt(last, 10) / 1e6) / durationSec));
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 200000) stderr = stderr.slice(-100000); });
    child.on('error', reject);
    const onAbort = () => { try { child.kill('SIGKILL'); } catch (_) {} };
    if (signal) { if (signal.aborted) onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    if (input) { child.stdin.end(input); }
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return reject(new Error('Cancelled'));
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr });
      else reject(new Error(`${path.basename(bin)} failed (code ${code}): ${stderr.split('\n').filter(Boolean).slice(-4).join(' | ')}`));
    });
  });
}

function ffmpeg(args, opts = {}) {
  const full = ['-hide_banner', '-nostdin', '-y', ...(opts.durationSec ? ['-progress', 'pipe:1', '-nostats'] : []), ...args];
  return run(config.ffmpeg, full, opts);
}

async function probe(file) {
  const { stdout } = await run(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout.toString());
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  let fps = null;
  if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') { const [n, d] = v.avg_frame_rate.split('/').map(Number); if (d) fps = n / d; }
  return {
    duration: parseFloat(j.format && j.format.duration) || (v && parseFloat(v.duration)) || 0,
    bitrate: parseInt(j.format && j.format.bit_rate, 10) || 0,
    width: v ? v.width : 0, height: v ? v.height : 0, fps,
    hasVideo: !!v, hasAudio: !!a, vcodec: v && v.codec_name, acodec: a && a.codec_name,
    rotation: v && v.side_data_list ? (v.side_data_list.find((x) => x.rotation !== undefined) || {}).rotation || 0 : 0,
  };
}

module.exports = { config, setBinaries, ext, base, outPath, tmpDir, parseTime, run, ffmpeg, probe, fsp, fs, path };
