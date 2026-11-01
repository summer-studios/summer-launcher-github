// Flujo completo para abrir una instancia:
// localizar Minecraft -> preparar carpetas -> instalar packs globales -> abrir juego (+IP) -> inyectar.
const { shell } = require('electron');
const path = require('path');
const config = require('../config');
const paths = require('../paths');
const bedrock = require('./bedrock');
const packs = require('./packs');
const injector = require('./injector');
const serversDb = require('../database/servers-db');
const skins = require('../skins/skins');

async function launch(instance, progress = () => {}, hooks = {}) {
  const roots = bedrock.locateAll();
  if (!roots) throw new Error('No se encontró Minecraft Bedrock. Instálalo o indica la carpeta com.mojang en Configuración.');

  // Los packs se leen al ARRANCAR el juego: si Minecraft ya esta abierto hay que cerrarlo antes.
  progress(5, 'Preparando Minecraft…');
  const wasOpen = await bedrock.closeIfRunning();

  progress(10, 'Preparando carpetas del juego…');
  bedrock.ensureStructure(roots.packRoot);
  bedrock.ensureDir(path.join(roots.packRoot, 'skin_packs'));

  progress(30, 'Activando packs de la instancia…');
  const installed = instance.resourcePacks.map((p) => packs.installResourcePack(roots.packRoot, paths.inRoot(p)));
  packs.setGlobalPacks(roots, installed);

  // La skin elegida en el launcher queda instalada ANTES de abrir el juego.
  let skinName = null;
  try { skinName = skins.applyToGame(roots.packRoot); } catch (e) { console.warn('[skins]', e.message); }

  // La IP vive solo aqui (proceso principal): no se muestra en mensajes, errores ni logs.
  const server = serversDb.get(instance.id, instance.server);
  progress(60, server ? 'Entrando al servidor…' : 'Abriendo Minecraft…');
  const uri = server
    ? `minecraft://connect/?serverUrl=${encodeURIComponent(server.ip)}&serverPort=${server.port}`
    : 'minecraft://';
  try { await shell.openExternal(uri); }
  catch { throw new Error('No se pudo abrir Minecraft. Comprueba que esté instalado.'); } // sin la URI: llevaria la IP

  if (hooks.onGameOpened) hooks.onGameOpened({ server: !!server }); // aqui empieza a vigilar y a esconder las pantallas de Minecraft

  const warnings = [];
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
