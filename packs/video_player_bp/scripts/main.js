// Video Player - behavior pack script.
//
// /play <1-3>  ->  abre un CustomForm (DDUI) cuyo contenido real dibuja la pagina hbui
// (resource_pack/hbui/video-player.js) encima del formulario.
//
// Protocolo (ver DDUI-BRIDGE.md):
//   script -> pagina : label en layout[0], JSON en `text` (ObservableString, solo lectura)
//   pagina -> script : textField en layout[1], JSON en `text` (ObservableString, clientWritable)
// El script es dueno de los datos y valida todo lo que llega de la pagina:
// limite de tamano, JSON valido, token de sesion y valores permitidos.
// Si la pagina no esta (pack sin parchear, juego actualizado...), el formulario sigue
// siendo usable: muestra un texto explicando que falta el resource pack.

import {
  system,
  world,
  Player,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from "@minecraft/server";
import * as ui from "@minecraft/server-ui";
// La lista la genera el launcher en cada arranque a partir de la carpeta /videos (ver scripts/videos.js).
import { VIDEOS } from "./videos.js";

const COMMAND = "video:play"; // tambien funciona como /play (Minecraft registra la version sin namespace)

// Al entrar a un mundo o servidor se abre el reproductor con un video elegido al azar.
const AUTO_PLAY_ON_JOIN = true;
const AUTO_PLAY_DELAY_TICKS = 60; // da tiempo a que cargue la pantalla del jugador antes de abrir el formulario
const AUTO_PLAY_OPT_OUT_TAG = "video:no_auto"; // /tag @s add video:no_auto  -> ese jugador no ve el video al entrar

const MAX_PAGE_MESSAGE = 300; // la pagina solo propone mensajes cortos
const HEARTBEAT_TICKS = 20; // el script reenvia el estado cada segundo (la pagina lo usa como "sigo abierto")
const BUSY_RETRY_TICKS = 10; // si el jugador aun tiene el chat abierto, reintenta
const BUSY_MAX_RETRIES = 30;

// Sin acentos ni simbolos raros: la fuente de Minecraft/Gameface no tiene casi nada fuera de ASCII.
const FALLBACK_TEXT =
  "No se detecto el reproductor de video. Activa el pack 'Video Player (RP)' como pack global y " +
  "parchea gameplay.html (ver README). Tras actualizar el juego hay que repetirlo.";

/** @type {Map<string, any>} playerId -> sesion */
const sessions = new Map();

// ---------- compatibilidad estable / beta del modulo server-ui ----------

function newObservable(value, clientWritable) {
  if (typeof ui.ObservableString === "function") {
    return clientWritable
      ? new ui.ObservableString(value, { clientWritable: true })
      : new ui.ObservableString(value);
  }
  // API mas nueva: Observable.create<string>(...)
  return ui.Observable.create(value, clientWritable ? { clientWritable: true } : undefined);
}

function newForm(player, title) {
  const F = ui.CustomForm;
  return typeof F.create === "function" ? F.create(player, title) : new F(player, title);
}

const CLOSED_USER_BUSY = ui.DataDrivenScreenClosedReason?.UserBusy ?? "UserBusy";

// ---------- comando ----------

system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    {
      name: COMMAND,
      description: "Reproduce un video de la lista en el reproductor Ore UI",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      mandatoryParameters: [{ name: "video", type: CustomCommandParamType.Integer }],
    },
    (origin, videoId) => {
      const player = origin.sourceEntity;
      if (!(player instanceof Player)) {
        return { status: CustomCommandStatus.Failure, message: "Solo un jugador puede usar este comando." };
      }
      const video = VIDEOS.find((v) => v.id === videoId);
      if (!video) {
        return { status: CustomCommandStatus.Failure, message: `Video invalido. Usa /play 1-${VIDEOS.length}` };
      }
      // El callback del comando corre en contexto "before": abrir la UI se hace un tick despues.
      system.run(() => openPlayer(player, video));
      return { status: CustomCommandStatus.Success };
    }
  );
});

world.afterEvents.playerLeave.subscribe((event) => closeSession(event.playerId, false));

// ---------- video aleatorio al entrar ----------

function pickRandomVideo() {
  return VIDEOS[Math.floor(Math.random() * VIDEOS.length)];
}

// initialSpawn = true solo la primera vez que el jugador aparece en la sesion (mundo o servidor),
// no al reaparecer tras morir ni al cambiar de dimension.
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!AUTO_PLAY_ON_JOIN || !event.initialSpawn || VIDEOS.length === 0) return;
  const player = event.player;
  system.runTimeout(() => {
    try {
      if (!player.isValid || player.hasTag(AUTO_PLAY_OPT_OUT_TAG)) return;
      if (sessions.has(player.id)) return; // ya abrio uno a mano con /play
      openPlayer(player, pickRandomVideo());
    } catch (err) {
      console.warn(`[video-player] auto-reproduccion fallo: ${err}`);
    }
  }, AUTO_PLAY_DELAY_TICKS);
});

// ---------- sesion ----------

function makeToken() {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

function titleFor(session) {
  // La pagina reconoce nuestros formularios por el sufijo [vp:token] del titulo.
  return `Reproductor - ${session.video.title} [vp:${session.token}]`;
}

function stateJson(session) {
  return JSON.stringify({
    s: session.token,
    k: session.beat,
    id: session.video.id,
    src: session.video.src,
    title: session.video.title,
    list: VIDEOS.map((v) => ({ id: v.id, title: v.title })),
  });
}

function openPlayer(player, video) {
  closeSession(player.id, true);

  const session = {
    token: makeToken(),
    player,
    video,
    beat: 0,
    activated: false,
    retries: 0,
    closed: false,
    timer: undefined,
    form: null,
    out: newObservable(FALLBACK_TEXT, false),
    inn: newObservable("", true),
    title: null,
    onMessage: null,
  };
  session.title = newObservable(titleFor(session), false);
  session.onMessage = (raw) => handlePageMessage(session, raw);
  session.inn.subscribe(session.onMessage);

  sessions.set(player.id, session);
  showForm(session);
}

function showForm(session) {
  if (session.closed) return;

  let form;
  try {
    form = newForm(session.player, session.title);
    form.label(session.out); // layout[0]  script -> pagina
    form.textField("Canal interno (no tocar)", session.inn); // layout[1]  pagina -> script
    form.closeButton();
  } catch (err) {
    console.warn(`[video-player] no se pudo crear el formulario: ${err}`);
    closeSession(session.player.id, false);
    return;
  }
  session.form = form;

  form
    .show()
    .then((reason) => {
      if (session.closed) return;
      if (reason === CLOSED_USER_BUSY && session.retries < BUSY_MAX_RETRIES) {
        // Normal al lanzar el comando desde el chat: la pantalla de chat aun esta abierta.
        session.retries++;
        system.runTimeout(() => showForm(session), BUSY_RETRY_TICKS);
        return;
      }
      closeSession(session.player.id, false);
    })
    .catch((err) => {
      console.warn(`[video-player] show() fallo: ${err}`);
      closeSession(session.player.id, false);
    });
}

function activate(session) {
  if (session.activated) {
    pushState(session);
    return;
  }
  session.activated = true;
  pushState(session);
  session.timer = system.runInterval(() => {
    if (session.closed) return;
    if (!session.form || !session.form.isShowing()) return;
    session.beat++;
    pushState(session);
  }, HEARTBEAT_TICKS);
}

function pushState(session) {
  try {
    session.out.setData(stateJson(session));
  } catch (err) {
    console.warn(`[video-player] setData fallo: ${err}`);
  }
}

function closeSession(playerId, closeForm) {
  const session = sessions.get(playerId);
  if (!session) return;
  session.closed = true;
  sessions.delete(playerId);
  if (session.timer !== undefined) system.clearRun(session.timer);
  try {
    session.inn.unsubscribe(session.onMessage);
  } catch {
    /* ya estaba */
  }
  if (closeForm) {
    try {
      if (session.form && session.form.isShowing()) session.form.close();
    } catch {
      /* el formulario ya no estaba abierto */
    }
  }
}

// ---------- mensajes de la pagina (no confiables) ----------

function handlePageMessage(session, raw) {
  if (session.closed) return;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PAGE_MESSAGE) return;

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  if (msg.s !== session.token || typeof msg.t !== "string") return; // sesion distinta o vieja

  switch (msg.t) {
    case "ready": // la pagina detecto el formulario y esta lista para dibujar
      system.run(() => activate(session));
      break;

    case "close": // boton X del reproductor
      system.run(() => closeSession(session.player.id, true));
      break;

    case "goto": {
      // cambiar de video desde la barra del reproductor
      if (!session.activated) break;
      const next = VIDEOS.find((v) => v.id === msg.v);
      if (!next) break;
      system.run(() => {
        if (session.closed) return;
        session.video = next;
        try {
          session.title.setData(titleFor(session));
        } catch {
          /* titulo no observable en esta version */
        }
        pushState(session);
      });
      break;
    }

    case "error": {
      // La pagina no pudo reproducir (formato no soportado, archivo no servido...).
      const code = String(msg.c ?? "?")
        .slice(0, 40)
        .replace(/[^\w .:-]/g, "");
      system.run(() => {
        try {
          session.player.sendMessage(
            `[Video Player] El motor de UI no pudo reproducir ${session.video.title} (${code}). ` +
              "Mira el texto en pantalla y la seccion Problemas del LEEME."
          );
        } catch {
          /* jugador desconectado */
        }
      });
      break;
    }

    default:
      break;
  }
}
