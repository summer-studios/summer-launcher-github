// Rutas base. En desarrollo la raiz es la carpeta del proyecto; empaquetado, es "resources".
const { app } = require('electron');
const path = require('path');

const ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');

module.exports = {
  ROOT,
  inRoot: (...p) => path.join(ROOT, ...p),
  asset: (...p) => path.join(ROOT, 'assets', ...p),
  userData: () => app.getPath('userData'),
};
