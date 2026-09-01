import { config, levelName, maxLevel } from './config.js';
import { verifySession } from './auth.js';
import { getStaffMember, sendDM, pingRoleInChannel } from './bot.js';
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
  setRequestedRole,
  getStats,
  getBlacklist,
  setBlacklist,
  updatePushSubLevel,
  getMemberProfile,
  findTicketId,
  effectiveCategories,
  getSettings,
  updateSettings,
  effectiveTheme,
  effectiveAssignRoles,
  effectiveSla,
  effectiveAskCategory,
  effectiveAutoClose,
  effectiveFlood,
  markAutoWarned,
  staleTickets,
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

// liste des staff en ligne (dédupliquée par utilisateur)
function presenceList() {
  const seen = new Map();
  for (const c of clients) {
    if (c.ready && !seen.has(c.session.uid)) {
      seen.set(c.session.uid, { uid: c.session.uid, name: c.session.name, level: c.level });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function broadcastPresence() {
  broadcastAll({ type: 'presence', staff: presenceList() });
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

// Un ticket a changé côté bot (ex : catégorie choisie par le client).
export function handleTicketUpdate() {
  pushTickets();
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

    const entry = { socket, session, level: 1, roleIds: [], ready: false };
    clients.add(entry);

    // niveau réel (asynchrone) : rôle + tiers
    getStaffMember(session.uid).then(({ isStaff, level, roleIds }) => {
      if (!isStaff) {
        send(entry, { type: 'kicked', reason: 'role_removed' });
        socket.close();
        clients.delete(entry);
        return;
      }
      entry.level = level;
      entry.roleIds = roleIds || [];
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
        staff: presenceList(),
        roles: entry.roleIds,
        assignRoles: effectiveAssignRoles(),
        slaMinutes: effectiveSla(),
      });
      send(entry, { type: 'categories', categories: effectiveCategories() });
      send(entry, {
        type: 'settings_meta',
        canEditSettings: level >= maxLevel,
        theme: effectiveTheme(),
      });
      send(entry, { type: 'tickets', tickets: visibleTickets(level) });
      broadcastPresence();
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

      /* ---- réglages ---- */
      if (msg.type === 'get_settings') {
        send(entry, {
          type: 'settings',
          settings: getSettings(),
          canEdit: entry.level >= maxLevel,
        });
        return;
      }
      if (msg.type === 'save_settings') {
        if (entry.level < maxLevel) {
          send(entry, { type: 'settings_saved', ok: false, reason: 'forbidden' });
          return;
        }
        const p = msg.patch || {};
        const patch = {};
        if (Array.isArray(p.categories)) {
          patch.categories = [
            ...new Set(p.categories.map((s) => String(s).trim()).filter(Boolean)),
          ].slice(0, 40);
        }
        if (p.welcome && typeof p.welcome.text === 'string') {
          patch.welcome = {
            text: p.welcome.text.slice(0, 1500),
            enabled: p.welcome.enabled !== false,
          };
        }
        if (typeof p.staffChannelId === 'string') {
          patch.staffChannelId = p.staffChannelId.trim();
        }
        if (typeof p.staffPingRoleId === 'string') {
          patch.staffPingRoleId = p.staffPingRoleId.trim();
        }
        if (Array.isArray(p.assignRoles)) {
          patch.assignRoles = p.assignRoles
            .map((r) => ({
              name: String(r.name || '').slice(0, 40),
              roleId: String(r.roleId || '').trim(),
            }))
            .filter((r) => r.name)
            .slice(0, 30);
        }
        if (p.slaMinutes != null) {
          const n = Number(p.slaMinutes);
          if (Number.isFinite(n) && n > 0) patch.slaMinutes = Math.round(n);
        }
        if (typeof p.askCategory === 'boolean') patch.askCategory = p.askCategory;
        if (p.autoClose && typeof p.autoClose === 'object') {
          patch.autoClose = {
            enabled: !!p.autoClose.enabled,
            warnHours: Math.max(1, Number(p.autoClose.warnHours) || 48),
            closeHours: Math.max(1, Number(p.autoClose.closeHours) || 72),
          };
        }
        if (p.flood && typeof p.flood === 'object') {
          patch.flood = {
            enabled: p.flood.enabled !== false,
            count: Math.max(2, Number(p.flood.count) || 8),
            windowSec: Math.max(3, Number(p.flood.windowSec) || 15),
            muteMin: Math.max(1, Number(p.flood.muteMin) || 10),
          };
        }
        if (p.theme && typeof p.theme === 'object') {
          patch.theme = {
            appName: String(p.theme.appName || '').slice(0, 40) || 'Volt Support',
            accent: /^#[0-9a-fA-F]{6}$/.test(p.theme.accent || '')
              ? p.theme.accent
              : '#ff9d00',
            bg: /^#[0-9a-fA-F]{6}$/.test(p.theme.bg || '') ? p.theme.bg : '#0a0a0c',
          };
        }
        updateSettings(patch);
        send(entry, { type: 'settings_saved', ok: true });
        broadcastAll({ type: 'categories', categories: effectiveCategories() });
        broadcastAll({ type: 'theme', theme: effectiveTheme() });
        broadcastAll({
          type: 'assign_config',
          assignRoles: effectiveAssignRoles(),
          slaMinutes: effectiveSla(),
        });
        pushTickets();
        return;
      }

      /* ---- demander un rôle sur un ticket ---- */
      if (msg.type === 'request_role') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        const role = effectiveAssignRoles().find(
          (r) => r.roleId && r.roleId === String(msg.roleId),
        );
        if (!role) return;
        const t = getTicket(msg.userId);
        setRequestedRole(msg.userId, {
          name: role.name,
          roleId: role.roleId,
          by: session.name,
          at: Date.now(),
        });
        const label = t?.title || t?.username || 'un client';
        const sys = addMessage(
          msg.userId,
          'system',
          'Système',
          `${session.name} demande un « ${role.name} » sur ce ticket`,
        );
        broadcastTicket(msg.userId, { type: 'message', message: sys });
        pushTickets();
        // alerte ciblée aux staff qui ont ce rôle
        for (const c of clients) {
          if (c.ready && c.roleIds.includes(role.roleId)) {
            send(c, {
              type: 'role_requested',
              userId: msg.userId,
              roleName: role.name,
              by: session.name,
              ticketName: label,
            });
          }
        }
        pingRoleInChannel(
          role.roleId,
          `🙋 demandé sur le ticket de **${label}** par **${session.name}**`,
        );
        return;
      }
      if (msg.type === 'clear_request') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        setRequestedRole(msg.userId, null);
        pushTickets();
        return;
      }

      /* ---- fiche membre ---- */
      if (msg.type === 'member') {
        const id = msg.userId || findTicketId(msg.query);
        const profile = id ? getMemberProfile(id) : null;
        if (profile && entry.level < tLevel({ escalation_level: profile.escalation_level })) {
          send(entry, { type: 'member', profile: null, query: msg.query || '' });
          return;
        }
        send(entry, { type: 'member', profile, query: msg.query || '' });
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
        // si un rôle était demandé et que je l'ai -> demande satisfaite
        if (
          t?.requested_role &&
          entry.roleIds.includes(t.requested_role.roleId)
        ) {
          setRequestedRole(msg.userId, null);
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
          msg.category && effectiveCategories().includes(msg.category)
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
        const at = getTicket(msg.userId);
        if (
          msg.take &&
          at?.requested_role &&
          entry.roleIds.includes(at.requested_role.roleId)
        ) {
          setRequestedRole(msg.userId, null);
        }
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

    socket.on('close', () => { clients.delete(entry); broadcastPresence(); });
    socket.on('error', () => { clients.delete(entry); broadcastPresence(); });
  });

  // Re-vérification périodique : rôle + niveau.
  setInterval(
    async () => {
      let changed = false;
      for (const c of [...clients]) {
        const { isStaff, level, roleIds } = await getStaffMember(c.session.uid);
        if (!isStaff) {
          if (c.socket.readyState === 1) {
            send(c, { type: 'kicked', reason: 'role_removed' });
            c.socket.close();
          }
          clients.delete(c);
          changed = true;
          continue;
        }
        const rolesChanged =
          (roleIds || []).join(',') !== c.roleIds.join(',');
        if (rolesChanged) c.roleIds = roleIds || [];
        if (level !== c.level || rolesChanged) {
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
            roles: c.roleIds,
            assignRoles: effectiveAssignRoles(),
            slaMinutes: effectiveSla(),
          });
          send(c, { type: 'tickets', tickets: visibleTickets(level) });
          changed = true;
        }
      }
      if (changed) broadcastPresence();
    },
    Math.max(30, config.roleRecheckSeconds) * 1000,
  ).unref?.();

  // Fermeture automatique des tickets inactifs (toutes les 15 min).
  setInterval(async () => {
    const ac = effectiveAutoClose();
    if (!ac.enabled) return;
    for (const t of staleTickets(ac.warnHours)) {
      if (t.auto_warned) continue;
      markAutoWarned(t.user_id);
      try {
        await sendDM(
          t.user_id,
          "Toujours besoin d'aide ? Sans réponse de ta part, ce ticket sera fermé automatiquement bientôt.",
        );
      } catch {}
      const sys = addMessage(
        t.user_id,
        'system',
        'Système',
        'Relance automatique envoyée (inactivité client).',
      );
      broadcastTicket(t.user_id, { type: 'message', message: sys });
    }
    let closedAny = false;
    for (const t of staleTickets(ac.closeHours)) {
      setTicketStatus(t.user_id, 'closed');
      try {
        await sendDM(
          t.user_id,
          'Ce ticket a été fermé automatiquement faute de réponse. Écris-nous à nouveau si besoin.',
        );
      } catch {}
      const sys = addMessage(
        t.user_id,
        'system',
        'Système',
        'Ticket fermé automatiquement (inactivité).',
      );
      broadcastTicket(t.user_id, { type: 'message', message: sys });
      closedAny = true;
    }
    if (closedAny) pushTickets();
  }, 15 * 60000).unref?.();
}
