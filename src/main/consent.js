// Consentimiento para parchear carpetas sensibles de Minecraft.
//
// Antes de abrir una instancia que necesita el parche (Ore UI + videos + behavior pack) el launcher muestra
// un dialogo NATIVO del sistema, desde el proceso principal, con las carpetas exactas que va a leer o escribir.
// - El dialogo vive en el proceso principal: la interfaz web no puede conceder el permiso por su cuenta
//   (no existe ningun IPC para "conceder"; solo para consultar y revocar).
// - "Recordar" guarda la lista de carpetas autorizadas. Si despues hace falta una carpeta que no estaba en esa
//   lista (otra edicion del juego, otro com.mojang, un mundo nuevo) se vuelve a preguntar.
const path = require('path');
const { dialog } = require('electron');
const settings = require('./settings');

const VERSION = 1; // sube este numero si cambia lo que el parche toca: obliga a pedir permiso otra vez
const norm = (p) => path.resolve(p).toLowerCase();

function stored() {
  const c = settings.get().patchConsent;
  return c && c.version === VERSION && Array.isArray(c.paths) ? c : null;
}

function covers(targets) {
  const c = stored();
  if (!c) return false;
  const ok = new Set(c.paths.map(norm));
  return targets.every((t) => ok.has(norm(t.path)));
}

function status() {
  const c = stored();
  return { granted: !!c, at: c ? c.at : null, paths: c ? c.paths : [] };
}

function revoke() {
  settings.set({ patchConsent: null });
  return true;
}

function describe(targets) {
  return targets.map((t) => `• ${t.access === 'read' ? 'LEE' : 'ESCRIBE'}  ${t.path}\n    ${t.why}`).join('\n\n');
}

// plan: { targets: [{ path, access: 'read' | 'write', why }], notes: [string] } (ver launch.plan)
// Devuelve 'allow' (parchear), 'skip' (jugar sin parche) o 'cancel'.
async function ensure(win, plan, instanceName) {
  if (!plan.targets.length || covers(plan.targets)) return 'allow';

  const detail = [
    'Para mostrar el reproductor de video, el launcher necesita acceder a estas carpetas:',
    '',
    describe(plan.targets),
    ...(plan.notes && plan.notes.length ? ['', ...plan.notes] : []),
    '',
    '"Jugar sin parche" abre la instancia igual, pero sin reproductor ni videos.',
  ].join('\n');

  const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'warning',
    title: 'Permiso para parchear Minecraft',
    message: `"${instanceName}" necesita parchear carpetas de Minecraft`,
    detail,
    buttons: ['Permitir y jugar', 'Jugar sin parche', 'Cancelar'],
    defaultId: 1, // lo mas seguro por defecto: jugar sin tocar nada
    cancelId: 2,
    noLink: true,
    checkboxLabel: 'Recordar mi decisión para estas carpetas',
    checkboxChecked: false,
  });

  if (r.response === 0) {
    if (r.checkboxChecked) {
      settings.set({ patchConsent: { version: VERSION, at: new Date().toISOString(), paths: plan.targets.map((t) => t.path) } });
    }
    return 'allow';
  }
  return r.response === 1 ? 'skip' : 'cancel';
}

module.exports = { ensure, status, revoke, covers };
