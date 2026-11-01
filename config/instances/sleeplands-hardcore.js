// ============================================================
//  INSTANCIA: Sleeplands Hardcore
//  - La IP/puerto NO van aqui: se editan en database/servers.json (id: "sleeplands-hardcore").
//  - Quien puede entrar se edita en database/access.json (o con el programa admin/).
// ============================================================
module.exports = {
  id: 'sleeplands-hardcore',
  name: 'Sleeplands Hardcore',
  tabTitle: 'Sleeplands Hardcore',
  thumbnail: 'thumbnails/sleeplands-hardcore.png',

  access: 'database',

  // Pack de menus global: se instala y se equipa solo al pulsar JUGAR.
  resourcePacks: ['packs/sleeplands_hardcore'],

  injectors: [],
};
