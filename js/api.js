/**
 * Conector centralizado hacia la WebApp de Google Apps Script.
 * 1) Despliegue Code.gs como Aplicación web  2) Pegue aquí la URL que termina en /exec
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbwTCaHBqWu7yDjh3V70v7Pdl0_tiWlapvqvDskKCcHYsbzOaV2VJ8okX_kRHqIPQgmA/exec'; // https://script.google.com/macros/s/AKfycb.../exec

class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code || 'ERROR'; }
}

const Api = (() => {
  const TK = 'vuce_token'; // sessionStorage: se borra al cerrar la pestaña
  const getToken = () => sessionStorage.getItem(TK);
  const setToken = t => (t ? sessionStorage.setItem(TK, t) : sessionStorage.removeItem(TK));

  /**
   * POST con Content-Type text/plain => "petición simple": no dispara preflight CORS,
   * que Apps Script no soporta. El token viaja en el cuerpo, nunca en la URL.
   */
  async function call(action, payload = {}, { auth = true, timeout = 60000 } = {}) {
    if (!API_URL || API_URL.startsWith('PEGAR')) throw new ApiError('Configure API_URL en js/api.js con la URL /exec de su WebApp.', 'CONFIG');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(API_URL, {
        method: 'POST', redirect: 'follow', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: auth ? getToken() : undefined, payload })
      });
      if (!res.ok) throw new ApiError('Error de red (' + res.status + ')', 'HTTP');
      const json = await res.json();
      if (!json.ok) {
        if (json.code === 'SESSION_EXPIRED') { setToken(null); window.dispatchEvent(new CustomEvent('vuce:session-expired')); }
        throw new ApiError(json.error || 'Error desconocido', json.code);
      }
      return json.data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e.name === 'AbortError') throw new ApiError('Tiempo de espera agotado', 'TIMEOUT');
      throw new ApiError('No se pudo conectar con el servidor. Verifique la URL y el despliegue.', 'NETWORK');
    } finally { clearTimeout(timer); }
  }

  return {
    call, getToken, setToken,
    ping: () => fetch(API_URL).then(r => r.json()),
    login: (usuario, password) => call('auth.login', { usuario, password }, { auth: false }),
    logout: () => call('auth.logout'),
    me: () => call('auth.me'),
    list: entity => call('crud.list', { entity }),
    create: (entity, data) => call('crud.create', { entity, data }),
    update: (entity, id, data) => call('crud.update', { entity, id, data }),
    remove: (entity, id) => call('crud.delete', { entity, id }),
    sunatRuc: ruc => call('sunat.consultarRuc', { ruc }),
    emitir: payload => call('ventas.emitirComprobante', payload),
    comprobantes: orden => call('ventas.comprobantes', { orden }),
    docsList: operacion => call('docs.list', { operacion }),
    docsUpload: payload => call('docs.upload', payload, { timeout: 120000 }),
    stats: () => call('dashboard.stats')
  };
})();
