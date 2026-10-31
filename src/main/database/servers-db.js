// IP y puerto de cada instancia. Se editan en database/servers.json (GitHub o programa admin/).
// La IP solo la usa el proceso principal para abrir el juego: NUNCA se manda a la interfaz,
// ni a los mensajes de progreso, ni a los logs.
const config = require('../config');
const { loadJson } = require('./remote');

let state = { servers: {}, source: 'none' };

const section = () => config.servers || { file: 'database/servers.json', remoteUrl: null };
const HOST = /^[A-Za-z0-9._:\[\]-]{1,253}$/;

function clean(entry) {
  if (!entry || typeof entry.ip !== 'string') return null;
  const ip = entry.ip.trim();
  const port = Number(entry.port) || 19132;
  if (!ip || !HOST.test(ip) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { ip, port };
}

async function refresh() {
  const s = section();
  const r = await loadJson({
    file: s.file || 'database/servers.json',
    remoteUrl: s.remoteUrl,
    cacheName: 'servers.cache.json',
    valid: (d) => d && typeof d.servers === 'object' && d.servers !== null,
    encryptCache: true,
  });
  const servers = {};
  for (const [id, entry] of Object.entries(r.data.servers)) {
    const ok = clean(entry);
    if (ok) servers[id] = ok;
  }
  return (state = { servers, source: r.source });
}

// Servidor de una instancia: el de servers.json; si no hay, el "server" del archivo de la instancia.
const get = (id, fallback) => state.servers[id] || fallback || null;

module.exports = { refresh, get };
