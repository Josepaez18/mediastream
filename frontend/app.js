(() => {
  const CFG = window.MEDIASTREAM_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ================= SESSION ================= */
  const SESSION_KEY = 'mediastream.session';
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; }
    catch { return {}; }
  }
  function saveSession(patch) {
    const s = { ...loadSession(), ...patch };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
    renderSession();
    return s;
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    renderSession();
  }
  function renderSession() {
    const s = loadSession();
    $('#sessAccount').textContent = s.accountId ? `cuenta ${s.accountId}` : 'sin cuenta';
    $('#sessProfile').textContent = s.profileId ? `perfil ${s.profileId}` : 'sin perfil';
    if (s.accountId) $('#b_accountId').value = s.accountId;
    if (s.profileId) {
      $('#p_profileId').value = s.profileId;
      $('#rc_profileId').value = s.profileId;
    }
  }
  function decodeJwtPayload(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return null; }
  }
  $('#clearSession').addEventListener('click', clearSession);

  /* ================= HTTP HELPERS ================= */
  async function api(base, path, { method = 'GET', body, auth, isForm } = {}) {
    const headers = {};
    if (!isForm) headers['Content-Type'] = 'application/json';
    if (auth) {
      const s = loadSession();
      if (s.accessToken) headers['Authorization'] = `Bearer ${s.accessToken}`;
    }
    let res, data;
    try {
      res = await fetch(base + path, {
        method,
        headers,
        body: isForm ? body : body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      return { ok: false, status: 0, data: { message: 'No se pudo conectar: ' + err.message } };
    }
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  }
  function errMsg(data, status) {
    if (!data) return `HTTP ${status}`;
    // Los servicios Node (AllExceptionsFilter) anidan el error de Nest bajo
    // `message`: { statusCode, message: { message: [...], error, statusCode } }.
    // Los servicios Python (FastAPI) usan `detail` directo, sin anidar.
    let m = data.message ?? data.detail ?? data.error;
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      m = m.message ?? m.detail ?? m.error ?? m;
    }
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
    return `HTTP ${status}`;
  }
  function showMsg(el, text, ok) {
    el.textContent = text;
    el.className = 'form-msg ' + (ok ? 'ok' : 'err');
  }
  function showResult(el, data) {
    el.style.display = 'block';
    el.textContent = JSON.stringify(data, null, 2);
  }

  /* ================= NAV ================= */
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      $$('.section').forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');
      $('#sec-' + btn.dataset.section).classList.add('active');
    });
  });

  /* ================= URL LABELS ================= */
  $('#userUrlLabel').textContent = CFG.USER;
  $('#catalogUrlLabel').textContent = CFG.CATALOG;
  $('#playbackUrlLabel').textContent = CFG.PLAYBACK;
  $('#mediaUrlLabel').textContent = CFG.MEDIA;
  $('#recommendationUrlLabel').textContent = CFG.RECOMMENDATION;
  $('#billingUrlLabel').textContent = CFG.BILLING;

  /* ================= HOME: STATUS ================= */
  const SERVICES = [
    { key: 'USER', name: 'User' },
    { key: 'CATALOG', name: 'Catalog' },
    { key: 'PLAYBACK', name: 'Playback' },
    { key: 'MEDIA', name: 'Media Processing' },
    { key: 'RECOMMENDATION', name: 'Recommendation' },
    { key: 'BILLING', name: 'Billing' },
  ];
  function buildStatusGrid() {
    const grid = $('#statusGrid');
    grid.innerHTML = SERVICES.map((s) => `
      <div class="status-card">
        <span class="dot" id="dot-${s.key}"></span>
        <div>
          <div class="name">${s.name}</div>
          <div class="url">${CFG[s.key].replace('https://', '')}</div>
        </div>
      </div>`).join('');
    SERVICES.forEach(async (s) => {
      const dot = $('#dot-' + s.key);
      try {
        const res = await fetch(CFG[s.key] + '/health/ready');
        dot.className = 'dot ' + (res.ok ? 'ok' : 'off');
      } catch {
        dot.className = 'dot off';
      }
    });
  }
  buildStatusGrid();

  /* ================= ACCOUNT (USER) ================= */
  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#registerMsg');
    const { ok, status, data } = await api(CFG.USER, '/api/users/register', {
      method: 'POST',
      body: {
        email: $('#r_email').value.trim(),
        password: $('#r_password').value,
        profileName: $('#r_profileName').value.trim(),
        isKids: $('#r_isKids').checked,
      },
    });
    if (!ok) return showMsg(msg, errMsg(data, status), false);
    saveSession({ accountId: data.account.id, profileId: data.profile.id });
    showMsg(msg, `Cuenta creada (id ${data.account.id}), perfil "${data.profile.name}" (id ${data.profile.id}).`, true);
  });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#loginMsg');
    const { ok, status, data } = await api(CFG.USER, '/api/users/login', {
      method: 'POST',
      body: { email: $('#l_email').value.trim(), password: $('#l_password').value },
    });
    if (!ok) return showMsg(msg, errMsg(data, status), false);
    const payload = decodeJwtPayload(data.accessToken);
    saveSession({ accessToken: data.accessToken, accountId: payload && payload.sub });
    showMsg(msg, `Sesión iniciada. Estado de cuenta: ${data.accountStatus}.`, true);
  });

  $('#loadProfiles').addEventListener('click', async () => {
    const box = $('#profilesResult');
    const s = loadSession();
    if (!s.accountId || !s.accessToken) return showResult(box, { error: 'Inicia sesión primero.' });
    const { ok, status, data } = await api(CFG.USER, `/api/users/profiles/${s.accountId}`, { auth: true });
    showResult(box, ok ? data : { error: errMsg(data, status) });
    if (ok && data[0]) saveSession({ profileId: data[0].id });
  });

  /* ================= CATALOG ================= */
  let lastTitles = [];
  async function loadCatalog() {
    const region = $('#c_region').value.trim() || 'GLOBAL';
    const category = $('#c_category').value.trim();
    const isKids = $('#c_isKids').checked;
    const params = new URLSearchParams({ region });
    if (category) params.set('category', category);
    if (isKids) params.set('isKids', 'true');
    const { ok, data } = await api(CFG.CATALOG, '/api/catalog/titles?' + params.toString());
    lastTitles = ok ? data : [];
    renderTitleGrid(lastTitles);
  }
  function renderTitleGrid(titles) {
    const grid = $('#titleGrid');
    if (!titles.length) { grid.innerHTML = '<p style="color:var(--ink-faint)">Sin resultados.</p>'; return; }
    grid.innerHTML = titles.map((t) => `
      <div class="title-card" data-id="${t.id}">
        <div class="name">${t.name}</div>
        <div class="meta">${t.type} · ${t.category || 's/c'} · ${t.ageRating || 's/r'}</div>
        <span class="badge status-${t.status}">${t.status}</span>
      </div>`).join('');
    $$('.title-card', grid).forEach((card) => {
      card.addEventListener('click', () => showTitleDetail(card.dataset.id));
    });
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso; }
  }
  function renderTitleDetail(title, availability) {
    let seasonsHtml = '';
    if (title.seasons && title.seasons.length) {
      seasonsHtml = '<div class="detail-section-title">Temporadas</div>' + title.seasons.map((s) => `
        <div class="season-block">
          <div class="season-head">Temporada ${s.seasonNumber}</div>
          ${(s.episodes || []).map((e) => `
            <div class="episode-row">
              <span>Episodio ${e.episodeNumber}</span>
              <span>${e.durationSeconds ? Math.round(e.durationSeconds / 60) + ' min' : 'Duración sin registrar'}</span>
            </div>`).join('') || '<div class="episode-row"><span>Sin episodios cargados</span></div>'}
        </div>`).join('');
    }

    const now = new Date();
    let availHtml = '<div class="detail-section-title">Disponibilidad regional</div>';
    if (availability && availability.length) {
      availHtml += availability.map((a) => {
        const isNow = a.isAvailableNow ?? (new Date(a.availableFrom) <= now && (!a.availableUntil || new Date(a.availableUntil) >= now));
        return `
        <div class="avail-row">
          <div>
            <div class="avail-region">${escapeHtml(a.region)}</div>
            <div class="avail-dates">${fmtDate(a.availableFrom)} → ${a.availableUntil ? fmtDate(a.availableUntil) : 'sin fecha límite'}</div>
          </div>
          <span class="pill ${isNow ? 'now' : 'not-now'}">${isNow ? 'vigente' : 'no vigente'}</span>
        </div>`;
      }).join('');
    } else {
      availHtml += '<p class="empty-note">Este título no tiene disponibilidad regional configurada.</p>';
    }

    return `
      <h3>${escapeHtml(title.name)}</h3>
      <div class="detail-tags">
        <span class="tag" title="Úsalo en Reproducción y Media Processing">ID ${escapeHtml(title.id)}</span>
        <span class="tag">${title.type}</span>
        <span class="tag">${title.status}</span>
        ${title.category ? `<span class="tag">${escapeHtml(title.category)}</span>` : ''}
        ${title.ageRating ? `<span class="tag">${escapeHtml(title.ageRating)}</span>` : ''}
      </div>
      <p class="detail-synopsis ${title.synopsis ? '' : 'empty'}">${escapeHtml(title.synopsis || 'Sin sinopsis registrada.')}</p>
      ${seasonsHtml}
      ${availHtml}
    `;
  }
  async function showTitleDetail(id) {
    const detailCard = $('#titleDetailCard');
    const box = $('#titleDetail');
    detailCard.style.display = 'block';
    box.innerHTML = '<p class="empty-note">Cargando…</p>';
    const [title, avail] = await Promise.all([
      api(CFG.CATALOG, `/api/catalog/titles/${id}`),
      api(CFG.CATALOG, `/api/catalog/titles/${id}/availability`),
    ]);
    box.innerHTML = title.ok
      ? renderTitleDetail(title.data, avail.data)
      : `<p style="color:var(--off)">${errMsg(title.data, title.status)}</p>`;
    $('#p_titleId').value = id;
    $('#m_titleId').value = id;
    $('#rc_titleId').value = id;
  }
  $('#loadCatalog').addEventListener('click', loadCatalog);
  loadCatalog();

  $('#createTitleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#createTitleMsg');
    const region = $('#t_region').value.trim() || 'CO';
    const payload = {
      name: $('#t_name').value.trim(),
      type: $('#t_type').value,
      synopsis: $('#t_synopsis').value.trim() || undefined,
      category: $('#t_category').value.trim() || undefined,
      ageRating: $('#t_ageRating').value.trim() || undefined,
      publishImmediately: $('#t_publishImmediately').checked,
      availabilities: [{ region, availableFrom: new Date().toISOString() }],
    };
    const { ok, status, data } = await api(CFG.CATALOG, '/api/catalog/titles', { method: 'POST', body: payload });
    if (!ok) return showMsg(msg, errMsg(data, status), false);
    showMsg(msg, `Título "${data.name}" creado (id ${data.id}, estado ${data.status}).`, true);
    e.target.reset();
    loadCatalog();
  });

  /* ================= PLAYBACK ================= */
  $('#getToken').addEventListener('click', async () => {
    const box = $('#tokenResult');
    const titleId = $('#p_titleId').value.trim();
    const profileId = $('#p_profileId').value.trim();
    const region = $('#p_region').value.trim() || 'CO';
    const { ok, status, data } = await api(
      CFG.PLAYBACK,
      `/api/playback/token/${titleId}?${new URLSearchParams({ profileId, region })}`,
    );
    showResult(box, ok ? data : { error: errMsg(data, status) });
  });

  $('#saveProgress').addEventListener('click', async () => {
    const msg = $('#progressMsg');
    const { ok, status, data } = await api(CFG.PLAYBACK, '/api/playback/progress', {
      method: 'POST',
      body: {
        profileId: $('#p_profileId').value.trim(),
        titleId: $('#p_titleId').value.trim(),
        positionSeconds: Number($('#pr_position').value),
        durationSeconds: Number($('#pr_duration').value),
      },
    });
    if (!ok) return showMsg(msg, errMsg(data, status), false);
    showMsg(msg, `Progreso guardado (${data.completed ? 'completado' : 'en curso'}).`, true);
  });

  $('#loadResume').addEventListener('click', async () => {
    const box = $('#resumeResult');
    const profileId = $('#p_profileId').value.trim();
    const { ok, status, data } = await api(
      CFG.PLAYBACK,
      `/api/playback/resume/${profileId}?includeCompleted=true`,
    );
    showResult(box, ok ? data : { error: errMsg(data, status) });
  });

  /* ================= MEDIA PROCESSING ================= */
  $('#submitIngest').addEventListener('click', async () => {
    const msg = $('#ingestMsg');
    const titleId = $('#m_titleId').value.trim();
    const file = $('#m_file').files[0];
    if (!titleId || !file) return showMsg(msg, 'Falta el id del título o el archivo.', false);
    const form = new FormData();
    form.append('file', file);
    const { ok, status, data } = await api(
      CFG.MEDIA,
      `/api/media/ingest?${new URLSearchParams({ title_id: titleId })}`,
      { method: 'POST', body: form, isForm: true },
    );
    if (!ok) return showMsg(msg, errMsg(data, status), false);
    $('#m_jobId').value = data.id;
    showMsg(msg, `Job creado (id ${data.id}, estado ${data.status}). Consúltalo abajo.`, true);
  });

  $('#checkJob').addEventListener('click', async () => {
    const box = $('#jobResult');
    const jobId = $('#m_jobId').value.trim();
    const { ok, status, data } = await api(CFG.MEDIA, `/api/media/jobs/${jobId}`);
    showResult(box, ok ? data : { error: errMsg(data, status) });
  });

  /* ================= RECOMMENDATION ================= */
  async function resolveTitleNames(ids) {
    const out = {};
    await Promise.all(ids.map(async (id) => {
      const { ok, data } = await api(CFG.CATALOG, `/api/catalog/titles/${id}`);
      out[id] = ok ? data.name : `título ${id}`;
    }));
    return out;
  }
  $('#getRecommendations').addEventListener('click', async () => {
    const grid = $('#recommendationCards');
    const profileId = $('#rc_profileId').value.trim();
    const region = $('#rc_region').value.trim();
    const params = new URLSearchParams({ limit: '10' });
    if (region) params.set('region', region);
    if ($('#rc_isKids').checked) params.set('isKids', 'true');
    const { ok, status, data } = await api(CFG.RECOMMENDATION, `/api/recommendations/${profileId}?${params}`);
    if (!ok) { grid.innerHTML = `<p style="color:var(--off)">${errMsg(data, status)}</p>`; return; }
    const names = await resolveTitleNames(data.items.map((i) => i.titleId));
    grid.innerHTML = data.items.map((i) => `
      <div class="title-card">
        <div class="name">${names[i.titleId]}</div>
        <div class="meta">score ${i.score.toFixed(3)} · ${i.reason.kind}</div>
      </div>`).join('') || '<p style="color:var(--ink-faint)">Sin recomendaciones todavía.</p>';
  });

  $('#getSimilar').addEventListener('click', async () => {
    const box = $('#similarResult');
    const titleId = $('#rc_titleId').value.trim();
    const { ok, status, data } = await api(CFG.RECOMMENDATION, `/api/recommendations/titles/${titleId}/similar`);
    showResult(box, ok ? data : { error: errMsg(data, status) });
  });

  /* ================= BILLING ================= */
  $('#subscribe').addEventListener('click', async () => {
    const box = $('#subscribeResult');
    const { ok, status, data } = await api(CFG.BILLING, '/api/billing/subscribe', {
      method: 'POST',
      body: {
        accountId: $('#b_accountId').value.trim(),
        plan: $('#b_plan').value,
        cardNumber: $('#b_card').value.trim(),
      },
    });
    showResult(box, ok ? data : { error: errMsg(data, status) });
    if (data && data.id) $('#w_subscriptionId').value = data.id;
  });

  $('#sendWebhook').addEventListener('click', async () => {
    const msg = $('#webhookMsg');
    const { ok, status, data } = await api(CFG.BILLING, '/api/billing/webhook', {
      method: 'POST',
      body: {
        subscriptionId: $('#w_subscriptionId').value.trim(),
        eventType: $('#w_eventType').value,
      },
    });
    if (!ok) return showMsg(msg, errMsg(data, status), false);
    showMsg(msg, 'Webhook procesado.', true);
  });

  $('#loadHistory').addEventListener('click', async () => {
    const box = $('#historyResult');
    const accountId = $('#b_accountId').value.trim();
    const { ok, status, data } = await api(CFG.BILLING, `/api/billing/history/${accountId}`);
    showResult(box, ok ? data : { error: errMsg(data, status) });
  });

  renderSession();
})();
