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

  // IP a la que se redirige al jugador al abrir el juego (null = solo abre Minecraft)
  server: { ip: 'play.ejemplo.com', port: 19132 },

  // Packs de recursos GLOBALES: se instalan y se equipan al entrar al juego.
  // Carpeta con manifest.json, o archivo .mcpack / .zip, dentro de /packs
  resourcePacks: ['packs/mi_pack'],

  // Clientes a inyectar (ids de config.injectors, ej. 'flarial')
  injectors: [],
};
