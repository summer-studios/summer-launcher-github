# summer launcher github
summer launcher real

Launcher (Electron) para Minecraft Bedrock con instancias, packs de menu globales y acceso remoto.

## Instancias incluidas
| Instancia | id | Pack de menu |
|---|---|---|
| Squadrock Z | `squadrock-z` | `packs/squadrock_z` |
| Sleeplands Hardcore | `sleeplands-hardcore` | `packs/sleeplands_hardcore` |

Cada instancia es un archivo en `config/instances/` (ver `_template.js`). Al pulsar **JUGAR** el launcher
instala y equipa de forma global el pack de la instancia y entra directo al servidor, sin mostrar la IP.

## Archivos que se editan (tambien de forma remota)
- `database/access.json` - quien puede entrar a cada instancia.
- `database/servers.json` - IP y puerto de cada instancia (nunca se muestran en el launcher).
- Programa `admin/` (panel web + linea de comandos) para cambiarlos en tiempo real: ver `admin/LEEME-ADMIN.txt`.

## Perfil
La foto del launcher sale de `assets/profile photo/<gamertag>.png`; si no existe, de la skin de
Minecraft Java de la cuenta; y si no tiene Java, de su skin de Bedrock.

## Desarrollo
`probar.bat` para abrirlo, `compilar.bat` para generar el instalador. Login Microsoft: `LEEME-LOGIN.txt`.

## Reproductor de video (Ore UI)
Integra el addon Video Player: un reproductor dibujado con HTML/CSS/JS sobre Ore UI (hbui) y controlado por un
behavior pack (`/play N` y un video aleatorio al entrar).
- `packs/video_player_rp` (resource pack global) + `packs/video_player_bp` (behavior pack), ya incluidos en las dos instancias.
- Al pulsar **JUGAR** el launcher parchea el `gameplay.html` de TU version del juego (cambia en cada actualizacion) con el CSS/JS
  que pide cada pack en `hbui/summer-inject.json` (`src/main/game/oreui.js`).
- Los videos se leen de `videos/` (`.webm` o `.mkv`, max. 8). Ore UI solo reproduce WebM VP8/VP9 + Vorbis, asi que los `.mkv`
  se convierten con ffmpeg (`tools/ffmpeg/`) y se cachean (`src/main/game/videos.js`). Ver `videos/LEEME.txt`.
- Ajustes en `config/launcher.config.js` (`oreUi`, `video`) y en cada instancia (`behaviorPacks`, `worlds`, `videosDir`).
- Un behavior pack no puede ser global: en un **servidor** el pack `video_player_bp` tiene que estar instalado en el servidor
  (el launcher solo lo instala para mundos locales listados en `worlds`).
