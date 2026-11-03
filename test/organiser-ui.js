'use strict';
// UI test of the page organiser in the real app window (run inside Electron: MAMBA_RADIAL_SCRIPT=test/organiser-ui.js).
// Drives Merge PDFs and Split PDF through DOM events (click / Shift / Ctrl, HTML5 drag & drop, keyboard), saves through the
// real queue, then checks the written PDFs' page order, rotation and count. Screenshots go to MAMBA_ORG_SHOTS (out/organiser).
const fs = require('fs'); const path = require('path'); const os = require('os');
const { BrowserWindow } = require('electron');
const F = require('./pdf-fixtures');
module.exports = async ({ E }) => {
  const lines = []; let passed = 0, failed = 0; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (n, c, x = '') => { c ? passed++ : failed++; lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
  const step = async (n, fn) => { try { const r = await fn(); ok(n, r !== false && r != null, typeof r === 'string' ? r : ''); } catch (e) { ok(n, false, String(e && e.message || e)); } };
  const must = (c, msg) => { if (!c) throw new Error(msg); return typeof c === 'string' ? c : msg; }; // pass with msg as detail, or fail with it
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (_) {} await sleep(100); } return null; };
  const shots = process.env.MAMBA_ORG_SHOTS || path.join(__dirname, '..', 'out', 'organiser'); fs.mkdirSync(shots, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamba-org-')); const out = path.join(dir, 'out'); fs.mkdirSync(out);
  const A = await F.labelledPdf(path.join(dir, 'Contract.pdf'), 'A', 4); const B = await F.labelledPdf(path.join(dir, 'Appendix.pdf'), 'B', 3, { mixed: true });
  const C = await F.labelledPdf(path.join(dir, 'Scan batch.pdf'), 'C', 12, { bookmarks: [{ title: 'Invoice 1001', page: 0 }, { title: 'Invoice 1002', page: 4 }, { title: 'Receipts', page: 9 }] });
  const win = await until(() => BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())));
  if (!win) return { passed: 0, failed: 1, lines: ['FAIL  main window did not open'] };
  const { screen } = require('electron'); const wa = screen.getPrimaryDisplay().workAreaSize; win.setBounds({ x: 0, y: 0, width: Math.min(1440, wa.width), height: Math.min(960, wa.height) }); win.show(); lines.push(`INFO  display ${wa.width}x${wa.height}`); const errs = []; win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 3) errs.push(msg); });
  const js = (code) => win.webContents.executeJavaScript(code);
  await until(() => js('!!(window.__mamba && window.__orgTools && document.querySelector(".toolcard"))'));
  const before = await js('window.api.getSettings()');
  await js(`(async () => { await window.api.setSettings({ outputMode: 'folder', outputDir: ${JSON.stringify(out)}, lang: 'en' }); })()`);
  const shot = async (name) => { win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 900 }); await js(`{ const o = document.querySelector('.org'); if (o) o.scrollIntoView({ block: 'start' }); }`); await sleep(300); fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG()); };
  const key = (k, mods = []) => { const m = mods; win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m }); if (k.length === 1) win.webContents.sendInputEvent({ type: 'char', keyCode: k, modifiers: m }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m }); };
  const labels = () => js(`[...document.querySelectorAll('.org-sec')].map(s => [...s.querySelectorAll('.pg')].map(p => p.querySelector('.tag').textContent + (p.querySelector('.rot') ? p.querySelector('.rot').textContent.replace('↻','@').replace('°','') : '')).join(' ')).join(' | ')`);
  // helpers that run in the page: click a thumb (with modifiers) and HTML5 drag a selection onto another thumb
  await js(`window.__t = {
    pg: (label, sec) => [...document.querySelectorAll(sec != null ? '.org-sec:nth-of-type(' + (sec + 1) + ') .pg' : '.pg')].find(p => p.querySelector('.tag').textContent === label),
    click(label, mods = {}, sec) { const n = this.pg(label, sec); n.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl })); },
    drag(fromLabel, toLabel, after, fromSec, toSec) {
      const src = this.pg(fromLabel, fromSec); const dst = toLabel ? this.pg(toLabel, toSec) : document.querySelectorAll('.org-sec')[toSec].querySelector('.org-pages');
      const dt = new DataTransfer(); src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = dst.getBoundingClientRect(); const x = toLabel ? (after ? r.right - 4 : r.left + 4) : r.left + 10, y = r.top + r.height / 2;
      const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
      dst.dispatchEvent(new DragEvent('dragover', o)); dst.dispatchEvent(new DragEvent('drop', o)); src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    },
  }; true`);
  const openTool = (id, paths) => js(`(async () => { const M = window.__mamba; M.showTab('tools'); const tool = M.catalog.tools.find(t => t.id === '${id}'); M.Tools.files['${id}'] = await M.describe(${JSON.stringify(paths)}); M.Tools.open(tool); })()`);
  const waitJobs = (n) => until(() => js(`(() => { const j = window.__mamba.Q.jobs; return j.length >= ${n} && j.slice(0, j.length - (window.__qBefore || 0)).length >= 1 && j.slice(0, ${n}).every(x => x.status === 'done' || x.status === 'error') ? j.slice(0, ${n}).map(x => ({ status: x.status, outputs: x.outputs, error: x.error })) : null; })()`), 60000);

  // ================= MERGE =================
  await openTool('merge-pdf', [A, B]);
  await step('merge: grid shows every page of both files, labelled by file', async () => { const l = await until(async () => { const v = await labels(); return v.split(' ').length === 7 ? v : null; }); return must(l === 'A·1 A·2 A·3 A·4 B·1 B·2 B·3', l); });
  await step('merge: thumbnails on screen load lazily via MuPDF', async () => { const r = await until(() => js(`(() => { document.querySelector('.org-grid').scrollIntoView({ block: 'nearest' }); const g = document.querySelector('.org-grid').getBoundingClientRect(), pn = document.getElementById('toolPane').getBoundingClientRect(); const top = Math.max(g.top, pn.top), bot = Math.min(g.bottom, pn.bottom, innerHeight); const vis = [...document.querySelectorAll('.pg img')].filter(i => { const r = i.closest('.pg').getBoundingClientRect(); return r.bottom > top + 2 && r.top < bot - 2; }); const loaded = vis.filter(i => (i.src || '').startsWith('blob:') && i.naturalWidth > 0); return vis.length && loaded.length === vis.length ? loaded.length + ' of ' + vis.length + ' visible loaded, ' + document.querySelectorAll('.pg img').length + ' total' : null; })()`)); return must(r, 'thumbnails did not load'); });
  await step('merge: colour-coded legend for 2 files', async () => { const c = await js(`[...document.querySelectorAll('.org-file')].map(f => getComputedStyle(f).borderInlineStartColor)`); return c.length === 2 && c[0] !== c[1] ? c.join(' / ') : false; });
  await step('merge: drag a page across files (B·2 before A·2)', async () => { await js(`__t.click('B·2'); __t.drag('B·2', 'A·2', false)`); await sleep(150); const l = await labels(); return must(l === 'A·1 B·2 A·2 A·3 A·4 B·1 B·3', l); });
  await step('merge: Ctrl+click two pages and drag them to the end', async () => { await js(`__t.click('A·1'); __t.click('A·3', { ctrl: true }); __t.drag('A·3', 'B·3', true)`); await sleep(150); const l = await labels(); return must(l === 'B·2 A·2 A·4 B·1 B·3 A·1 A·3', l); });
  await step('merge: Shift-range select + rotate right (R key)', async () => { await js(`__t.click('A·2'); __t.click('B·1', { shift: true }); document.querySelector('.org-grid').focus()`); key('R'); await sleep(150); const l = await labels(); return must(l === 'B·2 A·2@90 A·4@90 B·1@90 B·3 A·1 A·3', l); });
  await step('merge: Ctrl+Z undoes, Ctrl+Y redoes', async () => { key('Z', ['control']); await sleep(120); const u = await labels(); key('Y', ['control']); await sleep(120); const r = await labels(); return must(u === 'B·2 A·2 A·4 B·1 B·3 A·1 A·3' && r === 'B·2 A·2@90 A·4@90 B·1@90 B·3 A·1 A·3', `${u} || ${r}`); });
  await step('merge: Delete key removes the selection, duplicate (Ctrl+D) copies', async () => { await js(`__t.click('A·4'); document.querySelector('.org-grid').focus()`); key('Delete'); await sleep(120); await js(`__t.click('B·3')`); key('D', ['control']); await sleep(150); const l = await labels(); return must(l === 'B·2 A·2@90 B·1@90 B·3 B·3 A·1 A·3', l); });
  await step('merge: arrows move the focus, Ctrl+arrow moves the page', async () => { await js(`__t.click('B·2'); document.querySelector('.org-grid').focus()`); key('Right', ['control']); await sleep(120); key('Right'); await sleep(80); const f = await js(`document.querySelector('.pg.focus .tag').textContent`); const l = await labels(); return must(l.startsWith('A·2@90 B·2 B·1@90') && f === 'B·1', `${l} (focus ${f})`); });
  await step('merge: reorder whole files with the legend (Appendix first)', async () => { await js(`document.querySelectorAll('.org-file')[1].querySelector('button[title="Move file earlier"]').click()`); await sleep(150); const l = await labels(); return must(l === 'B·2 B·1@90 B·3 B·3 A·2@90 A·1 A·3', l); });
  await step('merge: Ctrl+A selects every page', async () => { await js(`document.querySelector('.org-grid').focus()`); key('A', ['control']); await sleep(100); const n = await js(`document.querySelectorAll('.pg.on').length`); return must(n === 7, n + ' selected'); });
  await js(`__t.click('B·3')`); await js(`document.querySelector('.org-grid').scrollTop = 0`);
  await shot('merge-organiser.png');
  await step('merge: preview lists 1 output with 7 pages, then saves through the queue', async () => {
    await js(`[...document.querySelectorAll('.org-foot button.primary')][0].click()`); await sleep(400); await shot('merge-preview.png');
    const txt = await js(`document.querySelector('.org-modal').innerText`); must(/7 pages from 2 file/.test(txt), 'preview: ' + txt);
    await js(`window.__qBefore = window.__mamba.Q.jobs.length; document.getElementById('orgSave').click()`); const jobs = await waitJobs(1); must(jobs && jobs[0].status === 'done', JSON.stringify(jobs));
    const got = F.labels(await F.readPages(jobs[0].outputs[0], E)); return must(got === 'B2 B1@90 B3 B3 A2@90 A1 A3' && jobs[0].outputs.length === 1, `${path.basename(jobs[0].outputs[0])}: ${got}`);
  });
  await step('merge: Arabic UI (RTL) renders the organiser', async () => { await js(`(async () => { window.S = null; })()`); await js(`document.querySelector('.lang button[data-lang="ar"]').click()`); await sleep(600); const dir = await js('document.documentElement.dir'); const n = await js(`document.querySelectorAll('.pg').length`); await shot('merge-organiser-ar.png'); await js(`document.querySelector('.lang button[data-lang="en"]').click()`); await sleep(500); return must(dir === 'rtl' && n === 7, `${dir}, ${n} pages`); });

  // ================= SPLIT =================
  await openTool('split-pdf', [C]);
  await step('split: 12 pages start unassigned, one empty group', async () => { const l = await until(async () => { const v = await labels(); return v.split(' ').length >= 12 ? v : null; }); return must(l === ' | 1 2 3 4 5 6 7 8 9 10 11 12', JSON.stringify(l)); });
  await step('split: select 1-3 (Shift) and press 1 → Group 1; Ctrl-select 5, 7 and press 2 → Group 2', async () => {
    await js(`__t.click('1'); __t.click('3', { shift: true }); document.querySelector('.org-grid').focus()`); key('1'); await sleep(150);
    await js(`__t.click('5'); __t.click('7', { ctrl: true })`); key('2'); await sleep(150); const l = await labels(); return must(l === '1 2 3 | 5 7 | 4 6 8 9 10 11 12', l);
  });
  await step('split: drag a page from the unassigned pool into Group 2 and between groups', async () => {
    await js(`__t.click('12', {}, 2); __t.drag('12', '5', false, 2, 1)`); await sleep(150);
    await js(`__t.click('2', {}, 0); __t.drag('2', '7', true, 0, 1)`); await sleep(150); const l = await labels(); return must(l === '1 3 | 12 5 7 2 | 4 6 8 9 10 11', l);
  });
  await step('split: rename the output files', async () => { await js(`{ const i = document.querySelectorAll('.org-sec .gname'); i[0].value = 'Cover letter'; i[0].dispatchEvent(new Event('change')); }`); await sleep(100); await js(`{ const i = document.querySelectorAll('.org-sec .gname'); i[1].value = 'Selected pages'; i[1].dispatchEvent(new Event('change')); }`); await sleep(100); const v = await js(`[...document.querySelectorAll('.org-sec .gname')].map(i => i.value).join(',')`); return must(v === 'Cover letter,Selected pages', v); });
  await step('split: group buttons are colour coded', async () => { const c = await js(`[...document.querySelectorAll('.org-sec')].map(s => getComputedStyle(s).borderInlineStartColor)`); return must(new Set(c).size === c.length, c.join(' / ')); });
  await js(`__t.click('5', {}, 1); __t.click('2', { shift: true }, 1)`); await js(`document.querySelector('.org-grid').scrollTop = 0`);
  await shot('split-groups.png');
  await step('split: preview shows 2 outputs and skips the unassigned pages; saving writes them', async () => {
    await js(`[...document.querySelectorAll('.org-foot button.primary')][0].click()`); await sleep(500); await shot('split-preview.png');
    const txt = await js(`document.querySelector('.org-modal').innerText`); must(/Cover letter\.pdf/.test(txt) && /Selected pages\.pdf/.test(txt) && /6 page\(s\) are not in any group/.test(txt), 'preview: ' + txt);
    await js(`window.__qBefore = window.__mamba.Q.jobs.length; document.getElementById('orgSave').click()`); const jobs = await waitJobs(1); must(jobs && jobs[0].status === 'done', JSON.stringify(jobs));
    const got = []; for (const f of jobs[0].outputs) got.push(`${path.basename(f)}=${F.labels(await F.readPages(f, E))}`);
    return must(got.join(' | ') === 'Cover letter.pdf=C1 C3 | Selected pages.pdf=C12 C5 C7 C2', got.join(' | '));
  });
  await step('split: preset ranges "1-3, 5, 8-10" builds 3 groups', async () => { await js(`{ const i = document.querySelector('.org-presets input.rng'); i.value = '1-3, 5, 8-10'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); }`); await sleep(200); const l = await labels(); return must(l === '1 2 3 | 5 | 8 9 10 | 4 6 7 11 12', l); });
  await step('split: Delete takes pages out of a group; Ctrl+Z puts them back', async () => { await js(`__t.click('5', {}, 1); document.querySelector('.org-grid').focus()`); key('Delete'); await sleep(150); const a = await labels(); key('Z', ['control']); await sleep(150); const b = await labels(); return must(a === '1 2 3 |  | 8 9 10 | 4 5 6 7 11 12' && b === '1 2 3 | 5 | 8 9 10 | 4 6 7 11 12', `${a} || ${b}`); });
  await step('split: every 4 pages preset', async () => { await js(`{ const p = document.querySelector('.org-presets'); const n = p.querySelector('input.n3'); n.value = '4'; n.dispatchEvent(new Event('input')); [...p.querySelectorAll('button')].find(b => b.textContent === 'Apply').click(); }`); await sleep(200); const l = await labels(); return must(l === '1 2 3 4 | 5 6 7 8 | 9 10 11 12 | ', l); });
  await step('split: by bookmarks preset uses the outline (3 groups named after bookmarks)', async () => { await js(`[...document.querySelectorAll('.org-presets button')].find(b => b.textContent === 'By bookmarks').click()`); await sleep(200); const n = await js(`[...document.querySelectorAll('.org-sec .gname')].map(i => i.value).join(',')`); const l = await labels(); await shot('split-bookmarks.png'); return must(n === 'Invoice 1001,Invoice 1002,Receipts' && l === '1 2 3 4 | 5 6 7 8 9 | 10 11 12 | ', `${n}: ${l}`); });
  await step('no renderer errors', async () => must(!errs.length, errs.join(' | ') || 'none'));
  // leave the profile as we found it (later CI steps rely on "next to original")
  await js(`window.api.setSettings(${JSON.stringify({ outputMode: before.outputMode || 'same', outputDir: before.outputDir || '', lang: before.lang || 'en' })})`);
  return { passed, failed, lines };
};
