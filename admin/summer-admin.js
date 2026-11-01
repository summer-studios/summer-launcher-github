#!/usr/bin/env node
// ============================================================
//  SUMMER ADMIN - edita en "tiempo real" quien puede entrar a cada instancia
//  y a que IP se conecta cada una. Los launchers abiertos lo reciben en segundos.
//
//  Uso (ver admin/LEEME-ADMIN.txt):
//    node admin/summer-admin.js panel                       panel web local (lo mas facil)
//    node admin/summer-admin.js list                        usuarios y servidores
//    node admin/summer-admin.js add <gamertag> <inst...|*>  da acceso (suma a lo que ya tenia)
//    node admin/summer-admin.js set <gamertag> <inst...|*>  deja EXACTAMENTE esas instancias
//    node admin/summer-admin.js remove <gamertag> [inst...] quita instancias (o al usuario entero)
//    node admin/summer-admin.js server <inst> <ip> [puerto] cambia la IP ('-' para borrarla)
//    node admin/summer-admin.js lock on [mensaje]           bloquea el launcher (o: lock off para abrirlo)
//    Opciones: --local  edita los archivos del repo en tu PC (sin GitHub; luego haz commit/push)
//
//  Sin dependencias: solo Node 18 o superior. El token de GitHub NUNCA va en el launcher.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = process.env.SUMMER_ROOT || path.join(__dirname, '..');
const launcherCfg = require(path.join(ROOT, 'config', 'launcher.config.js'));

const GAMERTAG = /^[A-Za-z0-9 _#.-]{1,32}$/;
const HOST = /^[A-Za-z0-9._:\[\]-]{1,253}$/;
const norm = (s) => String(s || '').trim().toLowerCase();


// JSON con el mismo estilo del repo: arreglos y objetos simples en una sola linea.
function pretty(json) {
  const val = String.raw`(?:"[^"\n]*"|-?\d+(?:\.\d+)?|true|false|null|\[[^\]\n]*\])`;
  let t = JSON.stringify(json, null, 2);
  t = t.replace(/\[\n\s+((?:"[^"\n]*"|-?\d+(?:\.\d+)?)(?:,\n\s+(?:"[^"\n]*"|-?\d+(?:\.\d+)?))*)\n\s*\]/g, (m, g) => `[${g.replace(/,\n\s+/g, ', ')}]`);
  const obj = new RegExp(String.raw`\{\n\s+("[^"\n]+": ${val}(?:,\n\s+"[^"\n]+": ${val})*)\n\s*\}`, 'g');
  return t.replace(obj, (m, g) => `{ ${g.replace(/,\n\s+/g, ', ')} }`) + '\n';
}

// ---------------------------------------------------------------- configuracion
function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(process.env.SUMMER_ADMIN_CONFIG || path.join(__dirname, 'admin.config.json'), 'utf8').replace(/^﻿/, '')); } catch {}
  const g = launcherCfg.github || {};
  const gi = launcherCfg.gist || {};
  return {
    token: process.env.SUMMER_GITHUB_TOKEN || file.githubToken || '',
    owner: file.owner || g.owner,
    repo: file.repo || g.repo,
    branch: file.branch || g.branch || 'main',
    backend: file.backend || (gi.id && !String(gi.id).startsWith('TU_') ? 'gist' : 'repo'), // 'repo' o 'gist'
    gistId: file.gistId || (String(gi.id || '').startsWith('TU_') ? '' : gi.id || ''),
    api: process.env.SUMMER_GITHUB_API || 'https://api.github.com',
    port: Number(file.panelPort) || 4580,
  };
}

const FILES = {
  access: (launcherCfg.database && launcherCfg.database.file) || 'database/access.json',
  servers: (launcherCfg.servers && launcherCfg.servers.file) || 'database/servers.json',
  lock: (launcherCfg.lock && launcherCfg.lock.file) || 'database/launcher.json',
};

// Instancias definidas en config/instances (ignora las que empiezan con "_").
function knownInstances() {
  const dir = path.join(ROOT, 'config', 'instances');
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    try { const d = require(path.join(dir, f)); if (d.id) out.push({ id: String(d.id), name: d.name || d.id }); } catch {}
  }
  return out;
}

// ---------------------------------------------------------------- almacenes (donde viven los JSON)
// Todos exponen read(file) -> { json, version } y write(file, json, version, mensaje).
function localStore() {
  return {
    label: 'archivos locales del repo (haz commit y push despues)',
    async read(file) {
      const p = path.join(ROOT, file);
      return { json: fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) : null, version: null };
    },
    async write(file, json) { fs.writeFileSync(path.join(ROOT, file), pretty(json)); },
  };
}

function githubClient(cfg) {
  if (!cfg.token) throw new Error('Falta el token de GitHub. Copia admin/admin.config.example.json a admin/admin.config.json y pega tu token (ver LEEME-ADMIN.txt).');
  return async function gh(method, url, body) {
    const res = await fetch(cfg.api + url, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'summer-admin', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    if (!res.ok) { const e = new Error(`GitHub ${res.status}: ${(data && data.message) || text.slice(0, 120)}`); e.status = res.status; throw e; }
    return data;
  };
}

function repoStore(cfg) {
  const gh = githubClient(cfg);
  const enc = (f) => f.split('/').map(encodeURIComponent).join('/');
  // Copia en memoria (contenido + sha) de cada archivo: guardar un cambio ya no necesita leer antes,
  // y si alguien lo edito por fuera, GitHub rechaza el sha viejo y se reintenta con lo nuevo.
  const cache = new Map();
  return {
    label: `GitHub ${cfg.owner}/${cfg.repo}@${cfg.branch}`,
    cache,
    async read(file) {
      let r;
      try {
        const d = await gh('GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${enc(file)}?ref=${encodeURIComponent(cfg.branch)}`);
        r = { json: JSON.parse(Buffer.from(d.content, 'base64').toString('utf8').replace(/^﻿/, '')), version: d.sha };
      } catch (e) { if (e.status === 404) r = { json: null, version: null }; else throw e; }
      cache.set(file, r);
      return r;
    },
    async write(file, json, version, message) {
      const d = await gh('PUT', `/repos/${cfg.owner}/${cfg.repo}/contents/${enc(file)}`, {
        message, branch: cfg.branch, sha: version || undefined,
        content: Buffer.from(pretty(json)).toString('base64'),
      });
      return d && d.content ? d.content.sha : null;
    },
  };
}

// Gist (sirve si el repo es privado: usa la URL raw del gist en config remoteUrl).
function gistStore(cfg) {
  const gh = githubClient(cfg);
  if (!cfg.gistId) throw new Error('backend "gist" necesita "gistId" en admin.config.json');
  // Una sola lectura del gist sirve para los 3 archivos (access, servers, launcher); se reutiliza ~3 s
  // y al guardar se actualiza al momento, asi el panel responde rapido tras cada cambio.
  let snap = null; let snapAt = 0;
  const load = async () => {
    if (snap && Date.now() - snapAt < 3000) return snap;
    const d = await gh('GET', `/gists/${cfg.gistId}`);
    snap = {}; for (const [n, f] of Object.entries(d.files || {})) snap[n] = f.content;
    snapAt = Date.now();
    return snap;
  };
  return {
    label: `gist ${cfg.gistId}`,
    async read(file) {
      const c = (await load())[path.basename(file)];
      return { json: c ? JSON.parse(c.replace(/^\uFEFF/, '')) : null, version: null };
    },
    async write(file, json) {
      const name = path.basename(file); const content = pretty(json);
      await gh('PATCH', `/gists/${cfg.gistId}`, { files: { [name]: { content } } });
      if (snap) { snap[name] = content; snapAt = Date.now(); }
    },
  };
}

// Crea el gist secreto con los 3 archivos de database/ (una sola vez). Devuelve { user, id }.
async function crearGist(cfg) {
  const gh = githubClient(cfg);
  const files = {};
  for (const f of Object.values(FILES)) files[path.basename(f)] = { content: fs.readFileSync(path.join(ROOT, f), 'utf8') };
  const d = await gh('POST', '/gists', { description: 'Summer Launcher - datos', public: false, files });
  return { user: d.owner.login, id: d.id };
}

function makeStore(cfg, local) {
  if (local) return localStore();
  return cfg.backend === 'gist' ? gistStore(cfg) : repoStore(cfg);
}

// Lee -> modifica -> guarda. Si alguien guardo en medio (sha viejo), reintenta sobre lo nuevo.
async function mutate(store, file, message, fn, fallback) {
  for (let attempt = 0; attempt < 4; attempt++) {
    // Primer intento con la copia en memoria (sin leer de GitHub); si fallo, se lee de nuevo.
    const cur = (attempt === 0 && store.cache && store.cache.get(file)) || await store.read(file);
    const next = fn(structuredClone(cur.json || fallback));
    try {
      const version = await store.write(file, next, cur.version, message);
      if (store.cache) store.cache.set(file, { json: next, version });
      return next;
    } catch (e) {
      if (store.cache) store.cache.delete(file);
      if (attempt < 3 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------- operaciones
const ACCESS_FALLBACK = { _ayuda: "Edita con el programa admin/ o a mano. 'instances' lista los ids permitidos; ['*'] = todas.", users: [] };
const SERVERS_FALLBACK = { _ayuda: 'IP y puerto por instancia.', servers: {} };
const LOCK_MESSAGE = 'Launcher bloqueado momentáneamente';
const LOCK_FALLBACK = { _ayuda: "Con 'locked': true nadie puede entrar y se muestra 'message'.", locked: false, message: LOCK_MESSAGE };

function checkTag(tag) {
  const t = String(tag || '').trim();
  if (!GAMERTAG.test(t)) throw new Error('Gamertag invalido (letras, numeros, espacios, _ # . -; maximo 32).');
  return t;
}
function checkInstances(list, force) {
  const ids = [...new Set((list || []).map(String).filter(Boolean))];
  const known = knownInstances().map((i) => i.id);
  const bad = ids.filter((i) => i !== '*' && !known.includes(i));
  if (bad.length && !force) throw new Error(`Instancia desconocida: ${bad.join(', ')}. Disponibles: ${known.join(', ')} (o *).`);
  return ids.includes('*') ? ['*'] : ids;
}

const ops = {
  // fresh = true vuelve a leer de GitHub (los 3 archivos a la vez); si no, usa la copia en memoria.
  state: async (store, fresh = false) => {
    if (fresh && store.cache) store.cache.clear();
    const get = async (f) => { const c = store.cache && store.cache.get(f); return (c || await store.read(f)).json; };
    const [a0, s0, l0] = await Promise.all([get(FILES.access), get(FILES.servers), get(FILES.lock)]);
    const a = a0 || ACCESS_FALLBACK, s = s0 || SERVERS_FALLBACK, l = l0 || LOCK_FALLBACK;
    return { users: a.users || [], servers: s.servers || {}, instances: knownInstances(), source: store.label, lock: { locked: l.locked === true, message: l.message || LOCK_MESSAGE } };
  },
  setUser: (store, tag, instances, mode = 'set', force = false) => {
    tag = checkTag(tag); instances = checkInstances(instances, force);
    return mutate(store, FILES.access, `admin: acceso de ${tag}`, (d) => {
      d.users = Array.isArray(d.users) ? d.users : [];
      const u = d.users.find((x) => norm(x.gamertag) === norm(tag));
      let list = instances;
      if (mode === 'add' && u) list = [...new Set([...(u.instances || []), ...instances])];
      if (list.includes('*')) list = ['*'];
      if (u) u.instances = list; else d.users.push({ gamertag: tag, instances: list });
      return d;
    }, ACCESS_FALLBACK);
  },
  removeUser: (store, tag, instances = [], force = false) => {
    tag = checkTag(tag); instances = instances.length ? checkInstances(instances, force) : [];
    return mutate(store, FILES.access, `admin: quitar acceso de ${tag}`, (d) => {
      d.users = (Array.isArray(d.users) ? d.users : []).filter((x) => {
        if (norm(x.gamertag) !== norm(tag)) return true;
        if (!instances.length) return false;
        x.instances = (x.instances || []).filter((i) => !instances.includes(i));
        return x.instances.length > 0;
      });
      return d;
    }, ACCESS_FALLBACK);
  },
  setLock: (store, locked, message) => {
    const msg = String(message || '').trim().slice(0, 300) || LOCK_MESSAGE;
    return mutate(store, FILES.lock, locked ? 'admin: launcher bloqueado' : 'admin: launcher desbloqueado', (d) => {
      d.locked = locked === true;
      d.message = msg;
      return d;
    }, LOCK_FALLBACK);
  },
  setServer: (store, id, ip, port, force = false) => {
    id = String(id || '').trim(); ip = String(ip || '').trim(); port = Number(port) || 19132;
    if (!force && !knownInstances().some((i) => i.id === id)) throw new Error(`Instancia desconocida: ${id}`);
    if (ip && !HOST.test(ip)) throw new Error('IP/dominio invalido.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto invalido (1-65535).');
    return mutate(store, FILES.servers, `admin: servidor de ${id}`, (d) => {
      d.servers = d.servers && typeof d.servers === 'object' ? d.servers : {};
      d.servers[id] = { ip, port };
      return d;
    }, SERVERS_FALLBACK);
  },
};

// ---------------------------------------------------------------- panel web local
function startPanel(cfg, store) {
  const token = crypto.randomBytes(24).toString('hex');
  const page = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8').replace('__TOKEN__', token);
  let queue = Promise.resolve();                  // un cambio a la vez
  const hostOk = (h) => [`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`].includes(h);

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (!hostOk(req.headers.host)) return send(403, { error: 'host no permitido' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') return send(200, page, 'text/html; charset=utf-8');
    if (!url.pathname.startsWith('/api/')) return send(404, { error: 'no existe' });
    if (req.headers['x-admin-token'] !== token) return send(403, { error: 'token invalido' });

    let body = {};
    if (req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 65536) return send(413, { error: 'muy grande' }); chunks.push(c); }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(400, { error: 'JSON invalido' }); }
    }
    const run = (fn) => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await ops.state(store, url.searchParams.get('fresh') === '1'));
      if (req.method === 'POST' && url.pathname === '/api/user') { await run(() => ops.setUser(store, body.gamertag, body.instances, 'set')); return send(200, await ops.state(store)); }
      if (req.method === 'POST' && url.pathname === '/api/user/delete') { await run(() => ops.removeUser(store, body.gamertag)); return send(200, await ops.state(store)); }
      if (req.method === 'POST' && url.pathname === '/api/lock') { await run(() => ops.setLock(store, body.locked === true, body.message)); return send(200, await ops.state(store)); }
      if (req.method === 'POST' && url.pathname === '/api/server') { await run(() => ops.setServer(store, body.id, body.ip, body.port)); return send(200, await ops.state(store)); }
      return send(404, { error: 'no existe' });
    } catch (e) { return send(400, { error: e.message }); }
  });
  ops.state(store, true).catch(() => {}); // precarga los datos mientras se abre el navegador
  server.listen(cfg.port, '127.0.0.1', () => {
    const addr = `http://127.0.0.1:${cfg.port}/`;
    console.log(`Panel listo en ${addr}\nGuardando en: ${store.label}\n(Ctrl+C para cerrar)`);
    if (!process.env.SUMMER_ADMIN_NO_OPEN) {
      const { exec } = require('child_process');
      const cmd = process.platform === 'win32' ? `start "" "${addr}"` : process.platform === 'darwin' ? `open "${addr}"` : `xdg-open "${addr}"`;
      exec(cmd, () => {});
    }
  });
  return server;
}

// ---------------------------------------------------------------- linea de comandos
function printState(s) {
  console.log(`Origen: ${s.source}\n\nUSUARIOS (${s.users.length})`);
  for (const u of s.users) console.log(`  ${u.gamertag.padEnd(24)} ${(u.instances || []).join(', ') || '(sin acceso)'}`);
  console.log(`\nLAUNCHER: ${s.lock.locked ? 'BLOQUEADO — ' + s.lock.message : 'abierto'}`);
  console.log('\nSERVIDORES');
  for (const i of s.instances) { const v = s.servers[i.id]; console.log(`  ${i.id.padEnd(24)} ${v && v.ip ? `${v.ip}:${v.port}` : '(sin IP)'}`); }
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('--'));
  const args = argv.filter((a) => !a.startsWith('--'));
  const local = flags.includes('--local');
  const force = flags.includes('--force');
  const [cmd = 'panel', ...rest] = args;
  const cfg = loadConfig();

  if (!['panel', 'list', 'add', 'set', 'remove', 'server', 'lock', 'crear-gist'].includes(cmd)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd === 'help' ? 0 : 1);
  }
  if (cmd === 'crear-gist') {
    const g = await crearGist(cfg);
    console.log(`\nGIST CREADO. En config/launcher.config.js pon:\n  gist: { user: '${g.user}', id: '${g.id}' },\nLuego recompila el launcher. El panel admin ya usara este gist solo.`);
    return;
  }
  const store = makeStore(cfg, local);

  if (cmd === 'panel') return startPanel(cfg, store);
  if (cmd === 'list') return printState(await ops.state(store));
  if (cmd === 'add' || cmd === 'set') {
    if (rest.length < 2) throw new Error(`Uso: ${cmd} <gamertag> <instancia...|*>`);
    await ops.setUser(store, rest[0], rest.slice(1), cmd, force);
    return console.log(`OK: ${rest[0]} -> ${cmd === 'add' ? 'suma' : 'queda con'} ${rest.slice(1).join(', ')}`);
  }
  if (cmd === 'remove') {
    if (!rest.length) throw new Error('Uso: remove <gamertag> [instancia...]');
    await ops.removeUser(store, rest[0], rest.slice(1), force);
    return console.log(`OK: ${rest[0]} ${rest.length > 1 ? 'pierde ' + rest.slice(1).join(', ') : 'eliminado'}`);
  }
  if (cmd === 'lock') {
    const mode = String(rest[0] || '').toLowerCase();
    if (!['on', 'off'].includes(mode)) throw new Error('Uso: lock on [mensaje] | lock off');
    await ops.setLock(store, mode === 'on', rest.slice(1).join(' '));
    return console.log(mode === 'on' ? 'OK: launcher BLOQUEADO' : 'OK: launcher desbloqueado');
  }
  if (cmd === 'server') {
    if (rest.length < 2) throw new Error('Uso: server <instancia> <ip|-> [puerto]');
    await ops.setServer(store, rest[0], rest[1] === '-' ? '' : rest[1], rest[2], force);
    return console.log(`OK: servidor de ${rest[0]} ${rest[1] === '-' ? 'borrado' : 'actualizado'}`);
  }
}

if (require.main === module) main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
module.exports = { ops, makeStore, loadConfig, startPanel, crearGist };
