'use strict';
// PDF / images / documents -> self-contained offline HTML flipbook using the shared Mamba flip engine.
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { fsp, outPath, base, ext } = require('./util');
const formats = require('./formats');

const ENGINE_DIR = path.join(__dirname, '..', 'flipbook');
const readEngine = () => ({ js: fs.readFileSync(path.join(ENGINE_DIR, 'flip-engine.js'), 'utf8'), css: fs.readFileSync(path.join(ENGINE_DIR, 'flip-engine.css'), 'utf8') });

async function renderPdfPages(file, o, onPage) {
  const pdf = require('./pdf');
  const m = await import('mupdf');
  const { doc } = await pdf._openDoc(file);
  const n = doc.countPages(); const width = Number(o.pageWidth) || 1400;
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i); const [x0, , x1] = page.getBounds();
    const s = Math.min(6, width / Math.max(1, x1 - x0));
    const pix = page.toPixmap(m.Matrix.scale(s, s), m.ColorSpace.DeviceRGB, false, true);
    await onPage(Buffer.from(pix.asPNG()), i, n);
  }
}

/** Collect page images (PNG/JPEG buffers) from every input, in order. */
async function collectPages(files, o, ctl = {}) {
  const pages = []; const tmp = [];
  try {
    for (let fi = 0; fi < files.length; fi++) {
      const f = files[fi]; const k = formats.kindOf(ext(f));
      const report = (i, n) => ctl.onProgress && ctl.onProgress(Math.min(0.85, ((fi + (i + 1) / n) / files.length) * 0.85));
      if (k === 'image') { const { loadInput } = require('./image'); pages.push(await sharp(await loadInput(f)).rotate().png().toBuffer()); report(0, 1); }
      else if (k === 'pdf' || k === 'ebook') await renderPdfPages(f, o, async (b, i, n) => { pages.push(b); report(i, n); });
      else if (k === 'doc') {
        const t = path.join(os.tmpdir(), `mamba-fb-${Date.now()}-${fi}.pdf`); tmp.push(t);
        await require('./doc').convert(f, 'pdf', { dest: t });
        await renderPdfPages(t, o, async (b, i, n) => { pages.push(b); report(i, n); });
      } else throw new Error(`Cannot make a flipbook from .${ext(f)}`);
    }
  } finally { tmp.forEach((t) => fs.rm(t, { force: true }, () => {})); }
  if (!pages.length) throw new Error('No pages found');
  return pages;
}

function htmlDoc({ title, rtl, data, css, js }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Mamba Convert flipbook (Mamba flip engine v1)">
<meta name="mamba-flipbook" content="1">
<title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;background:#2b2d33}
${css}</style>
</head>
<body>
<noscript><p style="color:#fff;padding:20px">This flipbook needs JavaScript enabled.</p></noscript>
<script>window.MF_DATA=${json};</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
<script>window.__flip=new MambaFlip(document.body,window.MF_DATA);</script>
</body>
</html>
`;
}

/**
 * o.mode: 'single' (one .html with embedded images) | 'folder' (folder with index.html + pages/)
 * o.pageWidth (px, default 1400), o.quality (JPEG, default 82), o.rtl (right-to-left books), o.title
 */
async function makeFlipbook(files, o = {}, ctl = {}) {
  if (!Array.isArray(files)) files = [files];
  const mode = o.mode === 'folder' ? 'folder' : 'single';
  const q = Math.max(30, Math.min(100, Number(o.quality) || 82)); const width = Number(o.pageWidth) || 1400;
  const title = o.title || base(files[0]);
  const raw = await collectPages(files, o, ctl);
  const pages = []; const thumbs = [];
  const { css, js } = readEngine();
  let dir = null, dest;
  if (mode === 'folder') {
    const parent = o.outputDir || path.dirname(files[0]);
    let name = `${base(files[0])}-flipbook`; dir = path.join(parent, name); let i = 1;
    while (fs.existsSync(dir)) dir = path.join(parent, `${name} (${i++})`);
    await fsp.mkdir(path.join(dir, 'pages'), { recursive: true }); await fsp.mkdir(path.join(dir, 'thumbs'), { recursive: true });
    dest = path.join(dir, 'index.html');
  } else dest = o.dest || outPath(files[0], 'html', { ...o, suffix: '-flipbook' });
  // normalise every page to the first page's aspect ratio (books need equal leaves)
  const m0 = await sharp(raw[0]).metadata(); const aspect = m0.width / m0.height;
  const W = Math.min(width, m0.width >= width ? width : Math.max(m0.width, 600)); const H = Math.round(W / aspect);
  for (let i = 0; i < raw.length; i++) {
    const pg = await sharp(raw[i]).resize(W, H, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
    const th = await sharp(pg).resize(220).jpeg({ quality: 60 }).toBuffer();
    if (mode === 'folder') {
      const nm = String(i + 1).padStart(4, '0');
      await fsp.writeFile(path.join(dir, 'pages', `p${nm}.jpg`), pg); await fsp.writeFile(path.join(dir, 'thumbs', `t${nm}.jpg`), th);
      pages.push({ src: `pages/p${nm}.jpg`, w: W, h: H }); thumbs.push(`thumbs/t${nm}.jpg`);
    } else {
      pages.push({ src: 'data:image/jpeg;base64,' + pg.toString('base64'), w: W, h: H }); thumbs.push('data:image/jpeg;base64,' + th.toString('base64'));
    }
    ctl.onProgress && ctl.onProgress(0.85 + 0.15 * ((i + 1) / raw.length));
  }
  await fsp.writeFile(dest, htmlDoc({ title, rtl: !!o.rtl, data: { title, rtl: !!o.rtl, pages, thumbs, cover: o.cover !== false }, css, js }), 'utf8');
  return dest;
}

module.exports = { makeFlipbook, htmlDoc, readEngine };
