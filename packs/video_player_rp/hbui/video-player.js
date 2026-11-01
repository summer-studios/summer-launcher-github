/* Video Player - pagina hbui (corre dentro de gameplay.html, junto a la app React de vanilla).
 *
 * Puente Ore UI <-> Script API (ver DDUI-BRIDGE.md):
 *   - data store "minecraft", propiedad literal "custom_form_data_{instanceId}"
 *   - lectura : engine.trigger("query:subscribe/vanilla.ddui.string", subId, ds, prop, path, false)
 *               y eventos query:subscribed/<subId> / query:updated/<subId>  ({value})
 *   - escritura: window.__commands__.vanillaDduiDataStoreSetCommandGroup.setDataStorePathString
 *   - layout[0].text : script -> pagina (estado JSON, solo lectura)
 *   - layout[1].text : pagina -> script (mensajes JSON cortos)
 *   - el formulario nuestro se reconoce por el sufijo [vp:token] en `title`
 *
 * Reglas: la pagina solo dibuja y propone acciones; el script decide. Si algo falla aqui,
 * el formulario del script sigue funcionando. Todo va en try/catch para no tocar la UI vanilla.
 * Gameface: sin click en divs (mousedown), sin CSS grid/gap/fixed/inset/vars, fuente solo ASCII.
 */
(function () {
  "use strict";

  var DEBUG = false;
  var DS = "minecraft";
  var PROP = "custom_form_data_{instanceId}";
  var PATH_STATE = "layout[0].text";
  var PATH_OUT = "layout[1].text";
  var TOKEN_RE = /\[vp:([a-z0-9]{6})\]/;
  var SRC_RE = /^\/hbui\/videos\/[A-Za-z0-9_-]+\.webm$/;
  var DEFAULT_AR = 854 / 362;
  var STATE_TIMEOUT_MS = 3500; // sin latido del script durante este tiempo = formulario cerrado
  var READY_RETRY_MS = 800;
  var READY_MAX_TRIES = 12;
  var ATTEMPT_MS = 9000; // tiempo por ruta antes de probar la siguiente (Gameface carga el .webm entero en memoria)
  var NO_METADATA_MS = 30000; // sin durationchange tras todos los intentos = el motor no puede con el video
  var NO_PLAYBACK_MS = 15000;

  var session = null; // sesion activa (overlay abierto)
  var dismissed = {}; // tokens ya cerrados: no se reabren
  var seq = 0;
  var subCounter = 0;

  function log() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, ["[video-player]"].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  // ---------------------------------------------------------------- diagnostico
  // Etiqueta pequena arriba a la izquierda: prueba que ESTE js se esta ejecutando dentro de Ore UI y
  // en que paso esta el puente. Poner BADGE = false cuando todo funcione.
  var BADGE = true;
  var VERSION = "1.2";
  var badgeTimer = null;

  function badge(text) {
    if (!BADGE) return;
    try {
      var b = document.getElementById("vp-badge");
      if (!b) {
        b = document.createElement("div");
        b.id = "vp-badge";
        document.body.appendChild(b);
      }
      b.textContent = "VideoPlayer v" + VERSION + ": " + text;
      b.style.display = "block";
      if (badgeTimer) clearTimeout(badgeTimer);
      badgeTimer = setTimeout(function () {
        b.style.display = "none";
      }, 25000);
    } catch (e) {}
  }

  // ---------------------------------------------------------------- puente

  function unwrap(p) {
    if (p && typeof p === "object" && "value" in p) return p.value;
    return p;
  }

  function subscribe(path, cb) {
    var id = "vp-" + ++subCounter + "-" + Date.now();
    engine.on("query:subscribed/" + id, function (p) {
      try {
        cb(unwrap(p));
      } catch (e) {
        log("cb error", e);
      }
    });
    engine.on("query:updated/" + id, function (p) {
      try {
        cb(unwrap(p));
      } catch (e) {
        log("cb error", e);
      }
    });
    engine.trigger("query:subscribe/vanilla.ddui.string", id, DS, PROP, path, false);
  }

  function writeString(path, value) {
    try {
      var group = window.__commands__ && window.__commands__.vanillaDduiDataStoreSetCommandGroup;
      var e = group && group.setDataStorePathString;
      if (!e) return false;
      e.callable.call(e, DS, PROP, path, value);
      return true;
    } catch (err) {
      log("write error", err);
      return false;
    }
  }

  function send(token, obj) {
    obj.s = token;
    obj.q = ++seq; // cambia siempre: el script solo se entera cuando el texto cambia
    var text = JSON.stringify(obj);
    if (text.length > 280) return false;
    return writeString(PATH_OUT, text);
  }

  // ---------------------------------------------------------------- utilidades

  function el(tag, id, cls, text) {
    var n = document.createElement(tag);
    if (id) n.id = id;
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function button(label, onDown) {
    var b = el("div", null, "vp-btn", label);
    b.addEventListener("mousedown", function (ev) {
      try {
        ev.stopPropagation();
        onDown(ev);
      } catch (e) {
        log("button error", e);
      }
    });
    return b;
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return "--:--";
    sec = Math.floor(sec);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function setActive(node, on) {
    if (!node) return;
    var cls = (node.className || "").replace(/\s*vp-active/g, "");
    node.className = on ? cls + " vp-active" : cls;
  }

  // ---------------------------------------------------------------- sesion

  function ensureSession(token) {
    if (dismissed[token]) return null;
    if (session && session.token === token) return session;
    if (session) endSession(false, "replaced");
    return startSession(token);
  }

  function startSession(token) {
    var s = {
      token: token,
      gotState: false,
      lastState: Date.now(),
      seenInDom: false,
      missingChecks: 0,
      readyTries: 0,
      videoId: null,
      src: null,
      list: [],
      node: {},
      video: null,
      paused: false,
      loadStart: 0,
      sawMeta: false,
      sawEnd: false,
      errorReported: false,
      readyTimer: null,
      pollTimer: null,
    };
    session = s;
    buildOverlay(s);
    showMessage(s, "Cargando reproductor...");

    s.readyTimer = setInterval(function () {
      if (s.gotState || s.readyTries >= READY_MAX_TRIES) {
        clearInterval(s.readyTimer);
        s.readyTimer = null;
        return;
      }
      s.readyTries++;
      send(token, { t: "ready" });
    }, READY_RETRY_MS);
    send(token, { t: "ready" });

    s.pollTimer = setInterval(function () {
      try {
        tick(s);
      } catch (e) {
        log("tick error", e);
      }
    }, 250);

    log("session start", token);
    return s;
  }

  function endSession(notifyScript, reason) {
    var s = session;
    if (!s) return;
    session = null;
    dismissed[s.token] = true;
    if (s.readyTimer) clearInterval(s.readyTimer);
    if (s.pollTimer) clearInterval(s.pollTimer);
    if (notifyScript) send(s.token, { t: "close" });
    try {
      // quitar el nodo del DOM libera el decodificador de video
      if (s.node.root && s.node.root.parentNode) s.node.root.parentNode.removeChild(s.node.root);
    } catch (e) {}
    log("session end", s.token, reason);
  }

  // ---------------------------------------------------------------- overlay

  function buildOverlay(s) {
    var n = s.node;
    n.root = el("div", "vp-root");

    var top = el("div", "vp-top");
    n.title = el("div", "vp-title", "Video");
    n.list = el("div", "vp-list");
    n.close = button("X", function () {
      endSession(true, "x");
    });
    n.close.id = "vp-close";
    top.appendChild(n.title);
    top.appendChild(n.list);
    top.appendChild(n.close);

    n.stage = el("div", "vp-stage");
    n.msg = el("div", "vp-msg", "");
    n.stage.appendChild(n.msg);

    var bar = el("div", "vp-bar");
    n.play = button("Pausa", function () {
      togglePause(s);
    });
    n.back = button("-10s", function () {
      seekBy(s, -10);
    });
    n.fwd = button("+10s", function () {
      seekBy(s, 10);
    });
    n.track = el("div", "vp-track");
    n.fill = el("div", "vp-fill");
    n.track.appendChild(n.fill);
    n.track.addEventListener("mousedown", function (ev) {
      try {
        ev.stopPropagation();
        var rect = n.track.getBoundingClientRect();
        var frac = (ev.clientX - rect.left) / rect.width;
        seekTo(s, frac);
      } catch (e) {}
    });
    n.time = el("div", "vp-time", "--:-- / --:--");
    n.mute = button("Sonido", function () {
      toggleMute(s);
    });
    n.replay = button("Repetir", function () {
      if (s.src) loadVideo(s, s.src);
    });
    n.replay.className += " vp-hide";

    bar.appendChild(n.play);
    bar.appendChild(n.back);
    bar.appendChild(n.fwd);
    bar.appendChild(n.track);
    bar.appendChild(n.time);
    bar.appendChild(n.mute);
    bar.appendChild(n.replay);

    n.root.appendChild(top);
    n.root.appendChild(n.stage);
    n.root.appendChild(bar);
    // Parar eventos de raton para que no lleguen al juego/formulario de debajo.
    n.root.addEventListener("mousedown", function (ev) {
      try {
        ev.stopPropagation();
      } catch (e) {}
    });
    document.body.appendChild(n.root);
  }

  function showMessage(s, text) {
    if (!s.node.msg) return;
    s.node.msg.textContent = text || "";
    s.node.msg.style.display = text ? "flex" : "none"; // #vp-msg gana en especificidad a .vp-hide
  }

  function renderList(s, list) {
    var n = s.node;
    while (n.list.firstChild) n.list.removeChild(n.list.firstChild);
    s.listButtons = {};
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var b = button(item.title, function () {
          if (item.id !== s.videoId) send(s.token, { t: "goto", v: item.id });
        });
        s.listButtons[item.id] = b;
        n.list.appendChild(b);
      })(list[i]);
    }
    s.list = list;
  }

  // ---------------------------------------------------------------- estado del script

  function onState(raw) {
    if (typeof raw !== "string" || raw.charAt(0) !== "{") return; // no es nuestro
    var st;
    try {
      st = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!st || typeof st.s !== "string" || !/^[a-z0-9]{6}$/.test(st.s)) return;
    var s = ensureSession(st.s);
    if (!s) return;

    // validacion de esquema: la pagina no se fia de lo que llega, aunque venga del script
    if (typeof st.id !== "number" || typeof st.src !== "string" || !SRC_RE.test(st.src)) return;
    if (!(st.list instanceof Array) || st.list.length === 0 || st.list.length > 8) return;
    var list = [];
    for (var i = 0; i < st.list.length; i++) {
      var it = st.list[i];
      if (it && typeof it.id === "number" && typeof it.title === "string") {
        list.push({ id: it.id, title: it.title.slice(0, 24) });
      }
    }

    if (!s.gotState) badge("estado recibido del script (puente OK)");
    s.gotState = true;
    s.lastState = Date.now();

    if (!s.list.length || s.list.length !== list.length) renderList(s, list);
    s.node.title.textContent = typeof st.title === "string" ? st.title.slice(0, 40) : "Video";
    for (var k in s.listButtons) setActive(s.listButtons[k], Number(k) === st.id);

    if (st.id !== s.videoId || st.src !== s.src) {
      s.videoId = st.id;
      s.src = st.src;
      loadVideo(s, st.src);
    }
  }

  function onTitle(title) {
    if (typeof title !== "string") return;
    var m = TOKEN_RE.exec(title);
    if (!m) {
      if (title) badge("formulario visto sin token: " + title.slice(0, 30));
      return;
    }
    badge("formulario detectado, esperando al script...");
    ensureSession(m[1]);
  }

  // ---------------------------------------------------------------- video

  // Rutas a probar: Gameface resuelve las URL contra la pagina, y no sabemos con certeza como sirve
  // Minecraft los archivos del pack, asi que se prueban varias formas de la misma ruta.
  function candidates(src) {
    var list = [src];
    var rel = src.replace(/^\//, "");
    var short = src.replace(/^\/hbui\//, "");
    if (list.indexOf(rel) === -1) list.push(rel);
    if (list.indexOf(short) === -1) list.push(short);
    return list;
  }

  function evlog(s, name) {
    var cur = s.evlog ? s.evlog.split(",") : [];
    if (cur.indexOf(name) === -1) cur.push(name);
    s.evlog = cur.join(",");
  }

  function loadVideo(s, src) {
    s.cands = candidates(src);
    s.attempt = 0;
    s.sawMeta = false;
    s.sawEnd = false;
    s.errorReported = false;
    s.paused = false;
    s.evlog = "";
    s.loadStart = Date.now();
    s.playKicked = 0;
    s.node.replay.className = "vp-btn vp-hide";
    s.node.play.textContent = "Pausa";
    startAttempt(s);
  }

  function startAttempt(s) {
    var n = s.node;
    var src = s.cands[s.attempt];
    if (s.video && s.video.parentNode) s.video.parentNode.removeChild(s.video); // libera el decodificador
    s.video = null;
    s.sawMeta = false;
    s.attemptStart = Date.now();
    showMessage(s, "Cargando video...");

    var v = document.createElement("video");
    v.id = "vp-video";
    v.setAttribute("preload", "auto");
    v.setAttribute("autoplay", "");
    v.setAttribute("cohfastseek", ""); // los saltos caen en keyframes (hay uno cada ~2 s)
    v.addEventListener("loadstart", function () {
      evlog(s, "loadstart");
      log("loadstart", src);
    });
    v.addEventListener("durationchange", function () {
      evlog(s, "duration");
      s.sawMeta = true;
      showMessage(s, "");
      fit(s);
      kickPlay(s); // por si autoplay no arranca solo
    });
    v.addEventListener("play", function () {
      evlog(s, "play");
    });
    v.addEventListener("playing", function () {
      evlog(s, "playing");
      showMessage(s, "");
    });
    v.addEventListener("error", function () {
      var code = "?";
      try {
        if (v.error && v.error.code !== undefined) code = String(v.error.code);
      } catch (e) {}
      evlog(s, "error" + code);
      log("video error", src, code);
      if (s.video !== v) return;
      if (s.attempt < s.cands.length - 1) {
        s.attempt++;
        startAttempt(s);
      } else {
        reportError(s, "media-error c" + code, "El motor de UI rechazo el video (error " + code + "). Ver README, seccion Problemas.");
      }
    });
    v.addEventListener("ended", function () {
      s.sawEnd = true;
      showMessage(s, "Fin del video");
      n.replay.className = "vp-btn";
    });
    v.setAttribute("src", src);
    n.stage.insertBefore(v, n.msg);
    s.video = v;
    fit(s);
    log("attempt", s.attempt + 1, src);
  }

  function kickPlay(s) {
    var v = s.video;
    if (!v || s.paused) return;
    try {
      var r = v.play();
      if (r && r.catch) r.catch(function () {});
    } catch (e) {}
  }

  function fit(s) {
    var v = s.video;
    var st = s.node.stage;
    if (!v || !st) return;
    var w = st.clientWidth;
    var h = st.clientHeight;
    if (!w || !h) return;
    var ar = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : DEFAULT_AR;
    var vw = w;
    var vh = Math.round(w / ar);
    if (vh > h) {
      vh = h;
      vw = Math.round(h * ar);
    }
    v.style.width = vw + "px";
    v.style.height = vh + "px";
    v.style.left = Math.round((w - vw) / 2) + "px";
    v.style.top = Math.round((h - vh) / 2) + "px";
    s.fitW = w;
    s.fitH = h;
  }

  function togglePause(s) {
    var v = s.video;
    if (!v) return;
    try {
      if (s.paused) {
        v.play();
        s.paused = false;
        s.node.play.textContent = "Pausa";
      } else {
        v.pause();
        s.paused = true;
        s.node.play.textContent = "Play";
      }
    } catch (e) {
      log("pause error", e);
    }
  }

  function seekTo(s, frac) {
    var v = s.video;
    if (!v || !isFinite(v.duration) || v.duration <= 0) return;
    frac = Math.max(0, Math.min(1, frac));
    try {
      v.currentTime = frac * v.duration;
    } catch (e) {
      log("seek error", e);
    }
  }

  function seekBy(s, delta) {
    var v = s.video;
    if (!v || !isFinite(v.duration)) return;
    try {
      v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    } catch (e) {
      log("seek error", e);
    }
  }

  function toggleMute(s) {
    var v = s.video;
    if (!v) return;
    try {
      v.muted = !v.muted;
      s.node.mute.textContent = v.muted ? "Mute" : "Sonido";
    } catch (e) {
      log("mute error", e);
    }
  }

  function reportError(s, code, text) {
    if (s.errorReported) return;
    s.errorReported = true;
    showMessage(s, text);
    send(s.token, { t: "error", c: code });
  }

  // ---------------------------------------------------------------- bucle de control (250 ms)

  function domHasMarker(token) {
    try {
      var text = document.body.textContent || "";
      var needle = "[vp:" + token + "]";
      var root = session && session.node.root;
      // el overlay nunca contiene el marcador, asi que cualquier aparicion es del formulario vanilla
      return text.indexOf(needle) !== -1 && (!root || (root.textContent || "").indexOf(needle) === -1);
    } catch (e) {
      return false;
    }
  }

  function tick(s) {
    if (session !== s) return;
    var now = Date.now();

    // Sigue abierto el formulario? Marcador en el DOM si lo vemos; si no, latido del script.
    var inDom = domHasMarker(s.token);
    if (inDom) {
      s.seenInDom = true;
      s.missingChecks = 0;
    } else if (s.seenInDom) {
      s.missingChecks++;
      if (s.missingChecks >= 4) {
        endSession(false, "form-gone");
        return;
      }
    }
    if (!s.seenInDom && s.gotState && now - s.lastState > STATE_TIMEOUT_MS) {
      endSession(false, "heartbeat-lost");
      return;
    }
    if (!s.gotState && s.readyTries >= READY_MAX_TRIES && now - s.lastState > READY_RETRY_MS * (READY_MAX_TRIES + 4)) {
      endSession(false, "no-script");
      return;
    }

    // progreso (Gameface no dispara timeupdate: se consulta currentTime)
    var v = s.video;
    if (!v) return;
    var dur = v.duration;
    var cur = v.currentTime;
    if (isFinite(dur) && dur > 0) {
      s.node.fill.style.width = Math.max(0, Math.min(100, (cur / dur) * 100)) + "%";
      s.node.time.textContent = fmt(cur) + " / " + fmt(dur);
    }
    if (s.node.stage.clientWidth !== s.fitW || s.node.stage.clientHeight !== s.fitH) fit(s);

    // vigilancia: si el motor no puede con el video, avisar en vez de dejar la pantalla negra
    var attemptMs = now - s.attemptStart;
    var totalMs = now - s.loadStart;
    if (!s.sawMeta) {
      var secs = Math.floor(totalMs / 1000);
      if (!s.errorReported) showMessage(s, "Cargando video... " + secs + "s (ruta " + (s.attempt + 1) + "/" + s.cands.length + ", eventos: " + (s.evlog || "ninguno") + ")");
      if (attemptMs > ATTEMPT_MS && s.attempt < s.cands.length - 1) {
        s.attempt++;
        startAttempt(s);
        return;
      }
      if (totalMs > NO_METADATA_MS && s.attempt >= s.cands.length - 1) {
        reportError(
          s,
          "no-metadata ev-" + (s.evlog || "ninguno").replace(/,/g, "-").slice(0, 16) + " a" + (s.attempt + 1),
          "El motor de UI no pudo cargar el video (eventos: " + (s.evlog || "ninguno") + "). Ver README, seccion Problemas."
        );
      }
    } else if (!s.sawEnd && !s.paused && (!cur || cur === 0)) {
      if (!s.playKicked && totalMs > 3000) {
        s.playKicked = 1;
        kickPlay(s);
      }
      if (totalMs > NO_PLAYBACK_MS) {
        reportError(s, "no-playback ev-" + (s.evlog || "ninguno").replace(/,/g, "-").slice(0, 16), "El video cargo pero no avanza (el motor de UI no lo reproduce).");
      }
    }
  }

  // ---------------------------------------------------------------- arranque

  function init() {
    var hasEngine = typeof engine !== "undefined" && !!engine.on && !!engine.trigger;
    var hasCmds = !!(window.__commands__ && window.__commands__.vanillaDduiDataStoreSetCommandGroup);
    badge("JS cargado | engine:" + (hasEngine ? "si" : "NO") + " | escritura:" + (hasCmds ? "si" : "NO"));
    if (!hasEngine) return;
    try {
      subscribe("title", onTitle);
      subscribe(PATH_STATE, onState);
      log("init ok");
    } catch (e) {
      badge("error en init: " + String(e).slice(0, 40));
      log("init error", e);
    }
  }

  badge("archivo ejecutado");
  try {
    if (typeof engine !== "undefined" && engine.whenReady && engine.whenReady.then) {
      engine.whenReady.then(init);
    } else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  } catch (e) {
    log("bootstrap error", e);
  }
})();
