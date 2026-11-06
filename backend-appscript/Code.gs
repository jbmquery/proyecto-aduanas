/**
 * VUCE Demo – API REST sobre Google Apps Script (Web App).
 * Despliegue: Implementar > Nueva implementación > Aplicación web
 *   Ejecutar como: Yo | Quién tiene acceso: Cualquier persona
 * La seguridad la da el token de sesión (no la URL). GET no expone datos.
 */
const CFG = {
  VERSION: '1.0.0',
  ROOT_FOLDER: 'VUCE_SYSTEM_FILES',
  SESSION_SECONDS: 6 * 3600,          // máximo permitido por CacheService
  MAX_FILE_BYTES: 8 * 1024 * 1024,
  MAX_FAILS: 5,
  LOCK_SECONDS: 900,
  IGV: 0.18,
  ALLOWED_EXT: { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
    csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' },
  // Datos del emisor del comprobante SIMULADO (confirmar razón social legal exacta)
  EMISOR: { ruc: '20602228810', razon: 'M & V GRUPO LOGISTICO S.A.C.',
    direccion: 'CAL. ALFONSO UGARTE NRO. 262 INT. 10 URB. JORGE CHAVEZ ET. UNO - CALLAO' }
};
const TZ = 'America/Lima';
const ROLES_WRITE = ['ADMIN', 'OPERADOR'];
const ROLES_DELETE = ['ADMIN'];

const ENTITIES = {
  clientes:   { sheet: 'CLIENTES', key: 'ID_Cliente', prefix: 'CLI', required: ['Nombre / Empresa', 'RUC / DNI'], nums: [] },
  calendario: { sheet: 'CALENDARIO_LLEGADAS', key: 'ID_Evento', prefix: 'EVT', required: ['Cliente', 'Fecha de Llegada'], nums: [] },
  ventas:     { sheet: 'REPORTE_VENTAS', key: 'N° de Orden', prefix: 'ORD', required: ['N° de Cliente'], nums: ['Monto CIF'] },
  servicio:   { sheet: 'SERVICIO_INTEGRAL', key: 'N° de Ítem', prefix: 'ITM', required: ['Cliente'], nums: ['CBM', 'Peso Bruto'] }
};

const ACTIONS = {
  'auth.login':               { pub: true, fn: authLogin_ },
  'auth.logout':              { fn: authLogout_ },
  'auth.me':                  { fn: (p, s) => ({ usuario: s.usuario, rol: s.rol }) },
  'crud.list':                { fn: crudList_ },
  'crud.create':              { fn: crudCreate_, roles: ROLES_WRITE },
  'crud.update':              { fn: crudUpdate_, roles: ROLES_WRITE },
  'crud.delete':              { fn: crudDelete_, roles: ROLES_DELETE },
  'sunat.consultarRuc':       { fn: sunatConsultar_ },
  'ventas.emitirComprobante': { fn: emitirComprobante_, roles: ROLES_WRITE },
  'ventas.comprobantes':      { fn: comprobantesDeOrden_ },
  'docs.upload':              { fn: docsUpload_, roles: ROLES_WRITE },
  'docs.list':                { fn: docsList_ },
  'dashboard.stats':          { fn: dashboardStats_ }
};

/* ============================ ENRUTADOR ============================ */
function doGet() { return json_({ ok: true, service: 'VUCE API', version: CFG.VERSION }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'Solicitud inválida', code: 'BAD_REQUEST' }); }
  try {
    return json_({ ok: true, data: route_(req) });
  } catch (err) {
    const code = err.code || 'SERVER_ERROR';
    if (code === 'SERVER_ERROR') console.error(err.stack || err);
    return json_({ ok: false, code: code, error: code === 'SERVER_ERROR' ? 'Error interno del servidor' : err.message });
  }
}

function route_(req) {
  const a = ACTIONS[req && req.action];
  if (!a) fail_('Acción no soportada', 'NOT_FOUND');
  let session = null;
  if (!a.pub) {
    session = getSession_(req.token);
    if (!session) fail_('Sesión inválida o expirada', 'SESSION_EXPIRED');
    if (a.roles && a.roles.indexOf(session.rol) < 0) fail_('No tiene permisos para esta acción', 'FORBIDDEN');
  }
  return a.fn(req.payload || {}, session, req);
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(msg, code) { const e = new Error(msg); e.code = code || 'ERROR'; throw e; }

/* ============================ UTILIDADES ============================ */
function getSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) fail_('Hoja no inicializada: ' + name + '. Ejecute inicializarSistema().', 'SCHEMA');
  return sh;
}
function headersOf_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
function readAll_(name) {
  const sh = sheet_(name), vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  const h = vals[0].map(String), out = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (r.every(c => c === '' || c === null)) continue;
    const o = { _row: i + 1 };
    h.forEach((k, j) => { const v = r[j]; o[k] = v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : (v === null || v === undefined ? '' : String(v)); });
    out.push(o);
  }
  return out;
}
function appendObj_(name, obj) {
  const sh = sheet_(name), h = headersOf_(sh);
  sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(c => obj[c] !== undefined ? String(obj[c]) : '')]);
}
function findRow_(sh, h, keyName, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const vals = sh.getRange(2, h.indexOf(keyName) + 1, n, 1).getValues();
  for (let i = 0; i < n; i++) if (String(vals[i][0]) === String(id)) return i + 2;
  return 0;
}
function withLock_(fn) {
  const l = LockService.getScriptLock();
  if (!l.tryLock(20000)) fail_('El sistema está ocupado, intente nuevamente', 'BUSY');
  try { return fn(); } finally { l.releaseLock(); }
}
function nextId_(rows, key, prefix) {
  let max = 0;
  rows.forEach(r => { const m = String(r[key]).match(/(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  return prefix + ('0000' + (max + 1)).slice(-4);
}
function todayStr_(add) { const d = new Date(); d.setDate(d.getDate() + (add || 0)); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function diffDays_(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }
function isDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s)); }
function round2_(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function audit_(user, accion, entidad, id, detalle) {
  try {
    appendObj_('BITACORA', { Fecha: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), Usuario: user, Accion: accion,
      Entidad: entidad, ID: id, Detalle: String(detalle || '').slice(0, 500) });
  } catch (e) { console.warn('audit', e); }
}

/* ============================ AUTENTICACIÓN ============================ */
// Hash con sal por usuario + pepper (Script Property) + 250 iteraciones SHA-256.
// Apps Script no ofrece bcrypt/argon2: para producción use un IdP (Google Identity, Auth0, etc.).
function hashPassword_(pwd, salt) {
  const pepper = PropertiesService.getScriptProperties().getProperty('PEPPER') || '';
  let h = salt + pepper + pwd;
  for (let i = 0; i < 250; i++) h = sha_(salt + h);
  return salt + '$' + h;
}
function verifyPassword_(pwd, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 2) return false;
  const calc = hashPassword_(pwd, parts[0]).split('$')[1];
  if (calc.length !== parts[1].length) return false;
  let d = 0;
  for (let i = 0; i < calc.length; i++) d |= calc.charCodeAt(i) ^ parts[1].charCodeAt(i);
  return d === 0;
}
/** Ejecutable desde el editor: crearUsuario('maria', 'ClaveSegura123', 'OPERADOR')  (roles: ADMIN | OPERADOR | CONSULTA) */
function crearUsuario(usuario, password, rol) {
  usuario = String(usuario || '').trim().toLowerCase();
  rol = String(rol || 'OPERADOR').toUpperCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuario inválido (3-30: letras, números . _ -)');
  if (['ADMIN', 'OPERADOR', 'CONSULTA'].indexOf(rol) < 0) throw new Error('Rol inválido');
  if (String(password || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  ensurePepper_();
  const rows = readAll_('USUARIOS');
  if (rows.some(r => String(r.Usuario).toLowerCase() === usuario)) throw new Error('El usuario ya existe');
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  appendObj_('USUARIOS', { ID_Usuario: nextId_(rows, 'ID_Usuario', 'USR'), Usuario: usuario, Password_Hash: hashPassword_(password, salt), Rol: rol, Estado: 'ACTIVO' });
}
/** Ejecutable desde el editor: cambiarPassword('admin', 'NuevaClave123') */
function cambiarPassword(usuario, nueva) {
  if (String(nueva || '').length < 8) throw new Error('Mínimo 8 caracteres');
  const sh = sheet_('USUARIOS'), h = headersOf_(sh);
  const row = findRow_(sh, h, 'Usuario', String(usuario).toLowerCase());
  if (!row) throw new Error('Usuario no encontrado');
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  sh.getRange(row, h.indexOf('Password_Hash') + 1).setValue(hashPassword_(nueva, salt));
}

function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function getSession_(token) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const c = CacheService.getScriptCache(), k = 'S_' + sha_(token), raw = c.get(k);
  if (!raw) return null;
  c.put(k, raw, CFG.SESSION_SECONDS); // expiración deslizante
  return JSON.parse(raw);
}
function authLogin_(p) {
  const user = String(p.usuario || '').trim().toLowerCase(), pwd = String(p.password || '');
  if (!user || !pwd) fail_('Ingrese usuario y contraseña', 'VALIDATION');
  const cache = CacheService.getScriptCache(), fk = 'F_' + sha_(user), fails = Number(cache.get(fk) || 0);
  if (fails >= CFG.MAX_FAILS) fail_('Cuenta bloqueada temporalmente. Intente en 15 minutos.', 'LOCKED');
  const u = readAll_('USUARIOS').find(r => String(r.Usuario).toLowerCase() === user);
  const passOk = verifyPassword_(pwd, u ? u.Password_Hash : 'x$' + sha_('dummy')); // tiempo similar si el usuario no existe
  if (!(u && passOk && String(u.Estado).toUpperCase() === 'ACTIVO')) {
    cache.put(fk, String(fails + 1), CFG.LOCK_SECONDS);
    audit_(user, 'LOGIN_FALLIDO', 'USUARIOS', '', '');
    fail_('Credenciales inválidas', 'AUTH');
  }
  cache.remove(fk);
  const token = newToken_(), s = { usuario: u.Usuario, rol: String(u.Rol).toUpperCase(), id: u.ID_Usuario };
  cache.put('S_' + sha_(token), JSON.stringify(s), CFG.SESSION_SECONDS);
  audit_(s.usuario, 'LOGIN', 'USUARIOS', s.id, '');
  return { token: token, usuario: s.usuario, rol: s.rol };
}
function authLogout_(p, s, req) {
  CacheService.getScriptCache().remove('S_' + sha_(req.token));
  audit_(s.usuario, 'LOGOUT', 'USUARIOS', s.id, '');
  return { ok: true };
}

/* ============================ CRUD GENÉRICO ============================ */
function ent_(name) { const e = ENTITIES[name]; if (!e) fail_('Entidad desconocida', 'VALIDATION'); return e; }
function clean_(name, data) {
  const out = {};
  SCHEMA[ENTITIES[name].sheet].forEach(c => { if (data[c] !== undefined && data[c] !== null) out[c] = String(data[c]).trim().slice(0, 2000); });
  return out;
}
function crudList_(p) {
  return readAll_(ent_(p.entity).sheet).map(r => { delete r._row; return r; });
}
function validate_(name, d, old, rows) {
  const e = ENTITIES[name], val = k => d[k] !== undefined ? d[k] : (old ? old[k] : '');
  e.required.forEach(k => { if (!String(val(k) || '').trim()) fail_('Campo obligatorio: ' + k, 'VALIDATION'); });
  Object.keys(d).forEach(k => {
    if (/^Fecha/.test(k) && d[k] && !isDate_(d[k])) fail_('Fecha inválida en «' + k + '» (use AAAA-MM-DD)', 'VALIDATION');
  });
  e.nums.forEach(k => { if (d[k] && (isNaN(Number(d[k])) || Number(d[k]) < 0)) fail_('«' + k + '» debe ser un número ≥ 0', 'VALIDATION'); });
  if (name === 'clientes') {
    const doc = val('RUC / DNI');
    if (!(/^\d{8}$/.test(doc) || rucValido_(doc))) fail_('Documento inválido: DNI (8 dígitos) o RUC válido (11 dígitos con dígito verificador)', 'VALIDATION');
    if (rows.some(r => r['RUC / DNI'] === doc && (!old || r._row !== old._row))) fail_('Ya existe un cliente con ese documento', 'VALIDATION');
    if (d['Correo'] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d['Correo'])) fail_('Correo inválido', 'VALIDATION');
  }
  if (name === 'ventas' && (!old || d['N° de Cliente'] !== old['N° de Cliente'])) checkClienteSunat_(val('N° de Cliente'));
}
function crudCreate_(p, s) {
  const name = p.entity, e = ent_(name), data = clean_(name, p.data || {});
  return withLock_(() => {
    const rows = readAll_(e.sheet);
    validate_(name, data, null, rows);
    data[e.key] = nextId_(rows, e.key, e.prefix);
    if (name === 'clientes') data['Fecha_Creacion'] = todayStr_();
    appendObj_(e.sheet, data);
    audit_(s.usuario, 'CREAR', name, data[e.key], '');
    return { id: data[e.key] };
  });
}
function crudUpdate_(p, s) {
  const name = p.entity, e = ent_(name), data = clean_(name, p.data || {});
  delete data[e.key]; delete data['Fecha_Creacion'];
  return withLock_(() => {
    const sh = sheet_(e.sheet), h = headersOf_(sh), row = findRow_(sh, h, e.key, p.id);
    if (!row) fail_('Registro no encontrado', 'NOT_FOUND');
    const rows = readAll_(e.sheet), old = rows.find(r => r._row === row);
    validate_(name, data, old, rows);
    const merged = Object.assign({}, old, data);
    sh.getRange(row, 1, 1, h.length).setValues([h.map(c => merged[c] !== undefined ? merged[c] : '')]);
    audit_(s.usuario, 'EDITAR', name, p.id, Object.keys(data).filter(k => String(data[k]) !== String(old[k])).join(', '));
    return { id: p.id };
  });
}
function crudDelete_(p, s) {
  const name = p.entity, e = ent_(name);
  return withLock_(() => {
    const sh = sheet_(e.sheet), row = findRow_(sh, headersOf_(sh), e.key, p.id);
    if (!row) fail_('Registro no encontrado', 'NOT_FOUND');
    sh.deleteRow(row);
    audit_(s.usuario, 'ELIMINAR', name, p.id, '');
    return { id: p.id };
  });
}

/* ============================ SUNAT (SIMULADO) ============================ */
function rucValido_(ruc) {
  if (!/^(10|15|16|17|20)\d{9}$/.test(String(ruc))) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let s = 0;
  for (let i = 0; i < 10; i++) s += w[i] * Number(ruc[i]);
  return (11 - (s % 11)) % 10 === Number(ruc[10]);
}
function lookupPadron_(ruc) {
  const r = readAll_('PADRON_SUNAT_SIMULADO').find(x => x.RUC === ruc);
  if (!r) return null;
  delete r._row;
  r.apto = String(r.Estado_Contribuyente).toUpperCase() === 'ACTIVO' && String(r.Condicion_Domicilio).toUpperCase() === 'HABIDO';
  return r;
}
function sunatConsultar_(p) {
  const ruc = String(p.ruc || '').trim();
  if (!rucValido_(ruc)) fail_('RUC inválido (11 dígitos y dígito verificador correcto)', 'VALIDATION');
  const r = lookupPadron_(ruc);
  if (!r) return { encontrado: false, apto: false, ruc: ruc, mensaje: 'El RUC no figura en el padrón SUNAT (simulado).' };
  r.encontrado = true;
  r.mensaje = r.apto ? 'Contribuyente ACTIVO y HABIDO: puede continuar.' : 'Contribuyente ' + r.Estado_Contribuyente + ' / ' + r.Condicion_Domicilio + ': no puede continuar.';
  return r;
}
function checkClienteSunat_(clienteId) {
  const cli = readAll_('CLIENTES').find(c => c.ID_Cliente === clienteId);
  if (!cli) fail_('El cliente ' + clienteId + ' no existe', 'VALIDATION');
  const doc = cli['RUC / DNI'];
  if (doc.length === 11) {
    const pd = lookupPadron_(doc);
    if (!pd || !pd.apto) fail_('SUNAT (simulado): el RUC ' + doc + (pd ? ' figura ' + pd.Estado_Contribuyente + ' / ' + pd.Condicion_Domicilio : ' no figura en el padrón') + '. No se puede continuar.', 'SUNAT_RUC');
  }
  return cli;
}

/* ============================ COMPROBANTES SIMULADOS ============================ */
function emitirComprobante_(p, s) {
  const tipo = String(p.tipo || '').toUpperCase();
  if (['FACTURA', 'BOLETA'].indexOf(tipo) < 0) fail_('Tipo de comprobante inválido', 'VALIDATION');
  const moneda = p.moneda === 'PEN' ? 'PEN' : 'USD';
  const cli = checkClienteSunat_(String(p.clienteId || ''));
  const doc = cli['RUC / DNI'], esRuc = doc.length === 11;
  if (tipo === 'FACTURA' && !esRuc) fail_('La factura requiere un cliente con RUC', 'VALIDATION');
  const pd = esRuc ? lookupPadron_(doc) : null;
  const items = (Array.isArray(p.items) ? p.items : []).slice(0, 40).map(it => {
    const cantidad = Number(it.cantidad), precio = Number(it.precio), descripcion = String(it.descripcion || '').trim().slice(0, 200);
    if (!descripcion || !(cantidad > 0) || isNaN(precio) || precio < 0) fail_('Ítem inválido: revise descripción, cantidad y precio', 'VALIDATION');
    return { descripcion: descripcion, cantidad: cantidad, precio: round2_(precio), total: round2_(cantidad * precio) };
  });
  if (!items.length) fail_('Agregue al menos un ítem', 'VALIDATION');
  const subtotal = round2_(items.reduce((a, i) => a + i.total, 0)), igv = round2_(subtotal * CFG.IGV), total = round2_(subtotal + igv);
  return withLock_(() => {
    const serie = tipo === 'FACTURA' ? 'F001' : 'B001';
    let max = 0;
    readAll_('COMPROBANTES').forEach(r => { if (r.Tipo === tipo && r.Serie === serie) max = Math.max(max, Number(r.Numero) || 0); });
    const numero = ('00000000' + (max + 1)).slice(-8), fecha = todayStr_();
    const hash = sha_([CFG.EMISOR.ruc, tipo, serie, numero, total, fecha].join('|')).slice(0, 32);
    const comp = {
      tipo: tipo, serie: serie, numero: numero, fecha: fecha, moneda: moneda, orden: String(p.orden || ''), hash: hash,
      estado: 'ACEPTADO (SIMULADO)', emisor: CFG.EMISOR,
      cliente: { id: cli.ID_Cliente, nombre: cli['Nombre / Empresa'], doc: doc, tipoDoc: esRuc ? 'RUC' : 'DNI', direccion: pd ? pd.Direccion : '' },
      items: items, subtotal: subtotal, igv: igv, total: total,
      qr: [CFG.EMISOR.ruc, tipo === 'FACTURA' ? '01' : '03', serie, numero, igv, total, fecha, esRuc ? '6' : '1', doc].join('|') + '|'
    };
    appendObj_('COMPROBANTES', { ID_Comprobante: serie + '-' + numero, Tipo: tipo, Serie: serie, Numero: numero, Fecha_Emision: fecha, Orden: comp.orden,
      RUC_Cliente: doc, Cliente: comp.cliente.nombre, Moneda: moneda, Subtotal: subtotal, IGV: igv, Total: total, Hash_Simulado: hash,
      Estado: comp.estado, Emitido_Por: s.usuario, Detalle_JSON: JSON.stringify(comp) });
    audit_(s.usuario, 'EMITIR_COMPROBANTE', 'ventas', serie + '-' + numero, 'Orden ' + comp.orden + ' Total ' + total + ' ' + moneda);
    return comp;
  });
}
function comprobantesDeOrden_(p) {
  return readAll_('COMPROBANTES').filter(r => r.Orden === String(p.orden || '')).map(r => JSON.parse(r.Detalle_JSON));
}

/* ============================ GOOGLE DRIVE ============================ */
function safeName_(s) { return String(s || '').replace(/[\\\/:*?"<>|#%\r\n\t]/g, '_').trim().slice(0, 100); }
function rootFolder_() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('ROOT_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recrear */ } }
  const it = DriveApp.getFoldersByName(CFG.ROOT_FOLDER);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(CFG.ROOT_FOLDER);
  props.setProperty('ROOT_FOLDER_ID', f.getId());
  return f;
}
function opFolder_(name, create) {
  const root = rootFolder_(), safe = safeName_(name), it = root.getFoldersByName(safe);
  if (it.hasNext()) return it.next();
  return create ? root.createFolder(safe) : null;
}
function magicOk_(ext, b) {
  if (ext === 'pdf') return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  if (ext === 'png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === 'jpg' || ext === 'jpeg') return b[0] === 0xff && b[1] === 0xd8;
  return true;
}
function docsUpload_(p, s) {
  const oper = safeName_(p.operacion);
  if (!oper) fail_('Indique la operación / DAM', 'VALIDATION');
  const original = safeName_(p.nombre), ext = (original.split('.').pop() || '').toLowerCase();
  if (!CFG.ALLOWED_EXT[ext]) fail_('Tipo de archivo no permitido (.' + ext + ')', 'VALIDATION');
  if (!p.base64 || p.base64.length * 0.75 > CFG.MAX_FILE_BYTES) fail_('Archivo vacío o mayor a ' + (CFG.MAX_FILE_BYTES / 1048576) + ' MB', 'VALIDATION');
  let bytes;
  try { bytes = Utilities.base64Decode(p.base64); } catch (e) { fail_('Archivo corrupto', 'VALIDATION'); }
  if (!magicOk_(ext, bytes.map(x => x & 0xff))) fail_('El contenido no coincide con la extensión .' + ext, 'VALIDATION');
  const tipo = safeName_(p.tipoDoc || 'Otro');
  return withLock_(() => {
    const folder = opFolder_(oper, true);
    const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
    const file = folder.createFile(Utilities.newBlob(bytes, CFG.ALLOWED_EXT[ext], tipo + '_' + stamp + '_' + original));
    const docs = readAll_('DOCUMENTOS').filter(d => d.Operacion === oper && d.Tipo_Documento === tipo);
    const rec = { ID_Documento: nextId_(readAll_('DOCUMENTOS'), 'ID_Documento', 'DOC'), Operacion: oper, Tipo_Documento: tipo, Nombre_Archivo: original,
      URL: file.getUrl(), File_ID: file.getId(), Version: String(docs.length + 1), Subido_Por: s.usuario, Fecha: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') };
    appendObj_('DOCUMENTOS', rec);
    audit_(s.usuario, 'SUBIR_DOCUMENTO', 'documentos', rec.ID_Documento, oper + ' / ' + tipo + ' v' + rec.Version);
    return { documento: rec, folderUrl: folder.getUrl() };
  });
}
function docsList_(p) {
  const oper = safeName_(p.operacion), f = opFolder_(oper, false);
  return {
    folderUrl: f ? f.getUrl() : '',
    documentos: readAll_('DOCUMENTOS').filter(d => d.Operacion === oper).map(d => { delete d._row; return d; }).reverse()
  };
}

/* ============================ DASHBOARD ============================ */
function dashboardStats_() {
  const hoy = todayStr_(), ventas = readAll_('REPORTE_VENTAS'), serv = readAll_('SERVICIO_INTEGRAL'), cal = readAll_('CALENDARIO_LLEGADAS');
  const alertas = [], K_ESTATUS = 'Estatus de la Carga (Entregado / No Entregado)';
  ventas.forEach(v => {
    if (/^s[ií]$/i.test(v['¿Regularizado? Sí / No'])) return;
    const f = v['Fecha Límite de Regularización'];
    if (!isDate_(f)) return;
    const d = diffDays_(hoy, f);
    if (d <= 5) alertas.push({ nivel: d < 0 ? 'critico' : 'atencion', tipo: 'Regularización', ref: v['N° de Orden'] + (v['DAM'] ? ' · DAM ' + v['DAM'] : ''), fecha: f,
      mensaje: d < 0 ? 'Plazo vencido hace ' + (-d) + ' día(s)' : (d === 0 ? 'Vence hoy' : 'Vence en ' + d + ' día(s)') });
  });
  const activos = serv.filter(x => !/^entregado$/i.test(x[K_ESTATUS]));
  activos.forEach(x => {
    const eta = x['Fecha de Llegada (ETA)'], ref = x['N° de Ítem'] + ' · ' + x['Cliente'];
    if (isDate_(eta)) {
      const d = diffDays_(hoy, eta);
      if (d < 0) alertas.push({ nivel: 'critico', tipo: 'ETA vencida', ref: ref, fecha: eta, mensaje: 'ETA pasó hace ' + (-d) + ' día(s) y la carga no figura como entregada' });
      else if (d <= 7) alertas.push({ nivel: 'atencion', tipo: 'Arribo próximo', ref: ref, fecha: eta, mensaje: d === 0 ? 'Arriba hoy' : 'Arriba en ' + d + ' día(s)' });
    }
    if (!x['Referencia (Google Drive URL/ID)']) alertas.push({ nivel: 'info', tipo: 'Documentos', ref: ref, fecha: '', mensaje: 'Aún no hay documentos cargados en Drive' });
  });
  const rank = { critico: 0, atencion: 1, info: 2 };
  alertas.sort((a, b) => rank[a.nivel] - rank[b.nivel]);
  const arribos = cal.filter(c => isDate_(c['Fecha de Llegada']) && diffDays_(hoy, c['Fecha de Llegada']) >= 0 && diffDays_(hoy, c['Fecha de Llegada']) <= 14)
    .sort((a, b) => a['Fecha de Llegada'].localeCompare(b['Fecha de Llegada']))
    .map(c => ({ fecha: c['Fecha de Llegada'], cliente: c['Cliente'], puerto: c['Puerto'], estado: c['Estado'], ref: c['Referencia_Operacion'] }));
  return {
    kpis: { clientes: readAll_('CLIENTES').length, operacionesActivas: activos.length,
      ventasPendientes: ventas.filter(v => !/^s[ií]$/i.test(v['¿Regularizado? Sí / No'])).length, arribos14d: arribos.length },
    alertas: alertas.slice(0, 30), proximosArribos: arribos
  };
}
