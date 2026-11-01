// Carga un JSON editable desde GitHub (o la URL que pongas en config) con respaldo:
//   1) en linea (GitHub)  2) ultima copia buena en cache  3) copia incluida en el launcher.
// Lo usan access-db.js (quien puede entrar) y servers-db.js (a que IP se conecta cada instancia).
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const config = require('../config');
const paths = require('../paths');

function githubRawUrl(file) {
  const g = config.github || {};
  if (!g.owner || String(g.owner).startsWith('TU_')) return null;
  return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${file}`;
}

// Repo PRIVADO: GitHub no deja leerlo sin iniciar sesion (404), asi que los cambios del panel admin
// nunca llegarian. Con un gist secreto (config.gist) los 3 archivos se leen sin token y al instante.
function remoteFor(file, remoteUrl) {
  if (remoteUrl) return remoteUrl;
  const gi = config.gist;
  if (gi && gi.user && gi.id && !String(gi.id).startsWith('TU_')) {
    return `https://gist.githubusercontent.com/${gi.user}/${gi.id}/raw/${path.basename(file)}`;
  }
  return githubRawUrl(file);
}

// El cache puede ir cifrado con el sistema (DPAPI en Windows): asi el archivo del disco
// no se puede abrir con el Bloc de notas. Si el cifrado no esta disponible, va en claro.
function writeCache(file, data, encrypt) {
  const text = JSON.stringify(data);
  fs.mkdirSync(paths.userData(), { recursive: true });
  fs.writeFileSync(file, encrypt && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text);
}
function readCache(file, encrypt) {
  const raw = fs.readFileSync(file);
  if (encrypt) { try { return JSON.parse(safeStorage.decryptString(raw)); } catch {} }
  return JSON.parse(raw.toString('utf8'));
}

// opts: { file, remoteUrl, cacheName, valid(data)->bool, encryptCache }
async function loadJson(opts) {
  const { file, remoteUrl, cacheName, valid, encryptCache = false } = opts;
  const cacheFile = path.join(paths.userData(), cacheName);
  const url = remoteFor(file, remoteUrl);
  if (url) {
    try {
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!valid(data)) throw new Error(`${file} invalido`);
      try { writeCache(cacheFile, data, encryptCache); } catch (e) { console.warn('[db] no se pudo guardar cache:', e.message); }
      return { data, source: 'github', syncedAt: Date.now() };
    } catch (e) { console.warn(`[db] ${file}: en linea no disponible (${e.message})`); }
    try {
      const data = readCache(cacheFile, encryptCache);
      if (valid(data)) return { data, source: 'cache', syncedAt: null };
    } catch {}
  }
  const data = JSON.parse(fs.readFileSync(paths.inRoot(file), 'utf8').replace(/^﻿/, ''));
  return { data, source: 'local', syncedAt: null };
}

module.exports = { loadJson };
