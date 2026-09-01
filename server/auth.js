import crypto from 'node:crypto';
import { config } from './config.js';
import { getStaffMember } from './bot.js';

const DISCORD_API = 'https://discord.com/api/v10';

export function oauthLoginUrl(state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.oauthRedirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauthRedirectUri,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`échange du code échoué: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`récupération user échouée: ${res.status}`);
  return res.json();
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signSession(payload) {
  const data = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(data)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Flux complet : code OAuth -> user -> vérif rôle staff -> session signée.
export async function completeLogin(code) {
  const tokens = await exchangeCode(code);
  const user = await fetchDiscordUser(tokens.access_token);
  const { isStaff, member, level } = await getStaffMember(user.id);
  if (!isStaff) {
    return { ok: false, reason: 'not_staff', user };
  }
  const displayName =
    member?.nickname || user.global_name || user.username;
  const session = signSession({
    uid: user.id,
    name: displayName,
    level,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 h
  });
  return { ok: true, session, user, displayName };
}
