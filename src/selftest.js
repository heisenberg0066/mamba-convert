'use strict';
// Built-in smoke test: "Mamba Convert.exe --self-test" (writes mamba-selftest.txt into %TEMP%\mamba-selftest).
const path = require('path'); const fs = require('fs'); const os = require('os');
module.exports = async function selfTest(E, outDir) {
  outDir = outDir || path.join(os.tmpdir(), 'mamba-selftest'); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  const sharp = require('sharp'); const { PDFDocument, StandardFonts } = require('pdf-lib');
  const lines = []; const ok = async (name, fn) => { try { const r = await fn(); lines.push(`PASS ${name} ${[].concat(r || []).map((f) => path.basename(f) + ':' + fs.statSync(f).size).join(' ')}`); } catch (e) { lines.push(`FAIL ${name} ${e.message}`); } };
  lines.push(`ffmpeg=${E.util.config.ffmpeg}`, `sharp=${JSON.stringify(sharp.versions)}`);
  const png = path.join(outDir, 't.png'); await sharp({ create: { width: 320, height: 200, channels: 3, background: '#ff8800' } }).png().toFile(png);
  const pdf = path.join(outDir, 't.pdf'); const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); d.addPage([300, 300]).drawText('hello', { x: 20, y: 200, size: 30, font: f }); fs.writeFileSync(pdf, await d.save());
  const mp4 = path.join(outDir, 't.mp4');
  await ok('ffmpeg testsrc→mp4', async () => { await E.util.ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4]); return mp4; });
  await ok('png→jpg', () => E.runJob({ type: 'convert', files: [png], target: 'jpg' }));
  await ok('png→webp', () => E.runJob({ type: 'convert', files: [png], target: 'webp' }));
  await ok('png→avif', () => E.runJob({ type: 'convert', files: [png], target: 'avif' }));
  await ok('mp4→mp3', () => E.runJob({ type: 'convert', files: [mp4], target: 'mp3' }));
  await ok('mp4→gif', () => E.runJob({ type: 'convert', files: [mp4], target: 'gif' }));
  await ok('pdf→png (mupdf)', () => E.runJob({ type: 'convert', files: [pdf], target: 'png' }));
  await ok('merge pdf', () => E.runJob({ type: 'tool', tool: 'merge-pdf', files: [pdf, pdf] }));
  await ok('images→pdf', () => E.runJob({ type: 'tool', tool: 'images-to-pdf', files: [png, png] }));
  await ok('pdf→flipbook', () => E.runJob({ type: 'convert', files: [pdf], target: 'flipbook' }));
  const md = path.join(outDir, 't.md'); fs.writeFileSync(md, '# Hi\n\nمرحبا');
  await ok('md→pdf (chromium)', () => E.runJob({ type: 'convert', files: [md], target: 'pdf' }));
  const report = path.join(outDir, 'mamba-selftest.txt'); fs.writeFileSync(report, lines.join('\n') + '\n');
  return { report, lines, passed: lines.filter((l) => l.startsWith('PASS')).length, failed: lines.filter((l) => l.startsWith('FAIL')).length };
};
