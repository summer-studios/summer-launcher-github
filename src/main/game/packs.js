// Instala packs de recursos en com.mojang y los activa como GLOBALES
// (global_resource_packs.json), para que se equipen al entrar a cualquier mundo/servidor.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('../paths');

const managedFile = () => path.join(paths.userData(), 'managed-packs.json');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '')); }
  } catch { return fallback; }
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

// src: carpeta del pack, o archivo .mcpack/.zip. Devuelve { uuid, version, name }.
function installResourcePack(comMojang, src) {
  const tmp = path.join(paths.userData(), 'tmp-pack');
  let folder = src;
  if (fs.statSync(src).isFile()) {
    fs.rmSync(tmp, { recursive: true, force: true });
    new AdmZip(src).extractAllTo(tmp, true);
    folder = tmp;
  }
  const manifest = readJson(path.join(folder, 'manifest.json'), null);
  if (!manifest || !manifest.header || !manifest.header.uuid) throw new Error(`manifest.json invalido en ${src}`);
  const { uuid, version, name } = manifest.header;
  copyDir(folder, path.join(comMojang, 'resource_packs', `summer_${uuid}`));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { uuid, version, name };
}

// Reemplaza SOLO los packs que puso Summer; los que el usuario activo a mano no se tocan.
function setGlobalPacks(comMojang, packs) {
  const file = path.join(comMojang, 'minecraftpe', 'global_resource_packs.json');
  const current = readJson(file, []);
  const prevManaged = readJson(managedFile(), []);
  const kept = (Array.isArray(current) ? current : []).filter((e) => !prevManaged.includes(e.pack_id));
  const added = packs.map((p) => ({ pack_id: p.uuid, version: p.version }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...added, ...kept], null, 2));
  fs.mkdirSync(paths.userData(), { recursive: true });
  fs.writeFileSync(managedFile(), JSON.stringify(packs.map((p) => p.uuid)));
}

module.exports = { installResourcePack, setGlobalPacks };
