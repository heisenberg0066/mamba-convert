'use strict';
// Test-only automation, active only when the MAMBA_RADIAL_* environment variables are set.
//  MAMBA_RADIAL_SCRIPT=<file.js>  run a scripted test: module.exports = async ({controller, app, E}) => ({passed, failed, lines})
//  MAMBA_RADIAL_AUTOPICK=<id>     when the wheel opens, take a screenshot (MAMBA_RADIAL_SHOT), pick <id> (e.g. convert:png),
//                                 wait for the jobs and write {count, files, jobs} to MAMBA_RADIAL_OUT, then quit.
module.exports = function testHooks({ app, controller, E, fs, path }) {
  const env = process.env;
  if (env.MAMBA_RADIAL_SCRIPT) {
    setTimeout(async () => {
      let r; try { r = await require(path.resolve(env.MAMBA_RADIAL_SCRIPT))({ controller, app, E }); } catch (e) { r = { passed: 0, failed: 1, lines: ['FAIL  radial script crashed — ' + (e.stack || e)] }; }
      const txt = r.lines.join('\n') + `\nRADIAL: ${r.passed} passed, ${r.failed} failed\n`; console.log(txt); if (env.MAMBA_RADIAL_OUT) fs.writeFileSync(env.MAMBA_RADIAL_OUT, txt);
      setTimeout(() => process.exit(r.failed ? 1 : 0), 2000); app.exit(r.failed ? 1 : 0);
    }, 600);
    return;
  }
  if (!env.MAMBA_RADIAL_AUTOPICK) return;
  const M = require('./menu'); const orig = controller.showRadial;
  controller.showRadial = async (paths, at, pre) => {
    const ok = await orig(paths, at, pre); if (!ok) return ok;
    const files = controller._files(); const w = controller._windows().radial;
    await new Promise((r) => setTimeout(r, 500));
    if (env.MAMBA_RADIAL_SHOT) { try { fs.writeFileSync(env.MAMBA_RADIAL_SHOT, (await w.webContents.capturePage()).toPNG()); } catch (_) {} }
    const node = M.find(M.menuFor(files).items, env.MAMBA_RADIAL_AUTOPICK);
    const result = { count: files.length, files, pick: env.MAMBA_RADIAL_AUTOPICK, items: M.menuFor(files).items.map((i) => i.id), jobs: [] };
    if (!node || !node.action) { result.error = 'no such menu item'; finish(result); return ok; }
    controller.hideRadial(); const ids = controller.runPick(node.action, files, node.id);
    const t0 = Date.now();
    const tick = setInterval(() => {
      const js = ids.map((id) => controller._tracked.get(id)).filter(Boolean);
      if (js.every((j) => ['done', 'error', 'cancelled'].includes(j.status)) || Date.now() - t0 > 240000) { clearInterval(tick); result.jobs = js.map((j) => ({ status: j.status, outputs: j.outputs, error: j.error })); finish(result); }
    }, 250);
    return ok;
  };
  function finish(result) { const out = env.MAMBA_RADIAL_OUT; if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2)); console.log('radial-autopick: ' + JSON.stringify(result)); setTimeout(() => app.exit(result.error || result.jobs.some((j) => j.status !== 'done') ? 1 : 0), Number(env.MAMBA_RADIAL_LINGER || 1500)); }
};
