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
