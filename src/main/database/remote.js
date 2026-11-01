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

// Lectura del gist por la API de GitHub con ETag: una sola peticion trae los 3 archivos, la API no tiene
// el retraso de cache de los enlaces raw y las respuestas 304 (sin cambios) no gastan el limite de GitHub.
let gistSnap = { etag: null, files: null, at: 0, inflight: null };
function invalidateGist() { gistSnap.at = 0; }
function gistConfigured() { const gi = config.gist; return !!(gi && gi.id && !String(gi.id).startsWith('TU_')); }
function gistApi() {
  if (gistSnap.inflight) return gistSnap.inflight;
  if (gistSnap.files && Date.now() - gistSnap.at < 1500) return Promise.resolve(gistSnap.files);
  gistSnap.inflight = (async () => {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'summer-launcher' };
    if (gistSnap.etag && gistSnap.files) headers['If-None-Match'] = gistSnap.etag;
    const res = await fetch(`https://api.github.com/gists/${config.gist.id}`, { headers, signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (res.status === 304 && gistSnap.files) { gistSnap.at = Date.now(); return gistSnap.files; }
    if (!res.ok) throw new Error(`gist API HTTP ${res.status}`);
    const d = await res.json();
    const files = {};
    for (const [name, f] of Object.entries(d.files || {})) if (!f.truncated && typeof f.content === 'string') files[name] = f.content;
    gistSnap = { etag: res.headers.get('etag'), files, at: Date.now(), inflight: null };
    return files;
  })().finally(() => { gistSnap.inflight = null; });
  return gistSnap.inflight;
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
  if (!remoteUrl && gistConfigured()) {
    try {
      const files = await gistApi();
      const text = files[path.basename(file)];
      if (text == null) throw new Error('archivo no esta en el gist');
      const data = JSON.parse(text.replace(/^\uFEFF/, ''));
      if (!valid(data)) throw new Error(`${file} invalido`);
      try { writeCache(cacheFile, data, encryptCache); } catch (e) { console.warn('[db] no se pudo guardar cache:', e.message); }
      return { data, source: 'gist-api', syncedAt: Date.now() };
    } catch (e) { console.warn(`[db] ${file}: gist API no disponible (${e.message}), se usa el enlace raw`); }
  }
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

module.exports = { loadJson, invalidateGist };
