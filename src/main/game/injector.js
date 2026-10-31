// Inyeccion de DLL en Minecraft.Windows.exe (clientes como Flarial).
// Solo Windows. Usa PowerShell + P/Invoke (LoadLibraryW via CreateRemoteThread).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const PS = String.raw`
param([string]$ProcName, [string]$Dll, [int]$TimeoutSec, [int]$DelayMs)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Inj {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint a, bool b, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr addr, uint size, uint type, uint prot);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool WriteProcessMemory(IntPtr h, IntPtr addr, byte[] buf, uint size, out UIntPtr w);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [DllImport("kernel32.dll")] static extern IntPtr GetProcAddress(IntPtr m, string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateRemoteThread(IntPtr h, IntPtr attr, uint stack, IntPtr start, IntPtr param, uint flags, IntPtr id);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Run(int pid, string dll) {
    IntPtr h = OpenProcess(0x1F0FFF, false, pid);
    if (h == IntPtr.Zero) return "No se pudo abrir el proceso (permisos). Error " + Marshal.GetLastWin32Error();
    byte[] bytes = Encoding.Unicode.GetBytes(dll + "\0");
    IntPtr mem = VirtualAllocEx(h, IntPtr.Zero, (uint)bytes.Length, 0x3000, 0x04);
    UIntPtr w; WriteProcessMemory(h, mem, bytes, (uint)bytes.Length, out w);
    IntPtr load = GetProcAddress(GetModuleHandle("kernel32.dll"), "LoadLibraryW");
    IntPtr t = CreateRemoteThread(h, IntPtr.Zero, 0, load, mem, 0, IntPtr.Zero);
    if (t == IntPtr.Zero) { CloseHandle(h); return "CreateRemoteThread fallo. Error " + Marshal.GetLastWin32Error(); }
    WaitForSingleObject(t, 10000); CloseHandle(t); CloseHandle(h);
    return "OK";
  }
}
"@
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$p = $null
while ((Get-Date) -lt $deadline) {
  $p = Get-Process -Name $ProcName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $p) { Write-Output "TIMEOUT: Minecraft no abrio a tiempo"; exit 2 }
Start-Sleep -Milliseconds $DelayMs
Write-Output ([Inj]::Run($p.Id, $Dll))
`;

function run(file, args) {
  return new Promise((resolve) => execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => resolve({ err, out: String(stdout).trim(), stderr })));
}

// Las apps de la tienda solo cargan DLLs con permiso para "ALL APPLICATION PACKAGES".
async function grantAppPackages(dll) {
  await run('icacls', [dll, '/grant', '*S-1-15-2-1:(RX)']);
}

async function inject(dllRelPath, { delayMs = 6000, timeoutSec = 90 } = {}) {
  if (process.platform !== 'win32') return { ok: false, error: 'La inyeccion solo funciona en Windows' };
  const dll = paths.inRoot(dllRelPath);
  if (!fs.existsSync(dll)) return { ok: false, error: `No existe ${dllRelPath}. Coloca la DLL en esa ruta.` };
  await grantAppPackages(dll);
  const script = path.join(paths.userData(), 'inject.ps1');
  fs.mkdirSync(paths.userData(), { recursive: true });
  fs.writeFileSync(script, PS);
  const { out } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-ProcName', 'Minecraft.Windows', '-Dll', dll, '-TimeoutSec', String(timeoutSec), '-DelayMs', String(delayMs)]);
  return out.endsWith('OK') ? { ok: true } : { ok: false, error: out || 'Fallo desconocido al inyectar' };
}

module.exports = { inject };
