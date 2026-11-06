/** Control de sesión, validación contra la hoja USUARIOS (vía API) y protección de rutas. */
const Auth = (() => {
  const IDLE_MS = 30 * 60 * 1000;
  let user = null, idleTimer = null;

  const current = () => user;
  const can = action => {
    const r = user && user.rol;
    if (action === 'write') return r === 'ADMIN' || r === 'OPERADOR';
    if (action === 'delete') return r === 'ADMIN';
    return !!r;
  };
  const guard = route => !!user || route === 'login';

  function startIdle() {
    stopIdle();
    const reset = () => { clearTimeout(idleTimer); idleTimer = setTimeout(async () => { await logout(); window.dispatchEvent(new CustomEvent('vuce:session-expired')); }, IDLE_MS); };
    ['click', 'keydown', 'mousemove'].forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    startIdle._reset = reset; reset();
  }
  function stopIdle() {
    clearTimeout(idleTimer);
    if (startIdle._reset) ['click', 'keydown', 'mousemove'].forEach(ev => window.removeEventListener(ev, startIdle._reset));
    startIdle._reset = null;
  }

  async function restore() {
    if (!Api.getToken()) return null;
    try { user = await Api.me(); startIdle(); } catch (e) { user = null; Api.setToken(null); }
    return user;
  }
  async function login(usuario, password) {
    const r = await Api.login(usuario, password);
    Api.setToken(r.token);
    user = { usuario: r.usuario, rol: r.rol };
    startIdle();
    return user;
  }
  async function logout() {
    try { if (Api.getToken()) await Api.logout(); } catch (e) { /* sesión ya inválida */ }
    Api.setToken(null); user = null; stopIdle();
  }

  /** Enlaza el formulario de views/login.html */
  function bindLogin(form, onSuccess) {
    const err = form.querySelector('[data-error]'), btn = form.querySelector('button[type=submit]');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      err.classList.add('hidden'); btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Verificando…';
      try {
        await login(form.usuario.value, form.password.value);
        form.password.value = '';
        onSuccess();
      } catch (ex) {
        err.textContent = ex.message; err.classList.remove('hidden');
      } finally { btn.disabled = false; btn.textContent = txt; }
    });
  }
  return { current, can, guard, restore, login, logout, bindLogin };
})();
