'use strict';
let lang = 'en'; const T = (k, v) => rt(lang, k, v); const list = document.getElementById('list');
document.getElementById('x').onclick = () => rapi.send('toast:close');
rapi.on('toast:update', (d) => {
  lang = d.lang || 'en'; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const active = d.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  document.getElementById('title').textContent = active ? `${T('working')} · ${T('jobs', { n: active })}` : T('allDone');
  list.replaceChildren(...d.jobs.map((j) => {
    const e = document.createElement('div'); e.className = 'job ' + j.status;
    const n = document.createElement('div'); n.className = 'n'; n.textContent = j.label; n.title = j.error || (j.outputs || []).join('\n');
    const st = document.createElement('div'); st.className = 'st'; st.textContent = j.status === 'done' ? '✓ ' + T('done') : j.status === 'error' ? '✕ ' + T('failed') : j.status === 'cancelled' ? '—' : Math.round((j.progress || 0) * 100) + '%';
    const bar = document.createElement('div'); bar.className = 'bar'; const b = document.createElement('div'); b.style.width = (j.status === 'done' ? 100 : Math.round((j.progress || 0) * 100)) + '%'; bar.append(b);
    const acts = document.createElement('div'); acts.className = 'acts';
    const btn = (txt, ch, arg) => { const x = document.createElement('button'); x.textContent = txt; x.onclick = () => rapi.send(ch, arg); acts.append(x); };
    if (j.status === 'done' && j.outputs && j.outputs.length) { btn('📁 ' + T('showFolder'), 'toast:show', j.outputs[0]); btn('↗ ' + T('open'), 'toast:open', j.outputs[0]); }
    if (j.status === 'running' || j.status === 'queued') btn(T('cancel'), 'toast:cancel', j.id);
    if (j.status === 'error') { const m = document.createElement('div'); m.className = 'st'; m.style.gridColumn = '1/-1'; m.textContent = j.error; e.append(n, st, bar, m); return e; }
    e.append(n, st, bar, acts); return e;
  }));
});
