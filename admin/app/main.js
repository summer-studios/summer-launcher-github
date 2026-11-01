// Summer Admin como app de escritorio: arranca el mismo panel de admin/summer-admin.js dentro de una ventana.
const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

const root = app.isPackaged ? path.join(process.resourcesPath, 'root') : path.join(__dirname, 'bundle', 'root');
const cfgFile = path.join(app.getPath('userData'), 'admin.config.json');
process.env.SUMMER_ROOT = root;
process.env.SUMMER_ADMIN_CONFIG = cfgFile;
process.env.SUMMER_ADMIN_NO_OPEN = '1';
const admin = require('./bundle/summer-admin.js');

let win = null;
let server = null;

const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { return {}; } };
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

function showSetup(message) {
  if (server) { try { server.close(); } catch { /* ya cerrado */ } server = null; }
  win.loadFile(path.join(__dirname, 'setup.html'), message ? { query: { m: message } } : undefined);
}

async function start() {
  const cfg = admin.loadConfig();
  if (!cfg.token) return showSetup();
  try {
    cfg.port = await freePort();
    const store = admin.makeStore(cfg, false);
    if (server) { try { server.close(); } catch { /* ya cerrado */ } }
    server = admin.startPanel(cfg, store);
    server.once('listening', () => win.loadURL(`http://127.0.0.1:${cfg.port}/`));
    server.once('error', (e) => showSetup(`No se pudo abrir el panel: ${e.message}`));
  } catch (e) { showSetup(e.message); }
}

async function createGist() {
  try {
    const g = await admin.crearGist(admin.loadConfig());
    const snippet = `gist: { user: '${g.user}', id: '${g.id}' },`;
    clipboard.writeText(snippet);
    await dialog.showMessageBox(win, { type: 'info', title: 'Gist creado', message: 'Gist creado. Ya está copiado al portapapeles.',
      detail: `Pega esto en config/launcher.config.js (sección gist) y recompila el launcher:\n\n${snippet}\n\nCierra y abre este panel para que use el gist.` });
  } catch (e) { dialog.showErrorBox('No se pudo crear el gist', e.message); }
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1180, height: 800, title: 'Summer Admin', icon: path.join(__dirname, 'bundle', 'icon.ico'), backgroundColor: '#0b0714',
    autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Panel', submenu: [
    { label: 'Recargar', accelerator: 'F5', click: () => start() },
    { label: 'Crear gist de datos (una vez)', click: createGist },
    { label: 'Cambiar token', click: () => showSetup() },
    { type: 'separator' }, { role: 'quit', label: 'Salir' },
  ] }]));
  ipcMain.handle('setup:save', (_e, token) => {
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify({ ...readCfg(), githubToken: String(token).trim() }, null, 2));
    return start();
  });
  start();
});

app.on('window-all-closed', () => app.quit());
