// Base de datos de acceso: quien (gamertag) puede entrar a que instancias.
// Fuente: database/access.json en tu GitHub (editable, tambien con el programa admin/).
// Respaldo: cache local y copia incluida. Ver remote.js.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const paths = require('../paths');
const { loadJson } = require('./remote');

let state = { data: { users: [] }, source: 'none', syncedAt: null };

const norm = (n) => String(n || '').trim().toLowerCase();

async function refresh() {
  const r = await loadJson({
    file: config.database.file,
    remoteUrl: config.database.remoteUrl,
    cacheName: 'access.cache.json',
    valid: (d) => d && Array.isArray(d.users),
  });
  return (state = { data: r.data, source: r.source, syncedAt: r.syncedAt });
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
