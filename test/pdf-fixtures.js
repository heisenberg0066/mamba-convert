'use strict';
// Helpers for the page-organiser tests: labelled PDFs (optionally with bookmarks) and reading back page labels/rotation.
const fs = require('fs');
const { PDFDocument, StandardFonts, PDFName, PDFHexString, degrees } = require('pdf-lib');

/** PDF whose page i shows the text `${label}${i + 1}`; sizes alternate portrait/landscape when `mixed`; bookmarks = [{ title, page }] */
async function labelledPdf(file, label, n, { bookmarks, mixed, rotateFirst } = {}) {
  const d = await PDFDocument.create(); const font = await d.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < n; i++) {
    const land = mixed && i % 2 === 1; const p = d.addPage(land ? [842, 595] : [595, 842]);
    p.drawText(`${label}${i + 1}`, { x: 60, y: p.getHeight() - 200, size: 120, font });
    if (rotateFirst && i === 0) p.setRotation(degrees(rotateFirst));
  }
  if (bookmarks && bookmarks.length) addOutline(d, bookmarks);
  fs.writeFileSync(file, await d.save()); return file;
}
function addOutline(doc, items) {
  const ctx = doc.context; const pages = doc.getPages(); const root = ctx.nextRef(); const refs = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const dict = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: root, Dest: [pages[it.page].ref, 'Fit'] });
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]); if (i < items.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], dict);
  });
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: items.length }));
  doc.catalog.set(PDFName.of('Outlines'), root);
}
/** [{ text, rotate }] for every page of a PDF (text via MuPDF, /Rotate via pdf-lib) */
async function readPages(file, E) {
  const { doc } = await E.pdf._openDoc(file); const d = await PDFDocument.load(fs.readFileSync(file));
  const out = [];
  for (let i = 0; i < doc.countPages(); i++) out.push({ text: doc.loadPage(i).toStructuredText().asText().trim(), rotate: d.getPage(i).getRotation().angle % 360 });
  return out;
}
const labels = (pages) => pages.map((p) => p.text + (p.rotate ? '@' + p.rotate : '')).join(' ');
module.exports = { labelledPdf, readPages, labels };
