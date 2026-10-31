// Foto de perfil, en este orden:
//   1) png en assets/profile photo que coincida con el gamertag
//   2) cabeza de la skin de Minecraft Java
//        - login Microsoft: la skin de SU cuenta Java (verificada, la saca microsoft.js)
//        - login por gamertag: se busca una cuenta Java con ese nombre (API publica de Mojang)
//   3) cabeza de la skin de Bedrock (Geyser)
//   4) ninguna (la interfaz dibuja un placeholder)
// En los casos 2 y 3 la interfaz recorta la cara de la skin igual que siempre.
const fs = require('fs');
const paths = require('../paths');

const norm = (s) => String(s || '').trim().toLowerCase();
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const JAVA_NAME = /^[A-Za-z0-9_]{3,16}$/;

function findPhoto(gamertag) {
  const dir = paths.asset('profile photo');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return null; }
  const wanted = [norm(gamertag), norm(gamertag).replace(/#\d+$/, '')];
  const hit = files.find((f) => f.toLowerCase().endsWith('.png') && wanted.includes(norm(f.slice(0, -4))));
  return hit ? `${dir}/${hit}` : null;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
  if (res.status !== 200) return null;           // 204/404 = no existe esa cuenta
  return res.json();
}

// Skin de una cuenta Java por nombre de usuario. null si no existe o no hay red.
async function javaSkinByName(name) {
  const tag = String(name || '').trim().replace(/#\d+$/, '');
  if (!JAVA_NAME.test(tag)) return null;         // un gamertag con espacios no puede ser nombre de Java
  try {
    const found = await getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(tag)}`);
    if (!found || !found.id) return null;
    const prof = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${found.id}`);
    const prop = prof && (prof.properties || []).find((p) => p.name === 'textures');
    if (!prop) return null;
    const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
    return (tex.textures && tex.textures.SKIN && tex.textures.SKIN.url) || null;
  } catch { return null; }
}

async function downloadSkin(url) {
  try {
    const res = await fetch(url.replace(/^http:/, 'https:'), { signal: AbortSignal.timeout(6000) });
    return res.ok ? { type: 'skin', dataUrl: dataUrl(Buffer.from(await res.arrayBuffer())) } : null;
  } catch { return null; }
}

// user: { gamertag, skinUrl, javaChecked }
//   javaChecked = true cuando el login ya consulto la cuenta Java de la persona (Microsoft).
async function resolve(user) {
  const photo = findPhoto(user.gamertag);
  if (photo) return { type: 'photo', dataUrl: dataUrl(fs.readFileSync(photo)) };

  const urls = [];
  if (!user.javaChecked) urls.push(await javaSkinByName(user.gamertag));
  urls.push(user.skinUrl);                       // Java verificada (Microsoft) o skin de Bedrock
  for (const url of urls.filter(Boolean)) {
    const skin = await downloadSkin(url);
    if (skin) return skin;
  }
  return { type: 'none' };
}

module.exports = { resolve, javaSkinByName };
