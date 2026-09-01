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

let data = { tickets: {}, messages: {}, seq: 0, blacklist: [], pushSubs: [], settings: {} };
if (existsSync(FILE)) {
  try {
    data = JSON.parse(readFileSync(FILE, 'utf8'));
    data.tickets ||= {};
    data.messages ||= {};
    data.seq ||= 0;
    data.blacklist ||= [];
    data.pushSubs ||= [];
    data.settings ||= {};
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

export function setTicketAssignee(userId, id, name) {
  const t = data.tickets[userId];
  if (t) {
    t.assignee_id = id || null;
    t.assignee_name = name || null;
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
    staffChannelId: data.settings.staffChannelId ?? null,
    staffPingRoleId: data.settings.staffPingRoleId ?? null,
    theme: data.settings.theme || null,
    assignRoles: data.settings.assignRoles || null,
    slaMinutes: data.settings.slaMinutes ?? null,
    askCategory: data.settings.askCategory !== false,
    autoClose: effectiveAutoClose(),
    flood: effectiveFlood(),
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
// tickets ouverts en attente client, dernière réponse staff plus vieille que `hours`
export function staleTickets(hours) {
  const cut = Date.now() - hours * 3600000;
  return Object.values(data.tickets).filter(
    (t) => t.status !== 'closed' && t.waiting === 'client' && (t.last_staff_at || 0) < cut,
  );
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
  return null;
}

export function getMemberProfile(userId) {
  const t = data.tickets[userId];
  if (!t) return null;
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

// Statistiques agrégées (limitées aux tickets visibles au niveau donné).
export function getStats(maxLevel = Infinity) {
  const now = Date.now();
  const tk = Object.values(data.tickets).filter(
    (t) => (t.escalation_level || 1) <= maxLevel,
  );
  const total = tk.length;
  const open = tk.filter((t) => t.status !== 'closed').length;
  const unassigned = tk.filter(
    (t) => t.status !== 'closed' && !t.assignee_id,
  ).length;

  const byCategory = {};
  for (const t of tk) {
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
  for (const t of tk) {
    const key = new Date(t.created_at).toISOString().slice(0, 10);
    if (idx.has(key)) perDay[idx.get(key)].count++;
  }

  let respSum = 0;
  let respN = 0;
  const byStaff = {};
  for (const t of tk) {
    const msgs = data.messages[t.user_id] || [];
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
