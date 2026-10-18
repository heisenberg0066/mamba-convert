'use strict';
const { PDFDocument, degrees, StandardFonts, rgb } = require('pdf-lib');
const sharp = require('sharp');
const { outPath, fsp, path, base, ext } = require('./util');

let _mupdf = null;
async function mupdf() { if (!_mupdf) _mupdf = await import('mupdf'); return _mupdf; }

/** "1-3,5,9-" -> zero-based indices */
function parseRanges(spec, count) {
  if (!spec || !String(spec).trim()) return [...Array(count).keys()];
  const out = [];
  for (const part of String(spec).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) { const a = m[1] ? parseInt(m[1], 10) : 1, b = m[2] ? parseInt(m[2], 10) : count; for (let i = a; i <= Math.min(b, count); i++) out.push(i - 1); }
    else { const n = parseInt(part, 10); if (n >= 1 && n <= count) out.push(n - 1); }
  }
  return out;
}

async function load(file) { return PDFDocument.load(await fsp.readFile(file), { ignoreEncryption: true }); }

async function merge(files, o = {}) {
  const out = await PDFDocument.create();
  for (const f of files) {
    if (ext(f) !== 'pdf') { // allow images in a merge
      const { imagesToPdf } = require('./image');
      const tmp = path.join(require('os').tmpdir(), `mamba-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
      await imagesToPdf([f], { dest: tmp, pageSize: o.pageSize });
      const d = await load(tmp); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); fsp.rm(tmp, { force: true });
      continue;
    }
    const d = await load(f);
    (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p));
  }
  const dest = o.dest || outPath(files[0], 'pdf', { ...o, suffix: '-merged' });
  await fsp.writeFile(dest, await out.save());
  return dest;
}

async function split(file, o = {}) {
  const src = await load(file); const n = src.getPageCount();
  const dir = o.outputDir || path.dirname(file);
  const outs = [];
  // mode 'each' -> one file per page; mode 'ranges' -> one file per comma-separated group
  const groups = o.mode === 'ranges' && o.ranges ? String(o.ranges).split(',').map((g) => parseRanges(g, n)).filter((g) => g.length) : [...Array(n).keys()].map((i) => [i]);
  for (const g of groups) {
    const d = await PDFDocument.create();
    (await d.copyPages(src, g)).forEach((p) => d.addPage(p));
    const label = g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g[g.length - 1] + 1}`;
    const dest = outPath(file, 'pdf', { outputDir: dir, suffix: `-${label}` });
    await fsp.writeFile(dest, await d.save()); outs.push(dest);
  }
  return outs;
}

async function extractPages(file, o = {}) {
  const src = await load(file);
  const idx = parseRanges(o.pages, src.getPageCount());
  const d = await PDFDocument.create();
  (await d.copyPages(src, idx)).forEach((p) => d.addPage(p));
  const dest = o.dest || outPath(file, 'pdf', { ...o, suffix: '-pages' });
  await fsp.writeFile(dest, await d.save()); return dest;
}

async function rotate(file, o = {}) {
  const d = await load(file); const idx = parseRanges(o.pages, d.getPageCount());
  const ang = Number(o.angle || 90);
  idx.forEach((i) => { const p = d.getPage(i); p.setRotation(degrees((p.getRotation().angle + ang) % 360)); });
  const dest = o.dest || outPath(file, 'pdf', { ...o, suffix: '-rotated' });
  await fsp.writeFile(dest, await d.save()); return dest;
}

async function pageNumbers(file, o = {}) {
  const d = await load(file); const font = await d.embedFont(StandardFonts.Helvetica);
  const n = d.getPageCount();
  d.getPages().forEach((p, i) => { const { width } = p.getSize(); const t = `${i + 1} / ${n}`; p.drawText(t, { x: width / 2 - font.widthOfTextAtSize(t, 10) / 2, y: 18, size: 10, font, color: rgb(0.3, 0.3, 0.3) }); });
  const dest = o.dest || outPath(file, 'pdf', { ...o, suffix: '-numbered' });
  await fsp.writeFile(dest, await d.save()); return dest;
}

async function stripMetadata(file, o = {}) {
  const d = await load(file);
  d.setTitle(''); d.setAuthor(''); d.setSubject(''); d.setKeywords([]); d.setProducer(''); d.setCreator('');
  d.setCreationDate(new Date(0)); d.setModificationDate(new Date(0));
  const dest = o.dest || outPath(file, 'pdf', { ...o, suffix: '-clean' });
  await fsp.writeFile(dest, await d.save({ useObjectStreams: true })); return dest;
}

/** Open PDF or other MuPDF formats (EPUB, XPS, CBZ, FB2, MOBI). */
async function openDoc(file) {
  const m = await mupdf();
  const buf = await fsp.readFile(file);
  const mime = { pdf: 'application/pdf', epub: 'application/epub+zip', xps: 'application/oxps', oxps: 'application/oxps', cbz: 'application/x-cbz', fb2: 'application/x-fictionbook', mobi: 'application/x-mobipocket-ebook' }[ext(file)] || ext(file);
  return { m, doc: m.Document.openDocument(buf, mime) };
}

async function toImages(file, fmt = 'png', o = {}, { onProgress } = {}) {
  const { m, doc } = await openDoc(file);
  const n = doc.countPages(); const idx = parseRanges(o.pages, n);
  const dpi = Number(o.dpi || 150); const outs = [];
  const dir = o.outputDir || path.dirname(file);
  for (let k = 0; k < idx.length; k++) {
    const page = doc.loadPage(idx[k]);
    const pix = page.toPixmap(m.Matrix.scale(dpi / 72, dpi / 72), m.ColorSpace.DeviceRGB, false, true);
    const png = Buffer.from(pix.asPNG());
    let buf = png;
    if (fmt === 'jpg') buf = await sharp(png).jpeg({ quality: o.quality || 90, mozjpeg: true }).withMetadata({ density: dpi }).toBuffer();
    else if (fmt === 'webp') buf = await sharp(png).webp({ quality: o.quality || 90 }).toBuffer();
    else if (fmt === 'tiff') buf = await sharp(png).tiff({ compression: 'lzw' }).withMetadata({ density: dpi }).toBuffer();
    else buf = await sharp(png).png().withMetadata({ density: dpi }).toBuffer();
    const dest = outPath(file, fmt, { outputDir: dir, suffix: idx.length > 1 || n > 1 ? `-page${String(idx[k] + 1).padStart(String(n).length, '0')}` : '' });
    await fsp.writeFile(dest, buf); outs.push(dest);
    pix.destroy && pix.destroy(); page.destroy && page.destroy();
    onProgress && onProgress((k + 1) / idx.length);
  }
  return outs;
}

async function toText(file, fmt = 'txt', o = {}) {
  const { doc } = await openDoc(file);
  const parts = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText('preserve-whitespace');
    parts.push(fmt === 'html' ? st.asHTML(i) : st.asText());
  }
  const body = fmt === 'html' ? `<!doctype html><html><head><meta charset="utf-8"><title>${base(file)}</title></head><body>\n${parts.join('\n')}\n</body></html>` : parts.join('\n\f\n');
  const dest = o.dest || outPath(file, fmt, o);
  await fsp.writeFile(dest, body, 'utf8'); return dest;
}

/** EPUB/XPS/CBZ/FB2/MOBI -> PDF via MuPDF's DocumentWriter. */
async function docToPdf(file, o = {}) {
  const { m, doc } = await openDoc(file);
  const buf = new m.Buffer(); const w = new m.DocumentWriter(buf, 'pdf', '');
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i); const dev = w.beginPage(page.getBounds());
    page.run(dev, m.Matrix.identity); w.endPage();
  }
  w.close();
  const dest = o.dest || outPath(file, 'pdf', o);
  await fsp.writeFile(dest, Buffer.from(buf.asUint8Array())); return dest;
}

/**
 * Compress: 'lossless' = MuPDF garbage-collect + deflate streams/fonts/images.
 * 'strong' = rasterise every page to JPEG at chosen DPI/quality (text no longer selectable, but big savings for scans).
 */
async function compress(file, o = {}, { onProgress } = {}) {
  const dest = o.dest || outPath(file, 'pdf', { ...o, suffix: '-compressed' });
  const { m, doc } = await openDoc(file);
  if (o.level === 'strong') {
    const dpi = Number(o.dpi || 110), q = Number(o.quality || 60);
    const out = await PDFDocument.create(); const n = doc.countPages();
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i); const [x0, y0, x1, y1] = page.getBounds();
      const pix = page.toPixmap(m.Matrix.scale(dpi / 72, dpi / 72), m.ColorSpace.DeviceRGB, false, true);
      const jpg = await sharp(Buffer.from(pix.asPNG())).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      const img = await out.embedJpg(jpg); const pw = x1 - x0, ph = y1 - y0;
      out.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
      onProgress && onProgress((i + 1) / n);
    }
    await fsp.writeFile(dest, await out.save({ useObjectStreams: true }));
  } else {
    const pdf = doc.asPDF ? doc.asPDF() : doc;
    const buf = pdf.saveToBuffer('garbage=4,compress=yes,compress-images=yes,compress-fonts=yes,clean=yes');
    let data = Buffer.from(buf.asUint8Array());
    const orig = (await fsp.stat(file)).size;
    if (data.length >= orig) data = await fsp.readFile(file); // never make it bigger
    await fsp.writeFile(dest, data);
  }
  return dest;
}

async function protect(file, o = {}) {
  if (!o.password) throw new Error('Enter a password');
  const { doc } = await openDoc(file);
  const pdf = doc.asPDF ? doc.asPDF() : doc;
  const pw = String(o.password).replace(/[,=]/g, '');
  const buf = pdf.saveToBuffer(`encrypt=aes-256,user-password=${pw},owner-password=${pw}`);
  const dest = o.dest || outPath(file, 'pdf', { ...o, suffix: '-protected' });
  await fsp.writeFile(dest, Buffer.from(buf.asUint8Array())); return dest;
}

async function pageCount(file) { try { return (await load(file)).getPageCount(); } catch (_) { const { doc } = await openDoc(file); return doc.countPages(); } }

module.exports = { merge, split, extractPages, rotate, pageNumbers, stripMetadata, toImages, toText, docToPdf, compress, protect, pageCount, parseRanges };
