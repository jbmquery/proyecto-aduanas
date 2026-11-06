/** Enrutamiento SPA (hash) y renderizado dinámico de vistas. Cada vista declara su configuración en un <script type="application/json">. */
const App = (() => {
  const esc = UI.esc;
  const viewRoot = () => document.getElementById('view-root');
  const cache = {};
  let navId = 0;

  const ROUTES = {
    dashboard:     { view: 'views/dashboard.html',     init: initDashboard },
    clientes:      { view: 'views/clientes.html',      init: root => CRUD.mount({ ...getCfg(root), root: root.querySelector('#crud-root') }) },
    calendario:    { view: 'views/calendario.html',    init: initCalendario },
    ventas:        { view: 'views/ventas.html',        init: initVentas },
    importaciones: { view: 'views/importaciones.html', init: initImportaciones }
  };

  async function loadView(path) {
    if (!cache[path]) {
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) throw new Error('No se pudo cargar ' + path + ' (¿está sirviendo la carpeta con un servidor web?)');
      cache[path] = await r.text();
    }
    return cache[path];
  }
  const getCfg = root => { const el = root.querySelector('script[type="application/json"]'); return el ? JSON.parse(el.textContent) : {}; };

  function setShell(logged) {
    document.getElementById('topbar').classList.toggle('hidden', !logged);
    if (logged) document.getElementById('user-chip').textContent = `${Auth.current().usuario} · ${Auth.current().rol}`;
  }

  async function showLogin() {
    setShell(false);
    const root = viewRoot();
    root.innerHTML = await loadView('views/login.html');
    Auth.bindLogin(root.querySelector('form'), () => navigate());
  }

  async function navigate() {
    const id = ++navId;
    const route = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
    if (!Auth.guard(route === 'login' ? 'login' : route) || !Auth.current()) return showLogin();
    setShell(true);
    const def = ROUTES[route] || ROUTES.dashboard;
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('bg-blue-700', a.dataset.route === (ROUTES[route] ? route : 'dashboard')));
    const root = viewRoot();
    root.innerHTML = '<p class="py-10 text-center text-slate-400">Cargando…</p>';
    try {
      const html = await loadView(def.view);
      if (id !== navId) return;
      root.innerHTML = html;
      await def.init(root);
    } catch (e) { if (id === navId) root.innerHTML = `<div class="rounded-lg bg-red-50 p-4 text-red-700">${esc(e.message)}</div>`; }
  }

  /* ---------------- Dashboard ---------------- */
  async function initDashboard(root) {
    try {
      const s = await Api.stats();
      Object.entries(s.kpis).forEach(([k, v]) => { const el = root.querySelector(`[data-kpi="${k}"]`); if (el) el.textContent = v; });
      const style = { critico: 'border-red-300 bg-red-50 text-red-800', atencion: 'border-amber-300 bg-amber-50 text-amber-800', info: 'border-sky-200 bg-sky-50 text-sky-800' };
      root.querySelector('#alert-list').innerHTML = s.alertas.length ? s.alertas.map(a => `
        <div class="rounded-lg border px-3 py-2 text-sm ${style[a.nivel]}"><div class="flex justify-between gap-2"><b>${esc(a.tipo)}</b><span class="text-xs">${esc(a.fecha)}</span></div>
        <div>${esc(a.ref)}</div><div class="text-xs opacity-80">${esc(a.mensaje)}</div></div>`).join('')
        : '<p class="text-sm text-slate-400">Sin alertas por ahora ✅</p>';
      root.querySelector('#arribos').innerHTML = s.proximosArribos.length ? s.proximosArribos.map(a => `
        <tr><td class="whitespace-nowrap">${esc(a.fecha)}</td><td>${esc(a.cliente)}</td><td>${esc(a.puerto)}</td><td>${UI.badge(a.estado)}</td><td class="text-xs">${esc(a.ref)}</td></tr>`).join('')
        : '<tr><td colspan="5" class="p-4 text-center text-slate-400">Sin arribos en los próximos 14 días</td></tr>';
    } catch (e) { UI.toast(e.message, 'err'); }
  }

  /* ---------------- Calendario ---------------- */
  function initCalendario(root) {
    const cfg = getCfg(root), grid = root.querySelector('#cal-grid');
    let cur = new Date(); cur.setDate(1);
    let rows = [], ctx = null;
    const chip = e => /arribad|descargad|entregad/i.test(e) ? 'bg-emerald-100 text-emerald-800' : /retras|observ/i.test(e) ? 'bg-red-100 text-red-800'
      : /tr[aá]nsito|levante|descarga/i.test(e) ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800';
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    function draw() {
      const y = cur.getFullYear(), m = cur.getMonth(), offset = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), today = iso(new Date());
      const by = {}; rows.forEach(r => (by[r['Fecha de Llegada']] = by[r['Fecha de Llegada']] || []).push(r));
      let cells = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="cal-h">${d}</div>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = new Date(y, m, 1 - offset + i), key = iso(d), off = d.getMonth() !== m;
        cells += `<div class="cal-d ${off ? 'off' : ''} ${key === today ? 'today' : ''}" data-date="${key}"><div class="font-semibold">${d.getDate()}</div>
          ${(by[key] || []).map(r => `<button type="button" class="cal-chip ${chip(r.Estado)}" data-id="${esc(r.ID_Evento)}" title="${esc(r.Cliente + ' · ' + r.Estado)}">${esc(r.Puerto)} · ${esc(r.Cliente)}</button>`).join('')}</div>`;
      }
      root.querySelector('#cal-title').textContent = cur.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
      grid.innerHTML = cells;
    }
    grid.addEventListener('click', e => {
      const b = e.target.closest('.cal-chip');
      if (b) { const r = rows.find(x => x.ID_Evento === b.dataset.id); if (r && Auth.can('write')) ctx.edit(r); return; }
      const d = e.target.closest('[data-date]');
      if (d && Auth.can('write')) ctx.create({ 'Fecha de Llegada': d.dataset.date });
    });
    root.querySelector('#cal-prev').onclick = () => { cur.setMonth(cur.getMonth() - 1); draw(); };
    root.querySelector('#cal-next').onclick = () => { cur.setMonth(cur.getMonth() + 1); draw(); };
    root.querySelector('#cal-today').onclick = () => { cur = new Date(); cur.setDate(1); draw(); };
    return CRUD.mount({ ...cfg, root: root.querySelector('#crud-root'), onLoad: (r, c) => { rows = r; ctx = c; draw(); } });
  }

  /* ---------------- Ventas / Despachos + comprobantes ---------------- */
  function initVentas(root) {
    const cfg = getCfg(root);
    return CRUD.mount({
      ...cfg, root: root.querySelector('#crud-root'),
      actions: [
        { label: 'Comprobante', icon: '🧾', title: 'Emitir / ver comprobantes (simulado)', write: true, onClick: row => emitDialog(row) },
        { label: 'Docs', icon: '📎', title: 'Documentos en Drive', onClick: row => Docs.open({ operacion: row['DAM'] || row['N° de Orden'] }) }
      ],
      onFormOpen: (form, row, ctx) => {
        const sel = form.querySelector('[data-key="N° de Cliente"]');
        const info = document.createElement('div'); info.className = 'mt-1 text-xs';
        sel.parentElement.appendChild(info);
        const check = async () => {
          const cli = ctx.refRows('clientes').find(c => c.ID_Cliente === sel.value);
          info.innerHTML = '';
          if (!cli) return;
          const doc = cli['RUC / DNI'];
          if (doc.length !== 11) { info.innerHTML = '<span class="text-slate-500">Cliente con DNI: no requiere validación SUNAT.</span>'; return; }
          info.textContent = 'Consultando SUNAT (simulado)…';
          try { const r = await Api.sunatRuc(doc); info.innerHTML = `${UI.badge(r.apto ? 'ACTIVO / HABIDO' : 'NO APTO')} <span class="${r.apto ? 'text-emerald-700' : 'text-red-700'}">${esc(r.mensaje)}</span>`; }
          catch (e) { info.innerHTML = `<span class="text-red-700">${esc(e.message)}</span>`; }
        };
        sel.addEventListener('change', check); if (sel.value) check();
      }
    });
  }

  async function emitDialog(row) {
    let cli, sun = null, prev = [];
    try {
      cli = (await Api.list('clientes')).find(c => c.ID_Cliente === row['N° de Cliente']);
      if (!cli) return UI.toast('El cliente de esta orden no existe.', 'err');
      if (cli['RUC / DNI'].length === 11) { try { sun = await Api.sunatRuc(cli['RUC / DNI']); } catch (e) { sun = { apto: false, mensaje: e.message }; } }
      prev = await Api.comprobantes(row['N° de Orden']);
    } catch (e) { return UI.toast(e.message, 'err'); }
    const doc = cli['RUC / DNI'], esRuc = doc.length === 11, blocked = esRuc && !(sun && sun.apto);
    const m = UI.modal({
      title: `Comprobante · ${row['N° de Orden']}`, size: 'max-w-3xl',
      body: `<div class="mb-3 rounded-lg border bg-slate-50 p-3 text-sm"><b>${esc(cli['Nombre / Empresa'])}</b> · ${esRuc ? 'RUC' : 'DNI'} ${esc(doc)}
          ${sun ? `<div class="mt-1">${UI.badge(sun.apto ? 'ACTIVO / HABIDO' : 'NO APTO')} <span class="text-xs">${esc(sun.mensaje)}</span></div>` : ''}</div>
        ${prev.length ? `<div class="mb-3 text-sm"><b>Emitidos:</b> ${prev.map((p, i) => `<button type="button" class="icon-btn" data-prev="${i}">${esc(p.serie)}-${esc(p.numero)}</button>`).join(' ')}</div>` : ''}
        ${blocked ? '<div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">No se puede emitir: el RUC debe estar ACTIVO y HABIDO.</div>' : `
        <div class="mb-3 grid gap-3 sm:grid-cols-2">
          <div><label class="lbl">Tipo</label><select data-tipo class="inp"><option value="FACTURA" ${esRuc ? '' : 'disabled'}>Factura</option><option value="BOLETA">Boleta</option></select></div>
          <div><label class="lbl">Moneda</label><select data-mon class="inp"><option value="USD">US$ Dólares</option><option value="PEN">S/ Soles</option></select></div></div>
        <table class="tbl w-full text-sm"><thead><tr><th>Descripción</th><th class="w-24">Cant.</th><th class="w-32">P. Unit. (sin IGV)</th><th></th></tr></thead><tbody data-items></tbody></table>
        <div class="mt-2 flex items-center justify-between"><button type="button" data-add class="btn-secondary">+ Ítem</button>
          <div class="text-right text-sm">Subtotal <b data-sub>0.00</b> · IGV 18% <b data-igv>0.00</b> · Total <b data-tot class="text-base">0.00</b></div></div>
        <div data-err class="mt-3 hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"></div>`}`,
      footer: `<button type="button" data-close class="btn-secondary">Cerrar</button>${blocked ? '' : '<button type="button" data-emit class="btn-primary">Emitir (simulado)</button>'}`
    });
    m.footer.querySelector('[data-close]').onclick = m.close;
    m.body.querySelectorAll('[data-prev]').forEach(b => (b.onclick = () => Comprobante.preview(prev[+b.dataset.prev])));
    if (blocked) return;
    const tb = m.body.querySelector('[data-items]'), q = s => m.body.querySelector(s);
    const calc = () => {
      let sub = 0; tb.querySelectorAll('tr').forEach(tr => { sub += (+tr.querySelector('[data-q]').value || 0) * (+tr.querySelector('[data-p]').value || 0); });
      q('[data-sub]').textContent = sub.toFixed(2); q('[data-igv]').textContent = (sub * 0.18).toFixed(2); q('[data-tot]').textContent = (sub * 1.18).toFixed(2);
    };
    const addRow = (d = '') => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input data-d class="inp" maxlength="200" value="${esc(d)}" placeholder="Servicio / concepto"></td><td><input data-q type="number" min="0" step="any" class="inp" value="1"></td>
        <td><input data-p type="number" min="0" step="any" class="inp" value="0"></td><td><button type="button" class="icon-btn" data-rm>✕</button></td>`;
      tr.querySelector('[data-rm]').onclick = () => { if (tb.children.length > 1) { tr.remove(); calc(); } };
      tr.addEventListener('input', calc); tb.appendChild(tr);
    };
    addRow(`Servicio de gestión aduanera – Orden ${row['N° de Orden']}`);
    q('[data-add]').onclick = () => addRow();
    m.footer.querySelector('[data-emit]').onclick = async function () {
      const err = q('[data-err]'); err.classList.add('hidden');
      const items = [...tb.querySelectorAll('tr')].map(tr => ({ descripcion: tr.querySelector('[data-d]').value, cantidad: tr.querySelector('[data-q]').value, precio: tr.querySelector('[data-p]').value }));
      this.disabled = true; this.textContent = 'Emitiendo…';
      try {
        const c = await Api.emitir({ orden: row['N° de Orden'], clienteId: cli.ID_Cliente, tipo: q('[data-tipo]').value, moneda: q('[data-mon]').value, items });
        m.close(); UI.toast(`${c.tipo} ${c.serie}-${c.numero} emitida (simulado)`, 'ok'); Comprobante.preview(c);
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); this.disabled = false; this.textContent = 'Emitir (simulado)'; }
    };
  }

  /* ---------------- Importaciones / Servicio integral ---------------- */
  function initImportaciones(root) {
    const cfg = getCfg(root);
    return CRUD.mount({
      ...cfg, root: root.querySelector('#crud-root'),
      actions: [{
        label: 'Docs', icon: '📎', title: 'Documentos del expediente (Drive)',
        onClick: (row, ctx) => Docs.open({
          operacion: row['DAM'] || row['N° de Ítem'],
          onUploaded: async url => {
            const K = 'Referencia (Google Drive URL/ID)';
            if (url && row[K] !== url) { try { await Api.update('servicio', row['N° de Ítem'], { [K]: url }); row[K] = url; ctx.reload(); } catch (e) { UI.toast(e.message, 'err'); } }
          }
        })
      }]
    });
  }

  async function boot() {
    await Auth.restore();
    window.addEventListener('hashchange', navigate);
    window.addEventListener('vuce:session-expired', () => { UI.toast('Su sesión expiró. Inicie sesión nuevamente.', 'warn'); showLogin(); });
    document.getElementById('btn-logout').onclick = async () => { await Auth.logout(); location.hash = '#/login'; showLogin(); };
    navigate();
  }
  return { boot };
})();

document.addEventListener('DOMContentLoaded', App.boot);