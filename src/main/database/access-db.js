// Base de datos de acceso: quien (gamertag) puede entrar a que instancias.
// Fuente: database/access.json en tu GitHub (editable). Respaldo: cache local y copia incluida.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const paths = require('../paths');

let state = { data: { users: [] }, source: 'none', syncedAt: null };

const norm = (n) => String(n || '').trim().toLowerCase();
const cacheFile = () => path.join(paths.userData(), 'access.cache.json');

function remoteUrl() {
  if (config.database.remoteUrl) return config.database.remoteUrl;
  const g = config.github;
  if (!g.owner || g.owner.startsWith('TU_')) return null;
  return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${config.database.file}`;
}

async function refresh() {
  const url = remoteUrl();
  if (url) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.users)) throw new Error('access.json invalido');
      fs.mkdirSync(paths.userData(), { recursive: true });
      fs.writeFileSync(cacheFile(), JSON.stringify(data));
      return (state = { data, source: 'github', syncedAt: Date.now() });
    } catch (e) { console.warn('[db] GitHub no disponible:', e.message); }
    try {
      return (state = { data: JSON.parse(fs.readFileSync(cacheFile(), 'utf8')), source: 'cache', syncedAt: null });
    } catch {}
  }
  const bundled = JSON.parse(fs.readFileSync(paths.inRoot(config.database.file), 'utf8'));
  return (state = { data: bundled, source: 'local', syncedAt: null });
}

function allowedInstances(gamertag) {
  const u = (state.data.users || []).find((x) => norm(x.gamertag) === norm(gamertag));
  return u ? u.instances || [] : [];
}
const canAccess = (gamertag, id) => {
  const l = allowedInstances(gamertag);
  return l.includes('*') || l.includes(id);
};

// ---- Registro de nombres que inician sesion ----
const registryFile = () => path.join(paths.userData(), 'registry.json');

async function registerLogin(gamertag, xuid) {
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(registryFile(), 'utf8')); } catch {}
  const now = new Date().toISOString();
  const prev = reg[gamertag] || { firstSeen: now, logins: 0 };
  reg[gamertag] = { ...prev, xuid, lastSeen: now, logins: prev.logins + 1 };
  fs.mkdirSync(paths.userData(), { recursive: true });
  fs.writeFileSync(registryFile(), JSON.stringify(reg, null, 2));

  const hook = config.registry.webhookUrl;
  if (hook && prev.logins === 0) {
    try {
      await fetch(hook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `Nuevo usuario en ${config.name}: **${gamertag}**`, gamertag, xuid, at: now }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) { console.warn('[registry] webhook fallo:', e.message); }
  }
}

module.exports = { refresh, allowedInstances, canAccess, registerLogin, info: () => ({ source: state.source, syncedAt: state.syncedAt }) };
