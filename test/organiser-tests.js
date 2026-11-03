'use strict';
// Page organiser (Merge PDFs / Split PDF): model unit tests + real PDF output checks. Called from run-tests.js.
const path = require('path'); const fs = require('fs');
const PM = require('../src/engine/pagemodel');
const F = require('./pdf-fixtures');
const eq = (a, b, what) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: got ${x}, want ${y}`); };

module.exports = async function organiserTests({ check, E, W, OUT }) {
  const files = [{ path: '/x/A.pdf', name: 'A.pdf', pages: 3 }, { path: '/x/B.pdf', name: 'B.pdf', pages: 2 }];
  const lab = (d, sec = 0) => d.sections[sec].items.map((x) => `${PM.fileById(d, x.f).name[0]}${x.p + 1}${x.r ? '@' + x.r : ''}`).join(' ');
  const poolLab = (d) => d.pool.map((x) => x.p + 1).join(' ');
  const ids = (d, ...labels) => labels.map((l) => d.sections.flatMap((s) => s.items).concat(d.pool || []).find((x) => `${PM.fileById(d, x.f).name[0]}${x.p + 1}` === l).id);

  // ---------- model: merge ----------
  await check('organiser: merge starts with every page in file order', async () => { const d = PM.createMerge(files); eq(lab(d), 'A1 A2 A3 B1 B2'); eq(d.files.map((f) => f.ci), [0, 1], 'colour index'); return lab(d); });
  await check('organiser: move a page within a file and across files', async () => {
    let d = PM.createMerge(files); d = PM.move(d, ids(d, 'A3'), 'out', 0); eq(lab(d), 'A3 A1 A2 B1 B2', 'within');
    d = PM.move(d, ids(d, 'B2'), 'out', 1); eq(lab(d), 'A3 B2 A1 A2 B1', 'across');
    d = PM.move(d, ids(d, 'A1'), 'out', 5); eq(lab(d), 'A3 B2 A2 B1 A1', 'to end'); return lab(d);
  });
  await check('organiser: multi-select moves as a block in document order', async () => {
    let d = PM.createMerge(files); d = PM.move(d, ids(d, 'B2', 'A1'), 'out', 3); // index counted before the move: before B1
    eq(lab(d), 'A2 A3 A1 B2 B1'); return lab(d);
  });
  await check('organiser: Ctrl+arrow nudge moves the selection one step', async () => {
    let d = PM.createMerge(files); d = PM.nudge(d, ids(d, 'A2', 'A3'), 1); eq(lab(d), 'A1 B1 A2 A3 B2', 'right');
    d = PM.nudge(d, ids(d, 'A2', 'A3'), -1); d = PM.nudge(d, ids(d, 'A2', 'A3'), -1); eq(lab(d), 'A2 A3 A1 B1 B2', 'left x2');
    eq(PM.nudge(d, ids(d, 'A2'), -1), d, 'no-op at start'); return lab(d);
  });
  await check('organiser: delete, rotate (wraps at 360) and duplicate', async () => {
    let d = PM.createMerge(files); d = PM.remove(d, ids(d, 'A2', 'B1')); eq(lab(d), 'A1 A3 B2', 'delete');
    d = PM.rotate(d, ids(d, 'A3'), 90); d = PM.rotate(d, ids(d, 'B2'), -90); d = PM.rotate(d, ids(d, 'A1'), 90); d = PM.rotate(d, ids(d, 'A1'), 270); eq(lab(d), 'A1 A3@90 B2@270', 'rotate');
    const r = PM.duplicate(d, ids(d, 'A1', 'B2')); eq(lab(r.doc), 'A1 A1 A3@90 B2@270 B2@270', 'duplicate'); eq(r.ids.length, 2); return lab(r.doc);
  });
  await check('organiser: reorder whole files (block move, drag file onto file, ↑/↓)', async () => {
    let d = PM.createMerge([...files, { path: '/x/C.pdf', name: 'C.pdf', pages: 1 }]);
    d = PM.moveFile(d, d.files[2].id, d.files[0].id); eq(lab(d), 'C1 A1 A2 A3 B1 B2', 'C before A');
    d = PM.shiftFile(d, d.files.find((f) => f.name === 'C.pdf').id, 1); eq(lab(d), 'A1 A2 A3 C1 B1 B2', 'C down');
    d = PM.move(d, ids(d, 'B2'), 'out', 1); d = PM.moveFile(d, d.files.find((f) => f.name === 'A.pdf').id, null); eq(lab(d), 'B2 C1 B1 A1 A2 A3', 'A block (incl. interleaved) to end');
    eq(d.files.map((f) => f.name).join(), 'C.pdf,B.pdf,A.pdf', 'legend order'); eq(d.files.map((f) => f.ci).join(), '2,1,0', 'colours stay with files'); return lab(d);
  });
  await check('organiser: insert pages from another file at a position', async () => {
    let d = PM.createMerge(files); const r = PM.insertFile(d, { path: '/x/Z.pdf', name: 'Z.pdf', pages: 2 }, 'out', 2); d = r.doc;
    eq(lab(d), 'A1 A2 Z1 Z2 A3 B1 B2'); eq(d.files[2].ci, 2, 'new colour');
    const r2 = PM.insertFile(d, { path: '/x/Y.pdf', name: 'Y.pdf', pages: 5 }, 'out', 0, [4, 0]); eq(lab(r2.doc), 'Y5 Y1 A1 A2 Z1 Z2 A3 B1 B2', 'chosen pages');
    d = PM.removeFile(r2.doc, r2.file.id); eq(lab(d), 'A1 A2 Z1 Z2 A3 B1 B2', 'remove file'); return lab(d);
  });
  await check('organiser: click / Shift / Ctrl selection', async () => {
    const d = PM.createMerge(files); const o = PM.order(d);
    let r = PM.select(d, [], o[1]); eq(r.sel, [o[1]], 'click');
    r = PM.select(d, r.sel, o[3], { shift: true, anchor: r.anchor }); eq(r.sel, [o[1], o[2], o[3]], 'shift range');
    r = PM.select(d, r.sel, o[2], { ctrl: true, anchor: r.anchor }); eq(r.sel, [o[1], o[3]], 'ctrl toggle off');
    r = PM.select(d, r.sel, o[0], { ctrl: true, anchor: r.anchor }); eq(r.sel, [o[1], o[3], o[0]], 'ctrl add');
    r = PM.select(d, r.sel, o[4], { shift: true, ctrl: true, anchor: o[3] }); eq(r.sel.length, 4, 'ctrl+shift extends'); return 'ok';
  });
  await check('organiser: undo / redo history', async () => {
    const d0 = PM.createMerge(files); const h = new PM.History(d0);
    h.push(PM.remove(h.doc, ids(h.doc, 'A1'))); h.push(PM.rotate(h.doc, ids(h.doc, 'B1'), 90)); eq(lab(h.doc), 'A2 A3 B1@90 B2');
    h.undo(); eq(lab(h.doc), 'A2 A3 B1 B2', 'undo 1'); h.undo(); eq(lab(h.doc), 'A1 A2 A3 B1 B2', 'undo 2'); eq(h.undo(), false, 'nothing left');
    h.redo(); eq(lab(h.doc), 'A2 A3 B1 B2', 'redo'); h.push(PM.move(h.doc, ids(h.doc, 'B2'), 'out', 0)); eq(h.canRedo, false, 'new action clears redo');
    eq(lab(d0), 'A1 A2 A3 B1 B2', 'original untouched (pure operations)'); return lab(h.doc);
  });

  // ---------- model: split ----------
  const ten = { path: '/x/Book.pdf', name: 'Book.pdf', pages: 10 };
  const groups = (d) => d.sections.map((s) => `${s.name}:[${s.items.map((x) => x.p + 1 + (x.r ? '@' + x.r : '')).join(',')}]`).join(' ');
  await check('organiser: split starts unassigned with one empty group', async () => { const d = PM.createSplit(ten); eq(groups(d), 'Book-part1:[]'); eq(poolLab(d), '1 2 3 4 5 6 7 8 9 10'); return groups(d); });
  await check('organiser: assign selection to groups 1, 2, 3 and between groups', async () => {
    let d = PM.createSplit(ten); const id = (p) => PM.allItems(d).find((x) => x.p === p - 1).id;
    d = PM.assign(d, [id(1), id(2), id(3)], 1); d = PM.assign(d, [id(6), id(5)], 2); d = PM.assign(d, [id(9)], 3);
    eq(groups(d), 'Book-part1:[1,2,3] Book-part2:[5,6] Book-part3:[9]'); eq(poolLab(d), '4 7 8 10', 'pool');
    d = PM.move(d, [id(2)], d.sections[1].id, 1); eq(groups(d), 'Book-part1:[1,3] Book-part2:[5,2,6] Book-part3:[9]', 'drag between groups');
    d = PM.move(d, [id(6)], d.sections[1].id, 0); eq(groups(d), 'Book-part1:[1,3] Book-part2:[6,5,2] Book-part3:[9]', 'reorder inside');
    d = PM.unassign(d, [id(5)]); eq(poolLab(d), '4 5 7 8 10', 'back to pool in page order');
    d = PM.removeGroup(d, d.sections[0].id); eq(groups(d), 'Book-part2:[6,2] Book-part3:[9]'); eq(poolLab(d), '1 3 4 5 7 8 10', 'remove group');
    d = PM.renameGroup(d, d.sections[0].id, 'Invoices'); eq(d.sections[0].name, 'Invoices'); return groups(d);
  });
  await check('organiser: preset every page / every N pages', async () => {
    const d = PM.createSplit(ten); eq(PM.presetEvery(d, 1).sections.length, 10, 'every page');
    const g = PM.presetEvery(d, 4); eq(groups(g), 'Book-p1-4:[1,2,3,4] Book-p5-8:[5,6,7,8] Book-p9-10:[9,10]'); eq(g.pool.length, 0); return groups(g);
  });
  await check("organiser: preset ranges '1-3, 5, 8-10'", async () => {
    const d = PM.createSplit(ten); const r = PM.presetRanges(d, '1-3, 5, 8-10'); eq(groups(r.doc), 'Book-p1-3:[1,2,3] Book-p5:[5] Book-p8-10:[8,9,10]'); eq(poolLab(r.doc), '4 6 7', 'rest unassigned');
    eq(PM.parseRangeGroups('9-, 3 - 1, x, 12, 2 4', 10), { groups: [[8, 9], [2, 1, 0], [1, 3]], errors: ['x', '12'] }, 'open end, reversed, errors, spaced');
    eq(PM.presetRanges(d, 'abc').count, 0, 'nothing valid'); return groups(r.doc);
  });
  await check('organiser: preset by bookmarks (top level; leading pages kept)', async () => {
    const d = PM.createSplit(ten); const r = PM.presetBookmarks(d, [{ title: 'Intro', page: 2, depth: 0 }, { title: 'Sub', page: 3, depth: 1 }, { title: 'Part: A/B', page: 5, depth: 0 }, { title: 'Intro', page: 8, depth: 0 }]);
    eq(groups(r.doc), 'Book:[1,2] Intro:[3,4,5] Part A B:[6,7,8] Intro (2):[9,10]'); eq(PM.presetBookmarks(d, []).count, 0, 'no bookmarks'); return groups(r.doc);
  });
  await check('organiser: outputs skip empty groups, unique safe names, rotation carried', async () => {
    let d = PM.createSplit(ten); const id = (p) => PM.allItems(d).find((x) => x.p === p - 1).id;
    d = PM.assign(d, [id(2), id(1)], 1); d = PM.addGroup(d); d = PM.assign(d, [id(4)], 3); d = PM.rotate(d, [id(4)], 90);
    d = PM.renameGroup(d, d.sections[0].id, 'Report: Q1?'); d = PM.renameGroup(d, d.sections[2].id, 'report  q1');
    const outs = PM.outputs(d); eq(outs.map((o) => o.name), ['Report Q1', 'report q1 (2)']); eq(outs[0].pages.map((p) => p.page), [0, 1], 'selection keeps page order'); eq(outs[1].pages[0], { path: '/x/Book.pdf', page: 3, rotate: 90 });
    eq(PM.summarize([0, 1, 2, 4, 7, 8, 9]), '1-3, 5, 8-10'); eq(PM.safeName('a<b>c:"d"/e\\f|g?h*. '), 'a b c d e f g h'); return outs.map((o) => o.name).join(' | ');
  });

  // ---------- real PDF output ----------
  const A = await F.labelledPdf(path.join(W, 'orgA.pdf'), 'A', 3, { rotateFirst: 90 }); const B = await F.labelledPdf(path.join(W, 'orgB.pdf'), 'B', 2, { mixed: true });
  const real = [{ path: A, name: 'orgA.pdf', pages: 3 }, { path: B, name: 'orgB.pdf', pages: 2 }];
  await check('organiser merge → PDF: exact order, rotation, duplicate, delete, across files', async () => {
    let d = PM.createMerge(real); const id = (l) => ids(d, l)[0];
    const fid = (n) => d.files.find((f) => f.name === n).id;
    const lbl = (d2) => d2.sections[0].items.map((x) => `${PM.fileById(d2, x.f).name[3]}${x.p + 1}`);
    const byL = (l) => d.sections[0].items.find((x) => `${PM.fileById(d, x.f).name[3]}${x.p + 1}` === l).id;
    d = PM.move(d, [byL('B2')], 'out', 0); d = PM.rotate(d, [byL('A2')], 90); d = PM.remove(d, [byL('A3')]); d = PM.duplicate(d, [byL('B1')]).doc; d = PM.rotate(d, [byL('A1')], 270);
    void id; void fid; void lbl;
    const out = PM.outputs(d)[0];
    const r = await E.runJob({ type: 'tool', tool: 'merge-pdf', files: [A, B], options: { layout: out.pages, name: 'organised merge' }, outputDir: OUT });
    const got = F.labels(await F.readPages(r[0], E));
    // A1 has /Rotate 90 in the source: +270 = 0; A2 +90; B1 twice; A3 deleted
    eq(got, 'B2 A1 A2@90 B1 B1', 'pages'); if (path.basename(r[0]) !== 'organised merge.pdf') throw new Error('name ' + r[0]); return got;
  });
  await check('organiser merge → PDF: file blocks reordered + image inserted mid-way', async () => {
    const sharp = require('sharp'); const img = path.join(W, 'org-photo.png'); await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2266dd' } }).png().toFile(img);
    let d = PM.createMerge(real); d = PM.moveFile(d, d.files[1].id, d.files[0].id);
    d = PM.insertFile(d, { path: img, name: 'org-photo.png', pages: 1 }, 'out', 2).doc;
    const r = await E.runJob({ type: 'tool', tool: 'merge-pdf', files: [A, B, img], options: { layout: PM.outputs(d)[0].pages, pageSize: 'a4' }, outputDir: OUT });
    const got = (await F.readPages(r[0], E)); eq(got.map((p) => p.text), ['B1', 'B2', '', 'A1', 'A2', 'A3'], 'order'); if (!/orgA-merged/.test(r[0])) throw new Error(r[0]);
    const { PDFDocument } = require('pdf-lib'); const sz = (await PDFDocument.load(fs.readFileSync(r[0]))).getPage(2).getSize(); if (Math.round(sz.width) !== 842) throw new Error('image page not A4 landscape: ' + JSON.stringify(sz)); return got.map((p) => p.text || '[img]').join(' ');
  });
  const C = await F.labelledPdf(path.join(W, 'orgBook.pdf'), 'C', 10, { bookmarks: [{ title: 'Intro', page: 0 }, { title: 'Chapter 1', page: 3 }, { title: 'Chapter 2', page: 7 }] });
  await check('organiser split → PDFs: one file per group, names, order, rotation, count', async () => {
    const info = await E.pdf.pagesInfo(C); let d = PM.createSplit({ path: C, name: 'orgBook.pdf', pages: info.pages });
    d = PM.presetRanges(d, '1-3, 5, 8-10').doc; const id = (p) => PM.allItems(d).find((x) => x.p === p - 1).id;
    d = PM.move(d, [id(10)], d.sections[0].id, 0); d = PM.rotate(d, [id(5)], 180); d = PM.renameGroup(d, d.sections[1].id, 'Just five');
    const outs = PM.outputs(d); const r = await E.runJob({ type: 'tool', tool: 'split-pdf', files: [C], options: { groups: outs }, outputDir: OUT });
    eq(r.map((f) => path.basename(f)), ['orgBook-p1-3.pdf', 'Just five.pdf', 'orgBook-p8-10.pdf'], 'files');
    const got = []; for (const f of r) got.push(F.labels(await F.readPages(f, E))); eq(got, ['C10 C1 C2 C3', 'C5@180', 'C8 C9'], 'pages');
    const again = await E.runJob({ type: 'tool', tool: 'split-pdf', files: [C], options: { groups: outs }, outputDir: OUT }); if (path.basename(again[1]) !== 'Just five (1).pdf') throw new Error('overwrote: ' + again[1]);
    return got.join(' | ');
  });
  await check('organiser split by bookmarks (real outline) → PDFs', async () => {
    const info = await E.pdf.pagesInfo(C); eq(info.bookmarks.map((b) => `${b.title}@${b.page}`), ['Intro@0', 'Chapter 1@3', 'Chapter 2@7'], 'outline');
    const d = PM.presetBookmarks(PM.createSplit({ path: C, name: 'orgBook.pdf', pages: info.pages, bookmarks: info.bookmarks }), info.bookmarks).doc;
    const r = await E.runJob({ type: 'tool', tool: 'split-pdf', files: [C], options: { groups: PM.outputs(d) }, outputDir: path.join(OUT) });
    const counts = []; for (const f of r) counts.push(`${path.basename(f, '.pdf')}=${(await F.readPages(f, E)).length}`); eq(counts, ['Intro=3', 'Chapter 1=4', 'Chapter 2=3']); return counts.join(' ');
  });
  await check('organiser: bad page index is refused', async () => {
    try { await E.pdf.organize([{ name: 'x', pages: [{ path: A, page: 7, rotate: 0 }] }], { outputDir: OUT }); } catch (e) { if (/Page 8 is not in/.test(e.message)) return e.message; throw e; }
    throw new Error('no error');
  });
  await check('organiser: large PDF (400 pages) info + lazy thumbnails stay fast', async () => {
    const big = await F.labelledPdf(path.join(W, 'org-big.pdf'), 'P', 400); const t0 = Date.now(); const info = await E.pdf.pagesInfo(big); const t1 = Date.now();
    for (const p of [0, 199, 399]) { const b = await E.pdf.thumbnail(big, p, 220); if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG'); } const t2 = Date.now();
    if (info.pages !== 400 || info.sizes.length !== 400) throw new Error('info'); if (t1 - t0 > 8000 || t2 - t1 > 8000) throw new Error(`slow: info ${t1 - t0} ms, 3 thumbs ${t2 - t1} ms`);
    return `info ${t1 - t0} ms, 3 thumbnails ${t2 - t1} ms`;
  });
};
