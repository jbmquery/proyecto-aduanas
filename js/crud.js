/** Utilidades de UI (modales, confirmación, toasts) + controlador CRUD genérico para tablas dinámicas. */
const UI = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = { ok: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-800', bad: 'bg-red-100 text-red-800', mute: 'bg-slate-100 text-slate-700' };

  function badge(text) {
    if (!text) return '';
    const t = String(text).toLowerCase();
    let c = 'mute';
    if (/^(s[ií]$|entregado|conforme|activo|habido|arribad|verde|aceptado|cerrado)/.test(t)) c = 'ok';
    else if (/(pendiente|tr[aá]nsito|programad|naranja|descarga|levante)/.test(t)) c = 'warn';
    else if (/(^no|rojo|retras|observad|baja|cr[ií]tic|vencid)/.test(t)) c = 'bad';
    return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[c]}">${esc(text)}</span>`;
  }
  const safeUrl = u => (/^https:\/\/(drive|docs)\.google\.com\//.test(u) ? u : '#');

  function toast(msg, type = 'info') {
    const col = { ok: 'bg-emerald-600', err: 'bg-red-600', warn: 'bg-amber-600', info: 'bg-slate-800' }[type] || 'bg-slate-800';
    const el = document.createElement('div');
    el.className = `toast ${col} rounded-lg px-4 py-2 text-sm text-white shadow-lg`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  let stack = [];
  /** Crea un modal. body/footer: string HTML o Node. Devuelve { el, body, footer, close }. */
  function modal({ title, body = '', footer = '', size = 'max-w-2xl', onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 modal-fade';
    wrap.innerHTML = `<div class="modal-pop my-6 w-full ${size} rounded-xl bg-white shadow-2xl" role="dialog" aria-modal="true">
      <div class="flex items-center justify-between border-b px-5 py-3">
        <h3 class="text-base font-semibold text-slate-800">${esc(title)}</h3>
        <button type="button" data-close class="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Cerrar">&times;</button>
      </div>
      <div data-body class="px-5 py-4"></div>
      <div data-footer class="flex flex-wrap justify-end gap-2 rounded-b-xl border-t bg-slate-50 px-5 py-3"></div></div>`;
    const b = wrap.querySelector('[data-body]'), f = wrap.querySelector('[data-footer]');
    typeof body === 'string' ? (b.innerHTML = body) : b.appendChild(body);
    typeof footer === 'string' ? (f.innerHTML = footer) : f.appendChild(footer);
    if (!footer) f.classList.add('hidden');
    const onKey = e => { if (e.key === 'Escape' && stack[stack.length - 1] === close) close(); };
    function close() {
      if (!wrap.isConnected) return;
      wrap.remove(); document.removeEventListener('keydown', onKey);
      stack = stack.filter(x => x !== close);
      if (onClose) onClose();
    }
    stack.push(close); document.addEventListener('keydown', onKey);
    wrap.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
    document.getElementById('modal-root').appendChild(wrap);
    return { el: wrap, body: b, footer: f, close };
  }

  /** Diálogo de confirmación. Devuelve Promise<boolean>. */
  function confirm({ title = 'Confirmar acción', message, detail = '', confirmText = 'Eliminar', danger = true }) {
    return new Promise(resolve => {
      let done = false;
      const fin = v => { if (!done) { done = true; resolve(v); } };
      const m = modal({
        title, size: 'max-w-md', onClose: () => fin(false),
        body: `<div class="flex gap-3"><div class="text-3xl">${danger ? '⚠️' : '❓'}</div><div>
          <p class="font-medium text-slate-800">${esc(message)}</p>${detail ? `<p class="mt-1 text-sm text-slate-500">${esc(detail)}</p>` : ''}</div></div>`,
        footer: `<button type="button" data-no class="btn-secondary">Cancelar</button>
                 <button type="button" data-yes class="${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmText)}</button>`
      });
      m.footer.querySelector('[data-no]').onclick = () => { fin(false); m.close(); };
      m.footer.querySelector('[data-yes]').onclick = () => { fin(true); m.close(); };
    });
  }
  return { esc, badge, safeUrl, toast, modal, confirm };
})();

/**
 * CRUD.mount({ root, entity, title, idKey, fields, actions, onLoad, onFormOpen, onBeforeSave })
 * fields: [{ k, l, t, r, tb, g, o, ref:{entity,value,label[]}, ro, ph, pattern, fmt }]
 *   k=clave/cabecera · l=etiqueta · t=tipo input · r=requerido · tb=columna en tabla · g=sección del formulario
 *   o=opciones · ref=lista dependiente de otra entidad · ro=solo lectura · fmt=badge|link|money
 */
const CRUD = (() => {
  async function mount(cfg) {
    const root = cfg.root, esc = UI.esc;
    const st = { rows: [], q: '', refs: {} };
    const canW = Auth.can('write'), canD = Auth.can('delete');
    const cols = cfg.fields.filter(f => f.tb);
    const acts = (cfg.actions || []).filter(a => !a.write || canW);

    root.innerHTML = `
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-xl font-semibold text-slate-800">${esc(cfg.title)}</h2><p class="text-sm text-slate-500" data-count></p></div>
        <div class="flex flex-wrap items-center gap-2">
          <input data-q type="search" placeholder="Buscar…" class="inp w-56">
          ${canW ? '<button type="button" data-new class="btn-primary">+ Nuevo</button>' : ''}
        </div>
      </div>
      <div class="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table class="tbl min-w-full text-sm"><thead><tr>
          ${cols.map(f => `<th>${esc(f.l || f.k)}</th>`).join('')}<th class="text-right">Acciones</th></tr></thead>
          <tbody data-body><tr><td colspan="${cols.length + 1}" class="p-6 text-center text-slate-400">Cargando…</td></tr></tbody></table>
      </div>`;
    const tbody = root.querySelector('[data-body]'), count = root.querySelector('[data-count]');

    const refRows = e => st.refs[e] || [];
    const refLabel = (f, v) => {
      const r = refRows(f.ref.entity).find(x => x[f.ref.value] === v);
      return r && f.ref.value !== f.ref.label[0] ? `${v} · ${r[f.ref.label[0]]}` : v;
    };
    const cell = (f, row) => {
      const v = row[f.k];
      if (f.fmt === 'badge') return UI.badge(v);
      if (f.fmt === 'link') return v ? `<a class="text-blue-700 underline" target="_blank" rel="noopener" href="${esc(UI.safeUrl(v))}">Abrir carpeta</a>` : '<span class="text-slate-300">—</span>';
      if (f.fmt === 'money') return v === '' ? '' : Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2 });
      if (f.ref) return esc(refLabel(f, v));
      return esc(v);
    };

    function draw() {
      const q = st.q.trim().toLowerCase();
      const rows = st.rows.filter(r => !q || Object.values(r).join(' ').toLowerCase().includes(q));
      count.textContent = `${rows.length} de ${st.rows.length} registros`;
      if (!rows.length) { tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="p-8 text-center text-slate-400">Sin registros</td></tr>`; return; }
      tbody.innerHTML = rows.map(r => {
        const id = esc(r[cfg.idKey]);
        const extra = acts.filter(a => !a.show || a.show(r)).map((a, i) => `<button type="button" class="icon-btn" title="${esc(a.title || a.label)}" data-act="x${cfg.actions.indexOf(a)}" data-id="${id}">${a.icon || ''} ${esc(a.label)}</button>`).join(' ');
        return `<tr>${cols.map(f => `<td>${cell(f, r)}</td>`).join('')}
          <td class="whitespace-nowrap text-right">${extra}
            ${canW ? `<button type="button" class="icon-btn" title="Editar" data-act="edit" data-id="${id}">✏️</button>` : ''}
            ${canD ? `<button type="button" class="icon-btn" title="Eliminar" data-act="del" data-id="${id}">🗑️</button>` : ''}</td></tr>`;
      }).join('');
    }

    async function load() {
      try {
        const need = [...new Set(cfg.fields.filter(f => f.ref).map(f => f.ref.entity))];
        const [rows, ...refs] = await Promise.all([Api.list(cfg.entity), ...need.map(e => Api.list(e))]);
        need.forEach((e, i) => (st.refs[e] = refs[i]));
        st.rows = rows.slice().reverse();
        draw();
        if (cfg.onLoad) cfg.onLoad(st.rows, ctx);
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="p-6 text-center text-red-600">${esc(e.message)}</td></tr>`;
      }
    }

    function fieldHtml(f) {
      const id = 'f_' + Math.random().toString(36).slice(2, 8);
      const attrs = `data-key="${esc(f.k)}" id="${id}"${f.r ? ' required' : ''}${f.ro ? ' disabled' : ''}`;
      let input;
      if (f.t === 'textarea') input = `<textarea ${attrs} rows="2" class="inp"></textarea>`;
      else if (f.o || f.ref) {
        const opts = f.ref ? refRows(f.ref.entity).map(r => [r[f.ref.value], f.ref.label.map(k => r[k]).join(' · ')]) : f.o.map(o => [o, o]);
        input = `<select ${attrs} class="inp"><option value="">— Seleccione —</option>${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;
      } else {
        input = `<input ${attrs} type="${f.t || 'text'}" class="inp" ${f.t === 'number' ? 'step="any" min="0"' : ''} ${f.pattern ? `pattern="${esc(f.pattern)}"` : ''} placeholder="${esc(f.ph || '')}">`;
      }
      return `<div class="${f.t === 'textarea' ? 'md:col-span-2' : ''}"><label for="${id}" class="lbl">${esc(f.l || f.k)}${f.r ? ' <span class="text-red-600">*</span>' : ''}</label>${input}</div>`;
    }

    function openForm(row, defaults = {}) {
      const isNew = !row;
      const groups = [];
      cfg.fields.forEach(f => {
        if (!groups.length || (f.g && f.g !== groups[groups.length - 1].g)) groups.push({ g: f.g || '', fs: [] });
        groups[groups.length - 1].fs.push(f);
      });
      const form = document.createElement('form');
      form.id = 'crud-form'; form.noValidate = false;
      form.innerHTML = `<div data-err class="mb-3 hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"></div>` +
        groups.map(g => `${g.g ? `<h4 class="mb-2 mt-3 border-b pb-1 text-xs font-bold uppercase tracking-wide text-blue-900">${esc(g.g)}</h4>` : ''}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">${g.fs.map(fieldHtml).join('')}</div>`).join('');
      form.querySelectorAll('[data-key]').forEach(el => {
        const v = row ? row[el.dataset.key] : (defaults[el.dataset.key] ?? '');
        if (el.tagName === 'SELECT' && v && ![...el.options].some(o => o.value === v)) el.add(new Option(v, v));
        el.value = v || '';
        if (el.disabled && isNew) el.placeholder = 'Automático';
      });
      const m = UI.modal({
        title: (isNew ? 'Nuevo registro · ' : 'Editar · ') + cfg.title, body: form, size: 'max-w-3xl',
        footer: `<button type="button" data-close class="btn-secondary">Cancelar</button><button type="submit" form="crud-form" data-save class="btn-primary">Guardar</button>`
      });
      m.footer.querySelector('[data-close]').onclick = m.close;
      const errBox = form.querySelector('[data-err]'), save = m.footer.querySelector('[data-save]');
      if (cfg.onFormOpen) cfg.onFormOpen(form, row, ctx);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const data = {};
        form.querySelectorAll('[data-key]:not(:disabled)').forEach(el => (data[el.dataset.key] = el.value.trim()));
        save.disabled = true; const txt = save.textContent; save.textContent = 'Guardando…'; errBox.classList.add('hidden');
        try {
          if (cfg.onBeforeSave) await cfg.onBeforeSave(data, row);
          isNew ? await Api.create(cfg.entity, data) : await Api.update(cfg.entity, row[cfg.idKey], data);
          m.close(); UI.toast(isNew ? 'Registro creado' : 'Registro actualizado', 'ok');
          await load();
        } catch (err) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
        finally { save.disabled = false; save.textContent = txt; }
      });
      return m;
    }

    async function del(row) {
      const ok = await UI.confirm({ message: '¿Está seguro de eliminar este registro?', detail: `${cfg.title} · ${row[cfg.idKey]}. Esta acción no se puede deshacer.` });
      if (!ok) return;
      try { await Api.remove(cfg.entity, row[cfg.idKey]); UI.toast('Registro eliminado', 'ok'); await load(); }
      catch (e) { UI.toast(e.message, 'err'); }
    }

    const ctx = { root, reload: load, edit: openForm, create: d => openForm(null, d), rows: () => st.rows, refRows };
    root.querySelector('[data-q]').addEventListener('input', e => { st.q = e.target.value; draw(); });
    const nb = root.querySelector('[data-new]'); if (nb) nb.onclick = () => openForm(null);
    tbody.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const row = st.rows.find(r => String(r[cfg.idKey]) === b.dataset.id); if (!row) return;
      const a = b.dataset.act;
      if (a === 'edit') openForm(row); else if (a === 'del') del(row);
      else if (a[0] === 'x') cfg.actions[+a.slice(1)].onClick(row, ctx);
    });
    await load();
    return ctx;
  }
  return { mount };
})();
