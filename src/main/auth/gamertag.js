// Inicio de sesion por gamertag de Minecraft Bedrock (sin Microsoft, sin costo).
// Obtiene xuid y skin con la API publica de Geyser. Si falla la consulta, entra igual.
// AVISO: no verifica que el gamertag sea realmente de la persona.
const settings = require('../settings');

const VALID = /^[A-Za-z0-9 _#.-]{1,32}$/;
const API = 'https://api.geysermc.org/v2';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Skin de Bedrock a partir del xuid (para cuentas sin Java).
async function bedrockSkinUrl(xuid) {
  try {
    const skin = await getJson(`${API}/skin/${xuid}`);
    return skin.texture_id ? `https://textures.minecraft.net/texture/${skin.texture_id}` : null;
  } catch { return null; }
}

async function lookup(gamertag) {
  try {
    const { xuid } = await getJson(`${API}/xbox/xuid/${encodeURIComponent(gamertag)}`);
    if (!xuid) return { xuid: null, skinUrl: null };
    let skinUrl = null;
    try {
      const skin = await getJson(`${API}/skin/${xuid}`);
      if (skin.texture_id) skinUrl = `https://textures.minecraft.net/texture/${skin.texture_id}`;
    } catch (e) { console.warn('[gamertag] sin skin:', e.message); }
    return { xuid: String(xuid), skinUrl };
  } catch (e) {
    console.warn('[gamertag] consulta fallo:', e.message);
    return { xuid: null, skinUrl: null };
  }
}

async function login(gamertag) {
  const tag = String(gamertag || '').trim();
  if (!VALID.test(tag)) throw new Error('Escribe un gamertag válido (letras, números, espacios, _ o #).');
  const info = await lookup(tag);
  settings.set({ lastGamertag: tag });
  return { gamertag: tag, xuid: info.xuid || 'gamertag', skinUrl: info.skinUrl };
}

async function restore() {
  const tag = settings.get().lastGamertag;
  return tag ? login(tag) : null;
}

function logout() { settings.set({ lastGamertag: null }); }

module.exports = { login, restore, logout, bedrockSkinUrl };
