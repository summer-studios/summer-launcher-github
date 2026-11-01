// Localiza Minecraft Bedrock (Windows) y administra su estructura de carpetas (com.mojang).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const settings = require('../settings');

const SUBFOLDERS = ['resource_packs', 'behavior_packs', 'development_resource_packs', 'minecraftWorlds', 'minecraftpe'];

function candidates() {
  const list = [];
  const appdata = process.env.APPDATA;
  const local = process.env.LOCALAPPDATA;
  // Versiones GDK (las actuales): %APPDATA%\Minecraft Bedrock\Users\<id>\games\com.mojang
  for (const [folder, kind] of [['Minecraft Bedrock', 'release'], ['Minecraft Bedrock Preview', 'preview']]) {
    if (!appdata) continue;
    const users = path.join(appdata, folder, 'Users');
    if (!fs.existsSync(users)) continue;
    const ids = fs.readdirSync(users).sort((a, b) => (a === 'Shared' ? -1 : b === 'Shared' ? 1 : 0));
    for (const id of ids) list.push({ dir: path.join(users, id, 'games', 'com.mojang'), kind: `${kind} (GDK)` });
  }
  // Versiones UWP antiguas
  if (local) {
    for (const [pkg, kind] of [['Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'release'], ['Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe', 'preview']]) {
      list.push({ dir: path.join(local, 'Packages', pkg, 'LocalState', 'games', 'com.mojang'), kind: `${kind} (UWP)` });
    }
  }
  return list;
}

function locate() {
  const override = settings.get().comMojangOverride || config.bedrock.comMojangOverride;
  if (override) return fs.existsSync(override) ? { comMojang: override, kind: 'manual' } : null;
  const hit = candidates().find((c) => fs.existsSync(c.dir));
  return hit ? { comMojang: hit.dir, kind: hit.kind } : null;
}

function ensureStructure(comMojang) {
  for (const f of SUBFOLDERS) fs.mkdirSync(path.join(comMojang, f), { recursive: true });
}

// En GDK hay varias carpetas com.mojang: Users\Shared (packs, mundos) y Users\<id> (opciones de cada
// cuenta, donde Minecraft puede leer global_resource_packs.json). Devuelve donde instalar los packs
// y TODAS las carpetas donde hay que escribir la lista de packs globales.
function locateAll() {
  const found = locate();
  if (!found) return null;
  const globalRoots = [found.comMojang];
  if (found.kind !== 'manual') {
    const m = found.comMojang.match(/^(.*[\\/]Users)[\\/][^\\/]+[\\/]games[\\/]com\.mojang$/i);
    if (m) {
      try {
        for (const id of fs.readdirSync(m[1])) {
          const dir = path.join(m[1], id, 'games', 'com.mojang');
          if (fs.existsSync(dir) && !globalRoots.includes(dir)) globalRoots.push(dir);
        }
      } catch { /* sin permiso: se usa solo la carpeta principal */ }
    }
  }
  return { packRoot: found.comMojang, globalRoots, kind: found.kind };
}

// --- Minecraft abierto: si ya esta corriendo, lee los packs al arrancar y pisa la lista al cerrar.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (file, args) => new Promise((res) => execFile(file, args, { windowsHide: true }, (_e, out) => res(String(out || ''))));
const isRunning = async () => /Minecraft\.Windows\.exe/i.test(await run('tasklist', ['/FI', 'IMAGENAME eq Minecraft.Windows.exe', '/NH']));

// Cierra Minecraft (primero con gentileza, a la fuerza si no responde). Devuelve true si estaba abierto.
async function closeIfRunning() {
  if (process.platform !== 'win32') return false;
  if ((config.bedrock || {}).closeRunningGame === false) return false;
  if (!(await isRunning())) return false;
  await run('taskkill', ['/IM', 'Minecraft.Windows.exe']);
  for (let i = 0; i < 16; i++) { await sleep(500); if (!(await isRunning())) return true; }
  await run('taskkill', ['/F', '/IM', 'Minecraft.Windows.exe']);
  await sleep(1500);
  return true;
}

module.exports = { locate, locateAll, closeIfRunning, ensureStructure, SUBFOLDERS };
