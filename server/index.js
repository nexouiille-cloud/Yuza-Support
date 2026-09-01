import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { config } from './config.js';
import {
  startBot,
  setClientMessageHandler,
  setSystemMessageHandler,
  getStaffMember,
  sendDMFile,
} from './bot.js';
import { oauthLoginUrl, completeLogin, verifySession } from './auth.js';
import {
  registerGateway,
  handleClientMessage,
  handleSystemMessage,
  relayStaffMessage,
} from './gateway.js';
import { getTicket, addMessage, addPushSub, removePushSub } from './db.js';
import { initPush } from './push.js';
import { saveBuffer, UPLOAD_DIR } from './uploads.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: false });

initPush();

await app.register(fastifyCookie);
await app.register(fastifyWebsocket);
await app.register(fastifyMultipart, {
  limits: { fileSize: config.maxAttachmentBytes, files: 1 },
});
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'web'),
  prefix: '/',
  index: 'index.html',
});
await app.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/',
  decorateReply: false,
});

const SECURE = config.oauthRedirectUri.startsWith('https');
const SESSION_COOKIE = 'yuza_session';
const STATE_COOKIE = 'yuza_oauth_state';
const baseCookie = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: SECURE,
};

app.get('/health', async () => ({ ok: true }));

// le front interroge ça au chargement pour savoir s'il est connecté
app.get('/api/me', async (req, reply) => {
  const s = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (!s) return reply.code(401).send({ error: 'unauthorized' });
  return { uid: s.uid, name: s.name, level: s.level || 1 };
});

app.get('/auth/login', async (req, reply) => {
  const state = crypto.randomBytes(16).toString('hex');
  reply.setCookie(STATE_COOKIE, state, { ...baseCookie, maxAge: 600 });
  return reply.redirect(oauthLoginUrl(state));
});

app.get('/auth/logout', async (req, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return reply.redirect('/');
});

app.get('/auth/callback', async (req, reply) => {
  const { code, state } = req.query || {};
  const expected = req.cookies?.[STATE_COOKIE];
  reply.clearCookie(STATE_COOKIE, { path: '/' });

  if (!code) return reply.redirect('/?error=no_code');
  if (!state || !expected || state !== expected) {
    return reply.redirect('/?error=bad_state');
  }

  try {
    const result = await completeLogin(code);
    if (!result.ok) {
      return reply.redirect(`/?error=${encodeURIComponent(result.reason || 'denied')}`);
    }
    reply.setCookie(SESSION_COOKIE, result.session, {
      ...baseCookie,
      maxAge: 60 * 60 * 12, // 12 h
    });
    return reply.redirect('/');
  } catch (err) {
    console.error('[auth] erreur callback:', err);
    return reply.redirect('/?error=server_error');
  }
});

// --- Web Push : (dé)abonnement d'un staff ---
function sessionOf(req) {
  return verifySession(req.cookies?.[SESSION_COOKIE]);
}

app.post('/api/push/subscribe', async (req, reply) => {
  const s = sessionOf(req);
  if (!s) return reply.code(401).send({ error: 'unauthorized' });
  const sub = req.body;
  if (!sub || !sub.endpoint) return reply.code(400).send({ error: 'bad_sub' });
  const { isStaff, level } = await getStaffMember(s.uid);
  if (!isStaff) return reply.code(403).send({ error: 'not_staff' });
  addPushSub(s.uid, level, sub);
  return { ok: true };
});

app.post('/api/push/unsubscribe', async (req, reply) => {
  const s = sessionOf(req);
  if (!s) return reply.code(401).send({ error: 'unauthorized' });
  if (req.body?.endpoint) removePushSub(req.body.endpoint);
  return { ok: true };
});

// --- Pièce jointe staff -> client ---
app.post('/api/attach', async (req, reply) => {
  const s = sessionOf(req);
  if (!s) return reply.code(401).send({ error: 'unauthorized' });

  let data;
  try {
    data = await req.file();
  } catch {
    return reply.code(400).send({ error: 'no_file' });
  }
  if (!data) return reply.code(400).send({ error: 'no_file' });

  const userId = data.fields?.userId?.value;
  const caption = (data.fields?.caption?.value || '').toString().trim();
  if (!userId) return reply.code(400).send({ error: 'no_user' });

  const { isStaff, level } = await getStaffMember(s.uid);
  if (!isStaff) return reply.code(403).send({ error: 'not_staff' });
  const t = getTicket(userId);
  if (t && level < (t.escalation_level || 1)) {
    return reply.code(403).send({ error: 'denied' });
  }

  let buf;
  try {
    buf = await data.toBuffer();
  } catch {
    return reply.code(413).send({ error: 'too_large' });
  }

  const label = `${s.name} ${config.staffSuffix}`;
  try {
    await sendDMFile(userId, caption ? `**${label} :** ${caption}` : `**${label}**`, {
      buffer: buf,
      name: data.filename,
    });
  } catch (err) {
    return reply.code(502).send({ error: 'dm_failed', detail: String(err?.message || err) });
  }

  const saved = saveBuffer(buf, data.filename, data.mimetype);
  const stored = addMessage(userId, 'staff', label, caption, [saved]);
  relayStaffMessage(stored, caption || `📎 ${saved.name}`);
  return { ok: true };
});

registerGateway(app);
setClientMessageHandler(handleClientMessage);
setSystemMessageHandler(handleSystemMessage);

await startBot();
await app.listen({ port: config.port, host: config.host });

console.log(`[server] à l'écoute sur http://${config.host}:${config.port}`);
console.log(`[server] rôles staff autorisés : ${config.staffRoleIds.join(', ')}`);
console.log(
  `[server] catégories (${config.categories.length}) : ${config.categories.join(', ')}`,
);
if (config.staffTiers.length) {
  console.log(
    `[server] niveaux : ${config.staffTiers
      .map((t, i) => `${i + 2}=${t.name}`)
      .join(', ')}`,
  );
}
console.log(
  `[server] message d'accueil auto : ${config.welcomeMessage ? 'activé' : 'désactivé (welcome.txt vide)'}`,
);
console.log('[server] Web Push + pièces jointes : prêts');
