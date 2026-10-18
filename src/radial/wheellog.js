'use strict';
// Diagnostic log for the Explorer wheel: %APPDATA%\Mamba Convert\logs\wheel.log (one JSON object per line).
// Rotated to wheel.old.log at 512 KB. Never throws.
const fs = require('fs'); const path = require('path');
module.exports = function wheelLog(app) {
  let file = null;
  const t0 = Date.now();
  function target() {
    if (file) return file;
    try { const dir = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(dir, { recursive: true }); file = path.join(dir, 'wheel.log'); } catch (_) { file = null; }
    return file;
  }
  function stamp() { const d = new Date(); const off = -d.getTimezoneOffset(); const p = (n, w = 2) => String(Math.abs(n)).padStart(w, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`; }
  function log(event, data) {
    const f = target(); if (!f) return;
    try {
      try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f.replace(/\.log$/, '.old.log')); } catch (_) {}
      fs.appendFileSync(f, JSON.stringify({ t: stamp(), ms: Date.now() - t0, pid: process.pid, event, ...(data || {}) }) + '\n');
    } catch (_) {}
  }
  log.path = () => target();
  return log;
};
