'use strict';
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { ffmpeg, ext, fsp, outPath, path, tmpDir } = require('./util');

sharp.cache(false);
const SHARP_NATIVE = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'tif', 'tiff', 'gif', 'svg'];

/** Load any supported image into something sharp can read (Buffer or path). Falls back to ffmpeg for HEIC/BMP/ICO/TGA/etc. */
async function loadInput(file) {
  const e = ext(file);
  if (SHARP_NATIVE.includes(e)) {
    try { await sharp(file).metadata(); return file; } catch (_) { /* fall through */ }
  }
  const { stdout } = await ffmpeg(['-i', file, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1']);
  if (!stdout.length) throw new Error('Could not decode image');
  return stdout;
}

async function info(file) {
  const src = await loadInput(file);
  const m = await sharp(src).metadata();
  return { width: m.width, height: m.height, format: m.format, density: m.density || null, hasAlpha: !!m.hasAlpha, pages: m.pages || 1, size: (await fsp.stat(file)).size };
}

/** Flood-fill background removal from image borders (works for solid/near-solid backgrounds, fully offline). */
async function removeBackground(img, { tolerance = 30, color } = {}) {
  const { data, info: inf } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = inf;
  let ref;
  if (color && /^#?[0-9a-f]{6}$/i.test(color)) {
    const c = color.replace('#', ''); ref = [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  } else {
    const pts = [0, w - 1, (h - 1) * w, (h - 1) * w + w - 1];
    ref = [0, 1, 2].map((ch) => Math.round(pts.reduce((s, p) => s + data[p * 4 + ch], 0) / 4));
  }
  const tol2 = (tolerance * 4.42) ** 2; // tolerance 0..100 -> distance 0..442
  const seen = new Uint8Array(w * h);
  const stack = [];
  const near = (p) => { const i = p * 4; const dr = data[i] - ref[0], dg = data[i + 1] - ref[1], db = data[i + 2] - ref[2]; return dr * dr + dg * dg + db * db <= tol2; };
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue; seen[p] = 1;
    if (!near(p)) continue;
    data[p * 4 + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } });
}

/** Apply all edit operations. Crop is in fractions (0..1) so one crop can be batch-applied to different sized images. */
async function buildPipeline(src, o = {}) {
  let img = sharp(src, { animated: false, failOn: 'none' }).rotate(); // auto-orient from EXIF
  let meta = await sharp(src).metadata();
  let W = meta.width, H = meta.height;
  if (meta.orientation && meta.orientation >= 5) [W, H] = [H, W];
  const materialize = async () => { const b = await img.png().toBuffer(); img = sharp(b); const m = await img.metadata(); W = m.width; H = m.height; };

  if (o.crop && o.crop.w > 0 && o.crop.h > 0) {
    const c = o.crop;
    const left = Math.max(0, Math.round(c.x * W)), top = Math.max(0, Math.round(c.y * H));
    const width = Math.max(1, Math.min(W - left, Math.round(c.w * W))), height = Math.max(1, Math.min(H - top, Math.round(c.h * H)));
    if (width < W || height < H) { img = img.extract({ left, top, width, height }); await materialize(); }
  }
  const rot = Number(o.rotate || 0) % 360;
  if (rot) { img = img.rotate(rot, { background: o.background || { r: 255, g: 255, b: 255, alpha: 0 } }); await materialize(); }
  if (o.flipV) img = img.flip();
  if (o.flipH) img = img.flop();

  if (o.resize && o.resize.mode && o.resize.mode !== 'none') {
    const r = o.resize; let w = null, h = null;
    if (r.mode === 'percent') { const p = (Number(r.percent) || 100) / 100; w = Math.max(1, Math.round(W * p)); h = Math.max(1, Math.round(H * p)); }
    else { w = Number(r.width) || null; h = Number(r.height) || null; }
    if (w || h) {
      const keep = r.keepAspect !== false;
      if (keep && w && h && r.mode !== 'percent') img = img.resize(w, h, { fit: r.fit || 'inside', withoutEnlargement: !!r.noEnlarge, background: { r: 255, g: 255, b: 255, alpha: 0 } });
      else img = img.resize(w, h, { fit: keep ? 'inside' : 'fill' });
      await materialize();
    }
  }

  const b = Number(o.brightness || 0), s = Number(o.saturation || 0), hue = Number(o.hue || 0);
  if (b || s || hue) img = img.modulate({ brightness: Math.max(0, 1 + b / 100), saturation: Math.max(0, 1 + s / 100), hue: Math.round(hue) });
  const c = Number(o.contrast || 0);
  if (c) { const a = Math.max(0, 1 + c / 100); img = img.linear(a, 128 * (1 - a)); }
  if (o.grayscale) img = img.grayscale();
  if (o.invert) img = img.negate({ alpha: false });
  if (o.blur) img = img.blur(Math.max(0.3, Number(o.blur)));
  if (o.sharpen) img = img.sharpen();
  if (o.removeBg) { await materialize(); img = await removeBackground(img, o.removeBg === true ? {} : o.removeBg); }
  return img;
}

function encode(img, fmt, o = {}, q) {
  const quality = Math.max(1, Math.min(100, Math.round(q || o.quality || 85)));
  const flatten = (i) => i.flatten({ background: o.flattenColor || '#ffffff' });
  switch (fmt) {
    case 'jpg': case 'jpeg': return flatten(img).jpeg({ quality, mozjpeg: true, progressive: true });
    case 'png': return img.png({ compressionLevel: 9, palette: quality < 80, quality, effort: 7 });
    case 'webp': return img.webp({ quality, effort: 4 });
    case 'avif': return img.avif({ quality: Math.max(1, quality - 15), effort: 4 });
    case 'tiff': case 'tif': return img.tiff({ quality, compression: 'lzw' });
    case 'gif': return img.gif({ effort: 7 });
    default: return img.png();
  }
}

function applyMeta(img, o) {
  if (o.dpi) return img.withMetadata({ density: Number(o.dpi) });   // DPI written into JFIF/PNG pHYs/TIFF
  if (o.stripMetadata === false) return img.keepMetadata();
  return img; // sharp strips EXIF/GPS/XMP by default
}

/** Encode to a buffer; when targetKB is set, binary-search quality, then downscale if needed. */
async function renderBuffer(file, fmt, o = {}) {
  const src = await loadInput(file);
  const pipeline = await buildPipeline(src, o);
  const targetBytes = o.targetKB ? Number(o.targetKB) * 1024 : 0;
  if (!targetBytes) return encode(applyMeta(pipeline, o), fmt, o).toBuffer();
  const base = await pipeline.png().toBuffer();
  const make = (buf, q) => encode(applyMeta(sharp(buf), o), fmt, o, q).toBuffer();
  let buf = base; let best = null;
  for (let round = 0; round < 8; round++) {
    if (['jpg', 'jpeg', 'webp', 'avif', 'png', 'tiff'].includes(fmt)) {
      let lo = 5, hi = 95; best = null;
      let cand = await make(buf, hi);
      if (cand.length <= targetBytes) return cand;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1; cand = await make(buf, mid);
        if (cand.length <= targetBytes) { best = cand; lo = mid + 1; } else hi = mid - 1;
      }
      if (best) return best;
    } else {
      const cand = await make(buf); if (cand.length <= targetBytes) return cand;
    }
    const m = await sharp(buf).metadata();
    if (m.width < 32) break;
    buf = await sharp(buf).resize(Math.round(m.width * 0.8)).png().toBuffer();
  }
  return make(buf, 5);
}

async function convert(file, fmt, o = {}) {
  fmt = fmt === 'jpeg' ? 'jpg' : fmt;
  const dest = o.dest || outPath(file, fmt, o);
  if (fmt === 'pdf') { await imagesToPdf([file], { ...o, dest }); return dest; }
  if (fmt === 'bmp' || fmt === 'ico') {
    const png = await renderBuffer(file, 'png', { ...o, targetKB: 0 });
    let buf = png;
    if (fmt === 'ico') buf = await sharp(png).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await ffmpeg(['-f', 'png_pipe', '-i', 'pipe:0', ...(fmt === 'bmp' ? ['-pix_fmt', 'bgr24'] : []), dest], { input: buf });
    return dest;
  }
  const buf = await renderBuffer(file, fmt, o);
  await fsp.writeFile(dest, buf);
  return dest;
}

/** Live preview: returns a small PNG data URL plus the real encoded size of the full-resolution result. */
async function preview(file, o = {}) {
  const fmt = o.format || 'png';
  const src = await loadInput(file);
  const m0 = await sharp(src).metadata();
  const big = m0.width * m0.height > 2.5e7;
  let full = null, outW = null, outH = null, estBytes = null;
  if (!big || o.targetKB) {
    full = await renderBuffer(file, ['bmp', 'ico', 'pdf'].includes(fmt) ? 'png' : fmt, o);
    const m = await sharp(full).metadata(); outW = m.width; outH = m.height; estBytes = full.length;
  }
  const pv = await sharp(full || (await (await buildPipeline(src, o)).png().toBuffer())).resize(900, 700, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  if (!outW) { const m = await sharp(pv).metadata(); outW = m.width; outH = m.height; }
  return { dataUrl: 'data:image/png;base64,' + pv.toString('base64'), width: outW, height: outH, bytes: estBytes, srcWidth: m0.width, srcHeight: m0.height };
}

async function imagesToPdf(files, o = {}) {
  const pdf = await PDFDocument.create();
  const pageSize = o.pageSize || 'fit'; // 'fit' | 'a4' | 'letter'
  const sizes = { a4: [595.28, 841.89], letter: [612, 792] };
  for (const f of files) {
    const buf = await renderBuffer(f, 'jpg', { ...o, quality: o.quality || 90, targetKB: 0 });
    const img = await pdf.embedJpg(buf);
    let pw = img.width * 72 / (o.dpi || 96), ph = img.height * 72 / (o.dpi || 96);
    if (sizes[pageSize]) {
      [pw, ph] = sizes[pageSize]; if (img.width > img.height) [pw, ph] = [ph, pw];
      const margin = 24; const sc = Math.min((pw - 2 * margin) / img.width, (ph - 2 * margin) / img.height);
      const page = pdf.addPage([pw, ph]);
      page.drawImage(img, { x: (pw - img.width * sc) / 2, y: (ph - img.height * sc) / 2, width: img.width * sc, height: img.height * sc });
    } else {
      const page = pdf.addPage([pw, ph]); page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    }
  }
  const dest = o.dest || outPath(files[0], 'pdf', { ...o, suffix: files.length > 1 ? '-combined' : '' });
  await fsp.writeFile(dest, await pdf.save());
  return dest;
}

module.exports = { loadInput, info, convert, preview, renderBuffer, imagesToPdf, buildPipeline };
