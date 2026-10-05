/*
 * MediaStream — frontend (SPA sin build step).
 *
 * Habla SOLO con el API Gateway (sección 5): él valida el AccessToken, aplica
 * el rate limiting y reenvía a cada microservicio. Rutas (hash):
 *   #/login  #/registro  #/perfiles  #/inicio  #/ver/:titulo[/:episodio]
 *   #/planes  #/cuenta  #/admin/:pestaña
 */
(() => {
  'use strict';

  const CFG = window.MEDIASTREAM_CONFIG || {};
  const API = (CFG.GATEWAY || '').replace(/\/+$/, '');
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');

  /* ============================================================ utilidades */
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso; }
  };
  const fmtDateTime = (iso) => {
    try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(message, bad = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (bad ? ' bad' : '');
    el.textContent = message;
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  const ICON = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    bell: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  };

  /* ================================================================ estado */
  // Solo conveniencias del navegador: el token de la sesión, el perfil elegido
  // y la región. Lo que importa (plan, rol) siempre viene del servidor.
  const store = {
    get(key, fallback = null) {
      try { const v = localStorage.getItem('ms.' + key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('ms.' + key, JSON.stringify(value)); } catch { /* modo privado */ }
    },
    del(key) {
      try { localStorage.removeItem('ms.' + key); } catch { /* modo privado */ }
    },
  };

  const session = {
    token: store.get('token'),
    account: store.get('account'),
    profile: store.get('profile'),
    region: store.get('region', 'CO'),
  };

  function decodeJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return null; }
  }
  function tokenValid() {
    const claims = session.token && decodeJwt(session.token);
    return !!claims && claims.exp * 1000 > Date.now() + 5000;
  }
  function setToken(token, account) {
    session.token = token;
    store.set('token', token);
    if (account) { session.account = { ...session.account, ...account }; store.set('account', session.account); }
  }
  function setProfile(profile) {
    session.profile = profile;
    if (profile) store.set('profile', profile); else store.del('profile');
  }
  function logout(message) {
    session.token = null; session.account = null; setProfile(null);
    store.del('token'); store.del('account');
    if (message) store.set('flash', message);
    go('#/login');
  }

  const isAdmin = () => session.account?.role === 'ADMIN';
  /** El plan con el que se decide qué se puede ver (una cuenta MOROSA queda como gratis). */
  const effectivePlan = () => (session.account?.status === 'MOROSA' ? 'GRATIS' : session.account?.plan || 'GRATIS');
  const canWatch = (title) => isAdmin() || title?.isFree || effectivePlan() !== 'GRATIS';

  /* ================================================================== API */
  function errInfo(data, status) {
    let message = data?.message ?? data?.detail ?? data?.error;
    let code = data?.code;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      code = code ?? message.code;
      message = message.message ?? message.detail ?? message.error;
    }
    if (Array.isArray(message)) message = message.map((m) => (typeof m === 'string' ? m : m.msg)).join(', ');
    if (typeof message !== 'string' || !message) message = status ? `Error ${status}` : 'No se pudo conectar con el servidor.';
    return { message, code };
  }

  // 502/503/504 que no vienen del Gateway (página HTML de Render): el servicio
  // se está iniciando o cambiando de versión. En el plan gratis tarda ~1 min.
  const WAKING_MESSAGE = 'El servicio se está iniciando. Espera unos segundos y vuelve a intentarlo.';
  const isWaking = (status, data) => [502, 503, 504].includes(status) && (data === null || typeof data !== 'object');

  /*
   * Servicios dormidos (plan gratis de Render): se apagan tras 15 min sin
   * tráfico y solo despiertan con una visita desde FUERA de Render. El Gateway
   * no puede despertarlos, pero el navegador sí: se "toca" su URL pública.
   */
  const SERVICE_KEYS = {
    user: 'USER', catalog: 'CATALOG', playback: 'PLAYBACK', media: 'MEDIA',
    recommendation: 'RECOMMENDATION', billing: 'BILLING', notification: 'NOTIFICATION', analytics: 'ANALYTICS',
  };
  const lastWake = {};
  function wake(service, url) {
    const base = url || CFG[SERVICE_KEYS[service]];
    if (!base || Date.now() - (lastWake[base] || 0) < 20000) return;
    lastWake[base] = Date.now();
    // no-cors: solo importa que la visita llegue; la respuesta no se lee.
    fetch(`${base.replace(/\/+$/, '')}/health`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  }
  function wakeAll() { Object.keys(SERVICE_KEYS).forEach((s) => wake(s)); }

  let wakingToastShown = 0;
  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const r = await request(path, opts);
      // El servicio estaba dormido: la petición no llegó, se puede reintentar
      // (también un registro o un pago) mientras despierta.
      if (r.code === 'SERVICE_WAKING') {
        wake(r.data?.service, r.data?.serviceUrl);
        if (Date.now() - started > 90000) return { ...r, message: 'El servicio tarda en iniciar. Inténtalo de nuevo en un minuto.' };
        if (Date.now() - wakingToastShown > 30000) { wakingToastShown = Date.now(); toast('Iniciando el servicio, puede tardar hasta un minuto…'); }
        await sleep(4000);
        continue;
      }
      if (!isWaking(r.status, r.data)) return r;
      if (method !== 'GET' || attempt >= 2) return { ...r, message: WAKING_MESSAGE };
      await sleep(3000);
    }
  }

  async function request(path, { method = 'GET', body, form, auth = true, quiet401 = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers,
        body: form || (body !== undefined ? JSON.stringify(body) : undefined),
      });
    } catch {
      return { ok: false, status: 0, data: null, ...errInfo(null, 0) };
    }
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (res.status === 401 && auth && session.token && !quiet401) {
      logout('Tu sesión expiró. Vuelve a iniciar sesión.');
    }
    return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, data, ...errInfo(data, res.status) };
  }

  /** Datos de la cuenta y un AccessToken renovado con el plan y rol actuales. */
  async function refreshMe() {
    const r = await api('/api/users/me', { quiet401: true });
    if (!r.ok) return r;
    setToken(r.data.accessToken, r.data.account);
    return r;
  }
  // Renueva la sesión cada 10 minutos mientras la app está abierta (el
  // AccessToken dura 15).
  setInterval(() => { if (session.token) refreshMe(); }, 10 * 60 * 1000);
  // Mientras la app está abierta y visible, se mantienen despiertos los
  // servicios (se duermen a los 15 min sin tráfico).
  setInterval(() => { if (document.visibilityState === 'visible') wakeAll(); }, 10 * 60 * 1000);

  /* ============================================================ catálogo */
  const CATEGORY_COLORS = {
    accion: 'e5484d', 'ciencia ficcion': '7ab8e8', drama: 'a393e6', documental: '46c08a',
    comedia: 'c5e05a', animacion: 'e693c0', infantil: 'e8b858', terror: '8a1c1c', romance: 'f08fb0',
  };
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function posterUrl(t, w = 300, h = 450) {
    if (t?.posterUrl) return t.posterUrl;
    const bg = CATEGORY_COLORS[norm(t?.category)] || '2c303c';
    return `https://placehold.co/${w}x${h}/${bg}/14161c?font=playfair-display&text=${encodeURIComponent(t?.name || 'MediaStream')}`;
  }

  // Videos de muestra libres de derechos (no hay archivos reales en la
  // plataforma): cada título/episodio arranca en uno, siempre el mismo. Si una
  // fuente falla, el reproductor pasa a la siguiente.
  const SAMPLE_VIDEOS = [
    'https://media.w3.org/2010/05/bunny/movie.mp4',
    'https://media.w3.org/2010/05/sintel/trailer.mp4',
    'https://vjs.zencdn.net/v/oceans.mp4',
    'https://media.w3.org/2010/05/bunny/trailer.mp4',
    'https://media.w3.org/2010/05/video/movie_300.mp4',
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  ];
  const videoSources = (titleId, episodeId) => {
    const start = (Number(titleId) * 7 + Number(episodeId || 0)) % SAMPLE_VIDEOS.length;
    return SAMPLE_VIDEOS.slice(start).concat(SAMPLE_VIDEOS.slice(0, start));
  };

  /** Fondo grande (portada, detalle): la imagen propia o un degradado del color de la categoría. */
  function backdropStyle(t) {
    if (t?.posterUrl) return `background-image:url('${esc(t.posterUrl)}')`;
    const c = '#' + (CATEGORY_COLORS[norm(t?.category)] || '3a3f4e');
    return `background-image:radial-gradient(900px 500px at 75% 30%, ${c}cc, transparent 70%), linear-gradient(135deg, ${c}55, #0f1014 70%)`;
  }

  let catalogCache = { key: null, titles: [] };
  async function loadCatalog(force = false) {
    const kids = !!session.profile?.isKids;
    const key = `${session.region}:${kids}`;
    if (!force && catalogCache.key === key) return catalogCache.titles;
    const params = new URLSearchParams({ region: session.region });
    if (kids) params.set('isKids', 'true');
    const r = await api(`/api/catalog/titles?${params}`, { auth: false });
    catalogCache = { key, titles: r.ok ? r.data : [] };
    return catalogCache.titles;
  }
  const titleCache = new Map();
  async function getTitle(id) {
    if (titleCache.has(String(id))) return titleCache.get(String(id));
    const r = await api(`/api/catalog/titles/${encodeURIComponent(id)}`, { auth: false });
    if (r.ok) titleCache.set(String(id), r.data);
    return r.ok ? r.data : null;
  }

  /* =============================================================== router */
  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }
  function parseRoute() {
    const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
    const parts = path.split('/').filter(Boolean);
    return { name: parts[0] || 'inicio', params: parts.slice(1), query: new URLSearchParams(query) };
  }

  let cleanup = [];
  function onLeave(fn) { cleanup.push(fn); }

  async function render() {
    cleanup.forEach((fn) => { try { fn(); } catch { /* nada */ } });
    cleanup = [];
    closeModal();
    const route = parseRoute();
    const publicRoutes = ['login', 'registro'];

    if (!session.token || !tokenValid()) {
      if (session.token) logout('Tu sesión expiró. Vuelve a iniciar sesión.');
      if (!publicRoutes.includes(route.name)) return go('#/login');
    } else if (publicRoutes.includes(route.name)) {
      return go(session.profile ? '#/inicio' : '#/perfiles');
    }

    const needsProfile = ['inicio', 'series', 'peliculas', 'ver', 'buscar'];
    if (session.token && needsProfile.includes(route.name) && !session.profile) return go('#/perfiles');

    const views = {
      login: viewLogin, registro: viewRegister, perfiles: viewProfiles,
      inicio: viewBrowse, series: viewBrowse, peliculas: viewBrowse, buscar: viewBrowse,
      ver: viewPlayer, planes: viewPlans, cuenta: viewAccount, admin: viewAdmin,
    };
    const view = views[route.name] || viewBrowse;
    window.scrollTo(0, 0);
    try {
      await view(route);
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="page"><div class="notice bad">Algo salió mal al cargar esta pantalla: ${esc(err.message)}</div></div>`;
    }
  }
  window.addEventListener('hashchange', render);

  /* ======================================================= login / registro */
  function authShell(inner) {
    return `<div class="auth-page"><div class="auth-top"><a class="brand" href="#/login">MediaStream</a></div>${inner}</div>`;
  }
  function takeFlash() {
    const msg = store.get('flash'); store.del('flash'); return msg;
  }

  function viewLogin(route) {
    const flash = takeFlash();
    const email = route.query.get('email') || '';
    app.innerHTML = authShell(`
      <form class="auth-card" id="loginForm" novalidate>
        <h1>Inicia sesión</h1>
        ${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
        <div class="field"><label for="email">Correo electrónico</label>
          <input class="input" id="email" type="email" autocomplete="email" required value="${esc(email)}"></div>
        <div class="field"><label for="password">Contraseña</label>
          <input class="input" id="password" type="password" autocomplete="current-password" required></div>
        <div class="form-error" id="err"></div>
        <button class="btn btn-block" type="submit">Iniciar sesión</button>
        <p class="auth-alt">¿Primera vez en MediaStream? <a href="#/registro">Regístrate ahora</a>.</p>
      </form>`);
    $('#email').focus();
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter || $('button[type=submit]', e.target);
      const err = $('#err');
      const emailValue = $('#email').value.trim();
      if (!emailValue || !$('#password').value) { err.textContent = 'Escribe tu correo y tu contraseña.'; return; }
      btn.disabled = true; err.textContent = '';
      const r = await api('/api/users/login', { method: 'POST', auth: false, body: { email: emailValue, password: $('#password').value } });
      btn.disabled = false;
      if (r.ok) {
        setToken(r.data.accessToken, r.data.account);
        setProfile(null);
        if (r.data.accountStatus === 'MOROSA') store.set('flash', 'Tu último pago fue rechazado: por ahora solo puedes ver los títulos gratis.');
        return go('#/perfiles');
      }
      if (r.code === 'ACCOUNT_NOT_FOUND') {
        // No está registrado: se le lleva al registro con su correo.
        store.set('flash', 'No encontramos una cuenta con ese correo. Crea una en un minuto.');
        return go(`#/registro?email=${encodeURIComponent(emailValue)}`);
      }
      err.textContent = r.status === 429 ? 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.' : r.message;
    });
  }

  function viewRegister(route) {
    const flash = takeFlash();
    app.innerHTML = authShell(`
      <form class="auth-card" id="regForm" novalidate>
        <h1>Crea tu cuenta</h1>
        ${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
        <div class="field"><label for="email">Correo electrónico</label>
          <input class="input" id="email" type="email" autocomplete="email" required value="${esc(route.query.get('email') || '')}"></div>
        <div class="field"><label for="password">Contraseña (mínimo 8 caracteres)</label>
          <input class="input" id="password" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="profileName">¿Cómo se llama tu primer perfil?</label>
          <input class="input" id="profileName" maxlength="30" required placeholder="Tu nombre"></div>
        <label class="check"><input type="checkbox" id="isKids"> Es un perfil infantil</label>
        <div class="form-error" id="err"></div>
        <button class="btn btn-block" type="submit">Crear cuenta gratis</button>
        <p class="form-note">Empiezas con el plan Gratis. Puedes mejorar tu plan cuando quieras.</p>
        <p class="auth-alt">¿Ya tienes cuenta? <a href="#/login">Inicia sesión</a>.</p>
      </form>`);
    $(route.query.get('email') ? '#password' : '#email').focus();
    $('#regForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#err');
      const body = {
        email: $('#email').value.trim(),
        password: $('#password').value,
        profileName: $('#profileName').value.trim(),
        isKids: $('#isKids').checked,
      };
      if (!body.email || !body.profileName) { err.textContent = 'Completa el correo y el nombre del perfil.'; return; }
      if (body.password.length < 8) { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
      const btn = $('button[type=submit]', e.target);
      btn.disabled = true; err.textContent = '';
      const reg = await api('/api/users/register', { method: 'POST', auth: false, body });
      if (!reg.ok) {
        btn.disabled = false;
        if (reg.status === 409) { store.set('flash', 'Ya tienes una cuenta con ese correo. Inicia sesión.'); return go(`#/login?email=${encodeURIComponent(body.email)}`); }
        err.textContent = reg.message; return;
      }
      const login = await api('/api/users/login', { method: 'POST', auth: false, body: { email: body.email, password: body.password } });
      btn.disabled = false;
      if (!login.ok) { store.set('flash', 'Cuenta creada. Inicia sesión.'); return go('#/login'); }
      setToken(login.data.accessToken, login.data.account);
      setProfile({ id: reg.data.profile.id, name: reg.data.profile.name, isKids: reg.data.profile.isKids });
      toast('¡Bienvenido a MediaStream!');
      go('#/planes?bienvenida=1');
    });
  }

  /* =============================================================== perfiles */
  const AVATAR_COLORS = ['#e5484d', '#3e8ed0', '#46c08a', '#e8b858', '#a393e6', '#e693c0', '#5fc9b8'];
  const avatarColor = (id) => AVATAR_COLORS[Number(id) % AVATAR_COLORS.length];
  const initial = (name) => esc((name || '?').trim().charAt(0).toUpperCase());

  async function viewProfiles(route) {
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const me = await refreshMe();
    if (!me.ok) return;
    const r = await api(`/api/users/profiles/${session.account.id}`);
    const profiles = r.ok ? r.data : [];
    const manage = route.query.get('editar') === '1';
    const limit = session.account.profileLimit || 1;
    const canAdd = profiles.length < limit;
    const flash = takeFlash();

    app.innerHTML = `
      <div class="profiles-page">
        <a class="brand" href="#/perfiles" style="position:absolute;top:22px;left:48px">MediaStream</a>
        ${flash ? `<div class="notice" style="max-width:520px">${esc(flash)}</div>` : ''}
        <h1>${manage ? 'Administrar perfiles' : '¿Quién está viendo?'}</h1>
        <div class="profile-grid">
          ${profiles.map((p) => `
            <button class="profile-tile" data-id="${esc(p.id)}">
              <div class="avatar" style="background:${avatarColor(p.id)}">${initial(p.name)}</div>
              <div class="name">${esc(p.name)}</div>
              ${p.isKids ? '<div class="kids">Infantil</div>' : ''}
              ${manage && profiles.length > 1 ? `<span class="remove" title="Eliminar perfil" data-remove="${esc(p.id)}">✕</span>` : ''}
            </button>`).join('')}
          ${canAdd ? `<button class="profile-tile" id="addProfile"><div class="avatar add">+</div><div class="name">Agregar perfil</div></button>` : ''}
        </div>
        ${!canAdd ? `<p class="form-note" style="margin-top:24px">Tu plan ${esc(session.account.plan)} permite ${limit} perfil(es). <a href="#/planes">Mejora tu plan</a> para agregar más.</p>` : ''}
        <div class="profiles-actions">
          <a class="btn btn-outline" href="#/perfiles${manage ? '' : '?editar=1'}">${manage ? 'Listo' : 'Administrar perfiles'}</a>
          ${isAdmin() ? '<a class="btn btn-outline" href="#/admin">Panel de administración</a>' : ''}
          <button class="btn btn-ghost" id="logoutBtn">Cerrar sesión</button>
        </div>
      </div>`;

    $$('.profile-tile[data-id]').forEach((tile) => tile.addEventListener('click', async (e) => {
      const removeId = e.target.closest('[data-remove]')?.dataset.remove;
      if (removeId) {
        e.stopPropagation();
        const p = profiles.find((x) => x.id === removeId);
        if (!confirm(`¿Eliminar el perfil "${p.name}"? Se perderá su historial en este perfil.`)) return;
        const del = await api(`/api/users/profiles/${removeId}`, { method: 'DELETE' });
        if (!del.ok) return toast(del.message, true);
        if (session.profile?.id === removeId) setProfile(null);
        toast('Perfil eliminado');
        return render();
      }
      if (manage) return;
      const p = profiles.find((x) => x.id === tile.dataset.id);
      setProfile({ id: p.id, name: p.name, isKids: p.isKids });
      catalogCache.key = null;
      go('#/inicio');
    }));
    $('#addProfile')?.addEventListener('click', () => openAddProfile());
    $('#logoutBtn').addEventListener('click', () => logout());
  }

  function openAddProfile() {
    openModal(`
      <form class="modal narrow" id="profileForm">
        <h2 style="margin-top:0">Agregar perfil</h2>
        <div class="field"><label for="pname">Nombre</label><input class="input" id="pname" maxlength="30" required></div>
        <label class="check"><input type="checkbox" id="pkids"> Perfil infantil (solo contenido G y PG)</label>
        <div class="form-error" id="perr"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button class="btn" type="submit">Guardar</button>
        </div>
      </form>`);
    $('#pname').focus();
    $('#profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#pname').value.trim();
      if (!name) return;
      const r = await api('/api/users/profiles', { method: 'POST', body: { name, isKids: $('#pkids').checked } });
      if (!r.ok) { $('#perr').textContent = r.message; return; }
      closeModal(); toast(`Perfil "${name}" creado`); render();
    });
  }

  /* ================================================================= modal */
  function openModal(html, { wide = false } = {}) {
    modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop">${html}</div>`;
    const backdrop = $('#backdrop');
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) closeModal(); });
    document.addEventListener('keydown', escClose);
    document.body.style.overflow = 'hidden';
    return backdrop;
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    modalRoot.innerHTML = '';
    document.removeEventListener('keydown', escClose);
    document.body.style.overflow = '';
  }

  /* ========================================================== barra superior */
  function topbar(active) {
    const p = session.profile;
    const links = [
      ['inicio', 'Inicio', '#/inicio'], ['series', 'Series', '#/series'], ['peliculas', 'Películas', '#/peliculas'],
      ['planes', 'Planes', '#/planes'],
      ...(isAdmin() ? [['admin', 'Administración', '#/admin']] : []),
    ];
    return `
      <header class="topbar">
        <a class="brand" href="#/inicio">MediaStream</a>
        <nav class="topnav" aria-label="Principal">
          ${links.map(([k, label, href]) => `<a href="${href}" class="${active === k ? 'active' : ''}">${label}</a>`).join('')}
        </nav>
        <div class="spacer"></div>
        <form class="search" id="searchForm" role="search">
          ${ICON.search}<label class="sr-only" for="q">Buscar</label>
          <input id="q" placeholder="Títulos, géneros" value="${esc(parseRoute().query.get('q') || '')}">
        </form>
        ${p ? `<div class="menu-wrap"><button class="icon-btn" id="bellBtn" aria-label="Notificaciones">${ICON.bell}<span class="badge-count" id="bellCount" hidden></span></button></div>` : ''}
        <div class="menu-wrap">
          <button class="icon-btn" id="meBtn" aria-label="Cuenta">
            <span class="avatar-sm" style="background:${p ? avatarColor(p.id) : '#444'}">${initial(p?.name || session.account?.email)}</span>
          </button>
        </div>
      </header>`;
  }

  function bindTopbar() {
    $('#searchForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#q').value.trim();
      go(q ? `#/buscar?q=${encodeURIComponent(q)}` : '#/inicio');
    });
    let timer;
    $('#q')?.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = e.target.value.trim();
        if (q.length >= 2) go(`#/buscar?q=${encodeURIComponent(q)}`);
      }, 450);
    });
    $('#meBtn')?.addEventListener('click', (e) => toggleMenu(e.currentTarget, meMenu()));
    $('#bellBtn')?.addEventListener('click', (e) => toggleMenu(e.currentTarget, notificationsMenu()));
    loadBellCount();
  }

  function meMenu() {
    const a = session.account || {};
    return `
      <div class="head"><div class="who">${esc(session.profile?.name || a.email)}</div>
        <div class="plan">${esc(a.email)} · Plan ${esc(a.plan)}${a.role === 'ADMIN' ? ' · Admin' : ''}</div></div>
      <a href="#/perfiles">Cambiar de perfil</a>
      <a href="#/cuenta">Cuenta</a>
      <a href="#/planes">Planes</a>
      ${isAdmin() ? '<a href="#/admin">Panel de administración</a>' : ''}
      <button data-logout>Cerrar sesión</button>`;
  }

  let openMenu = null;
  function toggleMenu(anchor, html) {
    if (openMenu) { const same = openMenu.anchor === anchor; openMenu.el.remove(); openMenu = null; if (same) return; }
    const el = document.createElement('div');
    el.className = 'dropdown' + (anchor.id === 'bellBtn' ? ' notif-panel' : '');
    el.innerHTML = html;
    anchor.parentElement.appendChild(el);
    openMenu = { anchor, el };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-logout]')) logout();
      if (e.target.closest('a')) { el.remove(); openMenu = null; }
    });
    if (anchor.id === 'bellBtn') fillNotifications(el);
  }
  document.addEventListener('click', (e) => {
    if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) { openMenu.el.remove(); openMenu = null; }
  });

  /* ========================================================= notificaciones */
  const seenKey = () => `notifSeen.${session.profile?.id}`;
  async function fetchNotifications() {
    if (!session.profile) return [];
    const r = await api(`/api/notifications/${session.profile.id}?accountId=${session.account.id}&limit=30`);
    return r.ok ? r.data : [];
  }
  async function loadBellCount() {
    const list = await fetchNotifications();
    const seen = store.get(seenKey(), '');
    const fresh = list.filter((n) => n.createdAt > seen).length;
    const badge = $('#bellCount');
    if (badge && fresh) { badge.textContent = fresh > 9 ? '9+' : fresh; badge.hidden = false; }
  }
  function notificationsMenu() { return '<div class="head"><div class="who">Notificaciones</div></div><div id="notifList"><div class="notif">Cargando…</div></div>'; }
  async function fillNotifications(el) {
    const list = await fetchNotifications();
    const seen = store.get(seenKey(), '');
    $('#notifList', el).innerHTML = list.length
      ? list.map((n) => `
          <div class="notif ${n.createdAt > seen ? 'new' : ''}">
            <div class="t">${esc(n.title)}</div><div class="m">${esc(n.message)}</div><div class="d">${fmtDateTime(n.createdAt)}</div>
          </div>`).join('')
      : '<div class="notif"><div class="m">No tienes notificaciones todavía. Te avisaremos de estrenos y de cómo seguir tus series.</div></div>';
    if (list[0]) store.set(seenKey(), list[0].createdAt);
    const badge = $('#bellCount'); if (badge) badge.hidden = true;
  }

  /* ================================================================ inicio */
  function card(t, { progress } = {}) {
    const locked = !canWatch(t);
    return `
      <button class="card ${locked ? 'locked' : ''}" data-title="${esc(t.id)}" aria-label="${esc(t.name)}${locked ? ' (requiere plan de pago)' : ''}">
        <img loading="lazy" src="${esc(posterUrl(t))}" alt="">
        <span class="card-badges">
          ${t.isFree ? '<span class="pill free">Gratis</span>' : ''}
          ${locked ? `<span class="pill lock">${ICON.lock}</span>` : ''}
        </span>
        ${progress ? `<span class="progress"><span style="width:${Math.max(3, progress)}%"></span></span>` : ''}
      </button>`;
  }
  function row(title, items, opts) {
    if (!items.length) return '';
    return `<section class="row"><h2>${esc(title)}</h2><div class="row-track">${items.map((t) => card(t, opts?.(t))).join('')}</div></section>`;
  }

  async function viewBrowse(route) {
    const active = route.name === 'buscar' ? '' : route.name;
    app.innerHTML = `${topbar(active)}<div class="loading"><div class="spinner"></div></div>`;
    bindTopbar();
    const [titles, resumeRes, recoRes] = await Promise.all([
      loadCatalog(),
      api(`/api/playback/resume/${session.profile.id}`),
      api(`/api/recommendations/${session.profile.id}?${new URLSearchParams({ limit: '15', region: session.region, ...(session.profile.isKids ? { isKids: 'true' } : {}) })}`),
    ]);
    const byId = new Map(titles.map((t) => [String(t.id), t]));
    const flash = takeFlash();
    let body;

    if (route.name === 'buscar') {
      const q = norm(route.query.get('q'));
      const found = titles.filter((t) => norm(t.name).includes(q) || norm(t.category).includes(q) || norm(t.synopsis).includes(q));
      body = `<div class="page" style="padding-bottom:0"><h1 style="font-size:28px">Resultados para “${esc(route.query.get('q'))}”</h1></div>
        ${found.length ? `<div class="grid-results">${found.map((t) => card(t)).join('')}</div>` : '<p class="empty">No encontramos títulos con ese nombre o género.</p>'}`;
    } else {
      const typeFilter = route.name === 'series' ? 'SERIES' : route.name === 'peliculas' ? 'MOVIE' : null;
      const list = typeFilter ? titles.filter((t) => t.type === typeFilter) : titles;
      if (!list.length) {
        body = `<p class="empty">Todavía no hay títulos disponibles en tu región (${esc(session.region)}). ${isAdmin() ? 'Agrégalos desde el <a href="#/admin/catalogo">panel de administración</a>.' : ''}</p>`;
      } else {
        const resume = (resumeRes.ok ? resumeRes.data : []).filter((r) => !r.completed && byId.has(String(r.titleId)));
        const seenTitle = new Set();
        const resumeTitles = resume.filter((r) => !seenTitle.has(r.titleId) && seenTitle.add(r.titleId));
        const reco = (recoRes.ok ? recoRes.data.items || [] : []).map((i) => byId.get(String(i.titleId))).filter(Boolean);
        const free = list.filter((t) => t.isFree);
        const byCategory = {};
        for (const t of list) (byCategory[t.category || 'Otros'] ||= []).push(t);
        const heroPool = list.filter(canWatch);
        const hero = (heroPool.length ? heroPool : list)[Math.floor(Math.random() * (heroPool.length || list.length))];
        const progressOf = new Map(resumeTitles.map((r) => [String(r.titleId), r.percentWatched]));
        body = `
          ${heroBlock(hero)}
          <div class="rows">
            ${flash ? `<div class="notice" style="margin:0 48px 20px">${esc(flash)}</div>` : ''}
            ${effectivePlan() === 'GRATIS' && !isAdmin() ? `<div class="upsell" style="margin:0 48px 26px"><strong>Estás en el plan Gratis.</strong> Ves los títulos marcados como gratis; el resto tiene candado. <a href="#/planes">Ver planes</a></div>` : ''}
            ${row('Seguir viendo', resumeTitles.map((r) => byId.get(String(r.titleId))).filter((t) => !typeFilter || t.type === typeFilter), (t) => ({ progress: progressOf.get(String(t.id)) }))}
            ${row(`Recomendado para ${session.profile.name}`, reco.filter((t) => !typeFilter || t.type === typeFilter))}
            ${row(effectivePlan() === 'GRATIS' ? 'Gratis para ti' : 'Gratis en MediaStream', free)}
            ${row('Novedades', list.slice(0, 15))}
            ${Object.entries(byCategory).sort().map(([cat, items]) => row(cat, items)).join('')}
          </div>`;
      }
    }

    app.innerHTML = `${topbar(active)}${body}`;
    bindTopbar();
    $('#heroPlay')?.addEventListener('click', (e) => playTitle(e.currentTarget.dataset.id));
    $('#heroInfo')?.addEventListener('click', (e) => openTitle(e.currentTarget.dataset.id));
  }

  function heroBlock(t) {
    if (!t) return '';
    return `
      <section class="hero">
        <div class="hero-bg" style="${backdropStyle(t)}"></div>
        <div class="hero-content">
          <h1>${esc(t.name)}</h1>
          <div class="meta-line">
            ${t.isFree ? '<span class="pill free">Gratis</span>' : ''}
            <span>${t.type === 'SERIES' ? 'Serie' : 'Película'}</span>
            ${t.category ? `<span>· ${esc(t.category)}</span>` : ''}
            ${t.ageRating ? `<span class="pill">${esc(t.ageRating)}</span>` : ''}
          </div>
          <p>${esc(t.synopsis || '')}</p>
          <div class="hero-actions">
            <button class="btn btn-light" id="heroPlay" data-id="${esc(t.id)}">${canWatch(t) ? ICON.play + ' Reproducir' : ICON.lock + ' Ver planes'}</button>
            <button class="btn btn-ghost" id="heroInfo" data-id="${esc(t.id)}">${ICON.info} Más información</button>
          </div>
        </div>
      </section>`;
  }

  // Un solo manejador para todas las tarjetas (inicio, búsqueda y "parecidos").
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.card[data-title]');
    if (c) openTitle(c.dataset.title);
  });

  function playTitle(titleId, episodeId) {
    const t = titleCache.get(String(titleId)) || catalogCache.titles.find((x) => String(x.id) === String(titleId));
    if (t && !canWatch(t)) { closeModal(); return go('#/planes'); }
    go(`#/ver/${titleId}${episodeId ? '/' + episodeId : ''}`);
  }

  /* ======================================================= detalle de título */
  async function openTitle(id) {
    openModal('<div class="modal"><div class="loading" style="min-height:300px"><div class="spinner"></div></div></div>');
    const [t, resumeRes] = await Promise.all([getTitle(id), api(`/api/playback/resume/${session.profile.id}?includeCompleted=true`)]);
    if (!t) { closeModal(); return toast('No se pudo cargar el título.', true); }
    const progress = (resumeRes.ok ? resumeRes.data : []).filter((r) => String(r.titleId) === String(id));
    const progressByEp = new Map(progress.map((r) => [String(r.episodeId || ''), r]));
    const watchable = canWatch(t);
    const episodes = (t.seasons || []).flatMap((s) => s.episodes.map((e) => ({ ...e, seasonNumber: s.seasonNumber })));
    const lastEp = progress.find((r) => r.episodeId && !r.completed);
    const firstEp = lastEp?.episodeId || episodes[0]?.id;
    const movieProgress = progressByEp.get('');

    openModal(`
      <div class="modal" role="dialog" aria-label="${esc(t.name)}">
        <button class="modal-close" data-close aria-label="Cerrar">✕</button>
        <div class="detail-hero" style="${backdropStyle(t)}">
          <div class="inner">
            <h2>${esc(t.name)}</h2>
            <div class="hero-actions">
              ${watchable
                ? `<button class="btn btn-light" id="playBtn">${ICON.play} ${lastEp || (movieProgress && !movieProgress.completed) ? 'Continuar' : 'Reproducir'}</button>`
                : `<a class="btn" href="#/planes">${ICON.lock} Mejora tu plan para ver</a>`}
            </div>
          </div>
        </div>
        <div class="detail-body">
          <div class="meta-line">
            ${t.isFree ? '<span class="pill free">Gratis</span>' : '<span class="pill accent">Planes de pago</span>'}
            <span>${t.type === 'SERIES' ? `Serie · ${(t.seasons || []).length} temporada(s)` : 'Película'}</span>
            ${t.category ? `<span>· ${esc(t.category)}</span>` : ''}
            ${t.ageRating ? `<span class="pill">${esc(t.ageRating)}</span>` : ''}
          </div>
          <p class="synopsis">${esc(t.synopsis || 'Sin sinopsis.')}</p>
          ${!watchable ? `<div class="upsell">${session.account.status === 'MOROSA'
            ? 'Tu último pago fue rechazado. Actualiza tu medio de pago en <a href="#/cuenta">Cuenta</a> para volver a ver todo el catálogo.'
            : 'Este título está incluido en los planes Básico, Estándar y Premium. Con el plan Gratis puedes ver los títulos marcados como <strong>Gratis</strong>.'}</div>` : ''}
          ${episodes.length ? `
            <div class="section-title">Episodios</div>
            ${episodes.map((e) => {
              const pr = progressByEp.get(String(e.id));
              const pct = pr ? (pr.completed ? 100 : pr.percentWatched || 0) : 0;
              return `<div class="episode" data-ep="${esc(e.id)}" role="button" tabindex="0">
                <div class="num">${e.episodeNumber}</div>
                <div><div>T${e.seasonNumber} · Episodio ${e.episodeNumber}</div>
                  ${pct ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}</div>
                <div class="form-note">${e.durationSeconds ? Math.round(e.durationSeconds / 60) + ' min' : ''} ${watchable ? '' : ICON.lock}</div>
              </div>`;
            }).join('')}` : ''}
          <div id="similar"></div>
        </div>
      </div>`);

    $('#playBtn')?.addEventListener('click', () => playTitle(id, t.type === 'SERIES' ? firstEp : undefined));
    $$('.episode').forEach((el) => {
      const play = () => (watchable ? playTitle(id, el.dataset.ep) : go('#/planes'));
      el.addEventListener('click', play);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
    });

    const sim = await api(`/api/recommendations/titles/${id}/similar?limit=8`);
    const titles = await loadCatalog();
    const byId = new Map(titles.map((x) => [String(x.id), x]));
    const similar = (sim.ok ? sim.data : []).map((s) => byId.get(String(s.titleId))).filter(Boolean);
    const box = $('#similar');
    if (box && similar.length) {
      box.innerHTML = `<div class="section-title">Más títulos parecidos</div><div class="similar-grid">${similar.map((x) => card(x)).join('')}</div>`;
    }
  }

  /* ============================================================ reproductor */
  async function viewPlayer(route) {
    const [titleId, episodeParam] = route.params;
    app.innerHTML = '<div class="player"><div class="loading" style="margin:auto"><div class="spinner"></div></div></div>';
    const t = await getTitle(titleId);
    if (!t) return playerMessage('Título no encontrado', 'Puede que ya no esté en el catálogo.');
    const episodes = (t.seasons || []).flatMap((s) => s.episodes.map((e) => ({ ...e, seasonNumber: s.seasonNumber })));
    const episode = episodes.find((e) => String(e.id) === String(episodeParam)) || (t.type === 'SERIES' ? episodes[0] : null);

    // Token DRM: Playback verifica el plan (vía Gateway), la disponibilidad y la región.
    const tok = await api(`/api/playback/token/${titleId}?${new URLSearchParams({ profileId: session.profile.id, region: session.region })}`);
    if (!tok.ok) {
      if (tok.code === 'PLAN_REQUIRED') return playerMessage('Mejora tu plan para ver este título', tok.message, '<a class="btn" href="#/planes">Ver planes</a>');
      if (tok.status === 451) return playerMessage('No disponible en tu región', tok.message, '<a class="btn btn-outline" href="#/cuenta">Cambiar región</a>');
      return playerMessage('No se pudo iniciar la reproducción', tok.message);
    }

    const resume = await api(`/api/playback/resume/${session.profile.id}?titleId=${titleId}`);
    const last = resume.ok && resume.data && String(resume.data.episodeId || '') === String(episode?.id || '') && !resume.data.completed
      ? resume.data.positionSeconds : 0;
    const subtitle = episode ? `T${episode.seasonNumber} · Episodio ${episode.episodeNumber}` : (t.category || '');
    const nextEp = episode ? episodes[episodes.indexOf(episode) + 1] : null;

    app.innerHTML = `
      <div class="player" id="player">
        <div class="player-top">
          <button class="icon-btn" id="backBtn" aria-label="Volver">${ICON.back}</button>
          <div><div class="t">${esc(t.name)}</div><div class="s">${esc(subtitle)}</div></div>
        </div>
        <video id="video" controls autoplay playsinline preload="auto"></video>
      </div>`;
    const video = $('#video');
    const player = $('#player');
    const sources = videoSources(titleId, episode?.id);
    let sourceIndex = 0;
    video.src = sources[0];
    video.addEventListener('error', () => {
      sourceIndex += 1;
      if (sourceIndex < sources.length) { video.src = sources[sourceIndex]; video.play().catch(() => {}); }
      else playerMessage('No se pudo cargar el video', 'Las fuentes de video de muestra no responden. Inténtalo más tarde.');
    });
    let lastSaved = 0;
    let idleTimer;

    let pendingSave = Promise.resolve();
    // Devuelve siempre el guardado en curso (aunque esta llamada se descarte
    // por repetida), para que quien espere sepa cuándo terminó.
    const save = (completedNow = false) => {
      if (!video.duration || !isFinite(video.duration)) return pendingSave;
      const position = completedNow ? Math.floor(video.duration) : Math.floor(video.currentTime);
      if (!completedNow && Math.abs(position - lastSaved) < 3) return pendingSave;
      lastSaved = position;
      pendingSave = api('/api/playback/progress', {
        method: 'POST',
        body: {
          profileId: session.profile.id,
          titleId: String(titleId),
          ...(episode ? { episodeId: String(episode.id) } : {}),
          positionSeconds: position,
          durationSeconds: Math.floor(video.duration),
          deviceId: 'web',
        },
      });
      return pendingSave;
    };

    video.addEventListener('loadedmetadata', () => { if (last && last < video.duration - 5) video.currentTime = last; });
    video.addEventListener('timeupdate', () => { if (Math.floor(video.currentTime) % 10 === 0) save(); });
    video.addEventListener('pause', () => save());
    video.addEventListener('ended', () => {
      save(true);
      if (nextEp) showNextUp(t, nextEp);
    });
    const wake = () => { player.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => player.classList.add('idle'), 2500); };
    player.addEventListener('mousemove', wake);
    wake();
    // Al volver se espera a que el progreso quede guardado: así "Seguir viendo"
    // ya lo muestra en el inicio.
    $('#backBtn').addEventListener('click', async () => {
      video.pause();
      await save();
      history.length > 1 ? history.back() : go('#/inicio');
    });
    onLeave(() => { save(); video.pause(); clearTimeout(idleTimer); });
  }

  function showNextUp(t, ep) {
    const box = document.createElement('div');
    box.className = 'next-up';
    let n = 8;
    box.innerHTML = `<div class="form-note">A continuación</div><div style="font-weight:600;margin:4px 0 12px">${esc(t.name)} · T${ep.seasonNumber} E${ep.episodeNumber}</div>
      <div style="display:flex;gap:8px"><button class="btn btn-light btn-sm" id="nextGo">${ICON.play} Reproducir (<span id="nextN">${n}</span>)</button>
      <button class="btn btn-ghost btn-sm" id="nextCancel">Cancelar</button></div>`;
    $('#player')?.appendChild(box);
    const timer = setInterval(() => {
      n -= 1; const el = $('#nextN'); if (el) el.textContent = n;
      if (n <= 0) { clearInterval(timer); go(`#/ver/${t.id}/${ep.id}`); }
    }, 1000);
    onLeave(() => clearInterval(timer));
    $('#nextGo').addEventListener('click', () => { clearInterval(timer); go(`#/ver/${t.id}/${ep.id}`); });
    $('#nextCancel').addEventListener('click', () => { clearInterval(timer); box.remove(); });
  }

  function playerMessage(title, message, action = '') {
    app.innerHTML = `
      <div class="player">
        <div class="player-top"><button class="icon-btn" id="backBtn" aria-label="Volver">${ICON.back}</button></div>
        <div class="player-msg"><h2>${esc(title)}</h2><p>${esc(message || '')}</p>
          <div style="display:flex;gap:10px;justify-content:center">${action}<a class="btn btn-ghost" href="#/inicio">Volver al inicio</a></div></div>
      </div>`;
    $('#backBtn').addEventListener('click', () => go('#/inicio'));
  }

  /* ================================================================= planes */
  const PLANS = [
    { id: 'GRATIS', name: 'Gratis', price: 0, profiles: 1, features: ['Títulos seleccionados marcados como Gratis', '1 perfil', 'Sin tarjeta'], missing: ['Todo el catálogo'] },
    { id: 'BASICO', name: 'Básico', price: 7.99, profiles: 2, features: ['Todo el catálogo', '2 perfiles', 'Recomendaciones personalizadas'] },
    { id: 'ESTANDAR', name: 'Estándar', price: 12.99, profiles: 4, featured: true, features: ['Todo el catálogo', '4 perfiles', 'Recomendaciones personalizadas'] },
    { id: 'PREMIUM', name: 'Premium', price: 17.99, profiles: 5, features: ['Todo el catálogo', '5 perfiles', 'Recomendaciones personalizadas', 'Ideal para toda la familia'] },
  ];
  const planName = (id) => PLANS.find((p) => p.id === id)?.name || id;

  async function viewPlans(route) {
    if (session.token) await refreshMe();
    const current = session.account?.plan || 'GRATIS';
    const welcome = route.query.get('bienvenida') === '1';
    app.innerHTML = `
      ${topbar('planes')}
      <div class="page">
        <h1>${welcome ? 'Elige tu plan' : 'Planes'}</h1>
        <p class="lead">${welcome ? 'Tu cuenta ya está lista con el plan Gratis. Puedes seguir así o pasarte a un plan de pago.' : 'Cambia de plan o cancela cuando quieras. El cambio se aplica a toda la cuenta.'}</p>
        ${session.account?.status === 'MOROSA' ? '<div class="notice bad">Tu último pago fue rechazado. Vuelve a suscribirte con otra tarjeta para recuperar el acceso completo.</div>' : ''}
        <div class="plans">
          ${PLANS.map((p) => `
            <div class="plan ${p.id === current ? 'current' : ''} ${p.featured ? 'featured' : ''}">
              ${p.id === current ? '<div class="tag-current">Tu plan actual</div>' : p.featured ? '<div class="tag-current" style="color:var(--gold)">El más elegido</div>' : '<div class="tag-current">&nbsp;</div>'}
              <h3>${p.name}</h3>
              <div class="price">${p.price ? money(p.price) : '$0'}<small> /mes</small></div>
              <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}${(p.missing || []).map((f) => `<li class="no">${esc(f)}</li>`).join('')}</ul>
              ${p.id === current
                ? '<button class="btn btn-outline btn-block" disabled>Plan actual</button>'
                : p.id === 'GRATIS'
                  ? '<button class="btn btn-outline btn-block" data-cancel>Pasar al plan Gratis</button>'
                  : `<button class="btn btn-block" data-plan="${p.id}">${current === 'GRATIS' ? 'Suscribirme' : 'Cambiar a ' + p.name}</button>`}
            </div>`).join('')}
        </div>
        ${welcome ? '<p style="margin-top:26px"><a class="btn btn-ghost" href="#/inicio">Seguir con el plan Gratis</a></p>' : ''}
        <p class="form-note" style="margin-top:22px">Los pagos son simulados (no se cobra dinero real). Tarjeta de prueba: 4242 4242 4242 4242.</p>
      </div>`;
    bindTopbar();
    $$('[data-plan]').forEach((b) => b.addEventListener('click', () => openCheckout(b.dataset.plan, current)));
    $('[data-cancel]')?.addEventListener('click', () => cancelPlan());
  }

  function openCheckout(planId, current) {
    const plan = PLANS.find((p) => p.id === planId);
    openModal(`
      <form class="modal narrow" id="payForm">
        <button type="button" class="modal-close" data-close aria-label="Cerrar">✕</button>
        <h2 style="margin-top:0">${current === 'GRATIS' ? 'Suscribirte a' : 'Cambiar a'} ${esc(plan.name)}</h2>
        <p class="form-note">${money(plan.price)} al mes${current !== 'GRATIS' ? ' · se cobra la diferencia con tu plan actual' : ''}.</p>
        <div class="field"><label for="card">Número de tarjeta</label>
          <input class="input" id="card" inputmode="numeric" autocomplete="cc-number" value="4242 4242 4242 4242" required></div>
        <div class="grid-2">
          <div class="field"><label for="exp">Vencimiento</label><input class="input" id="exp" placeholder="MM/AA" value="12/29"></div>
          <div class="field"><label for="cvc">CVC</label><input class="input" id="cvc" placeholder="123" value="123"></div>
        </div>
        <p class="form-note">Prueba: 4242 4242 4242 4242 → aprobada · 4000 0000 0000 0002 → rechazada.</p>
        <div class="form-error" id="payErr"></div>
        <button class="btn btn-block" type="submit">Pagar ${money(plan.price)}</button>
      </form>`);
    $('#payForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', e.target);
      const err = $('#payErr');
      btn.disabled = true; btn.textContent = 'Procesando…'; err.textContent = '';
      const cardNumber = $('#card').value.replace(/\s+/g, '');
      const accountId = session.account.id;
      let r = current === 'GRATIS'
        ? await api('/api/billing/subscribe', { method: 'POST', body: { accountId, plan: planId, cardNumber } })
        : await api('/api/billing/plan', { method: 'PUT', body: { accountId, newPlan: planId, cardNumber } });
      // Si el plan se asignó a mano (admin) o la suscripción no coincide, se intenta la otra vía.
      if (!r.ok && current === 'GRATIS' && r.status === 409) {
        r = await api('/api/billing/plan', { method: 'PUT', body: { accountId, newPlan: planId, cardNumber } });
      } else if (!r.ok && current !== 'GRATIS' && r.status === 404) {
        r = await api('/api/billing/subscribe', { method: 'POST', body: { accountId, plan: planId, cardNumber } });
      }
      if (!r.ok) {
        btn.disabled = false; btn.textContent = `Pagar ${money(plan.price)}`;
        err.textContent = r.status === 402 ? 'El pago fue rechazado. Prueba con otra tarjeta.' : r.message;
        return;
      }
      if (r.status === 202) {
        closeModal(); toast('Tu pago quedó pendiente de confirmación. Te avisaremos cuando se apruebe.'); return;
      }
      btn.textContent = 'Activando tu plan…';
      const applied = await waitForPlan(planId);
      closeModal();
      toast(applied ? `¡Listo! Ya tienes el plan ${plan.name}.` : 'Pago aprobado. Tu plan se activará en unos segundos.');
      catalogCache.key = null;
      go('#/inicio');
    });
  }

  /** El plan lo cambia User-Service al recibir el evento de Billing: se espera a que llegue. */
  async function waitForPlan(planId, tries = 12) {
    for (let i = 0; i < tries; i++) {
      const me = await refreshMe();
      if (me.ok && me.data.account.plan === planId) return true;
      await sleep(1500);
    }
    return false;
  }

  async function cancelPlan() {
    if (!confirm('¿Pasar al plan Gratis? Perderás el acceso al catálogo completo al final del cambio.')) return;
    const r = await api('/api/billing/cancel', { method: 'POST', body: { accountId: session.account.id } });
    if (!r.ok) return toast(r.message, true);
    await waitForPlan('GRATIS');
    toast('Tu cuenta ahora está en el plan Gratis.');
    catalogCache.key = null;
    render();
  }

  /* ================================================================= cuenta */
  const STATUS_CLASS = { ACTIVA: 'good', EXITOSO: 'good', AVAILABLE: 'good', MOROSA: 'warn', PAGO_PENDIENTE: 'warn', PENDIENTE: 'warn', PENDING: 'warn', SUSPENDIDA: 'bad', PAGO_FALLIDO: 'bad', FALLIDO: 'bad', UNAVAILABLE: 'bad', CANCELADA: 'neutral' };
  const statusTag = (s) => `<span class="status ${STATUS_CLASS[s] || 'neutral'}">${esc(String(s).replace('_', ' '))}</span>`;
  const REGIONS = ['CO', 'MX', 'AR', 'CL', 'PE', 'US', 'ES', 'GLOBAL'];

  async function viewAccount() {
    app.innerHTML = `${topbar('')}<div class="loading"><div class="spinner"></div></div>`;
    bindTopbar();
    await refreshMe();
    const a = session.account;
    const [history, notifs] = await Promise.all([api(`/api/billing/history/${a.id}`), fetchNotifications()]);
    const payments = (history.ok ? history.data : []).flatMap((s) => (s.payments || []).map((p) => ({ ...p, plan: s.plan })));

    app.innerHTML = `
      ${topbar('')}
      <div class="page" style="max-width:900px">
        <h1>Cuenta</h1>
        <p class="lead">Miembro desde ${fmtDate(a.createdAt)}</p>
        ${a.status === 'MOROSA' ? '<div class="notice bad">Tu último pago fue rechazado: solo puedes ver títulos gratis hasta que vuelvas a pagar. <a href="#/planes">Actualizar pago</a></div>' : ''}
        <section class="panel">
          <h2>Membresía</h2>
          <dl class="kv">
            <dt>Correo</dt><dd>${esc(a.email)}</dd>
            <dt>Plan</dt><dd>${esc(planName(a.plan))} ${a.role === 'ADMIN' ? '<span class="status warn">Administrador</span>' : ''}</dd>
            <dt>Estado</dt><dd>${statusTag(a.status)}</dd>
            <dt>Perfiles</dt><dd>${a.profiles ?? '—'} de ${a.profileLimit ?? '—'}</dd>
          </dl>
          <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
            <a class="btn" href="#/planes">Cambiar plan</a>
            ${a.plan !== 'GRATIS' ? '<button class="btn btn-danger" id="cancelBtn">Cancelar suscripción</button>' : ''}
            <a class="btn btn-outline" href="#/perfiles?editar=1">Administrar perfiles</a>
          </div>
        </section>
        <section class="panel">
          <h2>Preferencias</h2>
          <div class="field" style="max-width:280px"><label for="region">Región del catálogo</label>
            <select class="select" id="region">${REGIONS.map((r) => `<option ${r === session.region ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
          <p class="form-note">El catálogo depende de los acuerdos de licencia de cada región.</p>
        </section>
        <section class="panel">
          <h2>Historial de pagos</h2>
          ${payments.length ? `<ul class="list-plain">${payments.map((p) => `
            <li><span>${fmtDate(p.paidAt || p.createdAt)} · Plan ${esc(planName(p.plan))}</span><span>${money(p.amount)} ${statusTag(p.status)}</span></li>`).join('')}</ul>`
            : '<p class="form-note">Todavía no hay pagos. Estás en el plan Gratis.</p>'}
        </section>
        <section class="panel">
          <h2>Notificaciones</h2>
          ${notifs.length ? `<ul class="list-plain">${notifs.slice(0, 10).map((n) => `<li><span><strong>${esc(n.title)}</strong><br><span class="form-note">${esc(n.message)}</span></span><span class="form-note">${fmtDateTime(n.createdAt)}</span></li>`).join('')}</ul>`
            : '<p class="form-note">Sin notificaciones.</p>'}
        </section>
      </div>`;
    bindTopbar();
    $('#cancelBtn')?.addEventListener('click', () => cancelPlan());
    $('#region').addEventListener('change', (e) => {
      session.region = e.target.value; store.set('region', session.region); catalogCache.key = null;
      toast(`Región cambiada a ${session.region}`);
    });
  }

  /* ========================================================= administración */
  const ADMIN_TABS = [
    ['resumen', 'Resumen'], ['catalogo', 'Catálogo'], ['usuarios', 'Usuarios'],
    ['suscripciones', 'Suscripciones'], ['contenido', 'Subir video'], ['servicios', 'Servicios'],
  ];

  async function viewAdmin(route) {
    if (!isAdmin()) { await refreshMe(); if (!isAdmin()) { toast('Esta sección es solo para administradores.', true); return go('#/inicio'); } }
    const tab = route.params[0] || 'resumen';
    app.innerHTML = `
      ${topbar('admin')}
      <div class="page">
        <h1>Administración</h1>
        <p class="lead">Control de la plataforma: catálogo, usuarios, suscripciones y servicios.</p>
        <nav class="admin-tabs">${ADMIN_TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>
        <div id="adminBody"><div class="loading" style="min-height:200px"><div class="spinner"></div></div></div>
      </div>`;
    bindTopbar();
    const body = $('#adminBody');
    const tabs = { resumen: adminSummary, catalogo: adminCatalog, usuarios: adminUsers, suscripciones: adminSubscriptions, contenido: adminUpload, servicios: adminServices };
    await (tabs[tab] || adminSummary)(body);
  }

  async function adminSummary(body) {
    const [accounts, billing, kpis] = await Promise.all([
      api('/api/users/admin/accounts'), api('/api/billing/admin/overview'), api('/api/analytics/kpis?limit=5'),
    ]);
    const acc = accounts.ok ? accounts.data : [];
    const t = billing.ok ? billing.data.totals : null;
    const k = kpis.ok ? kpis.data : null;
    const planCount = (p) => acc.filter((a) => a.plan === p).length;
    const max = Math.max(1, ...(k?.popularityByRegion || []).map((p) => p.views));
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${acc.length}</div><div class="l">Cuentas registradas</div></div>
        <div class="stat"><div class="v">${planCount('GRATIS')}</div><div class="l">En plan Gratis</div></div>
        <div class="stat"><div class="v">${t ? t.active : '—'}</div><div class="l">Suscripciones activas</div></div>
        <div class="stat"><div class="v">${t ? money(t.monthlyRecurring) : '—'}</div><div class="l">Ingreso mensual recurrente</div></div>
        <div class="stat"><div class="v">${t ? money(t.revenue) : '—'}</div><div class="l">Ingresos cobrados</div></div>
        <div class="stat"><div class="v">${k ? k.totals.hoursWatched : '—'}</div><div class="l">Horas vistas</div></div>
      </div>
      <section class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h2 style="margin:0">Lo más visto</h2>
          <button class="btn btn-outline btn-sm" id="etlBtn">Recalcular KPIs ahora</button>
        </div>
        <p class="form-note">${k?.lastSuccessfulEtl ? 'Actualizado ' + fmtDateTime(k.lastSuccessfulEtl.finishedAt) : 'Los KPIs se calculan periódicamente con un ETL.'}</p>
        ${k && k.popularityByRegion.length ? k.popularityByRegion.map((p) => `
          <div class="bar-row"><span>${esc(p.titleName || 'Título ' + p.titleId)} · ${esc(p.region)}</span>
            <span class="track"><span class="fill" style="display:block;width:${(p.views / max) * 100}%"></span></span>
            <span class="val">${p.views} perf.</span></div>`).join('') : `<p class="form-note">${kpis.ok ? 'Sin datos de reproducción todavía.' : 'Analytics no responde: ' + esc(kpis.message)}</p>`}
      </section>
      <section class="panel">
        <h2>Tasa de abandono más alta</h2>
        ${k && k.abandonmentByEpisode.length ? k.abandonmentByEpisode.map((a) => `
          <div class="bar-row"><span>${esc(a.titleName || 'Título ' + a.titleId)}${a.episodeId ? ' · ep. ' + esc(a.episodeId) : ''}</span>
            <span class="track"><span class="fill" style="display:block;width:${a.abandonmentRate * 100}%"></span></span>
            <span class="val">${Math.round(a.abandonmentRate * 100)}% de ${a.viewers}</span></div>`).join('') : '<p class="form-note">Sin datos todavía.</p>'}
      </section>`;
    $('#etlBtn').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const r = await api('/api/analytics/etl/run', { method: 'POST' });
      if (!r.ok) { e.currentTarget.disabled = false; return toast(r.message, true); }
      toast('KPIs recalculados'); adminSummary(body);
    });
  }

  async function adminCatalog(body) {
    const r = await api('/api/catalog/admin/titles');
    if (!r.ok) { body.innerHTML = `<div class="notice bad">${esc(r.message)}</div>`; return; }
    const titles = r.data;
    const renderTable = (filter = '') => {
      const q = norm(filter);
      const list = titles.filter((t) => !q || norm(t.name).includes(q) || norm(t.category).includes(q));
      $('#catTable').innerHTML = list.length ? `
        <table class="data"><thead><tr><th></th><th>Título</th><th>Tipo</th><th>Estado</th><th>Gratis</th><th>Regiones</th><th></th></tr></thead><tbody>
        ${list.map((t) => `
          <tr data-id="${esc(t.id)}">
            <td><img class="thumb" src="${esc(posterUrl(t, 80, 120))}" alt=""></td>
            <td><strong>${esc(t.name)}</strong><div class="form-note">#${esc(t.id)} · ${esc(t.category || 'Sin categoría')} · ${esc(t.ageRating || 's/c')}</div></td>
            <td>${t.type === 'SERIES' ? `Serie<div class="form-note">${t.seasons} temp. · ${t.episodes} ep.</div>` : 'Película'}</td>
            <td>${statusTag(t.status)}</td>
            <td><label class="check"><input type="checkbox" data-free ${t.isFree ? 'checked' : ''}><span class="sr-only">Gratis</span></label></td>
            <td>${esc(t.regions.join(', ') || '—')}</td>
            <td><div class="actions">
              <button class="btn btn-outline btn-sm" data-edit>Editar</button>
              ${t.status === 'AVAILABLE' ? '<button class="btn btn-outline btn-sm" data-status="UNAVAILABLE">Retirar</button>' : '<button class="btn btn-sm" data-status="AVAILABLE">Publicar</button>'}
              <button class="btn btn-danger btn-sm" data-delete>Eliminar</button>
            </div></td>
          </tr>`).join('')}
        </tbody></table>` : '<p class="empty">No hay títulos.</p>';
    };
    body.innerHTML = `
      <div class="toolbar">
        <input class="input" id="catFilter" placeholder="Filtrar por nombre o categoría">
        <button class="btn" id="newTitle">+ Nuevo título</button>
      </div>
      <p class="form-note">${titles.length} títulos. "Gratis" los deja ver con el plan Gratis; "Publicar" los hace visibles en el catálogo.</p>
      <div class="table-wrap" id="catTable"></div>`;
    renderTable();
    $('#catFilter').addEventListener('input', (e) => renderTable(e.target.value));
    $('#newTitle').addEventListener('click', () => openTitleForm(null, () => adminCatalog(body)));

    const patch = async (id, data, msg) => {
      const res = await api(`/api/catalog/titles/${id}`, { method: 'PATCH', body: data });
      if (!res.ok) { toast(res.message, true); return false; }
      titleCache.delete(String(id)); catalogCache.key = null;
      toast(msg); return true;
    };
    $('#catTable').addEventListener('change', async (e) => {
      if (!e.target.matches('[data-free]')) return;
      const id = e.target.closest('tr').dataset.id;
      const ok = await patch(id, { isFree: e.target.checked }, e.target.checked ? 'Ahora es gratis' : 'Ahora requiere plan de pago');
      if (ok) titles.find((t) => t.id === id).isFree = e.target.checked; else e.target.checked = !e.target.checked;
    });
    $('#catTable').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const t = titles.find((x) => x.id === tr.dataset.id);
      if (e.target.closest('[data-edit]')) return openTitleForm(t, () => adminCatalog(body));
      const st = e.target.closest('[data-status]')?.dataset.status;
      if (st && await patch(t.id, { status: st }, st === 'AVAILABLE' ? 'Título publicado' : 'Título retirado del catálogo')) return adminCatalog(body);
      if (e.target.closest('[data-delete]')) {
        if (!confirm(`¿Eliminar "${t.name}" del catálogo? No se puede deshacer.`)) return;
        const del = await api(`/api/catalog/titles/${t.id}`, { method: 'DELETE' });
        if (!del.ok) return toast(del.message, true);
        titleCache.delete(String(t.id)); catalogCache.key = null;
        toast('Título eliminado'); adminCatalog(body);
      }
    });
  }

  function openTitleForm(t, done) {
    const editing = !!t;
    const categories = Object.keys(CATEGORY_COLORS).map((c) => c.charAt(0).toUpperCase() + c.slice(1));
    openModal(`
      <form class="modal narrow" id="titleForm" style="width:min(620px,100%)">
        <button type="button" class="modal-close" data-close aria-label="Cerrar">✕</button>
        <h2 style="margin-top:0">${editing ? 'Editar título' : 'Nuevo título'}</h2>
        <div class="field"><label for="f_name">Nombre</label><input class="input" id="f_name" required value="${esc(t?.name || '')}"></div>
        <div class="field"><label for="f_syn">Sinopsis</label><textarea class="textarea" id="f_syn">${esc(t?.synopsis || '')}</textarea></div>
        <div class="grid-2">
          <div class="field"><label for="f_type">Tipo</label>
            <select class="select" id="f_type" ${editing ? 'disabled' : ''}><option value="MOVIE">Película</option><option value="SERIES" ${t?.type === 'SERIES' ? 'selected' : ''}>Serie</option></select></div>
          <div class="field"><label for="f_cat">Categoría</label><input class="input" id="f_cat" list="cats" value="${esc(t?.category || '')}">
            <datalist id="cats">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
          <div class="field"><label for="f_age">Clasificación</label>
            <select class="select" id="f_age">${['G', 'PG', 'PG-13', 'R'].map((x) => `<option ${t?.ageRating === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label for="f_regions">Regiones (separadas por coma)</label><input class="input" id="f_regions" value="${esc((t?.regions || ['CO', 'MX']).join(', '))}"></div>
        </div>
        <div class="field"><label for="f_poster">URL de la imagen (opcional)</label><input class="input" id="f_poster" type="url" placeholder="https://…" value="${esc(t?.posterUrl || '')}"></div>
        ${!editing ? `
          <div class="grid-2" id="seriesFields" hidden>
            <div class="field"><label for="f_seasons">Temporadas</label><input class="input" id="f_seasons" type="number" min="1" max="20" value="1"></div>
            <div class="field"><label for="f_eps">Episodios por temporada</label><input class="input" id="f_eps" type="number" min="1" max="50" value="6"></div>
          </div>` : ''}
        <label class="check" style="margin-bottom:8px"><input type="checkbox" id="f_free" ${t?.isFree ? 'checked' : ''}> Gratis (visible con el plan Gratis)</label>
        ${!editing ? '<label class="check"><input type="checkbox" id="f_pub" checked> Publicar de inmediato (sin esperar a Media Processing)</label>' : ''}
        <div class="form-error" id="f_err"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button class="btn" type="submit">${editing ? 'Guardar cambios' : 'Crear título'}</button>
        </div>
      </form>`);
    const toggleSeries = () => { const sf = $('#seriesFields'); if (sf) sf.hidden = $('#f_type').value !== 'SERIES'; };
    $('#f_type').addEventListener('change', toggleSeries); toggleSeries();
    $('#titleForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const regions = $('#f_regions').value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
      const common = {
        name: $('#f_name').value.trim(),
        synopsis: $('#f_syn').value.trim() || undefined,
        category: $('#f_cat').value.trim() || undefined,
        ageRating: $('#f_age').value,
        isFree: $('#f_free').checked,
        posterUrl: $('#f_poster').value.trim(),
      };
      if (!common.name) { $('#f_err').textContent = 'El nombre es obligatorio.'; return; }
      let res;
      if (editing) {
        res = await api(`/api/catalog/titles/${t.id}`, { method: 'PATCH', body: { ...common, regions } });
      } else {
        const type = $('#f_type').value;
        const seasons = type === 'SERIES'
          ? Array.from({ length: Number($('#f_seasons').value) || 1 }, (_, i) => ({
              seasonNumber: i + 1,
              episodes: Array.from({ length: Number($('#f_eps').value) || 1 }, (_, j) => ({ episodeNumber: j + 1, durationSeconds: 2700 })),
            }))
          : undefined;
        res = await api('/api/catalog/titles', {
          method: 'POST',
          body: {
            ...common,
            posterUrl: common.posterUrl || undefined,
            type,
            seasons,
            publishImmediately: $('#f_pub').checked,
            availabilities: regions.map((region) => ({ region, availableFrom: new Date(Date.now() - 60000).toISOString() })),
          },
        });
      }
      if (!res.ok) { $('#f_err').textContent = res.message; return; }
      if (editing) titleCache.delete(String(t.id));
      catalogCache.key = null;
      closeModal(); toast(editing ? 'Cambios guardados' : 'Título creado'); done();
    });
  }

  async function adminUsers(body) {
    const r = await api('/api/users/admin/accounts');
    if (!r.ok) { body.innerHTML = `<div class="notice bad">${esc(r.message)}</div>`; return; }
    const accounts = r.data;
    const me = session.account.id;
    body.innerHTML = `
      <div class="toolbar"><input class="input" id="userFilter" placeholder="Buscar por correo"></div>
      <p class="form-note">${accounts.length} cuentas. Cambiar el plan aquí es una cortesía manual (no genera cobro).</p>
      <div class="table-wrap" id="userTable"></div>`;
    const renderTable = (filter = '') => {
      const list = accounts.filter((a) => !filter || a.email.toLowerCase().includes(filter.toLowerCase()));
      $('#userTable').innerHTML = `
        <table class="data"><thead><tr><th>#</th><th>Correo</th><th>Rol</th><th>Plan</th><th>Estado</th><th>Perfiles</th><th>Alta</th><th></th></tr></thead><tbody>
        ${list.map((a) => `
          <tr data-id="${esc(a.id)}">
            <td>${esc(a.id)}</td>
            <td>${esc(a.email)}${a.id === me ? ' <span class="form-note">(tú)</span>' : ''}</td>
            <td>${a.role === 'ADMIN' ? '<span class="status warn">Admin</span>' : 'Usuario'}</td>
            <td><select data-plan aria-label="Plan">${PLANS.map((p) => `<option value="${p.id}" ${p.id === a.plan ? 'selected' : ''}>${p.name}</option>`).join('')}</select></td>
            <td>${statusTag(a.status)}</td>
            <td>${a.profiles}</td>
            <td>${fmtDate(a.createdAt)}</td>
            <td><div class="actions">${a.id === me ? '' : `
              ${a.status === 'SUSPENDIDA' || a.status === 'MOROSA' ? '<button class="btn btn-outline btn-sm" data-set="status:ACTIVA">Reactivar</button>' : '<button class="btn btn-outline btn-sm" data-set="status:SUSPENDIDA">Suspender</button>'}
              ${a.role === 'ADMIN' ? '<button class="btn btn-outline btn-sm" data-set="role:USER">Quitar admin</button>' : '<button class="btn btn-outline btn-sm" data-set="role:ADMIN">Hacer admin</button>'}
              <button class="btn btn-danger btn-sm" data-delete>Eliminar</button>`}
            </div></td>
          </tr>`).join('')}
        </tbody></table>`;
    };
    renderTable();
    $('#userFilter').addEventListener('input', (e) => renderTable(e.target.value));
    const update = async (id, data, msg) => {
      const res = await api(`/api/users/admin/accounts/${id}`, { method: 'PATCH', body: data });
      if (!res.ok) { toast(res.message, true); return false; }
      toast(msg); return true;
    };
    $('#userTable').addEventListener('change', async (e) => {
      if (!e.target.matches('[data-plan]')) return;
      const id = e.target.closest('tr').dataset.id;
      if (await update(id, { plan: e.target.value }, `Plan cambiado a ${planName(e.target.value)}`)) accounts.find((a) => a.id === id).plan = e.target.value;
    });
    $('#userTable').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const a = accounts.find((x) => x.id === tr.dataset.id);
      const set = e.target.closest('[data-set]')?.dataset.set;
      if (set) {
        const [field, value] = set.split(':');
        const labels = { 'status:ACTIVA': 'Cuenta reactivada', 'status:SUSPENDIDA': 'Cuenta suspendida', 'role:ADMIN': 'Ahora es administrador', 'role:USER': 'Ya no es administrador' };
        if (await update(a.id, { [field]: value }, labels[set])) adminUsers(body);
        return;
      }
      if (e.target.closest('[data-delete]')) {
        if (!confirm(`¿Eliminar la cuenta ${a.email} y todos sus perfiles?`)) return;
        const del = await api(`/api/users/admin/accounts/${a.id}`, { method: 'DELETE' });
        if (!del.ok) return toast(del.message, true);
        toast('Cuenta eliminada'); adminUsers(body);
      }
    });
  }

  async function adminSubscriptions(body) {
    const r = await api('/api/billing/admin/overview');
    if (!r.ok) { body.innerHTML = `<div class="notice bad">${esc(r.message)}</div>`; return; }
    const { totals, subscriptions } = r.data;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${totals.active}</div><div class="l">Activas</div></div>
        ${Object.entries(totals.activeByPlan).map(([p, n]) => `<div class="stat"><div class="v">${n}</div><div class="l">${esc(planName(p))}</div></div>`).join('')}
        <div class="stat"><div class="v">${money(totals.monthlyRecurring)}</div><div class="l">Ingreso mensual recurrente</div></div>
        <div class="stat"><div class="v">${money(totals.revenue)}</div><div class="l">Cobrado en total</div></div>
      </div>
      <div class="table-wrap">${subscriptions.length ? `
        <table class="data"><thead><tr><th>#</th><th>Cuenta</th><th>Plan</th><th>Estado</th><th>Último pago</th><th>Próximo cobro</th><th>Alta</th></tr></thead><tbody>
        ${subscriptions.map((s) => `<tr>
          <td>${esc(s.id)}</td><td>#${esc(s.accountId)}</td><td>${esc(planName(s.plan))}</td><td>${statusTag(s.status)}</td>
          <td>${s.lastPayment ? `${money(s.lastPayment.amount)} ${statusTag(s.lastPayment.status)}` : '—'}</td>
          <td>${fmtDate(s.nextBillingDate)}</td><td>${fmtDate(s.createdAt)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="empty">Todavía no hay suscripciones.</p>'}</div>`;
  }

  async function adminUpload(body) {
    const r = await api('/api/catalog/admin/titles');
    const titles = r.ok ? r.data : [];
    body.innerHTML = `
      <section class="panel" style="max-width:640px">
        <h2>Subir el video maestro de un título</h2>
        <p class="form-note">Media Processing lo transcodifica con FFmpeg y, al terminar, publica <code>media.ready</code>: Catalog marca el título como disponible y Notification avisa del estreno.</p>
        <div class="field"><label for="u_title">Título</label>
          <select class="select" id="u_title">${titles.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (#${esc(t.id)}, ${esc(t.status)})</option>`).join('')}</select></div>
        <div class="field"><label for="u_file">Archivo de video</label><input class="input" id="u_file" type="file" accept="video/*"></div>
        <button class="btn" id="u_go">Subir y procesar</button>
        <div id="u_status" style="margin-top:16px"></div>
      </section>`;
    $('#u_go').addEventListener('click', async (e) => {
      const file = $('#u_file').files[0];
      const titleId = $('#u_title').value;
      if (!file || !titleId) return toast('Elige un título y un archivo.', true);
      e.currentTarget.disabled = true;
      const form = new FormData(); form.append('file', file);
      const res = await api(`/api/media/ingest?title_id=${encodeURIComponent(titleId)}`, { method: 'POST', form });
      e.currentTarget.disabled = false;
      if (!res.ok) return toast(res.message, true);
      const status = $('#u_status');
      const poll = async () => {
        const job = await api(`/api/media/jobs/${res.data.id}`);
        if (!job.ok) { status.innerHTML = `<div class="notice bad">${esc(job.message)}</div>`; return; }
        status.innerHTML = `<div class="notice ${job.data.status === 'completed' ? 'ok' : job.data.status === 'error' ? 'bad' : ''}">Job ${esc(job.data.id)}: <strong>${esc(job.data.status)}</strong></div>`;
        if (!['completed', 'error'].includes(job.data.status)) { const t = setTimeout(poll, 2500); onLeave(() => clearTimeout(t)); }
        else if (job.data.status === 'completed') { titleCache.delete(String(titleId)); catalogCache.key = null; toast('Video procesado: el título ya está disponible.'); }
      };
      poll();
    });
  }

  async function adminServices(body) {
    wakeAll();
    const r = await api('/health/services', { auth: false });
    const services = r.ok ? r.data.services : [];
    body.innerHTML = `
      <p class="form-note">Estado de cada microservicio detrás del API Gateway (su <code>/health/ready</code>). En el plan gratis de Render, un servicio dormido tarda ~50 s en despertar.</p>
      <div class="svc-grid">${services.map((s) => `
        <div class="svc"><span class="dot ${s.ok ? 'ok' : 'off'}"></span><div><strong>${esc(s.service)}</strong><div class="form-note">${s.ok ? `${s.latencyMs} ms` : s.status === 502 ? 'dormido · se despierta al usarlo' : 'sin respuesta'}</div></div></div>`).join('') || '<p class="empty">El Gateway no responde.</p>'}</div>
      <p style="margin-top:16px"><button class="btn btn-outline btn-sm" id="svcRefresh">Actualizar</button></p>`;
    $('#svcRefresh').addEventListener('click', () => adminServices(body));
  }

  /* ================================================================ arranque */
  (async () => {
    wakeAll();
    if (session.token && tokenValid()) {
      const me = await refreshMe();
      if (!me.ok && me.status === 401) { logout('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
    }
    render();
  })();
})();
