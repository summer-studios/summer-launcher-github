// Sistema de instancias.
// Dos formas de crear una instancia:
//   1) Un archivo .js en config/instances/ (se carga solo; ver _template.js)
//   2) Desde codigo: instanceManager.define({...})
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const paths = require('../paths');
const lockDb = require('../database/lock-db');
const db = require('../database/access-db');
const serversDb = require('../database/servers-db');

const defined = new Map();

function normalize(def) {
  if (!def || !def.id || !def.name) throw new Error('Una instancia necesita al menos "id" y "name"');
  return {
    id: String(def.id),
    name: def.name,
    tabTitle: def.tabTitle || def.name,      // nombre que se muestra en la pestana/tarjeta
    thumbnail: def.thumbnail || null,        // ruta relativa a la raiz (ej. thumbnails/backrooms.png)
    access: def.access === 'public' ? 'public' : 'database',
    server: def.server && def.server.ip ? { ip: def.server.ip, port: def.server.port || 19132 } : null,
    resourcePacks: def.resourcePacks || [],  // carpetas o .mcpack, relativas a la raiz (ej. packs/mi_pack)
    injectors: def.injectors || [],          // ids de config.injectors (ej. 'flarial')
  };
}

function define(def) {
  const inst = normalize(def);
  defined.set(inst.id, inst);
  return inst;
}

function loadFolder() {
  const dir = paths.inRoot('config', 'instances');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return; }
  for (const f of files) {
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    try { define(require(path.join(dir, f))); }
    catch (e) { console.warn(`[instancias] ${f} ignorado: ${e.message}`); }
  }
}

function get(id) { return defined.get(id) || null; }

// Instancias visibles para un gamertag (publicas + las que le da la base de datos).
function listFor(gamertag) {
  return [...defined.values()]
    .filter((i) => i.access === 'public' || db.canAccess(gamertag, i.id))
    .map((i) => {
      const thumb = i.thumbnail && fs.existsSync(paths.inRoot(i.thumbnail)) ? pathToFileURL(paths.inRoot(i.thumbnail)).href : null;
      const lk = (lockDb.get().instances || {})[i.id];
      return { id: i.id, name: i.tabTitle, thumbnail: thumb, hasServer: !!serversDb.get(i.id, i.server), locked: !!lk, lockMessage: lk ? lk.message : '' };
    });
}

module.exports = { define, loadFolder, get, listFor };
