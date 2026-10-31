// Pantalla de carga propia que tapa las pantallas de arranque de Minecraft (la roja de Mojang
// y la gris de carga) hasta que el juego llega al menu, y le pone nombre/icono del launcher.
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
const cfg = () => Object.assign({ minHoldMs: 12000, maxHoldMs: 60000, graceMs: 1500, gameTitle: 'Summer Launcher' }, config.loadingScreen);

function show() {
  close();
  const b = screen.getPrimaryDisplay().bounds;
  const c = cfg();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: c.background || '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'splash.html'), {
    query: { logo: pathToFileURL(paths.asset(c.logo)).href, bg: c.background || '#000000' },
  });
  win.once('ready-to-show', () => win && win.showInactive());
  win.on('closed', () => { win = null; globalShortcut.unregister('Escape'); });
  try { globalShortcut.register('Escape', close); } catch { /* salida de emergencia opcional */ }
}

function close() {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

// Vigila la ventana de Minecraft: cierra la pantalla cuando el juego ya cargo y luego le cambia
// el titulo y el icono. Usa PowerShell (incluido en Windows), sin instalar nada.
const SCRIPT = `
param([string]$Flag,[string]$Icon,[string]$Title,[int]$Seconds)
Add-Type @"
using System; using System.Runtime.InteropServices;
public class SW {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string t);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr i, string f, uint t, int x, int y, uint fl);
}
"@
$big = [SW]::LoadImage([IntPtr]::Zero, $Icon, 1, 256, 256, 0x10)
$small = [SW]::LoadImage([IntPtr]::Zero, $Icon, 1, 16, 16, 0x10)
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  $p = Get-Process Minecraft.Windows -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    [Console]::Out.WriteLine("T|" + $p.MainWindowTitle); [Console]::Out.Flush()
    if (Test-Path $Flag) {
      [void][SW]::SetWindowText($p.MainWindowHandle, $Title)
      if ($small -ne [IntPtr]::Zero) { [void][SW]::SendMessage($p.MainWindowHandle, 0x80, [IntPtr]0, $small) }
      if ($big -ne [IntPtr]::Zero) { [void][SW]::SendMessage($p.MainWindowHandle, 0x80, [IntPtr]1, $big) }
    }
  }
  Start-Sleep -Milliseconds 1000
}
`;

function finishWhenReady() {
  if (process.platform !== 'win32') { setTimeout(close, cfg().minHoldMs); return; }
  const c = cfg();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summer-'));
  const file = path.join(dir, 'watch.ps1');
  const flag = path.join(dir, 'brand.flag');
  fs.writeFileSync(file, '\ufeff' + SCRIPT, 'utf8');
  if (ps) { try { ps.kill(); } catch { /* ya cerrado */ } }
  ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file,
    '-Flag', flag, '-Icon', paths.asset('logos', 'icon.ico'), '-Title', c.gameTitle, '-Seconds', '150'], { windowsHide: true });

  const t0 = Date.now();
  let firstSeen = 0;
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    setTimeout(() => { close(); try { fs.writeFileSync(flag, '1'); } catch { /* sin permiso */ } }, c.graceMs);
  };
  ps.stdout.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (!line.startsWith('T|')) continue;
      const title = line.slice(2).trim();
      if (!firstSeen) firstSeen = Date.now();
      const loaded = title && !/for windows/i.test(title);
      if (loaded && Date.now() - firstSeen >= c.minHoldMs) finish();
    }
  });
  ps.on('error', () => finish());
  setTimeout(finish, c.maxHoldMs - (Date.now() - t0));
  ps.on('close', () => { done = true; close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporal */ } });
}

module.exports = { show, close, finishWhenReady };
