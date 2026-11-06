/**
 * VUCE Demo – Autoinicialización de hojas, cabeceras y datos base.
 * Ejecute inicializarSistema() UNA vez desde el editor (es idempotente).
 * Opcional: cargarDatosDemo() para sembrar registros de ejemplo.
 */
const SCHEMA = {
  // --- Hojas solicitadas ---
  USUARIOS: ['ID_Usuario', 'Usuario', 'Password_Hash', 'Rol', 'Estado'],
  CLIENTES: ['ID_Cliente', 'Nombre / Empresa', 'RUC / DNI', 'Teléfono', 'Correo', 'Fecha_Creacion'],
  CALENDARIO_LLEGADAS: ['ID_Evento', 'Cliente', 'Fecha de Llegada', 'Puerto', 'Estado', 'Referencia_Operacion'],
  REPORTE_VENTAS: ['N° de Orden', 'N° de Cliente', 'MOD', 'Vía', 'DAM', '¿Regularizado? Sí / No', 'N° de Manifiesto',
    'Canal que salió', 'Almacén', 'Monto CIF', 'AWB / BL', 'Agente de Carga', 'VoBo (Visto Bueno)', 'Fecha de Llegada',
    'Fecha de Levante', 'Fecha de Salida', 'Fecha Límite de Regularización', 'Documentos Entregados',
    'Carga Arribada / Pendiente', 'Observaciones'],
  SERVICIO_INTEGRAL: ['N° de Ítem', 'Cliente', 'DAM', 'N° de Seguro', 'Certificado de Origen', 'Tipo de Mercancía', 'Naviera',
    'Tipo de Contenedor', 'Vía', 'VoBo (Visto Bueno)', 'Nombre de la Nave', 'Conocimiento de Embarque (HBL/AWB)', 'CBM',
    'Peso Bruto', 'Contacto (Teléfono/Correo/Dirección)', 'Origen', 'Referencia del Partner', 'Tipo que se está utilizando',
    'Fecha de Zarpe (ETD)', 'Fecha de Llegada (ETA)', 'Fecha de Estatus', 'Estatus de la Carga (Entregado / No Entregado)',
    'Referencia (Google Drive URL/ID)', 'Reporte del Cliente', 'Observación'],
  PADRON_SUNAT_SIMULADO: ['RUC', 'Razon_Social', 'Estado_Contribuyente', 'Condicion_Domicilio', 'Ubigeo', 'Direccion'],
  // --- Hojas auxiliares (necesarias para correlativos, versiones de archivos y auditoría) ---
  COMPROBANTES: ['ID_Comprobante', 'Tipo', 'Serie', 'Numero', 'Fecha_Emision', 'Orden', 'RUC_Cliente', 'Cliente', 'Moneda',
    'Subtotal', 'IGV', 'Total', 'Hash_Simulado', 'Estado', 'Emitido_Por', 'Detalle_JSON'],
  DOCUMENTOS: ['ID_Documento', 'Operacion', 'Tipo_Documento', 'Nombre_Archivo', 'URL', 'File_ID', 'Version', 'Subido_Por', 'Fecha'],
  BITACORA: ['Fecha', 'Usuario', 'Accion', 'Entidad', 'ID', 'Detalle']
};

const PADRON_SEED = [
  ['20600589092', 'DETALLES VALENTINA E.I.R.L.', 'ACTIVO', 'HABIDO', '150117', 'AV. EL TREBOL NRO. 7191 URB. EL TREBOL II ETAPA LOS OLIVOS - LIMA - LIMA'],
  ['20602228810', 'M & V GRUPO LOGISTICO S.A.C.', 'ACTIVO', 'HABIDO', '070101', 'CAL. ALFONSO UGARTE NRO. 262 INT. 10 URB. JORGE CHAVEZ ET. UNO CALLAO'],
  ['20601758688', 'SOUTHCARGO PERU S.A.C.', 'ACTIVO', 'HABIDO', '150120', 'CALLE MANUEL UGARTE Y MOSCOSO 991 OF. 201 MAGDALENA DEL MAR - LIMA'],
  ['20100000009', 'EMPRESA DEMO NO HABIDA S.A.C.', 'ACTIVO', 'NO HABIDO', '150101', 'DIRECCION DEMO - LIMA'],
  ['20100000017', 'EMPRESA DEMO DE BAJA S.A.C.', 'BAJA DEFINITIVA', 'NO HABIDO', '150101', 'DIRECCION DEMO - LIMA']
];

function inicializarSistema() {
  const ss = getSS_();
  const report = Object.keys(SCHEMA).map(n => ensureSheet_(ss, n, SCHEMA[n]));
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() <= 1 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  ensurePepper_();
  seedPadron_();
  rootFolder_(); // crea VUCE_SYSTEM_FILES si no existe
  if (!readAll_('USUARIOS').length) {
    const pwd = 'Vu' + Utilities.getUuid().replace(/-/g, '').slice(0, 10) + '#9';
    crearUsuario('admin', pwd, 'ADMIN');
    report.push('USUARIO INICIAL  >>>  admin  /  ' + pwd + '   (guárdela y cambie con cambiarPassword)');
  }
  Logger.log(report.join('\n'));
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name), msg = name + ': ';
  if (!sh) { sh = ss.insertSheet(name); msg += 'creada'; } else msg += 'existente';
  const lastCol = sh.getLastColumn();
  const current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = headers.filter(h => current.indexOf(h) < 0);
  if (!current.length) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  else if (missing.length) sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  const cols = sh.getLastColumn();
  sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (sh.getMaxRows() < 2) sh.insertRowsAfter(1, 100);
  sh.getRange(2, 1, sh.getMaxRows() - 1, cols).setNumberFormat('@'); // texto plano: evita fechas/fórmulas auto-interpretadas
  return msg + (missing.length && current.length ? ' | cabeceras añadidas: ' + missing.join(', ') : ' | cabeceras OK');
}

function ensurePepper_() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());
}

function seedPadron_() {
  const have = readAll_('PADRON_SUNAT_SIMULADO').map(r => r.RUC);
  PADRON_SEED.filter(r => have.indexOf(r[0]) < 0).forEach(r => appendObj_('PADRON_SUNAT_SIMULADO', {
    RUC: r[0], Razon_Social: r[1], Estado_Contribuyente: r[2], Condicion_Domicilio: r[3], Ubigeo: r[4], Direccion: r[5]
  }));
}

/** Datos de ejemplo (fechas relativas a hoy para que se vean alertas). Basados en la operación TMSE3585286 del PDF. */
function cargarDatosDemo() {
  const rows = readAll_('CLIENTES');
  if (rows.length) { Logger.log('Ya existen clientes; no se cargó la demo.'); return; }
  appendObj_('CLIENTES', { ID_Cliente: 'CLI0001', 'Nombre / Empresa': 'DETALLES VALENTINA E.I.R.L.', 'RUC / DNI': '20600589092', 'Teléfono': '', Correo: '', Fecha_Creacion: todayStr_() });
  appendObj_('CLIENTES', { ID_Cliente: 'CLI0002', 'Nombre / Empresa': 'EMPRESA DEMO NO HABIDA S.A.C.', 'RUC / DNI': '20100000009', 'Teléfono': '', Correo: '', Fecha_Creacion: todayStr_() });
  appendObj_('CALENDARIO_LLEGADAS', { ID_Evento: 'EVT0001', Cliente: 'DETALLES VALENTINA E.I.R.L.', 'Fecha de Llegada': todayStr_(9), Puerto: 'CALLAO', Estado: 'En tránsito', Referencia_Operacion: 'TMSE3585286' });
  appendObj_('CALENDARIO_LLEGADAS', { ID_Evento: 'EVT0002', Cliente: 'DETALLES VALENTINA E.I.R.L.', 'Fecha de Llegada': todayStr_(2), Puerto: 'CALLAO', Estado: 'Programado', Referencia_Operacion: 'DEMO-002' });
  appendObj_('REPORTE_VENTAS', {
    'N° de Orden': 'ORD0001', 'N° de Cliente': 'CLI0001', MOD: '10 - Importación para el consumo', 'Vía': 'Marítima', DAM: '118-2026-10-000001',
    '¿Regularizado? Sí / No': 'No', 'N° de Manifiesto': '', 'Canal que salió': 'Naranja', 'Almacén': 'FARGOLINE S.A.', 'Monto CIF': '30094.30',
    'AWB / BL': 'TMSE3585286', 'Agente de Carga': 'M & V GRUPO LOGISTICO S.A.C.', 'VoBo (Visto Bueno)': 'Sí', 'Fecha de Llegada': todayStr_(-6),
    'Fecha de Levante': todayStr_(-4), 'Fecha de Salida': '', 'Fecha Límite de Regularización': todayStr_(3),
    'Documentos Entregados': 'Factura, BL, Packing list', 'Carga Arribada / Pendiente': 'Arribada', Observaciones: 'DAM ficticia de demostración'
  });
  appendObj_('SERVICIO_INTEGRAL', {
    'N° de Ítem': 'ITM0001', Cliente: 'DETALLES VALENTINA E.I.R.L.', DAM: '', 'N° de Seguro': '', 'Certificado de Origen': 'No aplica',
    'Tipo de Mercancía': 'Juguetes (muñecas, coches y muebles de muñecas) – requiere Autorización Sanitaria DIGESA', Naviera: 'EVERGREEN LINE',
    'Tipo de Contenedor': '1x40HQ (EITU9325079)', 'Vía': 'Marítima', 'VoBo (Visto Bueno)': 'Pendiente', 'Nombre de la Nave': 'EVER LUCKY V.078E',
    'Conocimiento de Embarque (HBL/AWB)': 'TMSE3585286', CBM: '56.9', 'Peso Bruto': '6748.2', 'Contacto (Teléfono/Correo/Dirección)': 'Los Olivos, Lima',
    Origen: 'NINGBO, CHINA', 'Referencia del Partner': 'MIM2025-0026', 'Tipo que se está utilizando': 'FCL',
    'Fecha de Zarpe (ETD)': todayStr_(-30), 'Fecha de Llegada (ETA)': todayStr_(9), 'Fecha de Estatus': todayStr_(), 'Estatus de la Carga (Entregado / No Entregado)': 'No Entregado',
    'Referencia (Google Drive URL/ID)': '', 'Reporte del Cliente': '', Observación: 'Operación de ejemplo basada en documentos de muestra'
  });
  Logger.log('Datos demo cargados.');
}
