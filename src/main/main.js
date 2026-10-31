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
const avatar = require('./profile/avatar');
const instances = require('./instances/instance-manager');
const bedrock = require('./game/bedrock');
const { launch } = require('./game/launch');

let win;
let user = null; // { gamertag, xuid, skinUrl }

const url = (...p) => pathToFileURL(paths.asset(...p)).href;
const devTag = () => process.env.SUMMER_DEV_GAMERTAG || config.devGamertag;

async function sessionView() {
  await db.registerLogin(user.gamertag, user.xuid);
  return {
    gamertag: user.gamertag,
    avatar: await avatar.resolve(user.gamertag, user.skinUrl),
    instances: instances.listFor(user.gamertag),
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 680, minWidth: 940, minHeight: 560,
    title: config.name, backgroundColor: '#000000', autoHideMenuBar: true, show: false,
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
    await db.refresh();
    instances.loadFolder();
    if (devTag()) user = { gamertag: devTag(), xuid: 'dev', skinUrl: null };
    else user = await auth().restore();
    return user ? sessionView() : null;
  });

  ipcMain.handle('auth:login', async (_e, gamertag) => {
    try {
      await db.refresh();
      user = devTag() ? { gamertag: devTag(), xuid: 'dev', skinUrl: null } : await auth().login(gamertag);
      return { ok: true, session: await sessionView() };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('auth:logout', () => { auth().logout(); user = null; return true; });

  ipcMain.handle('instances:list', async () => {
    if (!user) return [];
    await db.refresh();
    instances.loadFolder();
    return instances.listFor(user.gamertag);
  });

  ipcMain.handle('instance:launch', async (_e, id) => {
    const inst = instances.get(id);
    if (!user || !inst) return { ok: false, error: 'Instancia no encontrada' };
    if (inst.access !== 'public' && !db.canAccess(user.gamertag, inst.id)) return { ok: false, error: 'Tu cuenta no tiene acceso a esta instancia' };
    try {
      const r = await launch(inst, (pct, msg) => win.webContents.send('launch:progress', { pct, msg }));
      return { ok: true, warnings: r.warnings };
    } catch (e) { return { ok: false, error: e.message }; }
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
