/** Gestión de adjuntos (Drive: VUCE_SYSTEM_FILES/<operación>) con previsualización, y vista previa/impresión de comprobantes. */
const Docs = (() => {
  const esc = UI.esc;
  const TIPOS = ['Factura Comercial', 'BL / HBL', 'AWB', 'Packing List', 'Póliza de Seguro', 'Certificado de Origen',
    'Autorización Sanitaria (DIGESA)', 'Comprobante de Pago', 'Aviso de Llegada', 'DAM', 'Otro'];
  const EXT = ['pdf', 'png', 'jpg', 'jpeg', 'xlsx', 'xls', 'csv', 'docx', 'doc'];
  const MAX = 8 * 1024 * 1024;

  const toB64 = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });

  /** open({ operacion, entity, id, onUploaded(folderUrl) }) */
  async function open({ operacion, onUploaded }) {
    if (!operacion) return UI.toast('El registro necesita DAM o N° de operación para crear su carpeta.', 'warn');
    const canW = Auth.can('write');
    const m = UI.modal({
      title: 'Documentos · ' + operacion, size: 'max-w-5xl',
      body: `<div class="grid gap-4 md:grid-cols-5">
        <div class="md:col-span-3">
          ${canW ? `<div class="mb-3 grid gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-3">
            <select data-tipo class="inp">${TIPOS.map(t => `<option>${esc(t)}</option>`).join('')}</select>
            <input data-file type="file" accept=".${EXT.join(',.')}" class="inp sm:col-span-2">
            <button data-up type="button" class="btn-primary sm:col-span-3 justify-center">⬆️ Subir a Drive</button>
            <p class="text-xs text-slate-500 sm:col-span-3">Máx. 8 MB · ${EXT.join(', ')}. Cada carga crea una nueva versión.</p></div>` : ''}
          <div class="overflow-x-auto rounded-lg border"><table class="tbl min-w-full text-sm"><thead><tr><th>Tipo</th><th>Archivo</th><th>v</th><th>Fecha</th><th></th></tr></thead>
            <tbody data-list><tr><td colspan="5" class="p-4 text-center text-slate-400">Cargando…</td></tr></tbody></table></div>
          <p class="mt-2 text-xs" data-folder></p>
        </div>
        <div class="md:col-span-2"><div data-preview class="flex h-80 items-center justify-center rounded-lg border bg-slate-50 p-3 text-center text-sm text-slate-400">Seleccione un documento para previsualizarlo</div></div>
      </div>`,
      footer: '<button type="button" data-close class="btn-secondary">Cerrar</button>'
    });
    m.footer.querySelector('[data-close]').onclick = m.close;
    const list = m.body.querySelector('[data-list]'), prev = m.body.querySelector('[data-preview]');
    let docs = [];

    function preview(d) {
      const ext = (d.Nombre_Archivo.split('.').pop() || '').toLowerCase();
      if (['pdf', 'png', 'jpg', 'jpeg'].includes(ext) && /^[\w-]+$/.test(d.File_ID)) {
        prev.innerHTML = `<iframe class="h-full w-full rounded" src="https://drive.google.com/file/d/${d.File_ID}/preview" title="Vista previa" allow="autoplay"></iframe>`;
      } else {
        prev.innerHTML = `<div>Sin vista previa para .${esc(ext)}<br><a class="text-blue-700 underline" target="_blank" rel="noopener" href="${esc(UI.safeUrl(d.URL))}">Abrir en Drive</a></div>`;
      }
    }
    async function refresh() {
      try {
        const r = await Api.docsList(operacion);
        docs = r.documentos;
        list.innerHTML = docs.length ? docs.map((d, i) => `<tr>
          <td>${esc(d.Tipo_Documento)}</td><td class="max-w-[12rem] truncate" title="${esc(d.Nombre_Archivo)}">${esc(d.Nombre_Archivo)}</td>
          <td>v${esc(d.Version)}</td><td class="whitespace-nowrap text-xs">${esc(d.Fecha)}<br><span class="text-slate-400">${esc(d.Subido_Por)}</span></td>
          <td class="whitespace-nowrap"><button type="button" class="icon-btn" data-v="${i}">👁️ Ver</button>
          <a class="icon-btn" target="_blank" rel="noopener" href="${esc(UI.safeUrl(d.URL))}">Drive</a></td></tr>`).join('')
          : '<tr><td colspan="5" class="p-4 text-center text-slate-400">Aún no hay documentos</td></tr>';
        m.body.querySelector('[data-folder]').innerHTML = r.folderUrl ? `📁 <a class="text-blue-700 underline" target="_blank" rel="noopener" href="${esc(UI.safeUrl(r.folderUrl))}">Abrir carpeta de la operación</a>` : '';
        return r.folderUrl;
      } catch (e) { list.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-600">${esc(e.message)}</td></tr>`; }
    }
    list.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) preview(docs[+b.dataset.v]); });

    const up = m.body.querySelector('[data-up]');
    if (up) up.onclick = async () => {
      const input = m.body.querySelector('[data-file]'), f = input.files[0];
      if (!f) return UI.toast('Seleccione un archivo', 'warn');
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!EXT.includes(ext)) return UI.toast('Tipo de archivo no permitido', 'err');
      if (f.size > MAX) return UI.toast('El archivo supera 8 MB', 'err');
      up.disabled = true; const t = up.textContent; up.textContent = 'Subiendo…';
      try {
        const res = await Api.docsUpload({ operacion, tipoDoc: m.body.querySelector('[data-tipo]').value, nombre: f.name, base64: await toB64(f) });
        UI.toast('Documento subido (v' + res.documento.Version + ')', 'ok');
        input.value = '';
        await refresh(); preview(res.documento);
        if (onUploaded) onUploaded(res.folderUrl);
      } catch (e) { UI.toast(e.message, 'err'); }
      finally { up.disabled = false; up.textContent = t; }
    };
    await refresh();
  }
  return { open, TIPOS };
})();

/** Comprobante electrónico SIMULADO: vista previa lista para imprimir con QR. */
const Comprobante = (() => {
  const esc = UI.esc, fmt = n => Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function html(c) {
    const mon = c.moneda === 'PEN' ? 'S/' : 'US$';
    return `<div class="comp"><div class="wm">SIMULADO</div>
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
        <div><div style="font-size:16px;font-weight:700">${esc(c.emisor.razon)}</div><div>${esc(c.emisor.direccion)}</div></div>
        <div class="box"><div>R.U.C. ${esc(c.emisor.ruc)}</div><div style="font-weight:700;margin:4px 0">${esc(c.tipo)} ELECTRÓNICA</div><div>${esc(c.serie)}-${esc(c.numero)}</div></div>
      </div>
      <table style="margin:12px 0"><tr><td><b>Cliente:</b> ${esc(c.cliente.nombre)}</td><td><b>${esc(c.cliente.tipoDoc)}:</b> ${esc(c.cliente.doc)}</td></tr>
        <tr><td><b>Dirección:</b> ${esc(c.cliente.direccion || '—')}</td><td><b>Fecha de emisión:</b> ${esc(c.fecha)}</td></tr>
        <tr><td><b>Operación / Orden:</b> ${esc(c.orden || '—')}</td><td><b>Moneda:</b> ${esc(c.moneda)}</td></tr></table>
      <table><thead><tr><th>Cant.</th><th>Descripción</th><th>P. Unit.</th><th>Importe</th></tr></thead><tbody>
        ${c.items.map(i => `<tr><td class="r">${esc(i.cantidad)}</td><td>${esc(i.descripcion)}</td><td class="r">${fmt(i.precio)}</td><td class="r">${fmt(i.total)}</td></tr>`).join('')}</tbody></table>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:12px">
        <div><div data-qr style="width:112px;height:112px"></div><div style="font-size:9px;margin-top:4px;max-width:260px;word-break:break-all">Hash (simulado): ${esc(c.hash)}</div></div>
        <table style="width:240px"><tr><td>Op. gravada</td><td class="r">${mon} ${fmt(c.subtotal)}</td></tr><tr><td>IGV (18%)</td><td class="r">${mon} ${fmt(c.igv)}</td></tr>
          <tr><th>TOTAL</th><th class="r">${mon} ${fmt(c.total)}</th></tr></table></div>
      <p style="margin-top:10px;font-size:10px;color:#666">Estado: ${esc(c.estado)} · Representación impresa de demostración. No tiene validez tributaria ante SUNAT.</p></div>`;
  }
  function drawQr(el, text) {
    el.innerHTML = '';
    if (window.QRCode) new QRCode(el, { text, width: 112, height: 112, correctLevel: QRCode.CorrectLevel.M });
    else el.textContent = '[QR]';
  }
  function print(c) {
    const pa = document.getElementById('print-area');
    pa.innerHTML = html(c); drawQr(pa.querySelector('[data-qr]'), c.qr);
    window.onafterprint = () => { pa.innerHTML = ''; window.onafterprint = null; };
    setTimeout(() => window.print(), 300); // espera a que el QR se dibuje
  }
  function preview(c) {
    const m = UI.modal({
      title: `${c.tipo} electrónica ${c.serie}-${c.numero}`, size: 'max-w-3xl', body: html(c),
      footer: '<button type="button" data-close class="btn-secondary">Cerrar</button><button type="button" data-print class="btn-primary">🖨️ Imprimir</button>'
    });
    drawQr(m.body.querySelector('[data-qr]'), c.qr);
    m.footer.querySelector('[data-close]').onclick = m.close;
    m.footer.querySelector('[data-print]').onclick = () => print(c);
  }
  return { preview, print };
})();
