'use strict';
const { outPath, fsp, base, ext } = require('./util');

let pdfRenderer = null; // (html, destPath) => Promise ; provided by Electron main
function setPdfRenderer(fn) { pdfRenderer = fn; }

let _marked = null;
async function md2html(md) { if (!_marked) _marked = await import('marked'); return _marked.marked.parse(md, { gfm: true }); }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

const CSS = `body{font-family:"Segoe UI",Arial,"Noto Naskh Arabic",sans-serif;max-width:820px;margin:32px auto;padding:0 24px;line-height:1.55;color:#1d1d1f}
pre,code{font-family:Consolas,monospace;background:#f4f4f6;border-radius:4px}pre{padding:12px;overflow:auto;white-space:pre-wrap}code{padding:1px 4px}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}img{max-width:100%}blockquote{border-left:4px solid #ddd;margin:0;padding-left:12px;color:#555}`;
const wrap = (title, body) => /<html[\s>]/i.test(body) ? body : `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body dir="auto">\n${body}\n</body></html>`;

function htmlToText(html) {
  let s = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '\n• ').replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|table|ul|ol)>/gi, '\n\n').replace(/<\/t[dh]>/gi, '\t');
  s = decode(s.replace(/<[^>]+>/g, ''));
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function htmlToMd(html) {
  let s = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${'#'.repeat(+l)} ${t.trim()}\n\n`);
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)').replace(/<img [^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => '\n\n```\n' + c.replace(/<[^>]+>/g, '') + '\n```\n\n').replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1').replace(/<br\s*\/?>/gi, '  \n').replace(/<\/(p|div|ul|ol|blockquote)>/gi, '\n\n');
  s = decode(s.replace(/<[^>]+>/g, ''));
  return s.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Minimal DOCX writer (headings, paragraphs, bullets, bold/italic runs) using JSZip (bundled with mammoth). */
async function htmlToDocx(html) {
  const JSZip = require('jszip');
  const x = (t) => esc(decode(t));
  const runs = (inner) => {
    const out = []; const re = /<(strong|b|em|i)>([\s\S]*?)<\/\1>|([^<]+)|<[^>]+>/gi; let m;
    while ((m = re.exec(inner))) {
      if (m[3]) out.push(`<w:r><w:t xml:space="preserve">${x(m[3])}</w:t></w:r>`);
      else if (m[1]) { const b = /^(strong|b)$/i.test(m[1]); const t = m[2].replace(/<[^>]+>/g, ''); out.push(`<w:r><w:rPr>${b ? '<w:b/>' : '<w:i/>'}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`); }
    }
    return out.join('');
  };
  const body = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  const paras = []; const re = /<(h[1-6]|p|li|pre|blockquote|td|th)[^>]*>([\s\S]*?)<\/\1>/gi; let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    if (tag[0] === 'h' && tag.length === 2) paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading${tag[1]}"/></w:pPr>${runs(m[2])}</w:p>`);
    else if (tag === 'li') paras.push(`<w:p><w:r><w:t xml:space="preserve">• </w:t></w:r>${runs(m[2])}</w:p>`);
    else if (tag === 'pre') m[2].replace(/<[^>]+>/g, '').split('\n').forEach((l) => paras.push(`<w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">${x(l)}</w:t></w:r></w:p>`));
    else paras.push(`<w:p>${runs(m[2])}</w:p>`);
  }
  if (!paras.length) htmlToText(html).split('\n').forEach((l) => paras.push(`<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`));
  const heading = (n, sz) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:style>${heading(1, 36)}${heading(2, 30)}${heading(3, 26)}${heading(4, 24)}${heading(5, 22)}${heading(6, 22)}</w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function toHtml(file) {
  const e = ext(file);
  const raw = e === 'docx' ? null : await fsp.readFile(file, 'utf8');
  if (e === 'md' || e === 'markdown') return wrap(base(file), await md2html(raw));
  if (e === 'txt') return wrap(base(file), `<pre style="white-space:pre-wrap;background:none;font-family:inherit">${esc(raw)}</pre>`);
  if (e === 'docx') { const mammoth = require('mammoth'); const r = await mammoth.convertToHtml({ path: file }); return wrap(base(file), r.value); }
  return raw; // html
}

async function convert(file, fmt, o = {}) {
  const e = ext(file);
  const dest = o.dest || outPath(file, fmt, o);
  if (fmt === 'md' && e === 'txt') { await fsp.copyFile(file, dest); return dest; }
  if (fmt === 'md' && e === 'docx') { const mammoth = require('mammoth'); const h = (await mammoth.convertToHtml({ path: file })).value; await fsp.writeFile(dest, htmlToMd(h)); return dest; }
  const html = await toHtml(file);
  if (fmt === 'html') await fsp.writeFile(dest, html, 'utf8');
  else if (fmt === 'txt') await fsp.writeFile(dest, e === 'md' ? await fsp.readFile(file, 'utf8') : htmlToText(html), 'utf8');
  else if (fmt === 'md') await fsp.writeFile(dest, htmlToMd(html), 'utf8');
  else if (fmt === 'docx') await fsp.writeFile(dest, await htmlToDocx(html));
  else if (fmt === 'pdf') { if (!pdfRenderer) throw new Error('PDF rendering needs the desktop app'); await pdfRenderer(html, dest, o); }
  else throw new Error(`Unsupported: ${e} → ${fmt}`);
  return dest;
}

module.exports = { convert, setPdfRenderer, htmlToText, htmlToMd, htmlToDocx, toHtml };
