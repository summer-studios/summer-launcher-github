// Integracion con Ore UI (hbui) de Minecraft Bedrock.
//
// Ore UI es la interfaz web (HTML/CSS/JS sobre Gameface) del juego. Un resource pack puede aportar su
// propio hbui/gameplay.html, pero ese archivo lleva nombres de bundle con hash que cambian en cada version
// del juego (gameplay-<hash>.js ...). Por eso NO se guarda uno hecho: en cada arranque el launcher lee el
// gameplay.html del juego instalado, le anade las lineas <link>/<script> que pida cada pack y lo escribe en
// el pack ya instalado en com.mojang.
//
// Un pack pide inyecciones con hbui/summer-inject.json:
//   { "css": ["/hbui/mi.css"], "js": ["/hbui/mi.js"], "videos": true }
//   - css / js : rutas que empiezan por /hbui/ y que existen dentro del pack.
//   - videos   : el pack aloja los videos en hbui/videos (los llena game/videos.js).
const fs = require('fs');
const path = require('path');
const config = require('../config');
const settings = require('../settings');

const INJECT_FILE = path.join('hbui', 'summer-inject.json');
const HBUI_PATH = /^\/hbui\/[A-Za-z0-9_./-]+$/;
const REL_GAMEPLAY = path.join('Content', 'data', 'gui', 'dist', 'hbui', 'gameplay.html');
const REL_GAMEPLAY_UWP = path.join('data', 'gui', 'dist', 'hbui', 'gameplay.html');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

// ---------------------------------------------------------------- localizar el gameplay.html del juego

function candidates(preview) {
  const list = [];
  const editions = preview
    ? [['Minecraft Preview for Windows', 'Microsoft.MinecraftWindowsBeta_*'], ['Minecraft for Windows', 'Microsoft.MinecraftUWP_*']]
    : [['Minecraft for Windows', 'Microsoft.MinecraftUWP_*'], ['Minecraft Preview for Windows', 'Microsoft.MinecraftWindowsBeta_*']];

  // GDK: X:\XboxGames\<edicion>\Content\data\gui\dist\hbui\gameplay.html (en cualquier unidad)
  for (const [folder] of editions) {
    for (let c = 67; c <= 90; c++) { // C..Z
      list.push(path.join(`${String.fromCharCode(c)}:\\`, 'XboxGames', folder, REL_GAMEPLAY));
    }
  }
  // UWP antiguo: C:\Program Files\WindowsApps\<paquete>\data\gui\dist\hbui\gameplay.html
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const apps = path.join(programFiles, 'WindowsApps');
  for (const [, pkg] of editions) {
    const prefix = pkg.replace('*', '');
    let dirs = [];
    try { dirs = fs.readdirSync(apps).filter((d) => d.startsWith(prefix)).sort().reverse(); } catch { /* carpeta protegida */ }
    for (const d of dirs) list.push(path.join(apps, d, REL_GAMEPLAY_UWP));
  }
  return list;
}

function findGameplayHtml(kind) {
  const override = settings.get().gameplayHtmlOverride || (config.oreUi || {}).gameplayHtml;
  if (override) return fs.existsSync(override) ? override : null;
  if (process.platform !== 'win32') return null;
  const preview = /preview/i.test(kind || '');
  return candidates(preview).find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || null;
}

// ---------------------------------------------------------------- parcheo

// Inserta `text` justo antes de la ULTIMA aparicion de `tag` (sin distinguir mayusculas).
function insertBefore(html, tag, text) {
  const i = html.toLowerCase().lastIndexOf(tag);
  return i === -1 ? null : html.slice(0, i) + text + html.slice(i);
}

function patchHtml(html, { css = [], js = [] }) {
  let out = html;
  const links = css.filter((href) => !out.includes(href)).map((href) => `<link rel="stylesheet" href="${href}">`).join('');
  if (links) out = insertBefore(out, '</head>', links) ?? links + out;
  const scripts = js.filter((src) => !out.includes(src)).map((src) => `<script src="${src}"></script>`).join('');
  if (scripts) out = insertBefore(out, '</body>', scripts) ?? out + scripts;
  return out;
}

// El gameplay.html del juego referencia sus bundles y vive en /hbui/. Si no, no es el correcto y NO se parchea:
// un gameplay.html equivocado rompe la interfaz de todo el juego.
function looksLikeGameplayHtml(html) {
  return /<script/i.test(html) && /\/hbui\//.test(html);
}

// ---------------------------------------------------------------- packs con inyecciones

// Lee hbui/summer-inject.json de un pack instalado. Devuelve null si el pack no pide nada.
function readInjection(packDir) {
  const spec = readJson(path.join(packDir, INJECT_FILE));
  if (!spec || typeof spec !== 'object') return null;
  const valid = (list) => (Array.isArray(list) ? list : []).filter((p) =>
    typeof p === 'string' && HBUI_PATH.test(p) && !p.includes('..') && fs.existsSync(path.join(packDir, p.replace(/^\//, ''))));
  return { dir: packDir, css: valid(spec.css), js: valid(spec.js), videos: spec.videos === true };
}

function collect(packDirs) {
  return packDirs.map(readInjection).filter(Boolean);
}

// Escribe el gameplay.html parcheado en cada pack que pidio inyecciones, con la UNION de todas las
// inyecciones (solo gana un gameplay.html: el del pack con mas prioridad). Devuelve { applied, warning }.
function apply(packDirs, kind) {
  const injections = collect(packDirs);
  if (!injections.length) return { applied: false };
  if ((config.oreUi || {}).enabled === false) return { applied: false };

  const src = findGameplayHtml(kind);
  if (!src) {
    return { applied: false, warning: 'Ore UI: no encontré el gameplay.html del juego (la carpeta del juego suele estar protegida). ' +
      'Indica su ruta en config/launcher.config.js → oreUi.gameplayHtml. Sin él los videos no se mostrarán.' };
  }
  let original;
  try { original = fs.readFileSync(src, 'utf8'); }
  catch (e) { return { applied: false, warning: `Ore UI: no pude leer ${src} (${e.code || e.message}). Copia ese archivo a otra carpeta y pon la ruta en oreUi.gameplayHtml.` }; }
  if (!looksLikeGameplayHtml(original)) {
    return { applied: false, warning: 'Ore UI: el gameplay.html encontrado no parece el del juego; no se parcheó para no romper la interfaz.' };
  }

  const css = [...new Set(injections.flatMap((i) => i.css))];
  const js = [...new Set(injections.flatMap((i) => i.js))];
  const patched = patchHtml(original, { css, js });
  for (const inj of injections) {
    const out = path.join(inj.dir, 'hbui', 'gameplay.html');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, patched, 'utf8'); // UTF-8 sin BOM
  }
  return { applied: true, source: src };
}

const needsInjection = (packDir) => !!readInjection(packDir);

module.exports = { apply, collect, needsInjection, findGameplayHtml, patchHtml, looksLikeGameplayHtml, INJECT_FILE };
