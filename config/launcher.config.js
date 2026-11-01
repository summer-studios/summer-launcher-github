// ============================================================
//  SUMMER LAUNCHER - CONFIGURACION GENERAL
//  Todo lo "editable" del launcher vive aqui.
module.exports = {
  name: 'Summer Launcher',
  studio: 'Summer Studio',

  // Tu repo de GitHub. De aqui se descarga la base de datos de acceso.
  github: {
    owner: 'summer-studios',
    repo: 'summer-launcher-github',
    branch: 'main',
  },

  // Base de datos de acceso (database/access.json).
  // Si GitHub no responde, se usa la copia local incluida en el launcher.
  // Se vuelve a leer cada 'pollSeconds' mientras el launcher esta abierto, y SIEMPRE justo
  // antes de abrir una instancia: asi los cambios de acceso se aplican casi en tiempo real.
  // Edita la lista con el programa admin/ (ver admin/LEEME-ADMIN.txt) o a mano en GitHub.
  database: {
    file: 'database/access.json',
    remoteUrl: null, // null = se arma solo con la seccion github de arriba
    pollSeconds: 20,
  },

  // IP y puerto de cada instancia (database/servers.json). Archivo aparte para cambiarlas
  // facil, tambien de forma remota. Si tu repo es PRIVADO, GitHub no deja leer el archivo
  // sin iniciar sesion: pon aqui la URL "raw" de un repo publico de datos o de un gist secreto.
  servers: {
    file: 'database/servers.json',
    remoteUrl: null, // null = misma ruta de GitHub que la base de datos de acceso
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

  // Pantalla de carga propia: tapa la roja de Mojang y la gris de Minecraft hasta que el juego abre.
  loadingScreen: {
    logo: 'loading/loading_screen_logo.png',
    // Pantalla nueva a pantalla completa: copia tu imagen a assets/loading/ y pon aqui su nombre
    // (ej. 'loading/pantalla_nueva.png'). Con null se usa fondo + logo de arriba.
    image: null,
    showBar: true,      // barra animada abajo
    showText: true,     // texto "Cargando Minecraft…" (en modo imagen conviene false si ya lo trae)
    background: '#000000',
    minMs: 2500,
    minimizeGame: true, // mientras carga, Minecraft queda minimizado (no se ven la roja ni la gris)
    minHoldMs: 20000,   // minimo que se queda tapando Minecraft
    maxHoldMs: 90000,   // tope: se quita aunque no detecte que Minecraft cargo
    graceMs: 1200,      // pausa extra antes de quitarla
    gameTitle: 'Summer Launcher', // titulo que se pone a la ventana de Minecraft
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
  bedrock: {
    comMojangOverride: null,
    closeRunningGame: true, // si Minecraft ya esta abierto, se cierra para que cargue los packs de la instancia
  },

  // Ore UI (la interfaz web hbui del juego). Los packs que traen hbui/summer-inject.json piden que se les
  // anada su CSS/JS al gameplay.html del juego; el launcher lo parchea en cada arranque a partir del
  // gameplay.html de TU version instalada (cambia en cada actualizacion). No esta verificado en todas las
  // builds: si Minecraft no carga el hbui del pack, el reproductor no aparecera.
  oreUi: {
    enabled: true,
    // Ruta manual al gameplay.html si el launcher no puede leerlo (carpeta del juego protegida):
    // ...\\Content\\data\\gui\\dist\\hbui\\gameplay.html. null = deteccion automatica.
    gameplayHtml: null,
  },

  // Videos del reproductor Ore UI. Se leen de /videos (y de userData/videos). Ore UI solo reproduce WebM
  // (VP8/VP9 + Vorbis): los .mkv se convierten con ffmpeg (tools/ffmpeg/ffmpeg.exe o el del PATH) y se guardan
  // en cache, asi la conversion solo ocurre una vez por video. Maximo 8.
  video: {
    enabled: true,
    sourceDir: 'videos',
    extensions: ['.webm', '.mkv'],
    warnMb: 50,
    // Solo se usan si hay que recodificar (si el .mkv ya trae VP8/VP9 + Vorbis solo se cambia el contenedor).
    transcodeArgs: ['-vf', 'scale=854:-2', '-r', '24', '-c:v', 'libvpx', '-b:v', '450k', '-crf', '12', '-g', '48', '-c:a', 'libvorbis', '-b:a', '80k'],
  },

  // Inyectables (clientes tipo Flarial). Las instancias los referencian por id.
  injectors: {
    flarial: { name: 'Flarial', dll: 'mods/Flarial.dll' },
  },
};
