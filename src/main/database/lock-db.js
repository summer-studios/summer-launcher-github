// Bloqueo remoto del launcher. Fuente: database/launcher.json (GitHub, cache o copia local; ver remote.js).
// Se cambia con el panel admin: { "locked": true, "message": "..." }.
const config = require('../config');
const { loadJson } = require('./remote');

const DEFAULT_MESSAGE = 'Launcher bloqueado momentáneamente';
let state = { locked: false, message: DEFAULT_MESSAGE, instances: {} };

const section = () => config.lock || { file: 'database/launcher.json', remoteUrl: null };

async function refresh() {
  try {
    const s = section();
    const r = await loadJson({
      file: s.file || 'database/launcher.json',
      remoteUrl: s.remoteUrl,
      cacheName: 'lock.cache.json',
      valid: (d) => d && typeof d.locked === 'boolean',
    });
    const inst = {};
    for (const [id, v] of Object.entries(r.data.instances && typeof r.data.instances === 'object' ? r.data.instances : {})) {
      if (v && v.locked === true) inst[id] = { locked: true, message: String(v.message || 'Esta instancia está bloqueada por ahora').slice(0, 300) };
    }
    state = { locked: r.data.locked === true, message: String(r.data.message || DEFAULT_MESSAGE).slice(0, 300), instances: inst };
  } catch (e) { console.warn('[lock]', e.message); } // si falla todo, se conserva el ultimo estado conocido
  return state;
}

const get = () => state;

module.exports = { refresh, get, DEFAULT_MESSAGE };
