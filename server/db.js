// Stockage simple sur fichier JSON (aucune dépendance native).
// Suffisant pour un système de tickets ; migrable vers SQLite plus tard.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DATA_DIR permet de placer les données sur un disque persistant (Railway, etc.)
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');
const FILE = join(DATA_DIR, 'data.json');

let data = { tickets: {}, messages: {}, seq: 0, blacklist: [], pushSubs: [], settings: {}, suggestions: [], userThemes: {}, sanctions: [], firstSeen: {}, reports: [], onboarded: {}, archive: [] };
if (existsSync(FILE)) {
  try {
    data = JSON.parse(readFileSync(FILE, 'utf8'));
    data.tickets ||= {};
    data.messages ||= {};
    data.seq ||= 0;
    data.blacklist ||= [];
    data.pushSubs ||= [];
    data.settings ||= {};
    data.suggestions ||= [];
    data.userThemes ||= {};
    data.sanctions ||= [];
    data.firstSeen ||= {};
    data.reports ||= [];
    data.onboarded ||= {};
    data.archive ||= [];
  } catch (e) {
    console.error('[db] data.json illisible, on repart de zéro:', e.message);
  }
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      writeFileSync(FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[db] échec sauvegarde:', e.message);
    }
  }, 200);
}

export function getTicket(userId) {
  return data.tickets[userId] || null;
}

export function upsertTicket(userId, username, preview) {
  const now = Date.now();
  const t = data.tickets[userId];
  let created = false;
  let reopened = false;
  if (t) {
    t.username = username || t.username;
    t.updated_at = now;
    if (preview != null) t.last_preview = preview;
    if (t.status === 'closed') {
      t.status = 'open';
      reopened = true;
    }
  } else {
    created = true;
    data.tickets[userId] = {
      user_id: userId,
      username: username || 'client',
      title: null,
      priority: 'normal',
      status: 'open',
      category: null,
      escalation_level: 1,
      assignee_id: null,
      assignee_name: null,
      assignee_level: null,
      waiting: 'staff',
      last_client_at: now,
      last_staff_at: null,
      requested_role: null,
      auto_warned: false,
      created_at: now,
      updated_at: now,
      last_preview: preview ?? '',
    };
  }
  save();
  return { created, reopened };
}

// Archive un ticket clôturé : on le sort de la liste active (avec ses messages)
// pour que le prochain MP du client crée un ticket NEUF. L'historique est gardé.
export function archiveTicket(userId) {
  const t = data.tickets[userId];
  if (!t) return null;
  const entry = {
    id: ++data.seq,
    user_id: String(userId),
    username: t.username,
    title: t.title || null,
    category: t.category || null,
    priority: t.priority || 'normal',
    escalation_level: t.escalation_level || 1,
    assignee_name: t.assignee_name || null,
    created_at: t.created_at,
    closed_at: Date.now(),
    messages: data.messages[userId] || [],
  };
  data.archive.push(entry);
  if (data.archive.length > 3000) data.archive = data.archive.slice(-3000);
  delete data.tickets[userId];
  delete data.messages[userId];
  save();
  return entry;
}
export function getArchivedFor(userId) {
  const id = String(userId);
  return data.archive
    .filter((a) => a.user_id === id)
    .sort((a, b) => b.closed_at - a.closed_at)
    .map((a) => ({
      id: a.id,
      username: a.username,
      title: a.title,
      category: a.category,
      created_at: a.created_at,
      closed_at: a.closed_at,
      messages_total: (a.messages || []).length,
    }));
}
export function getArchivedById(id) {
  return data.archive.find((a) => a.id === (id | 0)) || null;
}

export function setTicketAssignee(userId, id, name, level) {
  const t = data.tickets[userId];
  if (t) {
    t.assignee_id = id || null;
    t.assignee_name = name || null;
    t.assignee_level = id ? level || 1 : null;
    t.updated_at = Date.now();
    save();
  }
}

export function setTicketEscalation(userId, level) {
  const t = data.tickets[userId];
  if (t) {
    t.escalation_level = Math.max(1, level | 0);
    t.updated_at = Date.now();
    save();
  }
}

export function setTicketTitle(userId, title) {
  const t = data.tickets[userId];
  if (t) {
    t.title = title ? String(title).slice(0, 80) : null;
    t.updated_at = Date.now();
    save();
  }
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export function setTicketPriority(userId, p) {
  const t = data.tickets[userId];
  if (t && PRIORITIES.includes(p)) {
    t.priority = p;
    t.updated_at = Date.now();
    save();
  }
}

export function setTicketCategory(userId, category) {
  const t = data.tickets[userId];
  if (t) {
    t.category = category || null;
    t.updated_at = Date.now();
    save();
  }
}

export function setTicketStatus(userId, status) {
  const t = data.tickets[userId];
  if (t) {
    t.status = status;
    t.updated_at = Date.now();
    save();
  }
}

export function addMessage(userId, author, authorName, content, attachments = []) {
  const now = Date.now();
  const msg = {
    id: ++data.seq,
    user_id: userId,
    author, // 'client' | 'staff' | 'note' | 'system'
    author_name: authorName,
    content,
    attachments: Array.isArray(attachments) ? attachments : [],
    created_at: now,
  };
  (data.messages[userId] ||= []).push(msg);
  // suivi de l'attente (client / staff)
  const t = data.tickets[userId];
  if (t) {
    if (author === 'client') {
      t.last_client_at = now;
      t.waiting = 'staff';
      t.auto_warned = false;
    } else if (author === 'staff') {
      t.last_staff_at = now;
      t.waiting = 'client';
    }
  }
  save();
  return msg;
}

export function setRequestedRole(userId, obj) {
  const t = data.tickets[userId];
  if (t) {
    t.requested_role = obj || null;
    t.updated_at = Date.now();
    save();
  }
}

/* ---------------- réglages (surchargent .env / fichiers) ---------------- */
export function getSettings() {
  return {
    categories: data.settings.categories || null,
    welcome: data.settings.welcome || null,
    closeMessage: data.settings.closeMessage || null,
    staffChannelId: data.settings.staffChannelId ?? null,
    staffPingRoleId: data.settings.staffPingRoleId ?? null,
    theme: data.settings.theme || null,
    assignRoles: data.settings.assignRoles || null,
    slaMinutes: data.settings.slaMinutes ?? null,
    askCategory: data.settings.askCategory !== false,
    autoClose: effectiveAutoClose(),
    flood: effectiveFlood(),
    panel: effectivePanel(),
    askRating: data.settings.askRating !== false,
    announceChannelId: data.settings.announceChannelId ?? null,
    sanctionChannelId: data.settings.sanctionChannelId ?? null,
    reportChannelId: data.settings.reportChannelId ?? null,
    categoryRoles: effectiveCategoryRoles(),
  };
}
export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  save();
  return getSettings();
}
export function effectiveCategories() {
  const c = data.settings.categories;
  return Array.isArray(c) && c.length ? c : config.categories;
}
export function effectiveWelcome() {
  const s = data.settings.welcome;
  if (s && typeof s.text === 'string') {
    if (s.enabled === false) return null;
    return s.text.trim() || null;
  }
  return config.welcomeMessage;
}
export function effectiveCloseMessage() {
  const s = data.settings.closeMessage;
  if (s && typeof s.text === 'string') {
    if (s.enabled === false) return null;
    return s.text.trim() || null;
  }
  return 'Ton ticket vient d\'être clôturé. Merci de nous avoir contactés — écris-nous à nouveau si tu as besoin. ✅';
}
export function effectiveStaffChannel() {
  const v = data.settings.staffChannelId;
  return (v == null ? config.staffChannelId : v) || '';
}
export function effectiveStaffPingRole() {
  const v = data.settings.staffPingRoleId;
  return (v == null ? config.staffPingRoleId : v) || config.staffRoleIds[0] || '';
}
export function effectiveTheme() {
  const t = data.settings.theme || {};
  return {
    appName: (t.appName || 'Volt Support').slice(0, 40),
    accent: /^#[0-9a-fA-F]{6}$/.test(t.accent || '') ? t.accent : '#ff9d00',
    bg: /^#[0-9a-fA-F]{6}$/.test(t.bg || '') ? t.bg : '#0a0a0c',
  };
}
export function effectiveAssignRoles() {
  const a = data.settings.assignRoles;
  return Array.isArray(a)
    ? a
        .map((r) => ({ name: String(r.name || '').slice(0, 40), roleId: String(r.roleId || '').trim() }))
        .filter((r) => r.name)
    : [];
}
export function effectiveSla() {
  const n = Number(data.settings.slaMinutes);
  return Number.isFinite(n) && n > 0 ? n : 15;
}
export function effectiveAskCategory() {
  return data.settings.askCategory !== false; // défaut : oui
}
export function effectiveAutoClose() {
  const a = data.settings.autoClose || {};
  return {
    enabled: !!a.enabled,
    warnHours: Number(a.warnHours) > 0 ? Number(a.warnHours) : 48,
    closeHours: Number(a.closeHours) > 0 ? Number(a.closeHours) : 72,
  };
}
export function effectiveFlood() {
  const f = data.settings.flood || {};
  return {
    enabled: f.enabled !== false, // défaut : oui
    count: Number(f.count) > 0 ? Number(f.count) : 8,
    windowSec: Number(f.windowSec) > 0 ? Number(f.windowSec) : 15,
    muteMin: Number(f.muteMin) > 0 ? Number(f.muteMin) : 10,
  };
}

export function markAutoWarned(userId) {
  const t = data.tickets[userId];
  if (t) { t.auto_warned = true; save(); }
}

/* ---------------- panneau « Contacter le support » ---------------- */
export function effectivePanel() {
  const p = data.settings.panel || {};
  return {
    title: (p.title || "Besoin d'aide ?").slice(0, 200),
    description: (
      p.description ||
      'Clique sur le bouton ci-dessous pour ouvrir un ticket. Un membre du staff te répondra en message privé.'
    ).slice(0, 1500),
    buttonLabel: (p.buttonLabel || '🎫 Ouvrir un ticket').slice(0, 70),
    channelId: String(p.channelId || '').trim(),
    messageId: String(p.messageId || '').trim(),
  };
}
export function setPanelMessageId(id) {
  data.settings.panel = { ...(data.settings.panel || {}), messageId: id ? String(id) : '' };
  save();
}

/* ---------------- salons annonces / sanctions ---------------- */
export function effectiveAnnounceChannel() {
  return String(data.settings.announceChannelId || '').trim();
}
export function effectiveSanctionChannel() {
  return String(data.settings.sanctionChannelId || '').trim();
}
export function effectiveReportChannel() {
  return String(data.settings.reportChannelId || '').trim();
}
// responsables par catégorie : [{category, roleId}]
export function effectiveCategoryRoles() {
  const a = data.settings.categoryRoles;
  const cats = effectiveCategories();
  return Array.isArray(a)
    ? a
        .map((r) => ({
          category: String(r.category || '').trim(),
          roleId: String(r.roleId || '').trim(),
        }))
        .filter((r) => r.category && r.roleId && cats.includes(r.category))
    : [];
}
export function roleForCategory(category) {
  return effectiveCategoryRoles().find((r) => r.category === category)?.roleId || '';
}

/* ---------------- signalements (bugs / problèmes) ---------------- */
export function addReport(byId, byName, text, kind) {
  const r = {
    id: ++data.seq,
    by: String(byName || ''),
    byId: String(byId || ''),
    kind: kind === 'bug' ? 'bug' : 'autre',
    text: String(text).slice(0, 1500),
    at: Date.now(),
    done: false,
  };
  data.reports.push(r);
  save();
  return r;
}
export function listReports() {
  return [...data.reports].sort((a, b) => a.done - b.done || b.at - a.at);
}
export function setReportDone(id, done) {
  const r = data.reports.find((x) => x.id === (id | 0));
  if (r) { r.done = !!done; save(); }
}
export function deleteReport(id) {
  const i = data.reports.findIndex((x) => x.id === (id | 0));
  if (i !== -1) { data.reports.splice(i, 1); save(); }
}

/* ---------------- guide de bienvenue (lu / pas lu) ---------------- */
export function isOnboarded(uid) {
  return !!data.onboarded[String(uid)];
}
export function setOnboarded(uid) {
  data.onboarded[String(uid)] = Date.now();
  save();
}
export function resetOnboarded(uid) {
  delete data.onboarded[String(uid)];
  save();
}

/* ---------------- 1re connexion au site de chaque personne (owner) ---------------- */
// Enregistré UNE fois, à la toute première connexion, et gardé pour toujours.
// Les connexions suivantes ne font que rafraîchir le pseudo / la dernière visite.
export function recordLogin(uid, name, roleName) {
  const id = String(uid);
  const now = Date.now();
  const e = data.firstSeen[id];
  if (e) {
    e.name = name; // on garde le pseudo Discord à jour
    e.roleName = roleName || null;
    e.lastAt = now;
  } else {
    data.firstSeen[id] = {
      uid: id,
      name,
      roleName: roleName || null,
      firstAt: now, // ← jamais modifié
      lastAt: now,
    };
  }
  save();
}
// triés : première connexion la plus récente en haut
export function listFirstSeen() {
  return Object.values(data.firstSeen).sort((a, b) => b.firstAt - a.firstAt);
}

/* ---------------- sanctions staff (3 = plus d'accès) ---------------- */
export function addSanction(targetId, targetName, reason, by, byName) {
  const s = {
    id: ++data.seq,
    targetId: String(targetId),
    targetName: String(targetName || targetId),
    reason: String(reason || '').slice(0, 500),
    by: String(by || ''),
    byName: String(byName || ''),
    at: Date.now(),
    active: true,
  };
  data.sanctions.push(s);
  save();
  return s;
}
export function listSanctions() {
  return [...data.sanctions].sort((a, b) => b.at - a.at);
}
export function removeSanction(id) {
  const s = data.sanctions.find((x) => x.id === (id | 0));
  if (s) { s.active = false; save(); }
}
export function activeSanctionCount(targetId) {
  const id = String(targetId);
  return data.sanctions.filter((s) => s.active && s.targetId === id).length;
}
export function isStaffBanned(targetId) {
  return activeSanctionCount(targetId) >= 3;
}

/* ---------------- note de satisfaction ---------------- */
export function effectiveAskRating() {
  return data.settings.askRating !== false; // défaut : oui
}
export function setTicketRating(userId, rating) {
  const t = data.tickets[userId];
  if (!t) return null;
  const n = Math.max(1, Math.min(5, rating | 0));
  if (!n) return null;
  t.rating = n;
  t.rated_staff = t.assignee_name || null;
  t.rated_at = Date.now();
  t.updated_at = Date.now();
  save();
  return t;
}
// tickets ouverts en attente client, dernière réponse staff plus vieille que `hours`
export function staleTickets(hours) {
  const cut = Date.now() - hours * 3600000;
  return Object.values(data.tickets).filter(
    (t) => t.status !== 'closed' && t.waiting === 'client' && (t.last_staff_at || 0) < cut,
  );
}

/* ---------------- suggestions ---------------- */
export function addSuggestion(by, text) {
  const s = { id: ++data.seq, by, text: String(text).slice(0, 800), at: Date.now(), done: false };
  data.suggestions.push(s);
  save();
  return s;
}
export function listSuggestions() {
  return [...data.suggestions].sort((a, b) => (a.done - b.done) || b.at - a.at);
}
export function setSuggestionDone(id, done) {
  const s = data.suggestions.find((x) => x.id === id);
  if (s) { s.done = !!done; save(); }
}
export function deleteSuggestion(id) {
  const i = data.suggestions.findIndex((x) => x.id === id);
  if (i !== -1) { data.suggestions.splice(i, 1); save(); }
}

/* ---------------- apparence personnelle (par staff) ---------------- */
// Chaque staff choisit son propre thème ; visible par lui seul, sur tous ses appareils.
const APPEARANCE_PRESETS = ['nuit', 'ardoise', 'clair'];
export function getUserTheme(uid) {
  return data.userThemes[String(uid)] || null;
}
export function setUserTheme(uid, pref) {
  const id = String(uid);
  const preset = String(pref?.preset || 'default');
  const accent = /^#[0-9a-fA-F]{6}$/.test(pref?.accent || '') ? pref.accent : null;
  // "default" ou preset inconnu sans accent perso -> on efface (retour au thème serveur)
  if (!APPEARANCE_PRESETS.includes(preset) && !accent) {
    delete data.userThemes[id];
  } else {
    data.userThemes[id] = {
      preset: APPEARANCE_PRESETS.includes(preset) ? preset : 'default',
      accent,
    };
  }
  save();
  return data.userThemes[id] || null;
}

/* ---------------- charge par staff ---------------- */
export function workload() {
  const w = {};
  for (const t of Object.values(data.tickets)) {
    if (t.status === 'closed' || !t.assignee_name) continue;
    w[t.assignee_name] = (w[t.assignee_name] || 0) + 1;
  }
  return w;
}

/* ---------------- fiche membre ---------------- */
export function findTicketId(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  if (data.tickets[q]) return q; // ID exact
  for (const t of Object.values(data.tickets)) {
    if (String(t.user_id) === q) return t.user_id;
    if ((t.username || '').toLowerCase().includes(q)) return t.user_id;
  }
  // pas de ticket en cours -> on cherche dans les archives
  for (const a of data.archive) {
    if (String(a.user_id) === q) return a.user_id;
    if ((a.username || '').toLowerCase().includes(q)) return a.user_id;
  }
  return null;
}

export function getMemberProfile(userId) {
  const t = data.tickets[userId];
  const past = getArchivedFor(userId);
  if (!t && !past.length) return null;

  // client qui n'a plus que des tickets archivés (pas de ticket en cours)
  if (!t) {
    const last = past[0];
    return {
      user_id: userId,
      username: last?.username || 'client',
      title: null,
      status: 'aucun ticket ouvert',
      category: null,
      priority: 'normal',
      escalation_level: 1,
      assignee_name: null,
      blacklisted: isBlacklisted(userId),
      first_at: last?.created_at || null,
      last_at: last?.closed_at || null,
      messages_total: 0,
      messages_client: 0,
      notes_count: 0,
      staff_replied: [],
      past_tickets: past,
    };
  }

  const msgs = data.messages[userId] || [];
  const staff = new Set();
  let notes = 0;
  let fromClient = 0;
  for (const m of msgs) {
    if (m.author === 'staff') staff.add(m.author_name.replace(/\s*\([^)]*\)\s*$/, '').trim());
    else if (m.author === 'note') notes++;
    else if (m.author === 'client') fromClient++;
  }
  return {
    user_id: userId,
    username: t.username,
    title: t.title || null,
    status: t.status,
    category: t.category || null,
    priority: t.priority || 'normal',
    escalation_level: t.escalation_level || 1,
    assignee_name: t.assignee_name || null,
    blacklisted: isBlacklisted(userId),
    first_at: t.created_at,
    last_at: t.updated_at,
    messages_total: msgs.length,
    messages_client: fromClient,
    notes_count: notes,
    staff_replied: [...staff],
    past_tickets: past,
  };
}

/* ---------------- blacklist ---------------- */
export function getBlacklist() {
  return [...new Set([...(config.blacklistSeed || []), ...data.blacklist])];
}
export function isBlacklisted(userId) {
  return getBlacklist().includes(String(userId));
}
export function setBlacklist(userId, on) {
  const id = String(userId);
  const i = data.blacklist.indexOf(id);
  if (on && i === -1) data.blacklist.push(id);
  else if (!on && i !== -1) data.blacklist.splice(i, 1);
  save();
}

/* ---------------- abonnements Web Push ---------------- */
export function listPushSubs() {
  return data.pushSubs;
}
export function addPushSub(uid, level, sub) {
  if (!sub || !sub.endpoint) return;
  const i = data.pushSubs.findIndex((r) => r.sub.endpoint === sub.endpoint);
  const rec = { uid, level, sub, ts: Date.now() };
  if (i === -1) data.pushSubs.push(rec);
  else data.pushSubs[i] = rec;
  save();
}
export function removePushSub(endpoint) {
  const i = data.pushSubs.findIndex((r) => r.sub.endpoint === endpoint);
  if (i !== -1) {
    data.pushSubs.splice(i, 1);
    save();
  }
}
export function updatePushSubLevel(uid, level) {
  let changed = false;
  for (const r of data.pushSubs) {
    if (r.uid === uid && r.level !== level) {
      r.level = level;
      changed = true;
    }
  }
  if (changed) save();
}

export function listTickets() {
  return Object.values(data.tickets).sort((a, b) => b.updated_at - a.updated_at);
}

export function listMessages(userId, limit = 200) {
  const arr = data.messages[userId] || [];
  return arr.slice(-limit);
}

// Statistiques agrégées (tickets en cours + archivés, visibles au niveau donné).
export function getStats(maxLevel = Infinity) {
  const now = Date.now();
  const live = Object.values(data.tickets)
    .filter((t) => (t.escalation_level || 1) <= maxLevel)
    .map((t) => ({ t, msgs: data.messages[t.user_id] || [] }));
  const arch = data.archive
    .filter((a) => (a.escalation_level || 1) <= maxLevel)
    .map((a) => ({ t: { ...a, status: 'closed' }, msgs: a.messages || [] }));
  const recs = [...live, ...arch];

  const total = recs.length;
  const open = live.filter((r) => r.t.status !== 'closed').length;
  const unassigned = live.filter(
    (r) => r.t.status !== 'closed' && !r.t.assignee_id,
  ).length;

  const byCategory = {};
  for (const { t } of recs) {
    const k = t.category || 'Non trié';
    byCategory[k] = (byCategory[k] || 0) + 1;
  }

  const perDay = [];
  const idx = new Map();
  for (let i = 13; i >= 0; i--) {
    const key = new Date(now - i * 86400000).toISOString().slice(0, 10);
    idx.set(key, perDay.length);
    perDay.push({ date: key, count: 0 });
  }
  for (const { t } of recs) {
    const key = new Date(t.created_at).toISOString().slice(0, 10);
    if (idx.has(key)) perDay[idx.get(key)].count++;
  }

  let ratingSum = 0;
  let ratingN = 0;
  const ratingStaff = {}; // name -> { sum, n }
  for (const { t } of recs) {
    if (!t.rating) continue;
    ratingSum += t.rating;
    ratingN++;
    const s = t.rated_staff;
    if (s) {
      (ratingStaff[s] ||= { sum: 0, n: 0 });
      ratingStaff[s].sum += t.rating;
      ratingStaff[s].n++;
    }
  }

  let respSum = 0;
  let respN = 0;
  const byStaff = {};
  for (const { msgs } of recs) {
    const firstClient = msgs.find((m) => m.author === 'client');
    const firstStaff = msgs.find(
      (m) =>
        m.author === 'staff' &&
        (!firstClient || m.created_at >= firstClient.created_at),
    );
    if (firstClient && firstStaff) {
      respSum += firstStaff.created_at - firstClient.created_at;
      respN++;
    }
    for (const m of msgs) {
      if (m.author !== 'staff') continue;
      const name =
        m.author_name.replace(/\s*\([^)]*\)\s*$/, '').trim() || m.author_name;
      byStaff[name] = (byStaff[name] || 0) + 1;
    }
  }

  return {
    total,
    open,
    closed: total - open,
    unassigned,
    avgResponseMs: respN ? Math.round(respSum / respN) : null,
    byCategory,
    byStaff,
    perDay,
    workload: workload(),
    avgRating: ratingN ? Math.round((ratingSum / ratingN) * 10) / 10 : null,
    ratingCount: ratingN,
    ratingByStaff: Object.fromEntries(
      Object.entries(ratingStaff).map(([k, v]) => [
        k,
        { avg: Math.round((v.sum / v.n) * 10) / 10, n: v.n },
      ]),
    ),
  };
}

// Recherche : nom du client, ID, ou contenu d'un message (notes incluses).
export function searchTicketIds(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const ids = [];
  for (const t of Object.values(data.tickets)) {
    const inHeader =
      (t.username || '').toLowerCase().includes(q) ||
      String(t.user_id).includes(q) ||
      (t.last_preview || '').toLowerCase().includes(q);
    const inMessages =
      inHeader ||
      (data.messages[t.user_id] || []).some((m) =>
        (m.content || '').toLowerCase().includes(q),
      );
    if (inMessages) ids.push(t.user_id);
  }
  return ids;
}
