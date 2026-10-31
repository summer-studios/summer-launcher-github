// Proceso principal de Summer Launcher.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const config = require('./config');
const paths = require('./paths');
const settings = require('./settings');
const msAuth = require('./auth/microsoft');
const gtAuth = require('./auth/gamertag');
const auth = () => (config.auth && config.auth.mode === 'microsoft' ? msAuth : gtAuth);
const db = require('./database/access-db');
const serversDb = require('./database/servers-db');
const avatar = require('./profile/avatar');
const instances = require('./instances/instance-manager');
const bedrock = require('./game/bedrock');
const { launch } = require('./game/launch');
const splash = require('./game/splash');

let win;
let user = null; // { gamertag, xuid, skinUrl, javaChecked }
let pollTimer = null;

const url = (...p) => pathToFileURL(paths.asset(...p)).href;
const devTag = () => process.env.SUMMER_DEV_GAMERTAG || config.devGamertag;

async function sessionView() {
  await db.registerLogin(user.gamertag, user.xuid);
  return {
    gamertag: user.gamertag,
    avatar: await avatar.resolve(user),
    instances: instances.listFor(user.gamertag),
  };
}

// Lee de nuevo quien puede entrar (access.json) y a que IP (servers.json).
const refreshAll = () => Promise.all([db.refresh(), serversDb.refresh()]);

// Tiempo real: mientras el launcher esta abierto se vuelve a leer la base de datos cada
// pocos segundos; si cambia la lista de instancias de este usuario, la interfaz se actualiza sola.
function startPolling() {
  stopPolling();
  const secs = Math.max(5, Number(config.database && config.database.pollSeconds) || 20);
  let last = user ? JSON.stringify(instances.listFor(user.gamertag)) : null;
  pollTimer = setInterval(async () => {
    if (!user || !win || win.isDestroyed()) return;
    try {
      await refreshAll();
      instances.loadFolder();
      const list = instances.listFor(user.gamertag);
      const key = JSON.stringify(list);
      if (key !== last) win.webContents.send('instances:updated', list);
      last = key;
    } catch (e) { console.warn('[poll]', e.message); }
  }, secs * 1000);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 680, minWidth: 940, minHeight: 560,
    title: config.name, icon: paths.asset('logos', 'icon.png'), backgroundColor: '#000000', autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    name: config.name,
    studio: config.studio,
    intro: { url: url(config.intro.video), skippable: config.intro.skippable },
    loading: { logo: url(config.loadingScreen.logo), background: config.loadingScreen.background, minMs: config.loadingScreen.minMs },
    logos: { studio: url('logos', 'summer-studio.png'), sun: url('logos', 'sun.png') },
    authMode: (config.auth && config.auth.mode) || 'gamertag',
    links: Object.fromEntries(Object.entries(config.links).map(([k, v]) => [k, !!v])),
  }));

  ipcMain.handle('auth:restore', async () => {
    await refreshAll();
    instances.loadFolder();
    if (devTag()) user = { gamertag: devTag(), xuid: 'dev', skinUrl: null };
    else user = await auth().restore();
    if (!user) return null;
    startPolling();
    return sessionView();
  });

  ipcMain.handle('auth:login', async (_e, gamertag) => {
    try {
      await refreshAll();
      user = devTag() ? { gamertag: devTag(), xuid: 'dev', skinUrl: null } : await auth().login(gamertag);
      startPolling();
      return { ok: true, session: await sessionView() };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('auth:logout', () => { auth().logout(); user = null; stopPolling(); return true; });

  ipcMain.handle('instances:list', async () => {
    if (!user) return [];
    await refreshAll();
    instances.loadFolder();
    return instances.listFor(user.gamertag);
  });

  ipcMain.handle('instance:launch', async (_e, id) => {
    const inst = instances.get(id);
    if (!user || !inst) return { ok: false, error: 'Instancia no encontrada' };
    await refreshAll(); // permisos e IP al dia justo antes de entrar
    if (inst.access !== 'public' && !db.canAccess(user.gamertag, inst.id)) return { ok: false, error: 'Tu cuenta no tiene acceso a esta instancia' };
    splash.show(); // tapa las pantallas de arranque de Minecraft con la del launcher
    try {
      const r = await launch(inst, (pct, msg) => win.webContents.send('launch:progress', { pct, msg }));
      splash.finishWhenReady();
      return { ok: true, warnings: r.warnings };
    } catch (e) { splash.close(); return { ok: false, error: e.message }; }
  });

  ipcMain.handle('settings:get', () => {
    const found = bedrock.locate();
    return { comMojang: found && found.comMojang, kind: found && found.kind, override: settings.get().comMojangOverride || '', db: db.info(), version: app.getVersion() };
  });
  ipcMain.handle('settings:setOverride', (_e, p) => { settings.set({ comMojangOverride: p || null }); return true; });
  ipcMain.handle('settings:openFolder', () => { const f = bedrock.locate(); if (f) shell.openPath(f.comMojang); return !!f; });

  ipcMain.handle('link:open', (_e, key) => {
    const target = config.links[key];
    if (target && /^https?:\/\//.test(target)) shell.openExternal(target);
  });
}

app.whenReady().then(() => { registerIpc(); createWindow(); });
app.on('window-all-closed', () => app.quit());
