// Pantalla de carga propia. Tapa las pantallas de arranque de Minecraft (la roja de Mojang y la gris
// de carga): se mantiene SIEMPRE encima, deja la ventana de Minecraft minimizada mientras carga y,
// cuando el juego ya cargo, la restaura, quita la pantalla y le pone nombre/icono del launcher.
const { BrowserWindow, screen, globalShortcut } = require('electron');
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
let flagFile = null;
let tmpDir = null;

const cfg = () => Object.assign({
  minHoldMs: 20000, maxHoldMs: 90000, graceMs: 1200, gameTitle: 'Summer Launcher',
  minimizeGame: true, image: null, showBar: true, showText: true,
}, config.loadingScreen);

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
  win.once('ready-to-show', () => win && win.showInactive());
  win.on('closed', () => { win = null; globalShortcut.unregister('Escape'); });
  try { globalShortcut.register('Escape', close); } catch { /* salida de emergencia opcional */ }
  // Minecraft puede subirse por encima al abrir: se vuelve a poner la pantalla arriba constantemente.
  const raise = () => { if (win && !win.isDestroyed()) { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } };
  raise();
  keepTop = setInterval(raise, 200);
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

// Se llama justo despues de abrir Minecraft.
function watch() {
  const c = cfg();
  if (process.platform !== 'win32') { setTimeout(close, c.minHoldMs); return; }
  stopWatcher();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summer-'));
  const dir = tmpDir;
  const file = path.join(dir, 'watch.ps1');
  flagFile = path.join(dir, 'release.flag');
  fs.writeFileSync(file, '\ufeff' + SCRIPT, 'utf8');
  const seconds = Math.ceil(c.maxHoldMs / 1000) + 120;
  log(`watch: inicio (minHold=${c.minHoldMs} maxHold=${c.maxHoldMs} minimizar=${c.minimizeGame})`);
  const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file,
    '-Flag', flagFile, '-Icon', paths.asset('logos', 'icon.ico'), '-Title', c.gameTitle,
    '-Minimize', c.minimizeGame === false ? '0' : '1', '-Seconds', String(seconds)], { windowsHide: true });
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
  proc.stdout.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (!line.startsWith('T|')) continue;
      const title = line.slice(2).trim();
      if (title !== lastTitle) { lastTitle = title; log(`titulo: "${title}" (+${Date.now() - t0}ms)`); }
      if (!firstSeen) firstSeen = Date.now();
      const loaded = title && !/for windows/i.test(title);
      if (loaded && Date.now() - firstSeen >= c.minHoldMs) finish('titulo cambio');
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
}

module.exports = { show, watch, close };
