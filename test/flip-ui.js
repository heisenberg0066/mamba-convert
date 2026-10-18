// Headless browser check of a generated flipbook: electron test/flip-ui.js <flipbook.html> [shotDir]
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const [file, shots] = process.argv.slice(-2).filter((a) => !a.startsWith('--')).slice(-2);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1300, height: 820, show: true, webPreferences: { backgroundThrottling: false } });
  const errors = []; w.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) errors.push(msg); });
  await w.loadFile(file);
  const js = (s) => w.webContents.executeJavaScript(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (n) => { if (shots) fs.writeFileSync(path.join(shots, n + '.png'), (await w.webContents.capturePage()).toPNG()); };
  const res = {}; await wait(400);
  res.initial = await js('window.__flip.state()'); await shot('1-cover');
  await js('window.__flip.next()'); await wait(300); res.mid = await js('window.__flip.state()'); await shot('2-midflip');
  await wait(600); res.afterNext = await js('window.__flip.state()'); await shot('3-spread');
  await js('window.__flip.next()'); await wait(1000); res.afterNext2 = await js('window.__flip.state()');
  await js('window.__flip.prev()'); await wait(1000); res.afterPrev = await js('window.__flip.state()');
  await js('window.__flip.go(window.__flip.n-1)'); await wait(1000); res.last = await js('window.__flip.state()');
  await js('window.__flip.zoomBy(2)'); await wait(100); res.zoom = await js('window.__flip.state().zoom'); await shot('4-zoom'); await js('window.__flip.setZoom(1)');
  await js('window.__flip.forceSingle=true;window.__flip.layout();window.__flip.go(0,true);window.__flip.next()'); await wait(1000); res.single = await js('window.__flip.state()');
  res.thumbs = await js('document.querySelectorAll(".mf-thumb").length'); res.imgsLoaded = await js('[...document.images].filter(i=>i.complete&&i.naturalWidth>0).length');
  res.errors = errors;
  console.log('FLIPUI ' + JSON.stringify(res));
  app.exit(0);
});
