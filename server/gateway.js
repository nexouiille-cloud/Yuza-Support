import { config, levelName, maxLevel } from './config.js';
import { verifySession } from './auth.js';
import { getStaffMember, sendDM } from './bot.js';
import { pushToLevel, vapidPublicKey } from './push.js';
import {
  listTickets,
  listMessages,
  addMessage,
  setTicketStatus,
  upsertTicket,
  getTicket,
  searchTicketIds,
  setTicketCategory,
  setTicketAssignee,
  setTicketEscalation,
  setTicketTitle,
  setTicketPriority,
  getStats,
  getBlacklist,
  setBlacklist,
  updatePushSubLevel,
} from './db.js';

/** @type {Set<{socket:any, session:any, level:number, ready:boolean}>} */
const clients = new Set();

const tLevel = (t) => (t && t.escalation_level) || 1;

function cookieVal(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return part.slice(i + 1).trim();
      }
    }
  }
  return null;
}

function send(entry, obj) {
  if (entry.socket.readyState === 1) entry.socket.send(JSON.stringify(obj));
}

// à tous les staff connectés (infos non sensibles)
function broadcastAll(obj) {
  for (const c of clients) send(c, obj);
}

// événement lié à un ticket : seulement aux staff dont le niveau suffit
function broadcastTicket(userId, obj) {
  const need = tLevel(getTicket(userId));
  for (const c of clients) if (c.level >= need) send(c, obj);
}

function visibleTickets(level) {
  return listTickets().filter((t) => level >= tLevel(t));
}

// renvoie à chaque client sa liste de tickets filtrée par son niveau
function pushTickets() {
  for (const c of clients) {
    if (c.ready) send(c, { type: 'tickets', tickets: visibleTickets(c.level) });
  }
}

function canSee(entry, userId) {
  const t = getTicket(userId);
  return !t || entry.level >= tLevel(t);
}

// Message système (ex : réponse automatique d'accueil).
export function handleSystemMessage(stored) {
  broadcastTicket(stored.user_id, { type: 'message', message: stored });
}

// Message staff venu d'ailleurs que le WebSocket (ex : pièce jointe via HTTP).
export function relayStaffMessage(stored, preview) {
  broadcastTicket(stored.user_id, { type: 'message', message: stored });
  const t = getTicket(stored.user_id);
  broadcastTicket(stored.user_id, {
    type: 'ticket_bump',
    userId: stored.user_id,
    name: t?.username || 'client',
    preview: preview || '📎 pièce jointe',
    fromStaff: true,
  });
}

// Web Push : anti-spam par ticket (45 s), sauf nouveau/relancé.
const lastPush = new Map();
function maybePush(ticket, payload, force) {
  const uid = ticket?.user_id || payload.userId;
  const now = Date.now();
  if (!force && now - (lastPush.get(uid) || 0) < 45000) return;
  lastPush.set(uid, now);
  pushToLevel(tLevel(ticket), payload);
}

// Appelé par bot.js quand un client envoie un MP.
export function handleClientMessage(stored, meta = {}) {
  broadcastTicket(stored.user_id, { type: 'message', message: stored });
  broadcastTicket(stored.user_id, {
    type: 'ticket_bump',
    userId: stored.user_id,
    name: stored.author_name,
    preview: stored.content.slice(0, 120) || '📎 pièce jointe',
    fromStaff: false,
    isNew: !!meta.created,
    reopened: !!meta.reopened,
  });
  maybePush(
    getTicket(stored.user_id),
    {
      title: meta.created
        ? '📩 Nouveau ticket'
        : meta.reopened
          ? '📩 Ticket relancé'
          : '💬 Nouveau message',
      body: `${stored.author_name} : ${stored.content || '📎 pièce jointe'}`.slice(0, 140),
      userId: stored.user_id,
    },
    !!(meta.created || meta.reopened),
  );
}

export function registerGateway(app) {
  app.get('/gateway', { websocket: true }, (conn, req) => {
    const socket = conn.socket ?? conn; // compat @fastify/websocket v8/v11
    const rawUrl = req.url || req.raw?.url || '';
    const cookieHeader = req.headers?.cookie || req.raw?.headers?.cookie || '';
    // web : cookie de session ; launcher Electron : ?token=
    const token =
      cookieVal(cookieHeader, 'yuza_session') ||
      new URL(rawUrl, 'http://x').searchParams.get('token');
    const session = verifySession(token);

    if (!session) {
      try {
        socket.send(JSON.stringify({ type: 'error', reason: 'invalid_session' }));
      } catch {}
      socket.close();
      return;
    }

    const entry = { socket, session, level: 1, ready: false };
    clients.add(entry);

    // niveau réel (asynchrone) : rôle + tiers
    getStaffMember(session.uid).then(({ isStaff, level }) => {
      if (!isStaff) {
        send(entry, { type: 'kicked', reason: 'role_removed' });
        socket.close();
        clients.delete(entry);
        return;
      }
      entry.level = level;
      entry.ready = true;
      send(entry, {
        type: 'hello',
        uid: session.uid,
        name: session.name,
        level,
        levelLabel: levelName(level),
        tiers: config.staffTiers.map((t) => t.name),
        maxLevel,
        blacklist: getBlacklist(),
        vapidPublic: vapidPublicKey(),
      });
      send(entry, { type: 'categories', categories: config.categories });
      send(entry, { type: 'tickets', tickets: visibleTickets(level) });
    });

    socket.on('message', async (raw) => {
      if (!entry.ready) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      /* ---- statistiques ---- */
      if (msg.type === 'stats') {
        send(entry, { type: 'stats', stats: getStats(entry.level) });
        return;
      }

      /* ---- recherche ---- */
      if (msg.type === 'search') {
        const ids = searchTicketIds(msg.q).filter(
          (id) => entry.level >= tLevel(getTicket(id)),
        );
        send(entry, { type: 'search_results', q: msg.q || '', ids });
        return;
      }

      /* ---- ouvrir un ticket (charger les messages) ---- */
      if (msg.type === 'open' && msg.userId) {
        if (!canSee(entry, msg.userId)) {
          send(entry, { type: 'denied', userId: msg.userId });
          return;
        }
        send(entry, {
          type: 'messages',
          userId: msg.userId,
          messages: listMessages(msg.userId),
        });
        return;
      }

      /* ---- réponse au client ---- */
      if (msg.type === 'reply') {
        const content = String(msg.content || '').trim();
        if (!content || !msg.userId) return;
        if (!canSee(entry, msg.userId)) {
          send(entry, { type: 'denied', userId: msg.userId });
          return;
        }
        const { isStaff } = await getStaffMember(session.uid);
        if (!isStaff) {
          send(entry, { type: 'kicked', reason: 'role_removed' });
          socket.close();
          return;
        }

        const label = `${session.name} ${config.staffSuffix}`;
        try {
          await sendDM(msg.userId, `**${label} :** ${content}`);
        } catch (err) {
          send(entry, {
            type: 'dm_failed',
            userId: msg.userId,
            error: String(err?.message || err),
          });
          return;
        }

        const stored = addMessage(msg.userId, 'staff', label, content);
        const t = getTicket(msg.userId);
        upsertTicket(msg.userId, t?.username || 'client', content.slice(0, 120));
        // auto-assignation si personne ne s'en occupe
        let assigned = false;
        if (t && !t.assignee_id) {
          setTicketAssignee(msg.userId, session.uid, session.name);
          assigned = true;
        }
        broadcastTicket(msg.userId, { type: 'message', message: stored });
        broadcastTicket(msg.userId, {
          type: 'ticket_bump',
          userId: msg.userId,
          name: t?.username || 'client',
          preview: content.slice(0, 120),
          fromStaff: true,
        });
        if (assigned) pushTickets();
        return;
      }

      /* ---- note interne ---- */
      if (msg.type === 'note') {
        const content = String(msg.content || '').trim();
        if (!content || !msg.userId) return;
        if (!canSee(entry, msg.userId)) {
          send(entry, { type: 'denied', userId: msg.userId });
          return;
        }
        const { isStaff } = await getStaffMember(session.uid);
        if (!isStaff) {
          send(entry, { type: 'kicked', reason: 'role_removed' });
          socket.close();
          return;
        }

        const stored = addMessage(msg.userId, 'note', session.name, content);
        const t = getTicket(msg.userId);
        const preview = '📝 ' + content.slice(0, 110);
        upsertTicket(msg.userId, t?.username || 'client', preview);
        broadcastTicket(msg.userId, { type: 'message', message: stored });
        broadcastTicket(msg.userId, {
          type: 'ticket_bump',
          userId: msg.userId,
          name: t?.username || 'client',
          preview,
          fromStaff: true,
        });
        return;
      }

      /* ---- catégorie ---- */
      if (msg.type === 'set_category') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        const { isStaff } = await getStaffMember(session.uid);
        if (!isStaff) {
          send(entry, { type: 'kicked', reason: 'role_removed' });
          socket.close();
          return;
        }
        const cat =
          msg.category && config.categories.includes(msg.category)
            ? msg.category
            : null;
        setTicketCategory(msg.userId, cat);
        pushTickets();
        return;
      }

      /* ---- prendre / lâcher un ticket ---- */
      if (msg.type === 'assign') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        if (msg.take) setTicketAssignee(msg.userId, session.uid, session.name);
        else setTicketAssignee(msg.userId, null, null);
        const sys = addMessage(
          msg.userId,
          'system',
          'Système',
          msg.take
            ? `${session.name} a pris le ticket en charge`
            : `${session.name} a lâché le ticket`,
        );
        broadcastTicket(msg.userId, { type: 'message', message: sys });
        pushTickets();
        return;
      }

      /* ---- renommer un ticket ---- */
      if (msg.type === 'rename') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        const title = String(msg.title || '').trim();
        setTicketTitle(msg.userId, title);
        const sys = addMessage(
          msg.userId,
          'system',
          'Système',
          title
            ? `Ticket renommé « ${title} » par ${session.name}`
            : `Titre du ticket réinitialisé par ${session.name}`,
        );
        broadcastTicket(msg.userId, { type: 'message', message: sys });
        pushTickets();
        return;
      }

      /* ---- priorité d'un ticket ---- */
      if (msg.type === 'priority') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        const labels = { low: 'basse', normal: 'normale', high: 'haute', urgent: 'urgente' };
        if (!labels[msg.priority]) return;
        setTicketPriority(msg.userId, msg.priority);
        const sys = addMessage(
          msg.userId,
          'system',
          'Système',
          `Priorité passée à « ${labels[msg.priority]} » par ${session.name}`,
        );
        broadcastTicket(msg.userId, { type: 'message', message: sys });
        pushTickets();
        return;
      }

      /* ---- escalade / changement de niveau ---- */
      if (msg.type === 'escalate') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        const target = Math.max(1, Math.min(maxLevel, msg.level | 0));
        const t = getTicket(msg.userId);
        if (!t || target === tLevel(t)) return;
        const up = target > tLevel(t);

        setTicketEscalation(msg.userId, target);
        // celui qui gérait ne peut peut-être plus voir : on remet à zéro
        setTicketAssignee(msg.userId, null, null);
        const sys = addMessage(
          msg.userId,
          'system',
          'Système',
          `Ticket ${up ? 'escaladé' : 'redescendu'} au niveau ${target} (${levelName(
            target,
          )}) par ${session.name}`,
        );
        upsertTicket(
          msg.userId,
          t.username || 'client',
          `${up ? '⬆' : '⬇'} niveau ${target}`,
        );
        // le message système part au NOUVEAU niveau
        broadcastTicket(msg.userId, { type: 'message', message: sys });
        pushTickets();
        return;
      }

      /* ---- blacklist d'un client ---- */
      if (msg.type === 'blacklist') {
        if (!msg.userId) return;
        const { isStaff } = await getStaffMember(session.uid);
        if (!isStaff) {
          send(entry, { type: 'kicked', reason: 'role_removed' });
          socket.close();
          return;
        }
        setBlacklist(String(msg.userId), !!msg.on);
        broadcastAll({ type: 'blacklist', list: getBlacklist() });
        return;
      }

      /* ---- clôturer / rouvrir ---- */
      if (msg.type === 'close' || msg.type === 'reopen') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        setTicketStatus(msg.userId, msg.type === 'close' ? 'closed' : 'open');
        pushTickets();
        return;
      }
    });

    socket.on('close', () => clients.delete(entry));
    socket.on('error', () => clients.delete(entry));
  });

  // Re-vérification périodique : rôle + niveau.
  setInterval(
    async () => {
      for (const c of [...clients]) {
        const { isStaff, level } = await getStaffMember(c.session.uid);
        if (!isStaff) {
          if (c.socket.readyState === 1) {
            send(c, { type: 'kicked', reason: 'role_removed' });
            c.socket.close();
          }
          clients.delete(c);
          continue;
        }
        if (level !== c.level) {
          c.level = level;
          updatePushSubLevel(c.session.uid, level);
          send(c, {
            type: 'hello',
            uid: c.session.uid,
            name: c.session.name,
            level,
            levelLabel: levelName(level),
            tiers: config.staffTiers.map((t) => t.name),
            maxLevel,
            blacklist: getBlacklist(),
            vapidPublic: vapidPublicKey(),
          });
          send(c, { type: 'tickets', tickets: visibleTickets(level) });
        }
      }
    },
    Math.max(30, config.roleRecheckSeconds) * 1000,
  ).unref?.();
}
