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
    el.className = 'inst' + (i.locked ? ' locked' : '');
    el.innerHTML = `<div class="thumb">${i.thumbnail ? `<img src="${i.thumbnail}" alt="">` : `<b>${i.name[0] || '?'}</b>`}<span class="play">${i.locked ? 'BLOQUEADO' : 'JUGAR'}</span></div><span class="name"></span>`;
    el.querySelector('.name').textContent = i.name;
    el.addEventListener('click', () => (i.locked ? toast(i.lockMessage || 'Esta instancia está bloqueada por ahora', true, 6000) : launchInstance(i)));
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
  if (res.locked) return;
  if (!res.ok) return toast(res.error, true, 8000);
  if (res.warnings && res.warnings.length) toast(res.warnings.join('\n'), true, 9000);
  else toast(`${inst.name} iniciada`);
}

/* ---------------- Vistas ---------------- */
function showView(name) {
  $('#viewInstances').classList.toggle('hidden', name !== 'instances');
  $('#viewSettings').classList.toggle('hidden', name !== 'settings');
  $('#viewSkins').classList.toggle('hidden', name !== 'skins');
  document.querySelector('.tab').textContent = { settings: 'CONFIGURACIÓN', skins: 'SKINS' }[name] || 'INSTANCIAS';
  if (name === 'settings') loadSettings();
  if (name === 'skins') loadSkins();
}

/* ---------------- Skins ---------------- */
let skinState = { skins: [], selected: null };
let pendingSkin = null;

// Dibuja la skin de frente (cabeza, cuerpo, brazos y piernas, con la segunda capa).
function drawSkin(canvas, img, slim) {
  const k = img.width / 64;
  const legacy = img.height === img.width / 2;
  const aw = slim ? 3 : 4;
  canvas.width = 16 * k; canvas.height = 32 * k;
  const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
  const part = (sx, sy, w, h, dx, dy, mirror) => {
    if (mirror) { g.save(); g.translate((dx + w) * k, 0); g.scale(-1, 1); g.drawImage(img, sx * k, sy * k, w * k, h * k, 0, dy * k, w * k, h * k); g.restore(); }
    else g.drawImage(img, sx * k, sy * k, w * k, h * k, dx * k, dy * k, w * k, h * k);
  };
  part(8, 8, 8, 8, 4, 0);                       // cabeza
  part(20, 20, 8, 12, 4, 8);                    // cuerpo
  part(44, 20, aw, 12, 4 - aw, 8);              // brazo derecho (a la izquierda de la imagen)
  part(4, 20, 4, 12, 4, 20);                    // pierna derecha
  if (legacy) { part(44, 20, aw, 12, 12, 8, true); part(4, 20, 4, 12, 8, 20, true); }
  else { part(36, 52, aw, 12, 12, 8); part(20, 52, 4, 12, 8, 20); }
  part(40, 8, 8, 8, 4, 0);                      // sombrero
  if (!legacy) {
    part(20, 36, 8, 12, 4, 8);                  // chaqueta
    part(44, 36, aw, 12, 4 - aw, 8); part(52, 52, aw, 12, 12, 8);   // mangas
    part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20);           // pantalones
  }
}

function renderSkins() {
  const grid = $('#skinGrid');
  grid.innerHTML = '';
  const { skins, selected } = skinState;
  $('#skinEmpty').classList.toggle('hidden', skins.length > 0);
  $('#skinCount').textContent = skins.length ? `${skins.length} skin${skins.length === 1 ? '' : 's'}` : '';
  for (const s of skins) {
    const el = document.createElement('button');
    el.className = 'skin' + (s.id === selected ? ' active' : '') + (s.id === pendingSkin ? ' pending' : '');
    el.innerHTML = '<canvas></canvas><span class="sname"></span>';
    el.querySelector('.sname').textContent = s.name;
    if (s.id === selected) el.insertAdjacentHTML('afterbegin', '<span class="badge">ELEGIDA</span>');
    const del = document.createElement('span');
    del.className = 'del'; del.textContent = '×'; del.title = 'Quitar skin';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Quitar la skin «${s.name}»?`)) return;
      skinState = await api.skinsRemove(s.id);
      if (pendingSkin === s.id) pendingSkin = null;
      renderSkins();
    });
    el.append(del);
    const img = new Image();
    img.onload = () => drawSkin(el.querySelector('canvas'), img, s.slim);
    img.src = s.url;
    el.addEventListener('click', () => { pendingSkin = s.id; renderSkins(); });
    grid.append(el);
  }
  const cur = skins.find((x) => x.id === selected);
  const pen = skins.find((x) => x.id === pendingSkin);
  $('#skinBarText').textContent = pen && pen.id !== selected ? `Seleccionada: ${pen.name}` : cur ? `Skin elegida: ${cur.name}` : 'Elige una skin';
  $('#skinChoose').disabled = !(pen && pen.id !== selected);
}

async function loadSkins() {
  skinState = await api.skinsList();
  pendingSkin = skinState.selected;
  renderSkins();
}

async function importSkins() {
  const r = await api.skinsImport();
  if (r.canceled) return;
  skinState = { skins: r.skins, selected: r.selected };
  renderSkins();
  const bad = (r.skipped || []).filter((x) => x.reason !== 'ya estaba importada');
  if (r.added) toast(`${r.added} skin${r.added === 1 ? '' : 's'} importada${r.added === 1 ? '' : 's'}${bad.length ? `. No válidas: ${bad.map((x) => `${x.name} (${x.reason})`).join(', ')}` : ''}`, bad.length > 0, 7000);
  else if (bad.length) toast(`No se importó: ${bad.map((x) => `${x.name} (${x.reason})`).join(', ')}`, true, 8000);
  else toast('Esas skins ya estaban importadas');
}

async function chooseSkin() {
  if (!pendingSkin) return;
  const r = await api.skinsSelect(pendingSkin);
  if (!r.ok) return toast('No se pudo elegir esa skin', true);
  skinState = { skins: r.skins, selected: r.selected };
  renderSkins();
  const s = skinState.skins.find((x) => x.id === skinState.selected);
  toast(`Skin elegida: ${s ? s.name : ''}. Quedará instalada al abrir Minecraft desde una instancia.`);
}

/* ---------------- Bloqueo del launcher ---------------- */
function applyLock(s) {
  const on = !!(s && s.locked);
  $('#lockedMsg').textContent = (s && s.message) || 'Launcher bloqueado momentáneamente';
  $('#locked').classList.toggle('hidden', !on);
  $('#locked').classList.remove('fade');
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
    if (a === 'instances') showView('instances');
    else if (a === 'skin') showView('skins');
    else if (a === 'help') api.openLink('help');
    else if (a === 'settings') showView('settings');
    else if (a === 'logout') $('#confirm').classList.remove('hidden');
  }));
  $('#confirmNo').addEventListener('click', () => $('#confirm').classList.add('hidden'));
  $('#confirm').addEventListener('click', (e) => { if (e.target.id === 'confirm') $('#confirm').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#confirm').classList.add('hidden'); });
  $('#confirmYes').addEventListener('click', async () => {
    $('#confirm').classList.add('hidden');
    await api.logout();
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
  });
  $('#wRefresh').addEventListener('click', async () => {
    const b = $('#wRefresh');
    if (b.classList.contains('spin')) return;
    b.classList.add('spin');
    try {
      const r = await api.refresh();
      if (r && r.instances) { instances = r.instances; renderInstances(); }
      toast('Actualizado');
    } catch { toast('No se pudo actualizar', true); }
    setTimeout(() => b.classList.remove('spin'), 600);
  });
  $('#wMin').addEventListener('click', () => api.minimize());
  $('#wClose').addEventListener('click', () => api.closeWindow());
  document.querySelectorAll('[data-link]').forEach((a) => a.addEventListener('click', () => api.openLink(a.dataset.link)));

  $('#saveOverride').addEventListener('click', async () => {
    await api.setOverride($('#setOverride').value.trim());
    await loadSettings();
    toast('Ruta guardada');
  });
  $('#skinImport').addEventListener('click', importSkins);
  $('#skinChoose').addEventListener('click', chooseSkin);
  $('#skinEditWeb').addEventListener('click', () => api.openLink('editSkin'));
  api.onLock(applyLock);
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
  $('#lockedLogo').src = cfg.logos.studio;
  bind();
  const ms = cfg.authMode === 'microsoft';
  $('#loginBtn').classList.toggle('hidden', !ms);
  $('#gtBox').classList.toggle('hidden', ms);

  api.getLock().then(applyLock);
  const restoring = api.restore();      // mientras suena el intro, se restaura la sesion
  await playIntro();
  const session = await restoring;
  if (session) enterApp(session); else $('#login').classList.remove('hidden');
})();
