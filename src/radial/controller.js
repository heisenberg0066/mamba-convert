'use strict';
// Explorer integration: radial wheel window, background job toast, floating drop bubble, tray + global hotkey.
const { BrowserWindow, ipcMain, screen, Menu, Tray, globalShortcut, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const M = require('./menu');

module.exports = function createController(ctx) {
  const { app, enqueue, cancel, openMain, reader, settings, saveSettings, kindOf } = ctx;
  const S = () => settings();
  const lang = () => S().lang || 'en';
  const TEST = !!process.env.MAMBA_RADIAL_TEST;
  let radial = null, toast = null, bubble = null, tray = null;
  let radialFiles = [], radialReady = null;
  const tracked = new Map(); // job id -> {id,label,status,progress,outputs,error}
  let toastHideT = null, collectT = null, collectBuf = [], collectAt = null;
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  const wlog = ctx.log || require('./wheellog')(app);
  // Wheel window state machine (see showRadial/hideRadial): one session per right-click.
  //  - showing is idempotent: a visible wheel is never hidden and re-shown, it is only updated in place;
  //  - files from late Explorer launches (one process per selected file) are merged into the open wheel;
  //  - blur closes the wheel only after it really gained focus and a grace period has passed.
  const GRACE_MS = Number(process.env.MAMBA_WHEEL_GRACE_MS || 300);
  const MERGE_MS = Number(process.env.MAMBA_WHEEL_MERGE_MS || 2500);
  let session = 0, shownAt = 0, focusedAt = 0, armed = false, armT = null, unfocusedT = null, lastHide = { at: 0, key: '' };
  const keyOf = (files) => files.slice().sort().join('|');

  // ---------- helpers ----------
  const webPrefs = { preload: path.join(__dirname, 'preload-radial.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false, backgroundThrottling: false };
  function expand(paths) {
    const out = [];
    for (const p of paths) {
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) { for (const c of fs.readdirSync(p).sort()) { const f = path.join(p, c); try { if (fs.statSync(f).isFile() && kindOf(f)) out.push(f); } catch (_) {} } }
        else if (kindOf(p)) out.push(p);
      } catch (_) {}
    }
    return [...new Set(out)];
  }
  const displayAt = (pt) => screen.getDisplayNearestPoint(pt).workArea;

  // ---------- radial window ----------
  function ensureRadial() {
    if (radial && !radial.isDestroyed()) return radialReady;
    radial = new BrowserWindow({ width: 720, height: 720, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000', title: 'Mamba Convert wheel', webPreferences: webPrefs });
    radial.setAlwaysOnTop(true, 'screen-saver'); radial.setMenu(null);
    radial.on('focus', () => {
      focusedAt = Date.now(); wlog('focus', { session, sinceShow: focusedAt - shownAt });
      clearTimeout(armT); armT = setTimeout(() => { if (radial && !radial.isDestroyed() && radial.isFocused()) { armed = true; wlog('blur-armed', { session }); } }, GRACE_MS);
    });
    radial.on('blur', () => {
      const vis = radial.isVisible();
      if (!vis) return;
      if (TEST) { wlog('blur-ignored', { session, reason: 'test' }); return; }
      if (!armed) {
        // Focus moved away before the grace period ended (typically Explorer re-activating itself right after the
        // shell launch). Do NOT hide: that is what produced the show/hide flicker. Take focus back once instead.
        wlog('blur-ignored', { session, reason: focusedAt ? 'grace' : 'never-focused', sinceShow: Date.now() - shownAt });
        if (Date.now() - shownAt < 1500) setTimeout(() => takeFocus('refocus'), 30);
        return;
      }
      hideRadial('blur');
    });
    radial.on('show', () => wlog('window-show', { session }));
    radial.on('hide', () => wlog('window-hide', { session }));
    radial.webContents.on('render-process-gone', (_e, d) => wlog('renderer-gone', { reason: d && d.reason }));
    radial.on('closed', () => { radial = null; });
    radialReady = radial.loadFile(path.join(__dirname, 'radial.html'));
    return radialReady;
  }
  /** Explorer launches one process per selected file; collect them for a moment, then show one wheel. */
  function collect(paths, at) {
    wlog('launch', { files: paths.length, visible: !!(radial && !radial.isDestroyed() && radial.isVisible()) });
    // A wheel that just opened for this selection: merge late arrivals straight in (no new session, no re-show).
    if (radial && !radial.isDestroyed() && radial.isVisible() && Date.now() - shownAt < MERGE_MS && !collectBuf.length) { api.showRadial(paths, null, null, { merge: true }); return; }
    collectBuf.push(...paths); collectAt = at || collectAt; clearTimeout(collectT);
    collectT = setTimeout(() => { const p = collectBuf; collectBuf = []; const a = collectAt; collectAt = null; api.showRadial(p, a); }, Number(process.env.MAMBA_RADIAL_COLLECT_MS || 450));
  }
  function takeFocus(why) {
    if (!radial || radial.isDestroyed() || !radial.isVisible()) return;
    try { if (process.platform === 'win32' || process.platform === 'darwin') app.focus({ steal: true }); } catch (_) {}
    radial.focus(); radial.moveTop(); radial.webContents.focus();
    wlog('take-focus', { session, why, focused: radial.isFocused() });
  }
  async function showRadial(paths, at, preselect, opts = {}) {
    let files = expand(paths);
    if (!files.length && !opts.merge) { wlog('show-skipped', { reason: paths.length ? 'unsupported' : 'no-selection' }); notify(paths.length ? 'unsupported' : 'noSelection'); return false; }
    const visible = radial && !radial.isDestroyed() && radial.isVisible();
    if (visible && (opts.merge || keyOf(files) === keyOf(radialFiles))) {
      // Idempotent: already showing → update in place, never hide/show.
      const merged = [...new Set([...radialFiles, ...files])]; const added = merged.length - radialFiles.length;
      wlog('show-update', { session, added, files: merged.length });
      if (added) { radialFiles = merged; const menu = M.menuFor(merged, { readerAvailable: !!reader.findReader() }); radial.webContents.send('radial:show', { items: menu.items, kinds: menu.kinds, count: merged.length, lang: lang(), preselect, legacyHover: process.env.MAMBA_WHEEL_LEGACY_HOVER === '1', update: true }); }
      return true;
    }
    if (!files.length) return false;
    const key = keyOf(files);
    if (!visible && lastHide.reason === 'blur' && lastHide.key === key && Date.now() - lastHide.at < 700) { wlog('show-suppressed', { reason: 'same selection right after a blur-close' }); return false; }
    session++; radialFiles = files; armed = false; focusedAt = 0; clearTimeout(armT); clearTimeout(unfocusedT);
    const menu = M.menuFor(files, { readerAvailable: !!reader.findReader() });
    await ensureRadial();
    const pt = at || screen.getCursorScreenPoint(); const wa = displayAt(pt);
    const x = Math.round(Math.min(Math.max(pt.x - 360, wa.x - 200), wa.x + wa.width - 520)), y = Math.round(Math.min(Math.max(pt.y - 360, wa.y - 200), wa.y + wa.height - 520));
    radial.setBounds({ x, y, width: 720, height: 720 });
    radial.webContents.send('radial:show', { items: menu.items, kinds: menu.kinds, count: files.length, lang: lang(), preselect, legacyHover: process.env.MAMBA_WHEEL_LEGACY_HOVER === '1' });
    shownAt = Date.now();
    wlog('show', { session, files: files.length, wasVisible: !!visible, x, y, cursor: pt });
    if (!radial.isVisible()) radial.show();
    radial.setAlwaysOnTop(true, 'screen-saver');
    takeFocus('show');
    // Focus-stealing prevention can refuse focus entirely; then a blur never comes. In that case close only when the
    // cursor has stayed well away from the wheel for a while (Esc / clicks need focus, which a click on the wheel gives).
    const watch = () => {
      if (!radial || radial.isDestroyed() || !radial.isVisible()) return;
      if (!radial.isFocused() && !TEST) {
        const c = screen.getCursorScreenPoint(); const b = radial.getBounds(); const dx = c.x - (b.x + 360), dy = c.y - (b.y + 360);
        if (Math.hypot(dx, dy) > 420) { watch.away = (watch.away || 0) + 250; if (watch.away >= 6000) { hideRadial('unfocused-cursor-away'); return; } } else watch.away = 0;
      } else watch.away = 0;
      unfocusedT = setTimeout(watch, 250);
    };
    unfocusedT = setTimeout(watch, 250);
    return true;
  }
  function hideRadial(reason = 'close') {
    clearTimeout(armT); clearTimeout(unfocusedT); armed = false;
    if (radial && !radial.isDestroyed() && radial.isVisible()) { lastHide = { at: Date.now(), key: keyOf(radialFiles), reason }; wlog('hide', { session, reason, shownFor: Date.now() - shownAt }); radial.hide(); }
    setTimeout(maybeQuit, 300);
  }
  ipcMain.on('radial:close', (_e, d) => hideRadial(d && d.picked ? 'picked' : (d && d.reason) || 'renderer-close'));
  ipcMain.on('radial:log', (_e, d) => wlog('renderer', d || {}));
  ipcMain.on('radial:pick', (_e, d) => runPick(d.action, radialFiles, d.label));

  function runPick(action, files, label) {
    const jobs = M.resolveJobs(action, files);
    const special = jobs.find((j) => j.special);
    if (special) {
      if (special.special === 'reader') { for (const f of special.files) { const r = reader.openInReader(f, { edit: special.edit }); wlog('reader', { file: f, ...r }); } }
      if (special.special === 'studio') openMain({ paths: special.files, tab: special.tab });
      return [];
    }
    const ids = enqueue(jobs.map(({ label: l, ...j }) => j));
    ids.forEach((id, i) => tracked.set(id, { id, label: jobs[i].label || label, status: 'queued', progress: 0 }));
    showToast(); return ids;
  }

  // ---------- toast ----------
  function ensureToast() {
    if (toast && !toast.isDestroyed()) return Promise.resolve();
    toast = new BrowserWindow({ width: 400, height: 160, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, focusable: false, hasShadow: false, backgroundColor: '#00000000', webPreferences: webPrefs });
    toast.setAlwaysOnTop(true, 'pop-up-menu'); toast.on('closed', () => { toast = null; });
    return toast.loadFile(path.join(__dirname, 'toast.html'));
  }
  async function showToast() {
    await ensureToast(); pushToast(); if (!toast.isVisible()) { toast.showInactive(); if (!toast.isVisible()) toast.show(); }
  }
  function pushToast() {
    if (!toast || toast.isDestroyed()) return; const jobs = [...tracked.values()].slice(-8);
    const h = Math.min(480, 74 + jobs.reduce((a, j) => a + (j.status === 'error' ? 76 : 60), 0));
    const wa = displayAt(screen.getCursorScreenPoint()); toast.setBounds({ x: wa.x + wa.width - 410, y: wa.y + wa.height - h - 8, width: 400, height: h });
    toast.webContents.send('toast:update', { jobs, lang: lang() });
    const active = jobs.some((j) => j.status === 'queued' || j.status === 'running'); clearTimeout(toastHideT);
    if (!active && jobs.length) toastHideT = setTimeout(hideToast, Number(process.env.MAMBA_TOAST_MS || 9000));
  }
  function hideToast() { if (toast && !toast.isDestroyed()) toast.hide(); for (const [id, j] of tracked) if (!['queued', 'running'].includes(j.status)) tracked.delete(id); setTimeout(maybeQuit, 200); }
  function notify(key) { tracked.set('n' + Date.now(), { id: 'n', label: require('./strings-node')(lang(), key), status: 'cancelled', progress: 0 }); showToast(); }
  ipcMain.on('toast:close', hideToast);
  ipcMain.on('toast:show', (_e, p) => shell.showItemInFolder(p));
  ipcMain.on('toast:open', (_e, p) => shell.openPath(p));
  ipcMain.on('toast:cancel', (_e, id) => cancel(id));
  function onJobUpdate(d) { const j = tracked.get(d.id); if (!j) return; Object.assign(j, d); pushToast(); }

  // ---------- bubble ----------
  function showBubble() {
    if (bubble && !bubble.isDestroyed()) { bubble.showInactive(); return; }
    const wa = screen.getPrimaryDisplay().workArea; const pos = S().bubblePos || { x: wa.x + wa.width - 120, y: wa.y + wa.height - 160 };
    bubble = new BrowserWindow({ x: pos.x, y: pos.y, width: 88, height: 88, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, focusable: true, backgroundColor: '#00000000', title: 'Mamba bubble', webPreferences: webPrefs });
    bubble.setAlwaysOnTop(true, 'floating'); bubble.loadFile(path.join(__dirname, 'bubble.html'));
    bubble.webContents.once('did-finish-load', () => { bubble.webContents.send('bubble:lang', lang()); bubble.showInactive(); });
    bubble.on('closed', () => { bubble = null; });
    saveSettings({ bubble: true }); refreshTray();
  }
  function hideBubble() { if (bubble && !bubble.isDestroyed()) bubble.close(); bubble = null; saveSettings({ bubble: false }); refreshTray(); setTimeout(maybeQuit, 200); }
  ipcMain.on('bubble:move', (_e, { dx, dy }) => { if (!bubble) return; const [x, y] = bubble.getPosition(); bubble.setPosition(x + dx, y + dy); });
  ipcMain.on('bubble:moved', () => { if (!bubble) return; const [x, y] = bubble.getPosition(); saveSettings({ bubblePos: { x, y } }); });
  ipcMain.on('bubble:click', () => openMain({}));
  ipcMain.on('bubble:drop', (_e, paths) => { const [x, y] = bubble.getPosition(); api.showRadial(paths, { x: x + 44, y: y + 44 }); });
  ipcMain.on('bubble:menu', () => Menu.buildFromTemplate(trayMenu()).popup({ window: bubble }));

  // ---------- tray, hotkey, start with Windows ----------
  function trayMenu() {
    const s = S();
    return [
      { label: 'Open Mamba Convert', click: () => openMain({}) },
      { label: s.bubble ? 'Hide floating bubble' : 'Show floating bubble', click: () => (s.bubble ? hideBubble() : showBubble()) },
      { type: 'separator' },
      { label: `Hotkey ${hotkeyLabel()} for selected Explorer files`, type: 'checkbox', checked: s.hotkey !== false, click: (m) => { saveSettings({ hotkey: m.checked }); applyHotkey(); } },
      { label: 'Start with Windows (background)', type: 'checkbox', checked: !!s.startAtLogin, visible: process.platform === 'win32', click: (m) => { saveSettings({ startAtLogin: m.checked }); applyLogin(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { ctx.quitting = true; app.quit(); } },
    ];
  }
  const hotkeyLabel = () => (S().hotkeyAccel || 'Control+Alt+M').replace('Control', 'Ctrl');
  function refreshTray() { if (tray && !tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(trayMenu())); }
  function startHelper() {
    if (!tray && process.env.MAMBA_NO_TRAY !== '1') {
      try { tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })); tray.setToolTip(`Mamba Convert — right-click files or press ${hotkeyLabel()}`); tray.on('click', () => openMain({})); refreshTray(); } catch (_) { tray = null; }
    }
    applyHotkey(); if (S().bubble) showBubble();
  }
  function applyHotkey() {
    try { globalShortcut.unregisterAll(); } catch (_) {}
    if (S().hotkey === false) return false;
    try { return globalShortcut.register(S().hotkeyAccel || 'Control+Alt+M', onHotkey); } catch (_) { return false; }
  }
  function applyLogin() {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    app.setLoginItemSettings({ openAtLogin: !!S().startAtLogin, path: exe, args: ['--background'], name: 'MambaConvert' });
  }
  async function onHotkey() {
    const at = screen.getCursorScreenPoint();
    const files = process.env.MAMBA_HOTKEY_FILES ? process.env.MAMBA_HOTKEY_FILES.split(path.delimiter) : await explorerSelection();
    return api.showRadial(files, at);
  }
  /** Selected items in the foreground File Explorer window (Windows; PowerShell + Shell.Application COM). */
  function explorerSelection() {
    if (process.platform !== 'win32') return Promise.resolve([]);
    const ps = `$ErrorActionPreference='SilentlyContinue'
Add-Type -Namespace MambaW -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
$h=[int64][MambaW.U]::GetForegroundWindow()
$out=@()
foreach($w in (New-Object -ComObject Shell.Application).Windows()){ if([int64]$w.HWND -eq $h){ $s=@($w.Document.SelectedItems() | ForEach-Object { $_.Path }); if($s.Count -gt 0){ $out=$s; break } } }
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$out | ForEach-Object { [Console]::WriteLine($_) }`;
    return new Promise((resolve) => {
      const cp = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
      let out = ''; cp.stdout.on('data', (d) => (out += d)); cp.on('error', () => resolve([])); cp.on('close', () => resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
      setTimeout(() => { try { cp.kill(); } catch (_) {} }, 8000);
    });
  }

  function anyVisible() { return [radial, toast, bubble].some((w) => w && !w.isDestroyed() && w.isVisible()); }
  function busy() { return [...tracked.values()].some((j) => j.status === 'queued' || j.status === 'running'); }
  function maybeQuit() { if (ctx.helperActive() || ctx.mainOpen() || anyVisible() || busy() || collectBuf.length) return; app.quit(); }

  const api = { collect, showRadial, hideRadial, runPick, onJobUpdate, showBubble, hideBubble, startHelper, applyHotkey, applyLogin, onHotkey, maybeQuit, explorerSelection, expand,
    _windows: () => ({ radial, toast, bubble, tray }), _log: wlog, _tracked: tracked, _files: () => radialFiles, _set: (x) => saveSettings(x) };
  return api;
};
