// Prepara los videos del reproductor Ore UI.
//
// El motor de Ore UI (Gameface) solo reproduce WebM con UNA pista de video VP8/VP9 y UNA de audio Vorbis,
// asi que un .mkv no se puede usar tal cual. Aqui, en cada arranque de una instancia:
//   1. Se buscan .webm / .mkv en la carpeta de videos (por defecto /videos, mas userData/videos).
//   2. Los .mkv (y los .webm que no cumplan el formato) se convierten con ffmpeg:
//        - si ya traen VP8/VP9 + Vorbis solo se cambia el contenedor (sin recodificar, es casi instantaneo);
//        - si no, se recodifica (config.video.transcodeArgs). Si el video no tiene audio se le anade una pista
//          silenciosa, porque Gameface exige una.
//      El resultado se guarda en cache (userData/video-cache): la conversion solo ocurre una vez por video.
//   3. Los .webm resultantes se copian al pack: <rp>/hbui/videos/<nombre>.webm
//   4. Se regenera <bp>/scripts/videos.js con la lista, que usa el behavior pack (/play N y video aleatorio).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const config = require('../config');
const paths = require('../paths');

const MAX_VIDEOS = 8; // limite del reproductor: video-player.js descarta listas de mas de 8
const DEFAULTS = {
  enabled: true,
  sourceDir: 'videos',
  extensions: ['.webm', '.mkv'],
  warnMb: 50, // Gameface carga el video entero en memoria: avisa si pesa mas
  transcodeArgs: ['-vf', 'scale=854:-2', '-r', '24', '-c:v', 'libvpx', '-b:v', '450k', '-crf', '12', '-g', '48', '-c:a', 'libvorbis', '-b:a', '80k'],
};
const cfg = () => ({ ...DEFAULTS, ...(config.video || {}) });

// ---------------------------------------------------------------- ffmpeg

function ffmpegBin() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = paths.inRoot('tools', 'ffmpeg', exe);
  return fs.existsSync(bundled) ? bundled : 'ffmpeg'; // si no esta incluido, se busca en el PATH
}

function run(file, args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve) => execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
    (err, stdout, stderr) => resolve({ err, out: String(stdout || ''), stderr: String(stderr || '') })));
}

let ffmpegOk;
async function hasFfmpeg() {
  if (ffmpegOk === undefined) ffmpegOk = !(await run(ffmpegBin(), ['-hide_banner', '-version'], 15000)).err;
  return ffmpegOk;
}

// Pistas del archivo leyendo lo que ffmpeg imprime al abrirlo (no hace falta ffprobe).
async function streams(file) {
  const { stderr } = await run(ffmpegBin(), ['-hide_banner', '-i', file], 30000); // sale con error por no tener salida: es normal
  const list = [];
  const re = /Stream #\d+:\d+[^\n]*?: (Video|Audio): ([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(stderr))) {
    if (/attached pic/i.test(stderr.slice(m.index, stderr.indexOf('\n', m.index) + 1))) continue; // caratulas
    list.push({ type: m[1].toLowerCase(), codec: m[2].toLowerCase() });
  }
  return list;
}

const gamefaceReady = (s) => {
  const v = s.filter((x) => x.type === 'video');
  const a = s.filter((x) => x.type === 'audio');
  return v.length === 1 && a.length === 1 && ['vp8', 'vp9'].includes(v[0].codec) && a[0].codec === 'vorbis';
};

// ---------------------------------------------------------------- nombres

function slug(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'video';
}
// La fuente de Minecraft/Gameface casi no tiene caracteres fuera de ASCII.
function title(name) {
  const t = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/[_-]+/g, ' ').trim().slice(0, 24).trim();
  return t || 'Video';
}

// ---------------------------------------------------------------- busqueda y conversion

function listSources(dirs, extensions) {
  const seen = new Set();
  const found = [];
  const exts = extensions.map((e) => e.toLowerCase());
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!exts.includes(ext)) continue;
      const file = path.join(dir, f);
      try { if (!fs.statSync(file).isFile()) continue; } catch { continue; }
      const base = slug(path.basename(f, path.extname(f)));
      if (seen.has(base)) continue; // mismo nombre en dos carpetas: gana la primera
      seen.add(base);
      found.push({ file, ext, base, name: path.basename(f, path.extname(f)) });
    }
  }
  return found;
}

// Devuelve la ruta (en cache) de un .webm listo para Gameface.
async function ensureWebm(src, onStatus) {
  const stat = fs.statSync(src.file);
  const argsKey = crypto.createHash('sha1').update(JSON.stringify(cfg().transcodeArgs)).digest('hex').slice(0, 8);
  const cacheDir = path.join(paths.userData(), 'video-cache');
  const cached = path.join(cacheDir, `${src.base}-${stat.size}-${Math.floor(stat.mtimeMs)}-${argsKey}.webm`);
  if (fs.existsSync(cached)) return cached;
  fs.mkdirSync(cacheDir, { recursive: true });

  const ffmpeg = await hasFfmpeg();
  if (!ffmpeg) {
    if (src.ext === '.webm') return src.file; // sin ffmpeg no se puede comprobar: se usa tal cual
    throw new Error('hace falta ffmpeg para convertir .mkv (copia ffmpeg.exe en tools/ffmpeg/ o instálalo en el PATH)');
  }

  const info = await streams(src.file);
  if (src.ext === '.webm' && gamefaceReady(info)) return src.file; // ya sirve: no se toca

  const tmp = `${cached}.part`;
  fs.rmSync(tmp, { force: true });
  const bin = ffmpegBin();
  let args;
  if (gamefaceReady(info)) {
    onStatus(`Convirtiendo ${src.name} (sin recodificar)…`);
    args = ['-y', '-v', 'error', '-i', src.file, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'webm', tmp];
  } else {
    onStatus(`Recodificando ${src.name} (puede tardar)…`);
    const hasAudio = info.some((x) => x.type === 'audio');
    args = ['-y', '-v', 'error', '-i', src.file];
    if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'); // Gameface exige pista de audio
    args.push('-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0');
    if (!hasAudio) args.push('-shortest');
    args.push(...cfg().transcodeArgs, '-f', 'webm', tmp);
  }
  const r = await run(bin, args);
  if (r.err || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    fs.rmSync(tmp, { force: true });
    const detail = (r.stderr || (r.err && r.err.message) || '').trim().split('\n').slice(-2).join(' ').slice(0, 160);
    throw new Error(`ffmpeg falló (${detail || 'sin detalle'})`);
  }
  fs.renameSync(tmp, cached);
  return cached;
}

// ---------------------------------------------------------------- API

// rpDir: pack instalado con hbui/ (destino de los .webm). bpScriptsDir: <bp>/scripts (opcional).
// extraDir: carpeta de videos propia de la instancia (opcional, relativa a la raiz del launcher).
// Devuelve { videos, warnings }. Nunca lanza por un video malo: lo omite y lo avisa.
async function prepare({ rpDir, bpScriptsDir, extraDir, onStatus = () => {} }) {
  const warnings = [];
  const c = cfg();
  if (c.enabled === false) return { videos: [], warnings };

  const dirs = [paths.inRoot(extraDir || c.sourceDir), path.join(paths.userData(), 'videos')];
  let sources = listSources(dirs, c.extensions);
  if (!sources.length) {
    warnings.push(`Videos: no hay .webm ni .mkv en "${extraDir || c.sourceDir}"; el reproductor quedará sin videos.`);
  }
  if (sources.length > MAX_VIDEOS) {
    warnings.push(`Videos: el reproductor admite ${MAX_VIDEOS}; se usan los primeros ${MAX_VIDEOS} por orden alfabético.`);
    sources = sources.slice(0, MAX_VIDEOS);
  }

  const outDir = path.join(rpDir, 'hbui', 'videos');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const videos = [];
  for (const src of sources) {
    try {
      const webm = await ensureWebm(src, onStatus);
      const mb = fs.statSync(webm).size / (1024 * 1024);
      if (mb > c.warnMb) warnings.push(`Videos: "${src.name}" pesa ${mb.toFixed(0)} MB; Ore UI lo carga entero en memoria y puede fallar o tardar. Conviene recodificarlo más pequeño.`);
      fs.copyFileSync(webm, path.join(outDir, `${src.base}.webm`));
      videos.push({ id: videos.length + 1, title: title(src.name), src: `/hbui/videos/${src.base}.webm` });
    } catch (e) {
      warnings.push(`Video "${src.name}" omitido: ${e.message}`);
    }
  }

  if (bpScriptsDir) {
    fs.mkdirSync(bpScriptsDir, { recursive: true });
    const body = videos.map((v) => `  { id: ${v.id}, title: ${JSON.stringify(v.title)}, src: ${JSON.stringify(v.src)} },`).join('\n');
    fs.writeFileSync(path.join(bpScriptsDir, 'videos.js'),
      `// Generado por Summer Launcher. No editar a mano: se reescribe en cada arranque.\nexport const VIDEOS = [\n${body}\n];\n`, 'utf8');
  }
  return { videos, warnings };
}

module.exports = { prepare, listSources, gamefaceReady, slug, title, MAX_VIDEOS };
