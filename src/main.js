'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const E = require('./engine');

// ---------- command line: --radial <files…> (Explorer context menu), --bubble, --background, --open-in-reader <file> ----------
function parseArgs(argv, first) {
  const list = argv.slice(1); if (process.defaultApp) { const k = list.findIndex((x) => !x.startsWith('-')); if (k >= 0) list.splice(k, 1); } const out = { files: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--radial') out.radial = true; else if (a === '--bubble') out.bubble = true; else if (a === '--background') out.background = true;
    else if (a === '--open-in-reader') out.openInReader = list[++i];
    else if (a === '--edit-in-reader') { out.openInReader = list[++i]; out.readerEdit = true; }
    else if (a.startsWith('--')) continue; else { try { if (fs.existsSync(a)) out.files.push(path.resolve(a)); } catch (_) {} }
  }
  return out;
}
const SPECIAL_RUN = process.argv.includes('--self-test') || process.env.MAMBA_SMOKE || process.env.MAMBA_SELFTEST || process.argv.includes('--open-in-reader') || process.argv.includes('--edit-in-reader');
if (!SPECIAL_RUN && !process.env.MAMBA_NO_LOCK && !app.requestSingleInstanceLock()) { app.exit(0); }
const earlyArgv = []; // second-instance launches that arrive before we are ready (Explorer multi-select)
function handleSecond(argv) {
  const a = parseArgs(argv, false);
  if (a.radial) controller.collect(a.files); else if (a.bubble) controller.showBubble(); else if (!a.background) openMain({ paths: a.files });
}
app.on('second-instance', (_e, argv) => { if (!controller) earlyArgv.push(argv); else handleSecond(argv); });
const helperEnabled = () => settings.helper !== false && (process.platform === 'win32' || process.env.MAMBA_HELPER === '1') && process.env.MAMBA_NO_TRAY !== '1';

// ---------- bundled ffmpeg ----------
function resolveBinaries() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    path.join(process.resourcesPath || '', 'bin'),
    path.join(__dirname, '..', 'vendor', process.platform === 'win32' ? 'ffmpeg-win' : 'ffmpeg-linux'),
  ];
  for (const dir of candidates) {
    const f = path.join(dir, 'ffmpeg' + exe);
    if (fs.existsSync(f)) return E.util.setBinaries({ ffmpeg: f, ffprobe: path.join(dir, 'ffprobe' + exe) });
  }
  // fall back to PATH (dev on Linux)
}
resolveBinaries();

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { lang: 'en', outputMode: 'same', outputDir: '', concurrency: Math.max(1, Math.min(3, Math.floor(os.cpus().length / 4))) };
function loadSettings() { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (_) {} }
function saveSettings() { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {} }

// ---------- HTML -> PDF with Chromium (offline) ----------
E.doc.setPdfRenderer(async (html, dest) => {
  const tmp = path.join(os.tmpdir(), `mamba-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(dest, pdf);
  } finally { w.destroy(); fs.rm(tmp, { force: true }, () => {}); }
});

// ---------- queue ----------
let win = null;
const jobs = new Map(); // id -> {job, ctrl, status}
const pending = [];
let running = 0;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); if (ch === 'job-update' && controller) controller.onJobUpdate(data); };
let controller = null;
function pump() {
  while (running < (settings.concurrency || 2) && pending.length) {
    const id = pending.shift(); const rec = jobs.get(id); if (!rec || rec.status !== 'queued') continue;
    running++; rec.status = 'running'; send('job-update', { id, status: 'running', progress: 0 });
    let last = 0;
    E.runJob(rec.job, { signal: rec.ctrl.signal, onProgress: (p) => { const now = Date.now(); if (now - last > 120) { last = now; send('job-update', { id, status: 'running', progress: p }); } } })
      .then((outputs) => { rec.status = 'done'; const sizes = outputs.map((f) => { try { return fs.statSync(f).size; } catch (_) { return 0; } }); send('job-update', { id, status: 'done', progress: 1, outputs, sizes }); })
      .catch((e) => { rec.status = rec.ctrl.signal.aborted ? 'cancelled' : 'error'; send('job-update', { id, status: rec.status, error: String(e.message || e) }); })
      .finally(() => { running--; pump(); });
  }
}

function outputDirFor() { return settings.outputMode === 'folder' && settings.outputDir ? settings.outputDir : undefined; }

// ---------- Mamba Reader handoff ----------
const { findReader, openInReader } = require('./reader')({ app, shell });

// ---------- IPC ----------
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-settings', (_e, s) => { settings = { ...settings, ...s }; saveSettings(); pump(); return settings; });
ipcMain.handle('pick-files', async (_e, opts = {}) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: opts.filters }); return r.canceled ? [] : r.filePaths; });
ipcMain.handle('pick-folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('catalog', () => ({ tools: E.TOOLS, conversions: E.formats.allConversions() }));
ipcMain.handle('describe', async (_e, files) => {
  const out = [];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.isDirectory()) { // expand folders one level deep
        for (const c of fs.readdirSync(f)) { const p = path.join(f, c); try { if (fs.statSync(p).isFile() && E.kind(p)) out.push({ path: p, name: c, size: fs.statSync(p).size, ext: E.util.ext(p), kind: E.kind(p), targets: E.formats.targetsFor(E.util.ext(p)) }); } catch (_) {} }
        continue;
      }
      const e = E.util.ext(f);
      out.push({ path: f, name: path.basename(f), size: st.size, ext: e, kind: E.kind(f), targets: E.formats.targetsFor(e) });
    } catch (_) {}
  }
  return out;
});
ipcMain.handle('image-preview', async (_e, file, opts) => E.image.preview(file, opts));
ipcMain.handle('image-info', async (_e, file) => E.image.info(file));
ipcMain.handle('probe', async (_e, file) => E.media.probe(file));
ipcMain.handle('video-frame', async (_e, file, at, opts) => E.media.frame(file, at, opts || {}));
ipcMain.handle('pdf-pages', async (_e, file) => E.pdf.pageCount(file));
function enqueue(list) {
  const ids = [];
  for (const job of list) {
    const id = job.id || `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const j = { ...job, id, outputDir: job.outputDir || outputDirFor() };
    jobs.set(id, { job: j, ctrl: new AbortController(), status: 'queued' }); pending.push(id); ids.push(id);
  }
  pump(); return ids;
}
function cancelJob(id) { const r = jobs.get(id); if (r) { if (r.status === 'queued') { r.status = 'cancelled'; send('job-update', { id, status: 'cancelled' }); } r.ctrl.abort(); } }
ipcMain.handle('enqueue', (_e, list) => enqueue(list));
ipcMain.handle('cancel', (_e, id) => cancelJob(id));
ipcMain.handle('retry', (_e, id) => { const r = jobs.get(id); if (r && ['error', 'cancelled'].includes(r.status)) { r.ctrl = new AbortController(); r.status = 'queued'; pending.push(id); send('job-update', { id, status: 'queued', progress: 0 }); pump(); } });
ipcMain.handle('reader-status', () => !!findReader());
ipcMain.handle('open-in-reader', (_e, p, o) => openInReader(p, o || {}));
ipcMain.handle('show-item', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('helper-settings', () => ({ helper: helperEnabled(), hotkey: settings.hotkey !== false, startAtLogin: !!settings.startAtLogin, bubble: !!settings.bubble }));
ipcMain.handle('helper-set', (_e, s) => { settings = { ...settings, ...s }; saveSettings(); if (controller) { controller.applyHotkey(); controller.applyLogin(); if ('bubble' in s) (s.bubble ? controller.showBubble() : controller.hideBubble()); } return true; });
ipcMain.handle('open-output-folder', (_e, p) => shell.openPath(p || settings.outputDir || app.getPath('downloads')));

// ---------- window ----------
let pendingOpen = null;
function openMain({ paths, tab } = {}) {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (paths && paths.length) win.webContents.send('open-files', { paths, tab }); return; }
  pendingOpen = paths && paths.length ? { paths, tab } : null; createWindow();
}
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 980, minHeight: 640, backgroundColor: '#f6f7fb', title: 'Mamba Convert',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => { if (pendingOpen) { win.webContents.send('open-files', pendingOpen); pendingOpen = null; } });
  win.on('closed', () => { win = null; if (controller) setTimeout(() => controller.maybeQuit(), 100); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env.MAMBA_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  loadSettings();
  // Hard offline guarantee: block every network request; only local files/data/blob are allowed.
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|devtools|chrome-extension):/i.test(d.url) }));
  if (process.env.MAMBA_SELFTEST) { require(path.join(__dirname, '..', 'test', 'run-tests.js')); return; }
  if (process.argv.includes('--self-test') || process.env.MAMBA_SMOKE) {
    const r = await require('./selftest')(E, process.env.MAMBA_SMOKE || undefined);
    console.log(r.lines.join('\n')); console.log(`report: ${r.report}`);
    if (!process.env.MAMBA_SMOKE) dialog.showMessageBoxSync({ message: `Self-test: ${r.passed} passed, ${r.failed} failed`, detail: r.lines.join('\n') });
    app.exit(r.failed ? 1 : 0); return;
  }
  const args = parseArgs(process.argv, true);
  if (args.openInReader) { const r = openInReader(path.resolve(args.openInReader), { edit: !!args.readerEdit }); console.log('open-in-reader: ' + JSON.stringify(r)); if (process.env.MAMBA_HANDOFF_OUT) fs.writeFileSync(process.env.MAMBA_HANDOFF_OUT, JSON.stringify(r)); setTimeout(() => app.exit(r.ok ? 0 : 2), 800); return; }
  controller = require('./radial/controller')({ app, enqueue, cancel: cancelJob, openMain, reader: { findReader, openInReader }, settings: () => settings, saveSettings: (s) => { settings = { ...settings, ...s }; saveSettings(); }, kindOf: (f) => E.kind(f), helperActive: () => helperEnabled() && !!controller._windows().tray, mainOpen: () => !!(win && !win.isDestroyed()) });
  if (settings.startAtLogin === undefined && app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE) { settings.startAtLogin = true; saveSettings(); }
  if (helperEnabled()) { controller.startHelper(); controller.applyLogin(); }
  controller._log('startup', { radial: !!args.radial, files: args.files.length, background: !!args.background, version: app.getVersion() });
  require('./radial/testhooks')({ app, controller, E, fs, path });
  if (args.radial) controller.collect(args.files);
  else if (args.bubble) controller.showBubble();
  else if (!args.background) openMain({ paths: args.files });
  earlyArgv.splice(0).forEach(handleSecond);
  if (process.env.MAMBA_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.MAMBA_SCREENSHOT_JS) await win.webContents.executeJavaScript(process.env.MAMBA_SCREENSHOT_JS).catch((e) => console.error(e));
      setTimeout(async () => { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.MAMBA_SCREENSHOT, img.toPNG()); app.quit(); }, Number(process.env.MAMBA_SCREENSHOT_WAIT || 1500));
    }, 800));
  }
});
app.on('window-all-closed', () => { if (process.env.MAMBA_SELFTEST || process.env.MAMBA_SMOKE || process.argv.includes('--self-test')) return; if (controller) controller.maybeQuit(); else app.quit(); });
app.on('will-quit', () => { try { require('electron').globalShortcut.unregisterAll(); } catch (_) {} });
