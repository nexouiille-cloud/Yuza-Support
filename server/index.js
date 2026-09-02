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
  setTicketUpdateHandler,
  getStaffMember,
  sendDMFile,
} from './bot.js';
import { oauthLoginUrl, completeLogin, verifySession } from './auth.js';
import {
  registerGateway,
  handleClientMessage,
  handleSystemMessage,
  handleTicketUpdate,
  relayStaffMessage,
} from './gateway.js';
import {
  getTicket,
  addMessage,
  addPushSub,
  removePushSub,
  listMessages,
  effectiveTheme,
} from './db.js';
import { initPush } from './push.js';
import { saveBuffer, UPLOAD_DIR } from './uploads.js';
import { bootScreen, SIGNATURE } from './boot.js';
import { bot } from './bot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: false });

// signature — présente aussi dans les en-têtes HTTP de chaque réponse
app.addHook('onSend', (req, reply, payload, done) => {
  reply.header('X-Author', SIGNATURE);
  reply.header('X-Powered-By', `Volt Support (by ${SIGNATURE})`);
  done(null, payload);
});

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

// thème / nom de l'appli (public, pour l'affichage)
app.get('/api/theme', async () => effectiveTheme());

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

// --- Transcript d'un ticket (fichier HTML téléchargeable) ---
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

function buildTranscript(t, msgs) {
  const rows = msgs
    .map((m) => {
      const when = new Date(m.created_at).toLocaleString('fr-FR');
      const atts = (m.attachments || [])
        .map((a) => `<a href="${esc(a.url)}">${esc(a.name || 'fichier')}</a>`)
        .join(' ');
      return `<div class="m ${esc(m.author)}"><div class="meta">${esc(
        m.author_name,
      )} · ${when}</div><div class="c">${esc(m.content)}${
        atts ? `<div class="att">${atts}</div>` : ''
      }</div></div>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8">
<title>Ticket ${esc(t.title || t.username)} — ${esc(t.user_id)}</title>
<style>
  body{font:14px/1.6 system-ui,Segoe UI,sans-serif;background:#0f0d0c;color:#eee;max-width:760px;margin:24px auto;padding:0 16px}
  h1{font-size:18px} .head{color:#aaa;font-size:13px;margin-bottom:20px;border-bottom:1px solid #333;padding-bottom:12px}
  .m{margin:8px 0;padding:8px 12px;border-radius:10px;max-width:80%}
  .m.client{background:#20202a}
  .m.staff{background:#3a2a12;margin-left:auto}
  .m.note{background:#302a17;border:1px solid #574a22;max-width:100%}
  .m.system{background:none;color:#888;text-align:center;font-size:12px;max-width:100%}
  .meta{font-size:11px;color:#999;margin-bottom:2px}
  .att a{color:#ffbb3d}
</style>
<h1>Ticket — ${esc(t.title || t.username)}</h1>
<div class="head">
  Client : ${esc(t.username)} (ID ${esc(t.user_id)})<br>
  Statut : ${esc(t.status)} · Catégorie : ${esc(t.category || 'aucune')} · Priorité : ${esc(t.priority || 'normale')}<br>
  Ouvert le ${new Date(t.created_at).toLocaleString('fr-FR')} · Export le ${new Date().toLocaleString('fr-FR')}
</div>
${rows}`;
}

app.get('/api/transcript/:userId', async (req, reply) => {
  const s = sessionOf(req);
  if (!s) return reply.code(401).send({ error: 'unauthorized' });
  const { isStaff, level } = await getStaffMember(s.uid);
  if (!isStaff) return reply.code(403).send({ error: 'not_staff' });
  const t = getTicket(req.params.userId);
  if (!t) return reply.code(404).send({ error: 'not_found' });
  if (level < (t.escalation_level || 1)) {
    return reply.code(403).send({ error: 'denied' });
  }
  const name = (t.username || 'client').replace(/[^\w.-]+/g, '_');
  reply
    .header(
      'Content-Disposition',
      `attachment; filename="ticket-${name}-${req.params.userId}.html"`,
    )
    .type('text/html; charset=utf-8')
    .send(buildTranscript(t, listMessages(req.params.userId, 5000)));
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
setTicketUpdateHandler(handleTicketUpdate);

await startBot();
await app.listen({ port: config.port, host: config.host });

await bootScreen({
  host: config.host,
  port: config.port,
  staffRoleIds: config.staffRoleIds,
  categories: config.categories,
  tiers: config.staffTiers.map((t) => t.name),
  welcome: !!config.welcomeMessage,
  botTag: bot?.user?.tag,
});
