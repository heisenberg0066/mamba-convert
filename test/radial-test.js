'use strict';
// Scripted test of the Explorer wheel (run inside Electron: MAMBA_RADIAL_SCRIPT=test/radial-test.js).
const fs = require('fs'); const path = require('path'); const os = require('os');
const { ipcMain, BrowserWindow, screen } = require('electron');
module.exports = async ({ controller, app, E }) => {
  const lines = []; let passed = 0, failed = 0; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (n, c, x = '') => { c ? passed++ : failed++; lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
  const step = async (n, fn) => { try { const r = await fn(); ok(n, r !== false && r != null, typeof r === 'string' ? r : ''); } catch (e) { ok(n, false, String(e && e.message || e)); } };
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (_) {} await sleep(100); } return null; };
  const shots = process.env.MAMBA_RADIAL_SHOTS || path.join(__dirname, '..', 'docs'); fs.mkdirSync(shots, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamba-radial-'));
  const sharp = require('sharp');
  const mk = async (name, color) => { const f = path.join(dir, name); await sharp({ create: { width: 320, height: 200, channels: 3, background: color } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret' } } }).toFile(f); return f; };
  const jpg = await mk('photo one.jpg', '#ff7a00'), jpg2 = await mk('photo two.jpg', '#2266dd'), jpg3 = await mk('photo three.jpg', '#22aa55');
  const pdf = (await E.image.imagesToPdf([jpg, jpg2], { outputDir: dir })); const pdfFile = Array.isArray(pdf) ? pdf[0] : pdf;
  const W = () => controller._windows();
  const js = (code) => W().radial.webContents.executeJavaScript(code);
  const shot = async (w, name) => { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(shots, name), img.toPNG()); };
  const waitJobs = async (ids) => until(() => ids.every((id) => { const j = controller._tracked.get(id); return j && ['done', 'error', 'cancelled'].includes(j.status); }), 120000);

  await step('wheel opens for one image, centred at the cursor', async () => {
    await controller.showRadial([jpg]); const w = W().radial; const b = w.getBounds(); const c = screen.getCursorScreenPoint();
    return w.isVisible() && w.isAlwaysOnTop() && b.width === 720 && (Math.abs(b.x + 360 - c.x) <= 220 && Math.abs(b.y + 360 - c.y) <= 220) ? `bounds ${JSON.stringify(b)}` : false;
  });
  await step('inner ring categories fit an image', async () => { await sleep(300); const ids = await js('__radial.state.items.map(i=>i.id).join(",")'); return ['convert', 'compress', 'edit', 'flipbook', 'pdf', 'strip', 'reader'].every((k) => ids.split(',').includes(k)) && !ids.includes('av') ? ids : false; });
  await step('inner ring renders one slice per category', async () => (await js('document.querySelectorAll(".r1 .sl").length')) === (await js('__radial.state.items.length')));
  await shot(W().radial, 'wheel-1-inner.png');
  await step('hover Convert expands the outer ring with formats', async () => { await js('__radial.hover(0,0)'); await sleep(250); const n = await js('document.querySelectorAll(".r2 .sl").length'); const labels = await js('[...document.querySelectorAll(".r2 .sl text:not(.ic)")].map(t=>t.textContent).join(" ")'); return n >= 6 && /PNG/.test(labels) && /WEBP/.test(labels) ? labels : false; });
  await shot(W().radial, 'wheel-2-convert.png');
  await step('nested third ring (Edit → Resize)', async () => { const ei = await js('__radial.state.items.findIndex(i=>i.id==="edit")'); await js(`__radial.hover(0,${ei})`); await sleep(120); await js('__radial.hover(1,0)'); await sleep(250); const n = await js('document.querySelectorAll(".r3 .sl").length'); return n === 6; });
  await shot(W().radial, 'wheel-3-nested.png');
  await step('keyboard: arrows move, Enter expands, Escape goes back', async () => {
    const w = W().radial; w.focus(); await js('__radial.hover(0,0)'); await sleep(80);
    const key = async (k) => { w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await sleep(120); };
    await key('Right'); const p1 = await js('__radial.path.join(",")'); await key('Return'); const p2 = await js('__radial.path.join(",")'); await key('Escape'); const p3 = await js('__radial.path.join(",")');
    if (!(p1 === '1' && p2 === '1,0' && p3 === '1')) throw new Error(`${p1} | ${p2} | ${p3}`); return `${p1} → ${p2} → ${p3}`;
  });
  await step('Escape on the inner ring closes the wheel', async () => { const w = W().radial; w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); return !!(await until(() => !W().radial.isVisible(), 3000)); });
  await step('Convert → PNG runs in the background with a toast', async () => {
    await controller.showRadial([jpg]); await sleep(300);
    const res = new Promise((r) => ipcMain.once('radial:pick', (_e, d) => r(d)));
    await js('__radial.hover(0,0)'); await sleep(100); const idx = await js('__radial.state.items[0].children.findIndex(c=>c.id==="convert:png")'); await js(`__radial.activate(1,${idx})`);
    const d = await res; await until(() => controller._tracked.size > 0, 3000); const ids = [...controller._tracked.keys()]; await waitJobs(ids);
    const j = controller._tracked.get(ids[0]); const t = await until(() => W().toast && W().toast.isVisible() && W().toast, 5000);
    if (!(d.id === 'convert:png' && j.status === 'done' && fs.existsSync(j.outputs[0]) && j.outputs[0].endsWith('.png') && t && t.isVisible())) throw new Error(JSON.stringify({ d, j, toast: !!t && t.isVisible() })); return path.basename(j.outputs[0]);
  });
  await sleep(300); await shot(W().toast, 'toast.png');
  await step('multi-select from Explorer: separate launches collected into one wheel', async () => {
    app.emit('second-instance', {}, [process.execPath, ...(process.defaultApp ? ['.'] : []), '--radial', jpg]);
    app.emit('second-instance', {}, [process.execPath, ...(process.defaultApp ? ['.'] : []), '--radial', jpg2]);
    app.emit('second-instance', {}, [process.execPath, ...(process.defaultApp ? ['.'] : []), '--radial', jpg3]);
    await until(() => W().radial.isVisible() && controller._files().length === 3, 4000); await sleep(300);
    return controller._files().length === 3 && (await js('__radial.state.count')) === 3 ? '3 files' : false;
  });
  await step('Compress → Medium on the multi-selection', async () => {
    controller._tracked.clear(); await js('__radial.hover(0,1)'); await sleep(80); await js('__radial.activate(1,1)');
    await until(() => controller._tracked.size === 3, 3000); await waitJobs([...controller._tracked.keys()]);
    const js2 = [...controller._tracked.values()]; return js2.length === 3 && js2.every((j) => j.status === 'done' && /-compressed/.test(j.outputs[0])) ? '3 outputs' : false;
  });
  await step('mixed image + PDF: compress resolves per kind', async () => { controller._tracked.clear(); const n = controller.runPick({ type: 'compress', level: 'strong' }, [jpg, pdfFile]); await waitJobs(n); const v = [...controller._tracked.values()]; return v.length === 2 && v.every((j) => j.status === 'done') ? v.map((j) => path.basename(j.outputs[0])).join(', ') : false; });
  await step('Strip metadata removes EXIF', async () => { controller._tracked.clear(); const ids = controller.runPick({ type: 'tool', tool: 'strip-metadata', params: {} }, [jpg]); await waitJobs(ids); const j = controller._tracked.get(ids[0]); const m = await sharp(j.outputs[0]).metadata(); return j.status === 'done' && !m.exif ? 'no EXIF' : false; });
  await step('Flipbook (single HTML) from 3 images', async () => { controller._tracked.clear(); const ids = controller.runPick({ type: 'tool', tool: 'make-flipbook', params: { mode: 'single' }, combine: true }, [jpg, jpg2, jpg3]); await waitJobs(ids); const j = controller._tracked.get(ids[0]); return j.status === 'done' && /mamba-flipbook/.test(fs.readFileSync(j.outputs[0], 'utf8')) ? path.basename(j.outputs[0]) : false; });
  await step('PDF wheel offers PDF tools + Reader', async () => { await controller.showRadial([pdfFile]); await sleep(250); const ids = await js('__radial.state.items.map(i=>i.id).join(",")'); return /pdf/.test(ids) && /reader/.test(ids) && /flipbook/.test(ids) ? ids : false; });
  await js(`__radial.hover(0, __radial.state.items.findIndex(i=>i.id==="pdf"))`); await sleep(250); await shot(W().radial, 'wheel-4-pdf.png');
  await step('folder selection expands to the files inside', async () => { const files = controller.expand([dir]); return files.length >= 4 ? `${files.length} files` : false; });
  await step('hotkey path shows the wheel for the given selection', async () => { controller.hideRadial(); process.env.MAMBA_HOTKEY_FILES = [jpg, jpg2].join(path.delimiter); await controller.onHotkey(); await sleep(200); return W().radial.isVisible() && controller._files().length === 2; });
  await step('no selection → friendly toast instead of a wheel', async () => { controller.hideRadial(); process.env.MAMBA_HOTKEY_FILES = ''; const r = await controller.showRadial([]); const labels = [...controller._tracked.values()].map((j) => j.label); if (!(r === false && labels.some((l) => /Select files/.test(l)))) throw new Error(r + ' ' + JSON.stringify(labels)); return true; });
  await step('Arabic wheel', async () => { controller._set({ lang: 'ar' }); await controller.showRadial([jpg]); await sleep(250); await js('__radial.hover(0,1)'); await sleep(250); const lab = await js('document.querySelector(".r1 .sl text:not(.ic)").textContent'); await shot(W().radial, 'wheel-5-arabic.png'); controller._set({ lang: 'en' }); controller.hideRadial(); return /[\u0600-\u06FF]/.test(lab) ? lab : false; });
  await step('floating bubble: drop opens the wheel next to it', async () => {
    controller.showBubble(); const b = await until(() => W().bubble && W().bubble.isVisible() && W().bubble, 5000); if (!b) return false;
    await sleep(300); await shot(b, 'bubble.png'); ipcMain.emit('bubble:drop', { sender: b.webContents }, [jpg]); await until(() => W().radial.isVisible() && controller._files().length === 1, 4000);
    const rb = W().radial.getBounds(); const [bx, by] = b.getPosition(); controller.hideBubble(); return Math.abs(rb.x + 360 - (bx + 44)) < 260 ? 'wheel near bubble' : false;
  });
  await step('Open in Mamba Reader hands the file to the Reader exe', async () => {
    if (!process.env.MAMBA_READER_PATH) return 'skipped (no reader stub)';
    const log = process.env.MAMBA_READER_STUB_LOG; try { fs.unlinkSync(log); } catch (_) {}
    controller.runPick({ type: 'reader' }, [pdfFile]); return !!(await until(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes(path.basename(pdfFile)), 8000)) && 'stub got the file';
  });
  controller.hideRadial();
  return { passed, failed, lines };
};
