'use strict';
// Detects Mamba Reader (installed exe, MAMBA_READER_PATH, or a registered mamba-reader:// / reader:// protocol) and hands a file to it.
const fs = require('fs');
const path = require('path');
module.exports = ({ app, shell }) => {
const READER_PROTOCOLS = ['mamba-reader', 'reader'];
  function findReader() {
    const env = process.env.MAMBA_READER_PATH;
    if (env && fs.existsSync(env)) return { exe: env };
    if (process.platform === 'win32') {
      const la = process.env.LOCALAPPDATA || '', pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || '';
      const names = ['Mamba Reader', 'mamba-reader', 'MambaReader'];
      const cands = [];
      for (const n of names) { cands.push(path.join(la, 'Programs', n, 'Mamba Reader.exe'), path.join(pf, n, 'Mamba Reader.exe')); if (pf86) cands.push(path.join(pf86, n, 'Mamba Reader.exe')); }
      cands.push(path.join(path.dirname(process.execPath), '..', 'Mamba Reader', 'Mamba Reader.exe'), path.join(path.dirname(process.execPath), 'Mamba Reader.exe'));
      for (const c of cands) if (fs.existsSync(c)) return { exe: c };
    }
    for (const p of READER_PROTOCOLS) { try { const n = app.getApplicationNameForProtocol(`${p}://`); if (n && !/mamba convert/i.test(n)) return { protocol: p, name: n }; } catch (_) {} }
    return null;
  }
  function openInReader(file) {
    const r = findReader(); if (!r) return { ok: false, error: 'Mamba Reader is not installed' };
    if (r.exe) { require('child_process').spawn(r.exe, [file], { detached: true, stdio: 'ignore' }).unref(); return { ok: true, via: 'exe' }; }
    shell.openExternal(`${r.protocol}://open?path=${encodeURIComponent(file)}`); return { ok: true, via: r.protocol };
  }
  return { findReader, openInReader, READER_PROTOCOLS };
};
