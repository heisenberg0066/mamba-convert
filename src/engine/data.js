'use strict';
const { outPath, fsp, ext, base } = require('./util');

function parseDelimited(text, delim) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
const cell = (v, d) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /["\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s; };

async function convert(file, fmt, o = {}) {
  const e = ext(file); const text = (await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  let records;
  if (e === 'json') { let j = JSON.parse(text); if (!Array.isArray(j)) j = Array.isArray(Object.values(j)[0]) ? Object.values(j)[0] : [j]; records = j.map((r) => (r && typeof r === 'object' ? r : { value: r })); }
  else { const rows = parseDelimited(text, e === 'tsv' ? '\t' : (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',')); const h = rows.shift() || []; records = rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))); }
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  let out;
  if (fmt === 'json') out = JSON.stringify(records, null, 2);
  else if (fmt === 'csv' || fmt === 'tsv') { const d = fmt === 'tsv' ? '\t' : ','; out = '\uFEFF' + [headers.map((h) => cell(h, d)).join(d), ...records.map((r) => headers.map((h) => cell(r[h], d)).join(d))].join('\r\n'); }
  else if (fmt === 'html') { const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); out = `<!doctype html><meta charset="utf-8"><title>${esc(base(file))}</title><style>table{border-collapse:collapse;font-family:Segoe UI,Arial}td,th{border:1px solid #ccc;padding:4px 8px}th{background:#f3f3f3}</style><table dir="auto"><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${records.map((r) => `<tr>${headers.map((h) => `<td>${esc(typeof r[h] === 'object' ? JSON.stringify(r[h]) : r[h])}</td>`).join('')}</tr>`).join('')}</table>`; }
  else throw new Error(`Unsupported: ${e} → ${fmt}`);
  const dest = o.dest || outPath(file, fmt, o);
  await fsp.writeFile(dest, out, 'utf8'); return dest;
}
module.exports = { convert, parseDelimited };
