// Inicio de sesion Microsoft -> Xbox Live -> gamertag (+ skin de Java si existe).
const { safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const paths = require('../paths');
const { bedrockSkinUrl } = require('./gamertag');

const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const sessionFile = () => path.join(paths.userData(), 'session.bin');

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function http(url, { method = 'POST', json, form, headers = {} } = {}) {
  const opts = { method, headers: { Accept: 'application/json', ...headers } };
  if (json) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json); }
  if (form) { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = new URLSearchParams(form).toString(); }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${new URL(url).host} respondio ${res.status}: ${text.slice(0, 160)}`);
  return data;
}

// ---- Paso 1: login en el navegador del sistema (OAuth + PKCE, redireccion a localhost) ----
const http_ = require('http');
const { shell } = require('electron');

const DONE_PAGE = (msg) => `<!doctype html><meta charset="utf-8"><title>Summer Launcher</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0714;color:#fff;font-family:Segoe UI,sans-serif;text-align:center">
<div><h1 style="margin:0 0 8px">${msg}</h1><p style="color:#a79bc4">Ya puedes cerrar esta pestaña y volver al launcher.</p></div></body>`;

function interactiveLogin() {
  const clientId = config.microsoft.clientId;
  if (!clientId || clientId.startsWith('TU_')) {
    return Promise.reject(new Error('Falta configurar microsoft.clientId en config/launcher.config.js'));
  }
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let finished = false;
    const server = http_.createServer((req, res) => {
      const q = new URL(req.url, 'http://localhost').searchParams;
      if (!q.get('code') && !q.get('error')) { res.writeHead(404).end(); return; }
      const ok = q.get('code') && q.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DONE_PAGE(ok ? 'Sesión iniciada' : 'No se pudo iniciar sesión'));
      end(ok ? null : new Error(q.get('error_description') || 'Inicio de sesión cancelado'), ok && { code: q.get('code'), verifier, redirect });
    });
    let redirect = '';
    const timer = setTimeout(() => end(new Error('Se agotó el tiempo del inicio de sesión')), 5 * 60 * 1000);
    function end(err, val) {
      if (finished) return; finished = true;
      clearTimeout(timer); server.close();
      err ? reject(err) : resolve(val);
    }
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://localhost:${server.address().port}`;
      const url = `${AUTH}/authorize?` + new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account', state,
      });
      shell.openExternal(url);
    });
  });
}

async function tokenFromCode({ code, verifier, redirect }) {
  return http(`${AUTH}/token`, { form: {
    client_id: config.microsoft.clientId, grant_type: 'authorization_code', code,
    redirect_uri: redirect, code_verifier: verifier, scope: SCOPE,
  } });
}
async function tokenFromRefresh(refresh) {
  return http(`${AUTH}/token`, { form: {
    client_id: config.microsoft.clientId, grant_type: 'refresh_token', refresh_token: refresh, scope: SCOPE,
  } });
}

// ---- Paso 2: Xbox Live -> gamertag ----
async function xboxProfile(msAccessToken) {
  const xbl = await http('https://user.auth.xboxlive.com/user/authenticate', { json: {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  } });
  const xsts = await http('https://xsts.auth.xboxlive.com/xsts/authorize', { json: {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'http://xboxlive.com', TokenType: 'JWT',
  } });
  const claim = xsts.DisplayClaims.xui[0];
  return { gamertag: claim.gtg, xuid: claim.xid, xblToken: xbl.Token };
}

// ---- Paso 3 (opcional): skin de Java ----
async function javaSkinUrl(xblToken) {
  try {
    const xsts = await http('https://xsts.auth.xboxlive.com/xsts/authorize', { json: {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    } });
    const uhs = xsts.DisplayClaims.xui[0].uhs;
    const mc = await http('https://api.minecraftservices.com/authentication/login_with_xbox', {
      json: { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` },
    });
    const profile = await http('https://api.minecraftservices.com/minecraft/profile', {
      method: 'GET', headers: { Authorization: `Bearer ${mc.access_token}` },
    });
    const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE') || (profile.skins || [])[0];
    return skin ? skin.url : null;
  } catch {
    return null; // no tiene Java o no hay skin: se usa el siguiente metodo
  }
}

async function finalize(tokens) {
  const prof = await xboxProfile(tokens.access_token);
  const javaSkin = await javaSkinUrl(prof.xblToken);
  const skinUrl = javaSkin || (await bedrockSkinUrl(prof.xuid));
  saveRefresh(tokens.refresh_token);
  // javaChecked: ya se consulto la cuenta Java de esta persona (avatar.js no vuelve a buscar por nombre)
  return { gamertag: prof.gamertag, xuid: prof.xuid, skinUrl, javaChecked: true };
}

// ---- Sesion persistente (refresh token cifrado con el sistema) ----
function saveRefresh(token) {
  if (!token || !safeStorage.isEncryptionAvailable()) return;
  fs.mkdirSync(paths.userData(), { recursive: true });
  fs.writeFileSync(sessionFile(), safeStorage.encryptString(token));
}
function loadRefresh() {
  try { return safeStorage.decryptString(fs.readFileSync(sessionFile())); } catch { return null; }
}

async function login() { return finalize(await tokenFromCode(await interactiveLogin())); }

async function restore() {
  const refresh = loadRefresh();
  if (!refresh) return null;
  try { return await finalize(await tokenFromRefresh(refresh)); } catch { return null; }
}

function logout() {
  try { fs.unlinkSync(sessionFile()); } catch {}
}

module.exports = { login, restore, logout };
