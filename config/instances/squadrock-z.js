// ============================================================
//  INSTANCIA: Squadrock Z
//  - La IP/puerto NO van aqui: se editan en database/servers.json (id: "squadrock-z").
//  - Quien puede entrar se edita en database/access.json (o con el programa admin/).
// ============================================================
module.exports = {
  id: 'squadrock-z',
  name: 'Squadrock Z',
  tabTitle: 'Squadrock Z',
  thumbnail: 'thumbnails/squadrock-z.png',

  access: 'database',

  // Pack de menus global: se instala y se equipa solo al pulsar JUGAR.
  resourcePacks: ['packs/squadrock_z', 'packs/video_player_rp'],

  // Behavior pack del reproductor (/play N y video aleatorio al entrar). En un SERVIDOR este pack debe estar
  // instalado en el servidor; aqui solo se instala para mundos locales (nombres en 'worlds').
  behaviorPacks: ['packs/video_player_bp'],
  worlds: [],

  injectors: [],
};
