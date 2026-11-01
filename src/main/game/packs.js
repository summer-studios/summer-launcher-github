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

const fpFile = () => path.join(paths.userData(), 'pack-fingerprints.json');

// Huella rapida del pack (cantidad de archivos, tamaño y fecha): si no cambio, no se vuelve a copiar.
function fingerprint(src) {
  let n = 0, size = 0, newest = 0;
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
    n++; size += st.size; newest = Math.max(newest, st.mtimeMs);
  };
  walk(src);
  return `${n}:${size}:${Math.round(newest)}`;
}

// src: carpeta del pack, o archivo .mcpack/.zip. Devuelve { uuid, version, name }.
function installResourcePack(comMojang, src) {
  const fps = readJson(fpFile(), {});
  const fp = fingerprint(src);
  const hit = fps[src];
  if (hit && hit.fp === fp && fs.existsSync(path.join(comMojang, 'resource_packs', `summer_${hit.uuid}`, 'manifest.json'))) {
    return { uuid: hit.uuid, version: hit.version, name: hit.name }; // ya instalado y sin cambios: se salta la copia
  }
  const info = copyPack(comMojang, src);
  fps[src] = { fp, ...info };
  try { fs.mkdirSync(paths.userData(), { recursive: true }); fs.writeFileSync(fpFile(), JSON.stringify(fps)); } catch { /* sin cache */ }
  return info;
}

function copyPack(comMojang, src) {
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
// roots: { packRoot, globalRoots } de bedrock.locateAll(). La lista se escribe en TODAS las carpetas
// de cuenta y luego se vuelve a leer para comprobar que quedo guardada.
function setGlobalPacks(roots, packs) {
  const prevManaged = readJson(managedFile(), []);
  const added = packs.map((p) => ({ pack_id: p.uuid, version: p.version }));

  for (const root of roots.globalRoots) {
    const file = path.join(root, 'minecraftpe', 'global_resource_packs.json');
    const current = readJson(file, []);
    const kept = (Array.isArray(current) ? current : []).filter((e) => !prevManaged.includes(e.pack_id) && !packs.some((p) => p.uuid === e.pack_id));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...added, ...kept], null, 2));
    const check = readJson(file, []);
    for (const a of added) {
      if (!Array.isArray(check) || !check.some((e) => e.pack_id === a.pack_id)) throw new Error('No se pudo activar el pack de la instancia (no se guardó la lista de packs).');
    }
  }

  // Quita del disco los packs de otras instancias que Summer instalo antes.
  const keepNow = new Set(packs.map((p) => p.uuid));
  for (const old of prevManaged) {
    if (keepNow.has(old)) continue;
    try { fs.rmSync(path.join(roots.packRoot, 'resource_packs', `summer_${old}`), { recursive: true, force: true }); } catch { /* en uso */ }
  }

  fs.mkdirSync(paths.userData(), { recursive: true });
  fs.writeFileSync(managedFile(), JSON.stringify(packs.map((p) => p.uuid)));
}

module.exports = { installResourcePack, setGlobalPacks };
