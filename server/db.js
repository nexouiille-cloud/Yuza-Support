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

let data = { tickets: {}, messages: {}, seq: 0, blacklist: [], pushSubs: [] };
if (existsSync(FILE)) {
  try {
    data = JSON.parse(readFileSync(FILE, 'utf8'));
    data.tickets ||= {};
    data.messages ||= {};
    data.seq ||= 0;
    data.blacklist ||= [];
    data.pushSubs ||= [];
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
  const msg = {
    id: ++data.seq,
    user_id: userId,
    author, // 'client' | 'staff' | 'system'
    author_name: authorName,
    content,
    attachments: Array.isArray(attachments) ? attachments : [],
    created_at: Date.now(),
  };
  (data.messages[userId] ||= []).push(msg);
  save();
  return msg;
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
