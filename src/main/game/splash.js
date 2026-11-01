// Pantalla de carga propia. Tapa las pantallas de arranque de Minecraft (la roja de Mojang y la gris
// de carga) y se quita cuando el juego ya cargo. La ventana se crea por adelantado (oculta) para que
// aparezca al instante al pulsar JUGAR.
const { BrowserWindow, screen, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('../config');
const paths = require('../paths');

let win = null;        // ventana (oculta si esta precalentada)
let ps = null;         // vigilante: titulo del juego + nombre/icono
let cap = null;        // vigilante de pantalla (proceso aparte; si falla, solo se pierde la deteccion)
let keepTop = null;
let maxTimer = null;
let fbTimer = null;
let flagFile = null;
let tmpDir = null;
let quitting = false;

const cfg = () => Object.assign({
  minHoldMs: 5000, postLoadMs: 1500, serverJoinMs: 4000, fallbackHoldMs: 22000, maxHoldMs: 60000, graceMs: 500,
  captureEveryMs: 600, gameTitle: 'Summer Launcher', detect: 'screen', minimizeGame: false, image: null, showBar: true, showText: true,
}, config.loadingScreen);
const useCapture = (c) => c.detect !== 'timer' && !c.minimizeGame && process.platform === 'win32';

const logFile = () => path.join(paths.userData(), 'splash-debug.log');
function log(msg) {
  try { fs.mkdirSync(paths.userData(), { recursive: true }); fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch { /* sin log */ }
}

function build() {
  const c = cfg();
  const b = screen.getPrimaryDisplay().bounds;
  const w = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: c.background || '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const imageFile = c.image ? paths.asset(c.image) : null;
  const useImage = !!imageFile && fs.existsSync(imageFile);
  w.loadFile(path.join(__dirname, '..', '..', 'renderer', 'splash.html'), {
    query: {
      logo: pathToFileURL(paths.asset(c.logo)).href,
      image: useImage ? pathToFileURL(imageFile).href : '',
      bg: c.background || '#000000',
      bar: c.showBar === false ? '0' : '1',
      text: c.showText === false ? '0' : '1',
    },
  });
  // Con la vigilancia de pantalla, esta ventana no sale en la captura (se ve lo que hay debajo).
  if (useCapture(c)) { try { w.setContentProtection(true); } catch { /* version antigua */ } }
  w.on('closed', () => { if (win === w) win = null; globalShortcut.unregister('Escape'); });
  return w;
}

// Crea la ventana oculta por adelantado.
function prewarm() {
  if (quitting || (win && !win.isDestroyed())) return;
  try { win = build(); } catch (e) { log(`prewarm fallo: ${e.message}`); }
}

function show() {
  stopTimers();
  if (!win || win.isDestroyed()) win = build();
  const w = win;
  w.setBounds(screen.getPrimaryDisplay().bounds);
  try { globalShortcut.register('Escape', close); } catch { /* salida de emergencia opcional */ }
  const reveal = () => { if (!w.isDestroyed()) { w.setAlwaysOnTop(true, 'screen-saver'); w.showInactive(); w.moveTop(); } };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', reveal); else reveal();
  // Minecraft puede subirse por encima al abrir: se vuelve a poner la pantalla arriba.
  keepTop = setInterval(() => { if (!w.isDestroyed()) { w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop(); } }, 200);
}

// Le dice al vigilante que suelte (restaure) la ventana de Minecraft.
function release() {
  if (flagFile) { try { fs.writeFileSync(flagFile, '1'); } catch { /* sin permiso */ } }
}

function stopTimers() {
  if (keepTop) clearInterval(keepTop);
  keepTop = null;
  if (maxTimer) clearTimeout(maxTimer);
  maxTimer = null;
  if (fbTimer) clearTimeout(fbTimer);
  fbTimer = null;
  if (cap) { try { cap.kill(); } catch { /* ya cerrado */ } }
  cap = null;
}

function close() {
  release();
  stopTimers();
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  globalShortcut.unregister('Escape');
  if (!quitting) setTimeout(prewarm, 1500); // deja lista la siguiente
}

function destroy() { quitting = true; close(); stopWatcher(); }

// Vigila Minecraft.Windows: avisa del titulo de la ventana y, cuando cargo, le pone nombre/icono.
// (Opcional) la mantiene minimizada mientras carga.
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


// Lee una miniatura de la pantalla (GDI, sin tocar el juego) y dice si se ve la pantalla roja de Mojang,
// la gris de carga, negro u otra cosa. Va en un proceso aparte: si falla, solo se pierde la deteccion.
const CAPTURE = String.raw`
param([int]$Interval,[int]$Seconds)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public class Cap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  public static string Kind() {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) { g.CopyFromScreen(0, 0, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy); }
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      try {
        int NX = 48, NY = 27, total = 0;
        Dictionary<int, long[]> map = new Dictionary<int, long[]>();
        for (int j = 0; j < NY; j++) for (int i = 0; i < NX; i++) {
          int x = (int)((i + 0.5) * w / NX), y = (int)((j + 0.5) * h / NY);
          int off = y * d.Stride + x * 4;
          int b = Marshal.ReadByte(d.Scan0, off), gr = Marshal.ReadByte(d.Scan0, off + 1), r = Marshal.ReadByte(d.Scan0, off + 2);
          int key = ((r >> 4) << 8) | ((gr >> 4) << 4) | (b >> 4);
          long[] e;
          if (!map.TryGetValue(key, out e)) { e = new long[4]; map[key] = e; }
          e[0]++; e[1] += r; e[2] += gr; e[3] += b; total++;
        }
        long[] top = null;
        foreach (long[] e in map.Values) if (top == null || e[0] > top[0]) top = e;
        if ((double)top[0] / total < 0.62) return "otro";
        double r2 = top[1] / (double)top[0], g2 = top[2] / (double)top[0], b2 = top[3] / (double)top[0];
        if (r2 > 150 && g2 < 110 && b2 < 120) return "rojo";
        if (Math.Abs(r2 - g2) <= 16 && Math.Abs(g2 - b2) <= 16) return (r2 + g2 + b2) / 3.0 < 8 ? "negro" : "gris";
        return "otro";
      } finally { bmp.UnlockBits(d); }
    }
  }
}
"@
[void][Cap]::SetProcessDPIAware()
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  try { [Console]::Out.WriteLine("S|" + [Cap]::Kind()) } catch { [Console]::Out.WriteLine("S|error") }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $Interval
}
`;

function stopWatcher() {
  if (ps) { try { ps.kill(); } catch { /* ya cerrado */ } }
  ps = null;
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
  const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];
  const proc = spawn('powershell.exe', [...psArgs, file,
    '-Flag', flagFile, '-Icon', paths.asset('logos', 'icon.ico'), '-Title', c.gameTitle,
    '-Minimize', c.minimizeGame ? '1' : '0', '-Seconds', String(seconds)], { windowsHide: true });
  ps = proc;

  const t0 = Date.now();
  let firstSeen = 0;
  let lastTitle = null;
  let done = false;
  const finish = (why) => {
    if (done) return; done = true;
    log(`finish: ${why} (+${Date.now() - t0}ms)`);
    release(); // restaura Minecraft; la pantalla propia sigue encima un momento mas
    setTimeout(close, c.graceMs);
  };
  // Sin deteccion de pantalla: se quita pasado fallbackHoldMs desde que se abrio el juego.
  let fellBack = false;
  const fallback = (why) => {
    if (fellBack || done) return; fellBack = true;
    log(`modo por tiempo: ${why}`);
    if (cap) { try { cap.kill(); } catch { /* ya cerrado */ } cap = null; }
    fbTimer = setTimeout(() => finish('tiempo'), Math.max(0, c.fallbackHoldMs - (Date.now() - t0)));
  };

  proc.stdout.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (!line.startsWith('T|')) continue;
      const title = line.slice(2).trim();
      if (title !== lastTitle) { lastTitle = title; log(`titulo: "${title}" (+${Date.now() - t0}ms)`); }
      if (!firstSeen) firstSeen = Date.now();
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

  if (!capture) { fallback('configurado'); return; }

  // Vigilancia de pantalla: hay que ver primero la roja o la gris (el juego esta cargando) y luego varias
  // lecturas seguidas sin ellas (ya muestra el menu o el mundo). Despues se espera postLoadMs.
  const capFile = path.join(dir, 'capture.ps1');
  fs.writeFileSync(capFile, '\ufeff' + CAPTURE, 'utf8');
  const extra = c.postLoadMs + (opts.server ? c.serverJoinMs : 0);
  let sawLoading = false;
  let clearStreak = 0;
  let errors = 0;
  let lastKind = null;
  const onKind = (kind) => {
    if (done || fellBack) return;
    if (kind !== lastKind) { lastKind = kind; log(`pantalla: ${kind} (+${Date.now() - t0}ms)`); }
    if (kind === 'error') { if (++errors >= 3) fallback('la captura da error'); return; }
    const loadingLike = kind === 'rojo' || kind === 'gris' || kind === 'negro';
    if (kind === 'rojo' || kind === 'gris') sawLoading = true;
    if (!sawLoading) {
      // Si pasan 12 s con el juego abierto y nunca se ve la carga, no se puede vigilar: modo por tiempo.
      if (firstSeen && Date.now() - firstSeen > 12000) fallback('no se vio la pantalla de carga');
      return;
    }
    clearStreak = loadingLike ? 0 : clearStreak + 1;
    if (clearStreak >= 2 && Date.now() - t0 >= c.minHoldMs) {
      if (cap) { try { cap.kill(); } catch { /* ya cerrado */ } cap = null; }
      log(`carga terminada; esperando ${extra}ms`);
      fbTimer = setTimeout(() => finish('juego cargado'), extra);
    }
  };
  const capProc = spawn('powershell.exe', [...psArgs, capFile, '-Interval', String(c.captureEveryMs), '-Seconds', String(seconds)], { windowsHide: true });
  cap = capProc;
  let pending = '';
  capProc.stdout.on('data', (buf) => {
    pending += String(buf);
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) if (line.startsWith('S|')) onKind(line.slice(2).trim());
  });
  capProc.on('error', () => fallback('no se pudo iniciar la captura'));
  capProc.on('close', () => { if (cap === capProc) cap = null; fallback('la captura se cerro'); });
}

module.exports = { prewarm, show, watch, close, destroy };
