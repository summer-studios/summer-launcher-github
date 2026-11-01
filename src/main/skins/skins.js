// Skins importadas por el jugador. Se guardan en la carpeta de datos del launcher y la elegida se
// instala como skin pack ANTES de abrir Minecraft (aparece en el vestidor del juego).
const { nativeImage, dialog } = require('electron');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const MAX_SKINS = 200;
const MAX_BYTES = 1024 * 1024;
const SIZES = [[64, 64], [64, 32], [128, 128]];
const PACK_FOLDER = 'summer_launcher_skin';
// UUID fijos: asi el pack se actualiza en lugar de duplicarse.
const PACK_UUID = '6f3b1c52-8d6a-4a0e-9c3b-2d9d5e0a7b11';
const MODULE_UUID = 'a1c2e3d4-5b6a-4c7d-8e9f-0a1b2c3d4e5f';

const dir = () => path.join(paths.userData(), 'skins');
const indexFile = () => path.join(dir(), 'index.json');
const fileOf = (s) => path.join(dir(), s.file);

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
    return { skins: Array.isArray(d.skins) ? d.skins : [], selected: d.selected || null, seeded: Array.isArray(d.seeded) ? d.seeded : [] };
  } catch { return { skins: [], selected: null, seeded: [] }; }
}
function save(d) { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(indexFile(), JSON.stringify(d, null, 2)); }

const cleanName = (n) => String(n || 'Skin').replace(/\.png$/i, '').replace(/[\r\n=\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Skin';

// Las skins "slim" (brazos de 3 px) dejan transparente la ultima columna del brazo.
function isSlim(img, w, h) {
  if (w !== h) return false;
  const k = w / 64;
  const bmp = img.toBitmap();
  const x = Math.floor(47 * k);
  for (let y = Math.floor(20 * k); y < Math.floor(32 * k); y++) if (bmp[(y * w + x) * 4 + 3] !== 0) return false;
  return true;
}

function inspect(file) {
  const st = fs.statSync(file);
  if (st.size > MAX_BYTES) return { error: 'pesa demasiado' };
  const buf = fs.readFileSync(file);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return { error: 'no es un PNG' };
  const img = nativeImage.createFromBuffer(buf);
  const { width: w, height: h } = img.getSize();
  if (!SIZES.some(([a, b]) => a === w && b === h)) return { error: `tamaño ${w}x${h} no válido (usa 64x64, 64x32 o 128x128)` };
  return { buf, slim: isSlim(img, w, h) };
}

// Skins que vienen con el launcher (assets/skins/*.png). Se agregan una sola vez: si el jugador
// quita alguna, no vuelve a aparecer. Nombre en pantalla: "hombre-1.png" -> "Hombre 1".
let seededThisRun = false;
function seedBundled() {
  if (seededThisRun) return;
  seededThisRun = true;
  let files = [];
  try { files = fs.readdirSync(paths.asset('skins')).filter((f) => /\.png$/i.test(f)).sort(); } catch { return; }
  const d = load();
  let changed = false;
  for (const f of files) {
    try {
      const r = inspect(path.join(paths.asset('skins'), f));
      if (r.error) continue;
      const id = crypto.createHash('sha1').update(r.buf).digest('hex').slice(0, 12);
      if (d.seeded.includes(id)) continue;
      d.seeded.push(id); changed = true;
      if (d.skins.some((s) => s.id === id)) continue;
      fs.mkdirSync(dir(), { recursive: true });
      fs.writeFileSync(path.join(dir(), `${id}.png`), r.buf);
      const nice = cleanName(f).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      d.skins.push({ id, name: nice, file: `${id}.png`, slim: r.slim });
    } catch { /* se ignora la que falle */ }
  }
  if (changed) save(d);
}

function view() {
  seedBundled();
  const d = load();
  return {
    selected: d.selected,
    skins: d.skins.map((s) => ({ id: s.id, name: s.name, slim: !!s.slim, url: pathToFileURL(fileOf(s)).href + `?v=${s.id}` })),
  };
}

function importFiles(files) {
  const d = load();
  const added = []; const skipped = [];
  for (const f of files) {
    const name = path.basename(f);
    try {
      if (d.skins.length >= MAX_SKINS) { skipped.push({ name, reason: `máximo ${MAX_SKINS} skins` }); continue; }
      const r = inspect(f);
      if (r.error) { skipped.push({ name, reason: r.error }); continue; }
      const id = crypto.createHash('sha1').update(r.buf).digest('hex').slice(0, 12);
      if (d.skins.some((s) => s.id === id)) { skipped.push({ name, reason: 'ya estaba importada' }); continue; }
      fs.mkdirSync(dir(), { recursive: true });
      fs.writeFileSync(path.join(dir(), `${id}.png`), r.buf);
      d.skins.push({ id, name: cleanName(name), file: `${id}.png`, slim: r.slim });
      added.push(name);
    } catch (e) { skipped.push({ name, reason: 'no se pudo leer' }); }
  }
  save(d);
  return { added: added.length, skipped, ...view() };
}

async function pickAndImport(parentWin) {
  const r = await dialog.showOpenDialog(parentWin, {
    title: 'Importar skins', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Skins (PNG)', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePaths.length) return { added: 0, skipped: [], canceled: true, ...view() };
  return importFiles(r.filePaths);
}

function select(id) {
  const d = load();
  if (id !== null && !d.skins.some((s) => s.id === id)) return { ok: false, ...view() };
  d.selected = id; save(d);
  return { ok: true, ...view() };
}

function remove(id) {
  const d = load();
  const s = d.skins.find((x) => x.id === id);
  if (s) { try { fs.rmSync(fileOf(s), { force: true }); } catch { /* en uso */ } }
  d.skins = d.skins.filter((x) => x.id !== id);
  if (d.selected === id) d.selected = null;
  save(d);
  return view();
}

// Instala la skin elegida como skin pack en com.mojang/skin_packs (antes de abrir el juego).
function applyToGame(packRoot) {
  const target = path.join(packRoot, 'skin_packs', PACK_FOLDER);
  const d = load();
  const s = d.skins.find((x) => x.id === d.selected);
  if (!s || !fs.existsSync(fileOf(s))) { fs.rmSync(target, { recursive: true, force: true }); return null; }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'texts'), { recursive: true });
  fs.copyFileSync(fileOf(s), path.join(target, 'skin.png'));
  const write = (f, o) => fs.writeFileSync(path.join(target, f), typeof o === 'string' ? o : JSON.stringify(o, null, 2));
  write('manifest.json', {
    format_version: 2,
    header: { name: 'Summer Launcher', description: 'Skin elegida en Summer Launcher', uuid: PACK_UUID, version: [1, 0, 0], min_engine_version: [1, 20, 0] },
    modules: [{ type: 'skin_pack', uuid: MODULE_UUID, version: [1, 0, 0] }],
  });
  write('skins.json', {
    serialize_name: 'Summer Launcher', localization_name: 'SummerLauncher',
    skins: [{ localization_name: 'elegida', geometry: s.slim ? 'geometry.humanoid.customSlim' : 'geometry.humanoid.custom', texture: 'skin.png', type: 'free' }],
  });
  write('texts/languages.json', ['en_US', 'es_ES', 'es_MX']);
  const lang = `skinpack.SummerLauncher=Summer Launcher\nskin.SummerLauncher.elegida=${s.name}\n`;
  for (const l of ['en_US', 'es_ES', 'es_MX']) write(`texts/${l}.lang`, lang);
  return s.name;
}

module.exports = { view, pickAndImport, importFiles, select, remove, applyToGame };
