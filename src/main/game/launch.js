// Flujo completo para abrir una instancia:
// localizar Minecraft -> preparar carpetas -> instalar packs globales -> abrir juego (+IP) -> inyectar.
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const config = require('../config');
const paths = require('../paths');
const bedrock = require('./bedrock');
const packs = require('./packs');
const injector = require('./injector');
const oreui = require('./oreui');
const videos = require('./videos');
const serversDb = require('../database/servers-db');

async function launch(instance, progress = () => {}, hooks = {}) {
  const roots = bedrock.locateAll();
  if (!roots) throw new Error('No se encontró Minecraft Bedrock. Instálalo o indica la carpeta com.mojang en Configuración.');

  // Los packs se leen al ARRANCAR el juego: si Minecraft ya esta abierto hay que cerrarlo antes.
  progress(5, 'Preparando Minecraft…');
  const wasOpen = await bedrock.closeIfRunning();

  progress(10, 'Preparando carpetas del juego…');
  bedrock.ensureStructure(roots.packRoot);

  const warnings = [];

  progress(30, 'Activando packs de la instancia…');
  const installed = instance.resourcePacks.map((p) => packs.installResourcePack(roots.packRoot, paths.inRoot(p)));
  const behavior = instance.behaviorPacks.map((p) => packs.installBehaviorPack(roots.packRoot, paths.inRoot(p)));

  // Ore UI + videos (fallan sin impedir que el juego abra: solo dejan un aviso).
  try {
    const packDirs = installed.map((p) => p.dir);
    const host = oreui.collect(packDirs).find((i) => i.videos); // pack que aloja los .webm
    if (host) {
      progress(40, 'Preparando videos…');
      const bp = behavior.find((b) => fs.existsSync(path.join(b.dir, 'scripts', 'videos.js')));
      const r = await videos.prepare({
        rpDir: host.dir,
        bpScriptsDir: bp && path.join(bp.dir, 'scripts'),
        extraDir: instance.videosDir,
        onStatus: (msg) => progress(45, msg),
      });
      warnings.push(...r.warnings);
    }
    progress(50, 'Integrando Ore UI…');
    const ui = oreui.apply(packDirs, roots.kind);
    if (ui.warning) warnings.push(ui.warning);
  } catch (e) {
    warnings.push(`Ore UI / videos: ${e.message}`);
  }

  packs.setGlobalPacks(roots, installed);

  // Los behavior packs no pueden ser globales: solo se activan en los mundos locales que pida la instancia.
  if (instance.worlds.length) {
    const hit = new Set();
    for (const bp of behavior) packs.activateBehaviorPackInWorlds(roots, bp, instance.worlds).forEach((w) => hit.add(w));
    if (!hit.size) warnings.push(`No encontré ningún mundo llamado: ${instance.worlds.join(', ')}.`);
  }

  // La IP vive solo aqui (proceso principal): no se muestra en mensajes, errores ni logs.
  const server = serversDb.get(instance.id, instance.server);
  progress(60, server ? 'Entrando al servidor…' : 'Abriendo Minecraft…');
  const uri = server
    ? `minecraft://connect/?serverUrl=${encodeURIComponent(server.ip)}&serverPort=${server.port}`
    : 'minecraft://';
  try { await shell.openExternal(uri); }
  catch { throw new Error('No se pudo abrir Minecraft. Comprueba que esté instalado.'); } // sin la URI: llevaria la IP

  if (hooks.onGameOpened) hooks.onGameOpened(); // aqui empieza a vigilar y a esconder las pantallas de Minecraft

  if (wasOpen) warnings.push('Minecraft ya estaba abierto: se reinició para aplicar los packs de la instancia.');
  if (!server) warnings.push('Esta instancia todavía no tiene servidor configurado; solo se abrió Minecraft.');
  for (const id of instance.injectors) {
    const def = config.injectors[id];
    if (!def) { warnings.push(`Inyectable desconocido: ${id}`); continue; }
    progress(80, `Inyectando ${def.name}…`);
    const r = await injector.inject(def.dll);
    if (!r.ok) warnings.push(`${def.name}: ${r.error}`);
  }
  progress(100, 'Listo');
  return { warnings };
}

module.exports = { launch };
