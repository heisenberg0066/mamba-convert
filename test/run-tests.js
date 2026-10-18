'use strict';
// Engine smoke tests on Linux (system ffmpeg). Run: node test/run-tests.js  (or under electron for HTML->PDF)
const path = require('path'); const fs = require('fs'); const os = require('os');
const sharp = require('sharp'); const { PDFDocument, StandardFonts } = require('pdf-lib');
const E = require('../src/engine');
const W = path.join(__dirname, 'work'); fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
const OUT = path.join(W, 'out'); fs.mkdirSync(OUT);
const results = [];
async function check(name, fn) {
  const t = Date.now();
  try { const r = await fn(); const files = (Array.isArray(r) ? r : [r]).filter(Boolean);
    const info = files.map((f) => `${path.basename(f)} (${fs.statSync(f).size} B)`).join(', ');
    files.forEach((f) => { if (!fs.statSync(f).size) throw new Error('empty output ' + f); });
    results.push(['PASS', name, info, Date.now() - t]); }
  catch (e) { results.push(['FAIL', name, e.message.slice(0, 300), Date.now() - t]); }
}
const o = { outputDir: OUT };
(async () => {
  // ---- samples ----
  const png = path.join(W, 'sample.png');
  await sharp({ create: { width: 800, height: 600, channels: 4, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg width="800" height="600"><circle cx="400" cy="300" r="200" fill="#ff8a00"/><rect x="80" y="80" width="200" height="120" fill="#0a84ff"/></svg>') }]).png().toFile(png);
  const mp4 = path.join(W, 'sample.mp4'); const mp4b = path.join(W, 'sample2.mp4'); const wav = path.join(W, 'sample.wav');
  const ff = (a) => E.util.ffmpeg(a);
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4]);
  await ff(['-f', 'lavfi', '-i', 'mandelbrot=size=320x240:rate=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4b]); // no audio, different size
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', wav]);
  const mkPdf = async (p, label, n) => { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); for (let i = 0; i < n; i++) d.addPage([595, 842]).drawText(`${label} page ${i + 1}`, { x: 60, y: 760, size: 28, font: f }); d.setAuthor('Secret Author'); fs.writeFileSync(p, await d.save()); };
  const pdfA = path.join(W, 'a.pdf'), pdfB = path.join(W, 'b.pdf'); await mkPdf(pdfA, 'Alpha', 2); await mkPdf(pdfB, 'Beta', 3);
  const md = path.join(W, 'notes.md'); fs.writeFileSync(md, '# Hello\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\nمرحبا بالعالم\n');
  const csv = path.join(W, 'data.csv'); fs.writeFileSync(csv, 'name,age,city\nAmmar,30,"Stockholm, SE"\nSara,25,Göteborg\n');
  const jpgExif = path.join(W, 'exif.jpg'); await sharp(png).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret', Artist: 'me' } } }).toFile(jpgExif);

  // ---- requested conversions ----
  await check('png → jpg', () => E.runJob({ type: 'convert', files: [png], target: 'jpg', outputDir: OUT }));
  await check('png → webp', () => E.runJob({ type: 'convert', files: [png], target: 'webp', outputDir: OUT }));
  await check('mp4 → mp3', () => E.runJob({ type: 'convert', files: [mp4], target: 'mp3', outputDir: OUT }));
  await check('mp4 → gif', () => E.runJob({ type: 'convert', files: [mp4], target: 'gif', outputDir: OUT }));
  await check('wav → mp3', () => E.runJob({ type: 'convert', files: [wav], target: 'mp3', outputDir: OUT }));
  await check('merge 2 PDFs', async () => { const r = await E.runJob({ type: 'tool', tool: 'merge-pdf', files: [pdfA, pdfB], outputDir: OUT }); const n = await E.pdf.pageCount(r[0]); if (n !== 5) throw new Error('pages=' + n); return r; });
  await check('images → PDF', async () => { const jpg = (await E.runJob({ type: 'convert', files: [png], target: 'jpg', outputDir: W }))[0]; const r = await E.runJob({ type: 'tool', tool: 'images-to-pdf', files: [png, jpg], options: { pageSize: 'a4' }, outputDir: OUT }); if (await E.pdf.pageCount(r[0]) !== 2) throw new Error('pages'); return r; });

  // ---- broader coverage ----
  await check('heic → jpg (ffmpeg HEIF decode)', () => E.runJob({ type: 'convert', files: [path.join(__dirname, 'sample.heic')], target: 'jpg', outputDir: OUT }));
  const svg = path.join(W, 'logo.svg'); fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal"/></svg>');
  await check('svg → png', () => E.runJob({ type: 'convert', files: [svg], target: 'png', outputDir: OUT }));
  for (const t of ['avif', 'tiff', 'gif', 'bmp', 'ico', 'pdf']) await check(`png → ${t}`, () => E.runJob({ type: 'convert', files: [png], target: t, outputDir: OUT }));
  const bmp = fs.readdirSync(OUT).find((f) => f.endsWith('.bmp'));
  await check('bmp → png (ffmpeg decode path)', () => E.runJob({ type: 'convert', files: [path.join(OUT, bmp)], target: 'png', outputDir: W }));
  for (const t of ['webm', 'mkv', 'avi', 'mov', 'wmv', 'mpg', 'ogv', 'flv', 'ts', '3gp', 'webp', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'jpg']) await check(`mp4 → ${t}`, () => E.runJob({ type: 'convert', files: [mp4], target: t, outputDir: OUT }));
  for (const t of ['flac', 'ogg', 'opus', 'm4a', 'aac', 'wma', 'aiff', 'ac3', 'mp2']) await check(`wav → ${t}`, () => E.runJob({ type: 'convert', files: [wav], target: t, outputDir: OUT }));
  await check('pdf → png pages', async () => { const r = await E.runJob({ type: 'convert', files: [pdfB], target: 'png', outputDir: OUT }); if (r.length !== 3) throw new Error('n=' + r.length); return r; });
  await check('pdf → jpg', () => E.runJob({ type: 'convert', files: [pdfA], target: 'jpg', outputDir: OUT }));
  await check('pdf → txt', async () => { const r = await E.runJob({ type: 'convert', files: [pdfA], target: 'txt', outputDir: OUT }); if (!fs.readFileSync(r[0], 'utf8').includes('Alpha page 2')) throw new Error('text missing'); return r; });
  await check('pdf → html', () => E.runJob({ type: 'convert', files: [pdfA], target: 'html', outputDir: OUT }));
  for (const t of ['html', 'txt', 'docx']) await check(`md → ${t}`, () => E.runJob({ type: 'convert', files: [md], target: t, outputDir: OUT }));
  const docx = path.join(OUT, 'notes.docx');
  for (const t of ['html', 'txt', 'md']) await check(`docx → ${t}`, async () => { const r = await E.runJob({ type: 'convert', files: [docx], target: t, outputDir: OUT }); if (!fs.readFileSync(r[0], 'utf8').includes('Hello')) throw new Error('content lost'); return r; });
  for (const t of ['json', 'tsv', 'html']) await check(`csv → ${t}`, () => E.runJob({ type: 'convert', files: [csv], target: t, outputDir: OUT }));
  await check('json → csv', () => E.runJob({ type: 'convert', files: [path.join(OUT, 'data.json')], target: 'csv', outputDir: W }));
  const isElectron = !!process.versions.electron;
  if (isElectron) {
    for (const [f, n] of [[md, 'md'], [docx, 'docx']]) await check(`${n} → pdf (Chromium)`, () => E.runJob({ type: 'convert', files: [f], target: 'pdf', outputDir: OUT }));
  }
  // ---- flipbook ----
  const flipPages = (html) => { const m = fs.readFileSync(html, 'utf8').match(/window\.MF_DATA=(\{.*?\});<\/script>/s); if (!m) throw new Error('no MF_DATA'); const d = JSON.parse(m[1]); if (!fs.readFileSync(html, 'utf8').includes('class MambaFlip')) throw new Error('engine not inlined'); return d; };
  await check('pdf → flipbook (single html)', async () => { const r = await E.runJob({ type: 'convert', files: [pdfB], target: 'flipbook', outputDir: OUT }); const d = flipPages(r[0]); if (d.pages.length !== 3 || d.thumbs.length !== 3 || !d.pages[0].src.startsWith('data:image/jpeg')) throw new Error('pages ' + d.pages.length); return r; });
  await check('pdf → flipbook (folder + index.html, RTL)', async () => { const r = await E.runJob({ type: 'tool', tool: 'make-flipbook', files: [pdfA], options: { mode: 'folder', rtl: true }, outputDir: OUT }); const d = flipPages(r[0]); if (!d.rtl || d.pages.length !== 2 || !fs.existsSync(path.join(path.dirname(r[0]), d.pages[1].src))) throw new Error('folder pages'); return r; });
  await check('images + PDFs → one flipbook', async () => { const r = await E.runJob({ type: 'tool', tool: 'make-flipbook', files: [png, pdfA, pdfB], options: { title: 'Mixed' }, outputDir: OUT }); const d = flipPages(r[0]); if (d.pages.length !== 6 || d.title !== 'Mixed') throw new Error('n=' + d.pages.length); return r; });
  if (isElectron) {
    await check('md → flipbook (via Chromium PDF)', async () => { const r = await E.runJob({ type: 'convert', files: [md], target: 'flipbook', outputDir: OUT }); if (flipPages(r[0]).pages.length < 1) throw new Error('empty'); return r; });
    await check('flipbook opens & flips in a browser', async () => {
      const { BrowserWindow } = require('electron');
      const html = (await E.runJob({ type: 'tool', tool: 'make-flipbook', files: [pdfA, pdfB], outputDir: OUT }))[0];
      const w = new BrowserWindow({ show: true, width: 1200, height: 800, webPreferences: { backgroundThrottling: false } }); const errs = []; w.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 3) errs.push(msg); });
      try {
        await w.loadFile(html); const js = (s) => w.webContents.executeJavaScript(s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await wait(300); await js('window.__flip.forceSingle=false;window.__flip.layout();window.__flip.render()');
        const s0 = await js('window.__flip.state()'); await js('window.__flip.next()'); await wait(1200); const s1 = await js('window.__flip.state()');
        await js('window.__flip.go(4)'); await wait(1200); const s2 = await js('window.__flip.state()'); await js('window.__flip.prev()'); await wait(1200); const s3 = await js('window.__flip.state()');
        await js('window.__flip.zoomBy(2)'); const z = await js('window.__flip.state().zoom'); const th = await js('document.querySelectorAll(".mf-thumb").length');
        const ok = s0.pages === 5 && s0.visible.join() === '0' && s1.visible.join() === '1,2' && s2.visible.join() === '3,4' && s3.visible.join() === '1,2' && z === 2 && th === 5 && !errs.length;
        if (!ok) throw new Error(JSON.stringify({ s0, s1, s2, s3, z, th, errs }));
      } finally { w.destroy(); }
      return html;
    });
    await check('Open in Mamba Reader handoff (exe)', async () => {
      const fake = path.join(W, 'fake-reader.sh'); const log = path.join(W, 'reader-args.txt');
      fs.writeFileSync(fake, `#!/bin/sh\necho "$@" > "${log}"\n`, { mode: 0o755 }); process.env.MAMBA_READER_PATH = fake;
      const { app, shell } = require('electron'); const R = require('../src/reader')({ app, shell });
      const target = path.join(OUT, 'b-flipbook.html'); const res = R.openInReader(target);
      await new Promise((r) => setTimeout(r, 500)); delete process.env.MAMBA_READER_PATH;
      if (!res.ok || fs.readFileSync(log, 'utf8').trim() !== target) throw new Error(JSON.stringify(res));
      if (R.findReader() && !process.env.CI) {/* a real Reader may be installed */}
      return log;
    });
  }
  // ---- image studio edits ----
  const studio = { crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, rotate: 90, flipH: true, brightness: 10, contrast: 20, saturation: -30, hue: 45, dpi: 300, resize: { mode: 'percent', percent: 50 } };
  await check('studio: crop+rotate+flip+colour+DPI+resize → jpg', async () => { const r = await E.image.convert(png, 'jpg', { ...studio, outputDir: OUT, suffix: '-studio' }); const m = await sharp(r).metadata(); if (m.density !== 300) throw new Error('dpi ' + m.density); if (m.width !== 150 || m.height !== 200) throw new Error(`size ${m.width}x${m.height}`); return r; });
  await check('studio: grayscale+invert → png', () => E.image.convert(png, 'png', { grayscale: true, invert: true, outputDir: OUT, suffix: '-gi' }));
  await check('studio: target 20 KB jpg', async () => { const r = await E.image.convert(png, 'jpg', { targetKB: 20, outputDir: OUT, suffix: '-20k' }); if (fs.statSync(r).size > 20480) throw new Error('too big'); return r; });
  await check('studio: exact 300x300 no aspect', async () => { const r = await E.image.convert(png, 'webp', { resize: { mode: 'px', width: 300, height: 300, keepAspect: false }, outputDir: OUT, suffix: '-300' }); const m = await sharp(r).metadata(); if (m.width !== 300 || m.height !== 300) throw new Error('size'); return r; });
  await check('studio: live preview', async () => { const p = await E.image.preview(png, { format: 'jpg', quality: 60, grayscale: true }); if (!p.dataUrl.startsWith('data:image/png') || !p.bytes) throw new Error('bad preview'); return null; });
  await check('remove background (flood fill)', async () => { const r = (await E.runJob({ type: 'tool', tool: 'remove-background', files: [png], options: { tolerance: 10 }, outputDir: OUT }))[0]; const { data } = await sharp(r).raw().toBuffer({ resolveWithObject: true }); if (data[3] !== 0) throw new Error('corner not transparent'); return r; });
  // ---- video studio ----
  await check('video studio: trim+crop+720p→480p+15fps+size target 0.3MB', async () => { const r = await E.media.convert(mp4, 'mp4', { start: '0:01', end: '0:03', crop: { x: 0, y: 0, w: 0.5, h: 1 }, height: 240, fps: 15, targetMB: 0.3, outputDir: OUT, suffix: '-studio' }, {}); const p = await E.media.probe(r); if (Math.abs(p.duration - 2) > 0.3) throw new Error('dur ' + p.duration); if (p.height !== 240) throw new Error('h ' + p.height); if (fs.statSync(r).size > 0.36 * 1048576) throw new Error('size ' + fs.statSync(r).size); return r; });
  await check('video frame preview', async () => { const d = await E.media.frame(mp4, 1, { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, grayscale: true }); if (!d.startsWith('data:image/png')) throw new Error('bad'); return null; });
  // ---- tools ----
  const tool = (id, files, options = {}) => E.runJob({ type: 'tool', tool: id, files, options, outputDir: OUT });
  const T = [
    ['compress-image', [png], { quality: 50, format: 'jpg' }], ['compress-video', [mp4], { mode: 'crf', crf: 32 }], ['compress-video', [mp4], { mode: 'size', targetMB: 0.2, format: 'webm' }],
    ['compress-audio', [wav], { audioBitrate: '64', format: 'mp3' }], ['compress-pdf', [pdfB], { level: 'lossless' }], ['compress-pdf', [pdfB], { level: 'strong', dpi: 72, quality: 40 }],
    ['trim', [mp4], { start: '1', end: '2.5' }], ['trim', [wav], { start: '0:01', end: '0:02', fast: true }], ['merge-audio', [wav, mp4], { format: 'mp3' }], ['merge-video', [mp4, mp4b], { format: 'mp4' }],
    ['split-pdf', [pdfB], { mode: 'each' }], ['split-pdf', [pdfB], { mode: 'ranges', ranges: '1-2,3' }], ['extract-pages', [pdfB], { pages: '2-3' }], ['rotate-pdf', [pdfA], { angle: '90' }],
    ['pdf-to-images', [pdfA], { format: 'jpg', dpi: 72 }], ['pdf-to-text', [pdfB], {}], ['page-numbers', [pdfB], {}], ['protect-pdf', [pdfA], { password: 'test123' }],
    ['resize-image', [png], { mode: 'px', width: 200, keepAspect: true }], ['rotate-image', [png], { angle: '270', flipV: true }], ['rotate-video', [mp4], { angle: '90' }],
    ['extract-audio', [mp4], { format: 'm4a' }], ['video-to-gif', [mp4], { start: '0', end: '2', gifFps: 10, gifWidth: 320 }], ['change-resolution', [mp4], { height: '240' }],
    ['change-bitrate', [mp4], { videoBitrate: 300, audioBitrate: '64' }], ['change-fps', [mp4], { fps: '15' }], ['change-speed', [mp4], { speed: '2' }], ['change-speed', [wav], { speed: '0.5' }],
    ['mute-video', [mp4], {}], ['normalize-audio', [wav], { normalize: true }], ['video-thumbnail', [mp4], { at: '0:02', format: 'png' }],
    ['strip-metadata', [jpgExif, mp4, pdfA], {}],
  ];
  for (const [id, files, op] of T) await check(`tool ${id} ${JSON.stringify(op)}`, () => tool(id, files, op));
  await check('strip-metadata removed EXIF', async () => { const c = fs.readdirSync(OUT).find((f) => f.startsWith('exif-clean')); const m = await sharp(path.join(OUT, c)).metadata(); if (m.exif) throw new Error('exif still present'); return path.join(OUT, c); });
  await check('rotate-video dims', async () => { const f = fs.readdirSync(OUT).find((x) => x.startsWith('sample-rotated') && x.endsWith('.mp4')); const p = await E.media.probe(path.join(OUT, f)); if (p.width !== 360 || p.height !== 640) throw new Error(`${p.width}x${p.height}`); return path.join(OUT, f); });

  const pass = results.filter((r) => r[0] === 'PASS').length;
  for (const r of results) console.log(`${r[0]}  ${r[1]}  [${r[3]} ms]  ${r[2]}`);
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-results.txt'), results.map((r) => r.join('\t')).join('\n') + `\n${pass}/${results.length} passed\n`);
  if (process.versions.electron) require('electron').app.exit(pass === results.length ? 0 : 1); else process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
