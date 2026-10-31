const $ = (s) => document.querySelector(s);
const api = window.summer;
let cfg = null;
let instances = [];

function toast(msg, isErr = false, ms = 5000) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------------- Intro ---------------- */
function playIntro() {
  return new Promise((resolve) => {
    const overlay = $('#intro');
    const video = $('#introVideo');
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      overlay.classList.add('fade');
      setTimeout(() => { overlay.classList.add('hidden'); video.pause(); }, 650);
      resolve();
    };
    if (!cfg.intro.skippable) $('#skipHint').remove(); else overlay.addEventListener('click', end);
    video.addEventListener('ended', end);
    video.addEventListener('error', end);
    video.src = cfg.intro.url;
    video.play().catch(end);
    setTimeout(end, 30000); // seguro por si el video falla
  });
}

/* ---------------- Perfil ---------------- */
function renderAvatar(av, name) {
  const box = $('#avatar');
  box.innerHTML = '';
  const placeholder = () => { box.innerHTML = `<span class="ph">${(name[0] || '?').toUpperCase()}</span>`; };
  if (av.type === 'photo') {
    const img = new Image(); img.src = av.dataUrl; box.append(img);
  } else if (av.type === 'skin') {
    const img = new Image();
    img.onload = () => {
      const k = img.width / 64;                      // soporta skins 64x64 y de mayor resolucion
      const c = document.createElement('canvas'); c.width = c.height = 8 * k;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(img, 8 * k, 8 * k, 8 * k, 8 * k, 0, 0, 8 * k, 8 * k);    // cara
      g.drawImage(img, 40 * k, 8 * k, 8 * k, 8 * k, 0, 0, 8 * k, 8 * k);   // capa exterior
      box.append(c);
    };
    img.onerror = placeholder;
    img.src = av.dataUrl;
  } else placeholder();
}

/* ---------------- Instancias ---------------- */
function renderInstances() {
  const q = $('#search').value.trim().toLowerCase();
  const list = instances.filter((i) => i.name.toLowerCase().includes(q));
  const grid = $('#grid');
  grid.innerHTML = '';
  for (const i of list) {
    const el = document.createElement('button');
    el.className = 'inst';
    el.innerHTML = `<div class="thumb">${i.thumbnail ? `<img src="${i.thumbnail}" alt="">` : `<b>${i.name[0] || '?'}</b>`}<span class="play">JUGAR</span></div><span class="name"></span>`;
    el.querySelector('.name').textContent = i.name;
    el.addEventListener('click', () => launchInstance(i));
    grid.append(el);
  }
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#empty').textContent = instances.length ? 'Ninguna instancia coincide con tu búsqueda.' : 'No hay instancias disponibles para tu cuenta todavía.';
}

async function launchInstance(inst) {
  const overlay = $('#loading');
  overlay.classList.remove('hidden', 'fade');
  $('#loadingBar').style.width = '4%';
  $('#loadingMsg').textContent = `Iniciando ${inst.name}…`;
  const t0 = Date.now();
  const res = await api.launch(inst.id);
  const wait = Math.max(0, cfg.loading.minMs - (Date.now() - t0));
  await new Promise((r) => setTimeout(r, wait));
  overlay.classList.add('fade');
  setTimeout(() => overlay.classList.add('hidden'), 650);
  if (!res.ok) return toast(res.error, true, 8000);
  if (res.warnings && res.warnings.length) toast(res.warnings.join('\n'), true, 9000);
  else toast(`${inst.name} iniciada`);
}

/* ---------------- Vistas ---------------- */
function showView(name) {
  $('#viewInstances').classList.toggle('hidden', name !== 'instances');
  $('#viewSettings').classList.toggle('hidden', name !== 'settings');
  document.querySelector('.tab').textContent = name === 'settings' ? 'CONFIGURACIÓN' : 'INSTANCIAS';
  if (name === 'settings') loadSettings();
}

async function loadSettings() {
  const s = await api.getSettings();
  $('#setKind').textContent = s.kind || 'No detectado';
  $('#setPath').textContent = s.comMojang || 'no encontrada';
  const src = { github: 'GitHub (en línea)', cache: 'Copia en caché', local: 'Copia local', none: '—' }[s.db.source];
  $('#setDb').textContent = src;
  $('#setVer').textContent = s.version;
  $('#setOverride').value = s.override || '';
}

function enterApp(session) {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#username').textContent = session.gamertag;
  renderAvatar(session.avatar, session.gamertag);
  instances = session.instances;
  showView('instances');
  renderInstances();
}

/* ---------------- Eventos ---------------- */
function bind() {
  const doLogin = async (btn) => {
    btn.disabled = true; $('#loginError').textContent = '';
    const r = await api.login($('#gtInput').value);
    btn.disabled = false;
    if (r.ok) enterApp(r.session); else $('#loginError').textContent = r.error;
  };
  $('#loginBtn').addEventListener('click', () => doLogin($('#loginBtn')));
  $('#gtBtn').addEventListener('click', () => doLogin($('#gtBtn')));
  $('#gtInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin($('#gtBtn')); });
  $('#collapse').addEventListener('click', () => $('#app').classList.toggle('collapsed'));
  $('#search').addEventListener('input', renderInstances);
  $('.tab').addEventListener('click', () => showView('instances'));

  document.querySelectorAll('nav [data-action]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.action;
    if (a === 'skin') api.openLink('editSkin');
    else if (a === 'help') api.openLink('help');
    else if (a === 'settings') showView('settings');
    else if (a === 'logout') {
      await api.logout();
      $('#app').classList.add('hidden');
      $('#login').classList.remove('hidden');
    }
  }));
  document.querySelectorAll('[data-link]').forEach((a) => a.addEventListener('click', () => api.openLink(a.dataset.link)));

  $('#saveOverride').addEventListener('click', async () => {
    await api.setOverride($('#setOverride').value.trim());
    await loadSettings();
    toast('Ruta guardada');
  });
  $('#openFolder').addEventListener('click', async () => { if (!(await api.openGameFolder())) toast('No se encontró la carpeta del juego', true); });

  // Tiempo real: el launcher avisa cuando cambian las instancias que este usuario puede ver.
  api.onInstancesUpdated((list) => {
    instances = list;
    if (!$('#viewInstances').classList.contains('hidden')) renderInstances();
    toast('Tu lista de instancias se actualizó');
  });

  api.onProgress(({ pct, msg }) => {
    $('#loadingBar').style.width = `${pct}%`;
    $('#loadingMsg').textContent = msg;
  });
}

/* ---------------- Arranque ---------------- */
(async function boot() {
  cfg = await api.init();
  document.title = cfg.name;
  $('#loginLogo').src = cfg.logos.studio;
  $('#studioLogo').src = cfg.logos.studio;
  $('#loadingLogo').src = cfg.loading.logo;
  $('#loading').style.background = cfg.loading.background;
  bind();
  const ms = cfg.authMode === 'microsoft';
  $('#loginBtn').classList.toggle('hidden', !ms);
  $('#gtBox').classList.toggle('hidden', ms);

  const restoring = api.restore();      // mientras suena el intro, se restaura la sesion
  await playIntro();
  const session = await restoring;
  if (session) enterApp(session); else $('#login').classList.remove('hidden');
})();
