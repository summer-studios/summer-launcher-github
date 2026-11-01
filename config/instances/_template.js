// ============================================================
//  PLANTILLA DE INSTANCIA
//  Copia este archivo, quitale el "_" del nombre (ej. backrooms.js) y edita.
//  Los archivos que empiezan con "_" se ignoran.
// ============================================================
module.exports = {
  id: 'mi-instancia',            // unico, sin espacios. Es el que pones en database/access.json
  name: 'Mi instancia',
  tabTitle: 'Mi instancia',      // nombre que se ve en la pestana/tarjeta del launcher
  thumbnail: 'thumbnails/mi-instancia.png',

  access: 'database',            // 'database' = solo gamertags autorizados | 'public' = todos

  // La IP NO se pone aqui: se escribe en database/servers.json con el mismo 'id' de arriba
  // (asi se puede cambiar de forma remota y nunca se ve en el launcher).
  // Opcional: respaldo local por si servers.json no tiene esta instancia.
  // server: { ip: 'play.ejemplo.com', port: 19132 },

  // Packs de recursos GLOBALES: se instalan y se equipan al entrar al juego.
  // Carpeta con manifest.json, o archivo .mcpack / .zip, dentro de /packs
  resourcePacks: ['packs/mi_pack'],

  // Opcional: reproductor de video Ore UI (ver config.oreUi y config.video).
  // resourcePacks: ['packs/mi_pack', 'packs/video_player_rp'],
  // behaviorPacks: ['packs/video_player_bp'],   // solo mundos locales; en servidores va instalado en el servidor
  // worlds: ['Mi mundo'],                        // mundos locales donde activar los behavior packs
  // videosDir: 'videos/mi-instancia',            // videos propios de esta instancia (.webm / .mkv)

  // Clientes a inyectar (ids de config.injectors, ej. 'flarial')
  injectors: [],
};
