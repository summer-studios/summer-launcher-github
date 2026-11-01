// Copia al paquete lo que necesita el panel: su codigo, la config del launcher y database/.
const fs = require('fs');
const path = require('path');
const admin = path.join(__dirname, '..');
const root = path.join(admin, '..');
const out = path.join(__dirname, 'bundle');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'root'), { recursive: true });
fs.copyFileSync(path.join(admin, 'summer-admin.js'), path.join(out, 'summer-admin.js'));
fs.copyFileSync(path.join(admin, 'panel.html'), path.join(out, 'panel.html'));
fs.copyFileSync(path.join(root, 'assets', 'logos', 'icon.ico'), path.join(out, 'icon.ico'));
fs.cpSync(path.join(root, 'config'), path.join(out, 'root', 'config'), { recursive: true });
fs.cpSync(path.join(root, 'database'), path.join(out, 'root', 'database'), { recursive: true });
console.log('bundle listo');
