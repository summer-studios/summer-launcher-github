// Pantalla de carga propia. Tapa las pantallas de arranque de Minecraft (la roja de Mojang y la gris
// de carga): se mantiene SIEMPRE encima, deja la ventana de Minecraft minimizada mientras carga y,
// cuando el juego ya cargo, la restaura, quita la pantalla y le pone nombre/icono del launcher.
const { BrowserWindow, screen, globalShortcut, desktopCapturer } = require('electron');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('../config');
const paths = require('../paths');

let win = null;
let ps = null;
let keepTop = null;
let maxTimer = null;
let sampler = null;
let flagFile = null;
let tmpDir = null;

const cfg = () => Object.assign({
  minHoldMs: 6000, postLoadMs: 2500, serverJoinMs: 7000, fallbackHoldMs: 35000, maxHoldMs: 120000, graceMs: 800,
  gameTitle: 'Summer Launcher', detect: 'screen', minimizeGame: false, image: null, showBar: true, showText: true,
}, config.loadingScreen);
const useCapture = (c) => c.detect !== 'timer' && !c.minimizeGame && process.platform === 'win32';

const logFile = () => path.join(paths.userData(), 'splash-debug.log');
function log(msg) {
  try { fs.mkdirSync(paths.userData(), { recursive: true }); fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch { /* sin log */ }
}

function show() {
  close();
  const c = cfg();
  const b = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: c.background || '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const imageFile = c.image ? paths.asset(c.image) : null;
  const useImage = !!imageFile && fs.existsSync(imageFile);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'splash.html'), {
    query: {
      logo: pathToFileURL(paths.asset(c.logo)).href,
      image: useImage ? pathToFileURL(imageFile).href : '',
      bg: c.background || '#000000',
      bar: c.showBar === false ? '0' : '1',
      text: c.showText === false ? '0' : '1',
    },
  });
  // Con la captura activa, esta ventana no aparece en ella: asi se puede ver que muestra Minecraft debajo.
  if (useCapture(c)) { try { win.setContentProtection(true); } catch { /* version antigua */ } }
  win.once('ready-to-show', () => win && win.showInactive());
  win.on('closed', () => { win = null; globalShortcut.unregister('Escape'); });
  try { globalShortcut.register('Escape', close); } catch { /* salida de emergencia opcional */ }
  // Minecraft puede subirse por encima al abrir: se vuelve a poner la pantalla arriba constantemente.
  let n = 0;
  const raise = () => {
    if (!win || win.isDestroyed()) return;
    if (n++ % 20 === 0) win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  };
  raise();
  keepTop = setInterval(raise, 50);
}

// Le dice al vigilante que suelte (restaure) la ventana de Minecraft.
function release() {
  if (flagFile) { try { fs.writeFileSync(flagFile, '1'); } catch { /* sin permiso */ } }
}

function close() {
  release();
  if (keepTop) clearInterval(keepTop);
  keepTop = null;
  if (maxTimer) clearTimeout(maxTimer);
  maxTimer = null;
  if (sampler) clearInterval(sampler);
  sampler = null;
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

// Vigila Minecraft.Windows: lo mantiene minimizado mientras carga, avisa cuando ya cargo y luego le
// cambia el titulo y el icono. Usa PowerShell (incluido en Windows), sin instalar nada.
const SCRIPT = String.raw`
param([string]$Flag,[string]$Icon,[string]$Title,[int]$Minimize,[int]$Seconds)
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public class SW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string t);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr i, string f, uint t, int x, int y, uint fl);
  public static List<IntPtr> Windows(uint pid) {
    List<IntPtr> r = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
}
"@
$big = [SW]::LoadImage([IntPtr]::Zero, $Icon, 1, 256, 256, 0x10)
$small = [SW]::LoadImage([IntPtr]::Zero, $Icon, 1, 16, 16, 0x10)
$end = (Get-Date).AddSeconds($Seconds)
$released = $false
while ((Get-Date) -lt $end) {
  $procs = Get-Process Minecraft.Windows -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    if ($p.MainWindowHandle -ne 0) { [Console]::Out.WriteLine("T|" + $p.MainWindowTitle); [Console]::Out.Flush() }
    if (-not $released -and (Test-Path $Flag)) {
      $released = $true
      foreach ($h in [SW]::Windows([uint32]$p.Id)) { [void][SW]::ShowWindow($h, 9) }
      if ($p.MainWindowHandle -ne 0) { [void][SW]::SetForegroundWindow($p.MainWindowHandle) }
    }
    if (-not $released -and $Minimize -eq 1) {
      foreach ($h in [SW]::Windows([uint32]$p.Id)) { if (-not [SW]::IsIconic($h)) { [void][SW]::ShowWindow($h, 7) } }
    }
    if ($released -and $p.MainWindowHandle -ne 0) {
      [void][SW]::SetWindowText($p.MainWindowHandle, $Title)
      if ($small -ne [IntPtr]::Zero) { [void][SW]::SendMessage($p.MainWindowHandle, 0x80, [IntPtr]0, $small) }
      if ($big -ne [IntPtr]::Zero) { [void][SW]::SendMessage($p.MainWindowHandle, 0x80, [IntPtr]1, $big) }
    }
  }
  Start-Sleep -Milliseconds 400
}
`;

function stopWatcher() {
  if (ps) { try { ps.kill(); } catch { /* ya cerrado */ } }
  ps = null;
}

// ---- Deteccion de la pantalla de carga de Minecraft ----
// Mira una miniatura de la pantalla (sin la ventana del launcher) y decide si lo que se ve es la pantalla
// roja de Mojang, la gris de carga o negro (todas son un color casi uniforme con un logo encima).
// Devuelve 'rojo' | 'gris' | 'negro' | 'otro' (menu, mundo, escritorio) | null si no se pudo capturar.
async function classifyScreen() {
  const d = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 36 } });
  const src = sources.find((x) => String(x.display_id) === String(d.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) return null;
  const { width, height } = src.thumbnail.getSize();
  const bmp = src.thumbnail.toBitmap(); // BGRA
  const buckets = new Map();
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const b = bmp[i * 4], g = bmp[i * 4 + 1], r = bmp[i * 4 + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; } else buckets.set(key, { n: 1, r, g, b });
  }
  let top = null;
  for (const e of buckets.values()) if (!top || e.n > top.n) top = e;
  if (top.n / total < 0.62) return 'otro';
  const r = top.r / top.n, g = top.g / top.n, b = top.b / top.n;
  if (r > 150 && g < 110 && b < 120) return 'rojo';
  if (Math.abs(r - g) <= 16 && Math.abs(g - b) <= 16) return (r + g + b) / 3 < 8 ? 'negro' : 'gris';
  return 'otro';
}

// Se llama justo despues de abrir Minecraft. opts: { server: bool }
function watch(opts = {}) {
  const c = cfg();
  if (process.platform !== 'win32') { setTimeout(close, c.fallbackHoldMs); return; }
  stopWatcher();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summer-'));
  const dir = tmpDir;
  const file = path.join(dir, 'watch.ps1');
  flagFile = path.join(dir, 'release.flag');
  fs.writeFileSync(file, '\ufeff' + SCRIPT, 'utf8');
  const seconds = Math.ceil(c.maxHoldMs / 1000) + 120;
  const capture = useCapture(c);
  log(`watch: inicio (modo=${capture ? 'pantalla' : 'tiempo'} minHold=${c.minHoldMs} postLoad=${c.postLoadMs} servidor=${!!opts.server})`);
  const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file,
    '-Flag', flagFile, '-Icon', paths.asset('logos', 'icon.ico'), '-Title', c.gameTitle,
    '-Minimize', c.minimizeGame ? '1' : '0', '-Seconds', String(seconds)], { windowsHide: true });
  ps = proc;

  const t0 = Date.now();
  let firstSeen = 0;
  let lastTitle = null;
  let titleLoaded = false;
  let done = false;
  const finish = (why) => {
    if (done) return; done = true;
    log(`finish: ${why} (+${Date.now() - t0}ms)`);
    if (sampler) { clearInterval(sampler); sampler = null; }
    release(); // restaura Minecraft; la pantalla propia sigue encima un momento mas
    setTimeout(close, c.graceMs);
  };

  proc.stdout.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (!line.startsWith('T|')) continue;
      const title = line.slice(2).trim();
      if (title !== lastTitle) { lastTitle = title; log(`titulo: "${title}" (+${Date.now() - t0}ms)`); }
      if (!firstSeen) firstSeen = Date.now();
      titleLoaded = !!title && !/for windows/i.test(title);
      // Sin vigilancia de pantalla: se quita por titulo + tiempo de seguridad.
      if (!capture && titleLoaded && Date.now() - firstSeen >= c.fallbackHoldMs) finish('titulo + tiempo');
    }
  });
  proc.on('error', () => finish('error powershell'));
  maxTimer = setTimeout(() => finish('tiempo maximo'), c.maxHoldMs);
  proc.on('close', () => {
    done = true; close();
    if (ps === proc) ps = null;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporal */ }
    if (flagFile === path.join(dir, 'release.flag')) flagFile = null;
  });

  if (!capture) return;
  // Vigilancia de pantalla: hay que ver primero la roja/gris/negra (el juego esta cargando) y luego varias
  // lecturas seguidas sin ellas (el juego ya muestra el menu o el mundo). Despues se espera postLoadMs.
  let sawLoading = false;
  let clearStreak = 0;
  let blackSince = 0;
  let lastKind = null;
  let busy = false;
  const extra = c.postLoadMs + (opts.server ? c.serverJoinMs : 0);
  sampler = setInterval(async () => {
    if (done || busy) return;
    busy = true;
    try {
      const kind = await classifyScreen();
      if (kind !== lastKind) { lastKind = kind; log(`pantalla: ${kind} (+${Date.now() - t0}ms)`); }
      const loadingLike = kind === 'rojo' || kind === 'gris' || kind === 'negro';
      if (kind === null) return;
      // Si la captura sale negra de forma continua (sistema que no la permite), se pasa a modo por tiempo.
      if (kind === 'negro') { blackSince = blackSince || Date.now(); } else blackSince = 0;
      if (blackSince && Date.now() - blackSince > 15000 && !sawLoading) {
        log('captura negra continua: modo por tiempo');
        if (sampler) { clearInterval(sampler); sampler = null; }
        setTimeout(() => finish('captura no disponible'), Math.max(0, c.fallbackHoldMs - (Date.now() - t0)));
        return;
      }
      if (loadingLike && firstSeen) sawLoading = true;
      if (!sawLoading) {
        // Nunca se vio la pantalla de carga: se usa el tiempo de seguridad.
        if (Date.now() - t0 > c.fallbackHoldMs) finish('no se vio la carga');
        return;
      }
      clearStreak = loadingLike ? 0 : clearStreak + 1;
      if (clearStreak >= 3 && Date.now() - t0 >= c.minHoldMs) {
        if (sampler) { clearInterval(sampler); sampler = null; }
        log(`carga terminada; esperando ${extra}ms`);
        setTimeout(() => finish('juego cargado'), extra);
      }
    } catch (e) { log(`captura fallo: ${e.message}`); } finally { busy = false; }
  }, 700);
}

module.exports = { show, watch, close };
