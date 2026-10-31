// Foto de perfil: 1) png en assets/profile photo que coincida con el gamertag,
// 2) cabeza de la skin de Java, 3) ninguna (la interfaz dibuja un placeholder).
const fs = require('fs');
const paths = require('../paths');

const norm = (s) => String(s || '').trim().toLowerCase();
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

function findPhoto(gamertag) {
  const dir = paths.asset('profile photo');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return null; }
  const wanted = [norm(gamertag), norm(gamertag).replace(/#\d+$/, '')];
  const hit = files.find((f) => f.toLowerCase().endsWith('.png') && wanted.includes(norm(f.slice(0, -4))));
  return hit ? `${dir}/${hit}` : null;
}

async function resolve(gamertag, skinUrl) {
  const photo = findPhoto(gamertag);
  if (photo) return { type: 'photo', dataUrl: dataUrl(fs.readFileSync(photo)) };
  if (skinUrl) {
    try {
      const res = await fetch(skinUrl, { signal: AbortSignal.timeout(6000) });
      if (res.ok) return { type: 'skin', dataUrl: dataUrl(Buffer.from(await res.arrayBuffer())) };
    } catch {}
  }
  return { type: 'none' };
}

module.exports = { resolve };
