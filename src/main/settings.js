// Ajustes locales del usuario (se guardan en userData/settings.json).
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const file = () => path.join(paths.userData(), 'settings.json');

function get() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}
function set(patch) {
  const next = { ...get(), ...patch };
  fs.mkdirSync(paths.userData(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
module.exports = { get, set };
