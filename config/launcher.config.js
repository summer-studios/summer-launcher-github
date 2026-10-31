// ============================================================
//  SUMMER LAUNCHER - CONFIGURACION GENERAL
//  Todo lo "editable" del launcher vive aqui.
module.exports = {
  name: 'Summer Launcher',
  studio: 'Summer Studio',

  // Tu repo de GitHub. De aqui se descarga la base de datos de acceso.
  github: {
    owner: 'summer-studios',
    repo: 'summer-launcher',
    branch: 'main',
  },

  // Base de datos de acceso (database/access.json).
  // Si GitHub no responde, se usa la copia local incluida en el launcher.
  database: {
    file: 'database/access.json',
    remoteUrl: null, // null = se arma solo con la seccion github de arriba
  },

  // Registro de usuarios que inician sesion (opcional).
  // Si pones una URL (ej. webhook de Discord), el launcher envia el nombre ahi.
  registry: {
    webhookUrl: '',
  },

  // Modo de inicio de sesion: 'gamertag' (escribes tu usuario de Bedrock, sin costo)
  // o 'microsoft' (verificado, requiere clientId de Azure).
  auth: { mode: 'microsoft' },

  // Inicio de sesion Microsoft.
  // Necesitas registrar una app en Azure (tipo "cliente publico") y pegar su ID aqui.
  microsoft: {
    clientId: 'caa3a8be-f96d-42df-a8c7-2d0c96fe5ccd', // ver LEEME-LOGIN.txt (gratis, 5 minutos)
  },

  // Para probar la interfaz SIN Microsoft: pon un gamertag aqui (o usa la variable
  // de entorno SUMMER_DEV_GAMERTAG). Dejalo en null para produccion.
  devGamertag: null,

  // Video de introduccion antes de abrir la interfaz.
  intro: { video: 'intro/summer_intro.mp4', skippable: true },

  // Pantalla de carga previa a entrar a Minecraft (fondo negro + logo).
  loadingScreen: {
    logo: 'loading/loading_screen_logo.png',
    background: '#000000',
    minMs: 2500,
  },

  // Enlaces del menu lateral y del pie.
  links: {
    editSkin: 'https://www.minecraft.net/msaprofile/mygames/editskin',
    help: 'https://github.com/summer-studio/summer-launcher/issues',
    terms: '',
    privacy: '',
    licenses: '',
  },

  // Minecraft Bedrock: null = deteccion automatica. Para forzar la carpeta com.mojang
  // pon la ruta completa aqui.
  bedrock: { comMojangOverride: null },

  // Inyectables (clientes tipo Flarial). Las instancias los referencian por id.
  injectors: {
    flarial: { name: 'Flarial', dll: 'mods/Flarial.dll' },
  },
};
