// Localiza Minecraft Bedrock (Windows) y administra su estructura de carpetas (com.mojang).
const fs = require('fs');
const path = require('path');
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

module.exports = { locate, ensureStructure, SUBFOLDERS };
