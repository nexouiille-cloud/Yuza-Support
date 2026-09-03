import { config, levelName, maxLevel } from './config.js';
import { verifySession } from './auth.js';
import {
  getStaffMember,
  sendDM,
  pingRoleInChannel,
  searchMembers,
  sendConvocation,
  publishSupportPanel,
  sendRatingRequest,
  postAnnouncement,
  postSanction,
  postReport,
  applyBotStatus,
  postConvocation,
  publishReprisePanel,
  postShopAnnounce,
  publishRecruit,
} from './bot.js';
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
  effectiveCloseMessage,
  effectiveAskCategory,
  effectiveAutoClose,
  effectiveFlood,
  markAutoWarned,
  staleTickets,
  addSuggestion,
  listSuggestions,
  setSuggestionDone,
  deleteSuggestion,
  getUserTheme,
  setUserTheme,
  effectiveCategoryRoles,
  roleForCategory,
  addSanction,
  listSanctions,
  removeSanction,
  activeSanctionCount,
  isStaffBanned,
  recordLogin,
  listFirstSeen,
  addReport,
  listReports,
  setReportDone,
  deleteReport,
  isOnboarded,
  setOnboarded,
  resetOnboarded,
  addConvocation,
  listConvocations,
  listPanels,
  upsertPanel,
  deletePanel,
  effectiveRecruit,
  setRecruit,
  listHooks,
  addHook,
  deleteHook,
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
    if (!c.ready) continue;
    const prev = seen.get(c.session.uid);
    // si plusieurs onglets : on garde le statut le plus "présent"
    const rank = { online: 0, idle: 1, away: 2, busy: 3 };
    if (!prev || (rank[c.status] ?? 0) < (rank[prev.status] ?? 0)) {
      seen.set(c.session.uid, {
        uid: c.session.uid,
        name: c.session.name,
        level: c.level,
        roleName: c.roleName || null,
        status: c.status || 'online',
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function broadcastPresence() {
  broadcastAll({ type: 'presence', staff: presenceList() });
}

function onlineUids() {
  return [...new Set([...clients].filter((c) => c.ready).map((c) => c.session.uid))];
}
// journal des connexions -> poussé aux owners uniquement
function pushLoginsToOwners() {
  const payload = { type: 'logins', list: listFirstSeen(), online: onlineUids() };
  for (const c of clients) if (c.ready && c.isOwner) send(c, payload);
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

    const entry = { socket, session, level: 1, roleIds: [], roleName: null, status: 'online', ready: false };
    clients.add(entry);

    // niveau réel (asynchrone) : rôle + tiers
    getStaffMember(session.uid).then(({ isStaff, level, roleIds, roleName }) => {
      if (!isStaff) {
        send(entry, { type: 'kicked', reason: 'role_removed' });
        socket.close();
        clients.delete(entry);
        return;
      }
      if (isStaffBanned(session.uid)) {
        send(entry, { type: 'kicked', reason: 'sanctioned' });
        socket.close();
        clients.delete(entry);
        return;
      }
      entry.level = level;
      entry.roleIds = roleIds || [];
      entry.roleName = roleName || null;
      entry.isOwner = config.ownerIds.length
        ? config.ownerIds.includes(session.uid)
        : level >= maxLevel;
      entry.canModerate = entry.isOwner || level >= maxLevel;
      entry.ready = true;
      send(entry, {
        type: 'hello',
        uid: session.uid,
        name: session.name,
        level,
        levelLabel: levelName(level),
        roleName: entry.roleName,
        canModerate: entry.canModerate,
        tiers: config.staffTiers.map((t) => t.name),
        maxLevel,
        blacklist: getBlacklist(),
        vapidPublic: vapidPublicKey(),
        staff: presenceList(),
        roles: entry.roleIds,
        assignRoles: effectiveAssignRoles(),
        slaMinutes: effectiveSla(),
        appearance: getUserTheme(session.uid),
        onboarded: isOnboarded(session.uid),
      });
      send(entry, { type: 'categories', categories: effectiveCategories() });
      send(entry, {
        type: 'settings_meta',
        canEditSettings: true, // tous les staff : au moins les couleurs
        settingsScope: entry.isOwner ? 'owner' : 'colors',
        theme: effectiveTheme(),
      });
      send(entry, { type: 'tickets', tickets: visibleTickets(level) });
      recordLogin(session.uid, session.name, entry.roleName);
      if (entry.isOwner) {
        send(entry, { type: 'logins', list: listFirstSeen(), online: onlineUids() });
      }
      pushLoginsToOwners(); // les autres owners voient la nouvelle connexion
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
          scope: entry.isOwner ? 'owner' : 'colors',
        });
        return;
      }
      /* ---- apparence personnelle (tous les staff) ---- */
      if (msg.type === 'save_appearance') {
        const pref = setUserTheme(session.uid, {
          preset: msg.preset,
          accent: msg.accent,
        });
        send(entry, { type: 'appearance_saved', ok: true, appearance: pref });
        return;
      }

      if (msg.type === 'save_settings') {
        const p = msg.patch || {};

        // le thème global (nom + couleurs par défaut) est réservé à l'owner.
        if (!entry.isOwner) {
          send(entry, { type: 'settings_saved', ok: false, reason: 'forbidden' });
          return;
        }

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
        if (p.closeMessage && typeof p.closeMessage.text === 'string') {
          patch.closeMessage = {
            text: p.closeMessage.text.slice(0, 1500),
            enabled: p.closeMessage.enabled !== false,
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
        if (p.panel && typeof p.panel === 'object') {
          const cur = getSettings().panel || {};
          patch.panel = {
            title: String(p.panel.title ?? cur.title ?? '').slice(0, 200),
            description: String(p.panel.description ?? cur.description ?? '').slice(0, 1500),
            buttonLabel: String(p.panel.buttonLabel ?? cur.buttonLabel ?? '').slice(0, 70),
            channelId: String(p.panel.channelId ?? cur.channelId ?? '').trim(),
            messageId: String(cur.messageId || ''), // conservé, géré par publish_panel
          };
        }
        if (typeof p.askRating === 'boolean') patch.askRating = p.askRating;
        if (typeof p.announceChannelId === 'string') {
          patch.announceChannelId = p.announceChannelId.trim();
        }
        if (typeof p.sanctionChannelId === 'string') {
          patch.sanctionChannelId = p.sanctionChannelId.trim();
        }
        if (typeof p.reportChannelId === 'string') {
          patch.reportChannelId = p.reportChannelId.trim();
        }
        if (typeof p.convoChannelId === 'string') {
          patch.convoChannelId = p.convoChannelId.trim();
        }
        if (typeof p.shopChannelId === 'string') {
          patch.shopChannelId = p.shopChannelId.trim();
        }
        if (p.recruit && typeof p.recruit === 'object') {
          const r = effectiveRecruit();
          patch.recruit = {
            channelId: String(p.recruit.channelId ?? r.channelId).trim(),
            roleId: String(p.recruit.roleId ?? r.roleId).trim(),
            formUrl: String(p.recruit.formUrl ?? r.formUrl).trim(),
            bannerUrl: String(p.recruit.bannerUrl ?? r.bannerUrl).trim(),
            textOpen: String(p.recruit.textOpen ?? r.textOpen).slice(0, 2000),
            textClosed: String(p.recruit.textClosed ?? r.textClosed).slice(0, 2000),
            open: r.open,
            messageId: r.messageId,
          };
        }
        if (p.botStatus && typeof p.botStatus === 'object') {
          patch.botStatus = {
            text: String(p.botStatus.text || '').slice(0, 120),
            type: ['custom', 'playing', 'watching', 'listening'].includes(p.botStatus.type)
              ? p.botStatus.type
              : 'custom',
          };
        }
        if (Array.isArray(p.categoryRoles)) {
          patch.categoryRoles = p.categoryRoles
            .map((r) => ({
              category: String(r.category || '').trim(),
              roleId: String(r.roleId || '').trim(),
            }))
            .filter((r) => r.category && r.roleId)
            .slice(0, 40);
        }
        updateSettings(patch);
        if (patch.botStatus) applyBotStatus();
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

      /* ---- statut de présence (présent / occupé / absent / inactif) ---- */
      if (msg.type === 'set_status') {
        const s = String(msg.status || 'online');
        if (['online', 'busy', 'away', 'idle'].includes(s)) {
          entry.status = s;
          broadcastPresence();
        }
        return;
      }

      /* ---- annonce dans le salon annonces ---- */
      if (msg.type === 'announce') {
        if (!entry.canModerate) {
          send(entry, { type: 'announced', ok: false, error: 'forbidden' });
          return;
        }
        const text = String(msg.text || '').trim();
        if (!text) {
          send(entry, { type: 'announced', ok: false, error: 'vide' });
          return;
        }
        try {
          await postAnnouncement(text, session.name);
          send(entry, { type: 'announced', ok: true });
        } catch (e) {
          send(entry, { type: 'announced', ok: false, error: String(e?.message || e) });
        }
        return;
      }

      /* ---- journal des connexions (owner uniquement) ---- */
      if (msg.type === 'get_logins') {
        if (!entry.isOwner) return;
        send(entry, { type: 'logins', list: listFirstSeen(), online: onlineUids() });
        return;
      }

      /* ---- sanctions staff (3 = plus d'accès au site) ---- */
      if (msg.type === 'get_sanctions') {
        if (!entry.canModerate) return;
        send(entry, { type: 'sanctions', list: listSanctions() });
        return;
      }
      if (msg.type === 'sanction_add') {
        if (!entry.canModerate) {
          send(entry, { type: 'sanctions', list: [], error: 'forbidden' });
          return;
        }
        const targetId = String(msg.targetId || '').trim();
        const targetName = String(msg.targetName || targetId).trim();
        const reason = String(msg.reason || '').trim();
        if (!targetId) return;
        addSanction(targetId, targetName, reason, session.uid, session.name);
        const count = activeSanctionCount(targetId);
        postSanction({ targetId, targetName, reason, byName: session.name, count });
        // 3 sanctions actives -> on éjecte ses sockets
        if (count >= 3) {
          for (const c of [...clients]) {
            if (c.session.uid === targetId) {
              send(c, { type: 'kicked', reason: 'sanctioned' });
              c.socket.close();
              clients.delete(c);
            }
          }
          broadcastPresence();
        }
        for (const c of clients) {
          if (c.canModerate) send(c, { type: 'sanctions', list: listSanctions() });
        }
        return;
      }
      if (msg.type === 'sanction_del') {
        if (!entry.canModerate) return;
        removeSanction(msg.id | 0);
        for (const c of clients) {
          if (c.canModerate) send(c, { type: 'sanctions', list: listSanctions() });
        }
        return;
      }

      /* ---- publier le panneau « Contacter le support » ---- */
      if (msg.type === 'publish_panel') {
        if (!entry.isOwner) {
          send(entry, { type: 'panel_published', ok: false, error: 'forbidden' });
          return;
        }
        try {
          const r = await publishSupportPanel();
          send(entry, { type: 'panel_published', ok: true, ...r });
        } catch (e) {
          send(entry, { type: 'panel_published', ok: false, error: String(e?.message || e) });
        }
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

      /* ---- suggestions ---- */
      if (msg.type === 'suggest') {
        const text = String(msg.text || '').trim();
        if (!text) return;
        addSuggestion(session.name, text);
        for (const c of clients) {
          if (c.isOwner) send(c, { type: 'suggestions', list: listSuggestions() });
        }
        send(entry, { type: 'suggest_ok' });
        return;
      }
      if (msg.type === 'get_suggestions') {
        if (!entry.isOwner) return;
        send(entry, { type: 'suggestions', list: listSuggestions() });
        return;
      }
      if (msg.type === 'suggestion_done' || msg.type === 'suggestion_del') {
        if (!entry.isOwner) return;
        if (msg.type === 'suggestion_del') deleteSuggestion(msg.id | 0);
        else setSuggestionDone(msg.id | 0, !!msg.done);
        for (const c of clients) {
          if (c.isOwner) send(c, { type: 'suggestions', list: listSuggestions() });
        }
        return;
      }

      /* ---- signalements (bugs / problèmes) ---- */
      if (msg.type === 'report') {
        const text = String(msg.text || '').trim();
        if (!text) return;
        addReport(session.uid, session.name, text, msg.kind);
        postReport({ byName: session.name, kind: msg.kind, text });
        for (const c of clients) {
          if (c.canModerate) send(c, { type: 'reports', list: listReports() });
        }
        send(entry, { type: 'report_ok' });
        return;
      }
      if (msg.type === 'get_reports') {
        if (!entry.canModerate) return;
        send(entry, { type: 'reports', list: listReports() });
        return;
      }
      if (msg.type === 'report_done' || msg.type === 'report_del') {
        if (!entry.canModerate) return;
        if (msg.type === 'report_del') deleteReport(msg.id | 0);
        else setReportDone(msg.id | 0, !!msg.done);
        for (const c of clients) {
          if (c.canModerate) send(c, { type: 'reports', list: listReports() });
        }
        return;
      }

      /* ---- guide de bienvenue (lu) ---- */
      if (msg.type === 'onboarding_done') {
        setOnboarded(session.uid);
        return;
      }
      if (msg.type === 'onboarding_reset') {
        resetOnboarded(session.uid); // pour soi-même : revoir le guide
        send(entry, { type: 'show_onboarding' });
        return;
      }

      /* ---- convocations (tout le staff) ---- */
      if (msg.type === 'convoke') {
        const targetId = String(msg.targetId || '').trim();
        const text = String(msg.text || '').trim();
        if (!targetId) {
          send(entry, { type: 'convoke_result', ok: false, error: 'cible manquante' });
          return;
        }
        const now = Date.now();
        entry.convo = (entry.convo || []).filter((t) => now - t < 60000);
        if (entry.convo.length >= 10) {
          send(entry, { type: 'convoke_result', ok: false, error: 'trop_rapide' });
          return;
        }
        entry.convo.push(now);
        const { isStaff } = await getStaffMember(session.uid);
        if (!isStaff) {
          send(entry, { type: 'kicked', reason: 'role_removed' });
          socket.close();
          return;
        }
        try {
          await postConvocation({
            targetId,
            targetName: String(msg.targetName || targetId),
            byName: session.name,
            reason: msg.reason,
            when: msg.when,
            text,
          });
          addConvocation(targetId, msg.targetName, session.uid, session.name, msg.reason, msg.when, text);
          send(entry, { type: 'convoke_result', ok: true });
          broadcastAll({ type: 'convocations', list: listConvocations() });
        } catch (err) {
          send(entry, {
            type: 'convoke_result',
            ok: false,
            error: /cannot send messages to this user/i.test(String(err?.message))
              ? 'mp_fermes'
              : String(err?.message || err),
          });
        }
        return;
      }
      if (msg.type === 'get_convocations') {
        send(entry, { type: 'convocations', list: listConvocations() });
        return;
      }

      /* ---- panneaux « Reprise » (owner + grade max) ---- */
      if (msg.type === 'get_panels') {
        if (!entry.canModerate) return;
        send(entry, { type: 'panels', list: listPanels() });
        return;
      }
      if (msg.type === 'save_panel') {
        if (!entry.canModerate) return;
        const saved = upsertPanel(msg.panel || {});
        for (const c of clients) if (c.canModerate) send(c, { type: 'panels', list: listPanels() });
        send(entry, { type: 'panel_saved', ok: true, id: saved.id });
        return;
      }
      if (msg.type === 'delete_panel') {
        if (!entry.canModerate) return;
        deletePanel(msg.id | 0);
        for (const c of clients) if (c.canModerate) send(c, { type: 'panels', list: listPanels() });
        return;
      }
      if (msg.type === 'publish_reprise') {
        if (!entry.canModerate) return;
        try {
          const r = await publishReprisePanel(msg.id | 0);
          for (const c of clients) if (c.canModerate) send(c, { type: 'panels', list: listPanels() });
          send(entry, { type: 'reprise_published', ok: true, ...r });
        } catch (e) {
          send(entry, { type: 'reprise_published', ok: false, error: String(e?.message || e) });
        }
        return;
      }

      /* ---- boutique (owner + grade max) ---- */
      if (msg.type === 'shop_announce') {
        if (!entry.canModerate) {
          send(entry, { type: 'shop_result', ok: false, error: 'forbidden' });
          return;
        }
        try {
          await postShopAnnounce({
            title: String(msg.title || '').slice(0, 240),
            text: String(msg.text || '').slice(0, 3500),
            bannerUrl: String(msg.bannerUrl || '').trim(),
            linkUrl: String(msg.linkUrl || '').trim(),
            linkLabel: String(msg.linkLabel || '').slice(0, 60),
          });
          send(entry, { type: 'shop_result', ok: true });
        } catch (e) {
          send(entry, { type: 'shop_result', ok: false, error: String(e?.message || e) });
        }
        return;
      }

      /* ---- recrutement staff (owner + grade max) ---- */
      if (msg.type === 'recruit_toggle') {
        if (!entry.canModerate) return;
        setRecruit({ open: !!msg.open });
        try {
          const r = await publishRecruit();
          send(entry, { type: 'recruit_state', ...effectiveRecruit(), published: true, ...r });
        } catch (e) {
          send(entry, { type: 'recruit_state', ...effectiveRecruit(), published: false, error: String(e?.message || e) });
        }
        return;
      }
      if (msg.type === 'get_recruit') {
        if (!entry.canModerate) return;
        send(entry, { type: 'recruit_state', ...effectiveRecruit() });
        return;
      }

      /* ---- webhooks entrants (owner) ---- */
      if (msg.type === 'get_hooks') {
        if (!entry.isOwner) return;
        send(entry, { type: 'hooks', list: listHooks() });
        return;
      }
      if (msg.type === 'add_hook') {
        if (!entry.isOwner) return;
        addHook(msg.kind, msg.channelId, msg.label);
        send(entry, { type: 'hooks', list: listHooks() });
        return;
      }
      if (msg.type === 'del_hook') {
        if (!entry.isOwner) return;
        deleteHook(msg.id | 0);
        send(entry, { type: 'hooks', list: listHooks() });
        return;
      }

      /* ---- annuaire des membres du serveur ---- */
      if (msg.type === 'members') {
        send(entry, { type: 'members', q: msg.q || '', ...searchMembers(msg.q) });
        return;
      }
      if (msg.type === 'dm_member') {
        const text = String(msg.text || '').trim().slice(0, 1800);
        if (!msg.userId || !text) {
          send(entry, { type: 'dm_member_result', ok: false, error: 'vide' });
          return;
        }
        const now = Date.now();
        entry.convo = (entry.convo || []).filter((t) => now - t < 60000);
        if (entry.convo.length >= 15) {
          send(entry, { type: 'dm_member_result', ok: false, error: 'trop_rapide' });
          return;
        }
        entry.convo.push(now);
        const { isStaff } = await getStaffMember(session.uid);
        if (!isStaff) {
          send(entry, { type: 'kicked', reason: 'role_removed' });
          socket.close();
          return;
        }
        try {
          await sendConvocation(msg.userId, text, session.name);
          send(entry, { type: 'dm_member_result', ok: true, userId: msg.userId });
        } catch (err) {
          send(entry, {
            type: 'dm_member_result',
            ok: false,
            error: /cannot send messages to this user/i.test(String(err?.message))
              ? 'mp_fermes'
              : String(err?.message || err),
          });
        }
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
          setTicketAssignee(msg.userId, session.uid, session.name, entry.level);
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
        const prevCat = getTicket(msg.userId)?.category || null;
        setTicketCategory(msg.userId, cat);
        pushTickets();
        // notifier le responsable de la catégorie
        if (cat && cat !== prevCat) {
          const roleId = roleForCategory(cat);
          if (roleId) {
            const t = getTicket(msg.userId);
            const label = t?.title || t?.username || 'un client';
            const sys = addMessage(
              msg.userId,
              'system',
              'Système',
              `Ticket classé dans « ${cat} » par ${session.name} — responsables notifiés`,
            );
            broadcastTicket(msg.userId, { type: 'message', message: sys });
            for (const c of clients) {
              if (c.ready && c.roleIds.includes(roleId)) {
                send(c, {
                  type: 'category_assigned',
                  userId: msg.userId,
                  category: cat,
                  ticketName: label,
                  by: session.name,
                });
              }
            }
            pingRoleInChannel(
              roleId,
              `📂 ticket de **${label}** classé dans **${cat}** par **${session.name}**`,
            );
          }
        }
        return;
      }

      /* ---- prendre / lâcher un ticket ---- */
      if (msg.type === 'assign') {
        if (!msg.userId || !canSee(entry, msg.userId)) return;
        const at0 = getTicket(msg.userId);
        // un grade inférieur ne peut pas retirer le ticket à un grade supérieur
        if (
          msg.take &&
          at0?.assignee_id &&
          at0.assignee_id !== session.uid &&
          (at0.assignee_level || 1) > entry.level
        ) {
          send(entry, {
            type: 'error',
            reason: 'assignee_higher',
            userId: msg.userId,
          });
          return;
        }
        if (msg.take) setTicketAssignee(msg.userId, session.uid, session.name, entry.level);
        else setTicketAssignee(msg.userId, null, null, null);
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
        if (msg.type === 'close') {
          // un ticket fermé est relâché : plus personne ne "l'a pris"
          if (getTicket(msg.userId)?.assignee_id) {
            setTicketAssignee(msg.userId, null, null, null);
          }
          const tpl = effectiveCloseMessage();
          if (tpl) {
            const tk = getTicket(msg.userId);
            const text = tpl.replace(/\{name\}/g, tk?.username || '');
            sendDM(msg.userId, text).catch(() => {});
            const sys = addMessage(msg.userId, 'system', 'Message auto', text);
            broadcastTicket(msg.userId, { type: 'message', message: sys });
          }
          sendRatingRequest(msg.userId).catch(() => {});
        }
        pushTickets();
        return;
      }
    });

    socket.on('close', () => { clients.delete(entry); broadcastPresence(); pushLoginsToOwners(); });
    socket.on('error', () => { clients.delete(entry); broadcastPresence(); pushLoginsToOwners(); });
  });

  // Re-vérification périodique : rôle + niveau.
  setInterval(
    async () => {
      let changed = false;
      for (const c of [...clients]) {
        const { isStaff, level, roleIds, roleName } = await getStaffMember(c.session.uid);
        if (!isStaff || isStaffBanned(c.session.uid)) {
          if (c.socket.readyState === 1) {
            send(c, { type: 'kicked', reason: isStaff ? 'sanctioned' : 'role_removed' });
            c.socket.close();
          }
          clients.delete(c);
          changed = true;
          continue;
        }
        const rolesChanged = (roleIds || []).join(',') !== c.roleIds.join(',');
        const roleNameChanged = (roleName || null) !== (c.roleName || null);
        if (rolesChanged) c.roleIds = roleIds || [];
        if (roleNameChanged) c.roleName = roleName || null;
        if (level !== c.level || rolesChanged || roleNameChanged) {
          c.level = level;
          c.canModerate = c.isOwner || level >= maxLevel;
          updatePushSubLevel(c.session.uid, level);
          send(c, {
            type: 'hello',
            uid: c.session.uid,
            name: c.session.name,
            level,
            levelLabel: levelName(level),
            roleName: c.roleName,
            canModerate: c.canModerate,
            tiers: config.staffTiers.map((t) => t.name),
            maxLevel,
            blacklist: getBlacklist(),
            vapidPublic: vapidPublicKey(),
            roles: c.roleIds,
            assignRoles: effectiveAssignRoles(),
            slaMinutes: effectiveSla(),
            appearance: getUserTheme(c.session.uid),
            onboarded: isOnboarded(c.session.uid),
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
      sendRatingRequest(t.user_id).catch(() => {});
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
