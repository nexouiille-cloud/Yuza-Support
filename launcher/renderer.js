const { login, getConfig, setServer, focus } = window.yuza;

let ws = null;
let apiBase = 'http://127.0.0.1:53134';
let sessionToken = null;
let current = null;

const tickets = new Map(); // userId -> ticket
const msgCache = new Map(); // userId -> [messages]

let filterMode = 'open';        // 'open' | 'closed' | 'all'
let searchQuery = '';           // texte de recherche courant
let searchIds = null;           // Set d'ids correspondants, ou null si pas de recherche
let categories = [];            // liste des catégories (venue du serveur)
const collapsedGroups = new Set(); // noms de catégories repliées dans la sidebar
const NONE = '__none__';

let myId = null;               // mon ID Discord
let myLevel = 1;               // mon niveau staff
let tiers = [];                // noms des niveaux au-dessus du support
let maxLvl = 1;                // niveau max possible

const levelName = (L) => (L <= 1 ? 'Support' : tiers[L - 2] || `Niveau ${L}`);

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

function setStatus(s) { $('#status').textContent = s; }

/* ---------------- notification bureau ---------------- */
function maybeNotify(m) {
  // pas de notif si on regarde déjà ce ticket avec la fenêtre au premier plan
  if (!document.hidden && m.userId === current) return;
  if (typeof Notification === 'undefined') return;
  const title = m.isNew
    ? '📩 Nouveau ticket'
    : m.reopened
      ? '📩 Ticket relancé'
      : '💬 Nouveau message';
  const body = `${m.name || 'Client'} : ${m.preview || ''}`.slice(0, 140);
  try {
    const n = new Notification(title, { body });
    n.onclick = () => {
      focus();
      openTicket(m.userId);
    };
  } catch {}
}

/* ---------------- login ---------------- */
// préremplit le champ "adresse du serveur"
(async () => {
  try {
    const cfg = await getConfig();
    if (cfg && cfg.api) $('#srv').value = cfg.api;
  } catch {}
})();

$('#loginBtn').addEventListener('click', async () => {
  $('#loginBtn').disabled = true;
  $('#loginMsg').textContent = 'Connexion…';

  const url = $('#srv').value.trim();
  if (url) {
    try {
      await setServer(url);
    } catch {}
  }

  $('#loginMsg').textContent = 'Fenêtre Discord ouverte…';
  const res = await login();
  if (!res.ok) {
    $('#loginBtn').disabled = false;
    $('#loginMsg').textContent =
      res.reason === 'not_staff'
        ? "Ce compte n'a pas de rôle staff sur le serveur."
        : `Connexion annulée (${res.reason}).`;
    return;
  }
  sessionToken = res.token;
  const cfg = await getConfig();
  apiBase = cfg.api || apiBase;
  connect();
});

/* ---------------- websocket ---------------- */
function connect() {
  const wsUrl =
    apiBase.replace(/^http/, 'ws') +
    '/gateway?token=' +
    encodeURIComponent(sessionToken);
  ws = new WebSocket(wsUrl);
  ws.onopen = () => setStatus('connecté');
  ws.onclose = () => setStatus('déconnecté — relance le launcher pour te reconnecter');
  ws.onerror = () => setStatus('erreur de connexion au serveur');
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}

function handle(m) {
  switch (m.type) {
    case 'hello':
      if (m.uid) myId = m.uid;
      myLevel = m.level || 1;
      tiers = Array.isArray(m.tiers) ? m.tiers : [];
      maxLvl = m.maxLevel || 1;
      $('#login').classList.add('hidden');
      $('#app').classList.add('on');
      setStatus(`connecté : ${m.name} · ${m.levelLabel || levelName(myLevel)}`);
      if (current) syncHeader();
      break;

    case 'kicked':
      $('#app').classList.remove('on');
      $('#login').classList.remove('hidden');
      $('#loginBtn').disabled = false;
      $('#loginMsg').textContent =
        'Ton rôle staff a été retiré : accès révoqué.';
      if (ws) ws.close();
      break;

    case 'error':
      setStatus(`session invalide (${m.reason}) — relance le launcher`);
      break;

    case 'categories':
      categories = Array.isArray(m.categories) ? m.categories : [];
      buildCatSelect();
      break;

    case 'tickets':
      tickets.clear();
      m.tickets.forEach((t) => tickets.set(t.user_id, t));
      if (current && !tickets.has(current)) {
        setStatus("Tu n'as plus accès à ce ticket (escaladé à un niveau supérieur).");
        closeTicketView();
      }
      renderSidebar();
      if (current) syncHeader();
      break;

    case 'denied':
      setStatus('Accès refusé à ce ticket.');
      if (m.userId === current) closeTicketView();
      break;

    case 'ticket_bump': {
      const t =
        tickets.get(m.userId) ||
        { user_id: m.userId, username: m.name, status: 'open' };
      t.username = m.name || t.username;
      t.last_preview = m.preview;
      t.updated_at = Date.now();
      if (!m.fromStaff) {
        t.status = 'open'; // un message client (r)ouvre le ticket
        if (m.userId !== current) t.unread = (t.unread || 0) + 1;
        maybeNotify(m);
      }
      tickets.set(m.userId, t);
      renderSidebar();
      break;
    }

    case 'search_results':
      if (m.q === searchQuery) {
        searchIds = searchQuery ? new Set(m.ids) : null;
        renderSidebar();
      }
      break;

    case 'messages':
      msgCache.set(m.userId, m.messages);
      if (m.userId === current) renderMessages();
      break;

    case 'message': {
      const uid = m.message.user_id;
      const arr = msgCache.get(uid) || [];
      arr.push(m.message);
      msgCache.set(uid, arr);
      if (uid === current) renderMessages();
      break;
    }

    case 'dm_failed':
      setStatus(
        "⚠ impossible d'envoyer le MP à ce client (il a peut-être fermé ses MP).",
      );
      break;
  }
}

/* ---------------- recherche + filtre ---------------- */
let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  clearTimeout(searchTimer);
  if (!searchQuery) {
    searchIds = null;
    renderSidebar();
    return;
  }
  searchTimer = setTimeout(() => {
    if (ws && ws.readyState === 1)
      ws.send(JSON.stringify({ type: 'search', q: searchQuery }));
  }, 250);
});
document.querySelectorAll('#filters button').forEach((b) => {
  b.addEventListener('click', () => {
    document
      .querySelectorAll('#filters button')
      .forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    filterMode = b.dataset.f;
    renderSidebar();
  });
});

/* ---------------- vue ticket ---------------- */
function closeTicketView() {
  current = null;
  $('#msgs').innerHTML =
    '<div class="placeholder">Sélectionne un ticket à gauche.</div>';
  $('#input').disabled = true;
  $('#sendBtn').disabled = true;
  syncHeader();
  renderSidebar();
}

/* ---------------- rendu sidebar (groupé par catégorie) ---------------- */
function ticketRow(t) {
  const el = document.createElement('div');
  const mine = t.assignee_id && t.assignee_id === myId;
  el.className =
    'tk' +
    (t.user_id === current ? ' active' : '') +
    (t.status === 'closed' ? ' closed' : '') +
    (t.assignee_id && !mine ? ' assigned-other' : '');
  el.innerHTML =
    `<div class="n"><span>${esc(t.username)}</span>` +
    `${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</div>` +
    `<div class="p">${esc(t.last_preview || '')}</div>` +
    (t.assignee_id
      ? `<div class="lock">🔒 ${mine ? 'toi' : esc(t.assignee_name || '?')}</div>`
      : '');
  el.addEventListener('click', () => openTicket(t.user_id));
  return el;
}

function renderSidebar() {
  let list = [...tickets.values()];
  if (filterMode === 'open') list = list.filter((t) => t.status !== 'closed');
  else if (filterMode === 'closed')
    list = list.filter((t) => t.status === 'closed');
  if (searchIds) list = list.filter((t) => searchIds.has(t.user_id));

  const box = $('#ticketList');
  box.innerHTML = '';
  if (!list.length) {
    const why = searchIds
      ? 'Aucun résultat.'
      : filterMode === 'closed'
        ? 'Aucun ticket clôturé.'
        : filterMode === 'open'
          ? 'Aucun ticket ouvert.'
          : "Aucun ticket pour l'instant.";
    box.innerHTML = `<div class="empty">${why}</div>`;
    return;
  }

  // regroupe : "Non trié" puis chaque catégorie connue, dans l'ordre défini
  const order = [NONE, ...categories];
  const groups = new Map(order.map((k) => [k, []]));
  for (const t of list) {
    const key =
      t.category && categories.includes(t.category) ? t.category : NONE;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  for (const key of groups.keys()) {
    const items = groups
      .get(key)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    if (!items.length) continue;

    const label = key === NONE ? 'Non trié' : key;
    const collapsed = collapsedGroups.has(key);
    const unread = items.reduce((n, t) => n + (t.unread || 0), 0);

    const gh = document.createElement('div');
    gh.className = 'grp';
    gh.innerHTML =
      `<span class="arw">${collapsed ? '▸' : '▾'}</span>${esc(label)}` +
      `<span class="cnt">${items.length}</span>` +
      `${unread ? `<span class="gbadge">${unread}</span>` : ''}`;
    gh.addEventListener('click', () => {
      if (collapsedGroups.has(key)) collapsedGroups.delete(key);
      else collapsedGroups.add(key);
      renderSidebar();
    });
    box.appendChild(gh);

    if (collapsed) continue;
    for (const t of items) box.appendChild(ticketRow(t));
  }
}

function buildCatSelect() {
  const sel = $('#catSelect');
  sel.innerHTML =
    `<option value="">— Non trié —</option>` +
    categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function syncHeader() {
  const t = current ? tickets.get(current) : null;
  $('#headName').textContent = t ? t.username : current || '—';
  $('#headWho').textContent = t ? `ID ${current} · ${t.status}` : '';

  const mine = !!(t && t.assignee_id && t.assignee_id === myId);
  $('#headAssignee').textContent =
    t && t.assignee_id ? `🔒 ${mine ? 'toi' : t.assignee_name || '?'}` : '';

  $('#closeBtn').classList.toggle('hidden', !t || t.status === 'closed');
  $('#reopenBtn').classList.toggle('hidden', !t || t.status !== 'closed');

  const take = $('#takeBtn');
  take.classList.toggle('hidden', !t);
  take.classList.toggle('mine', mine);
  take.textContent = mine
    ? 'Lâcher'
    : t && t.assignee_id
      ? 'Reprendre'
      : 'Prendre';

  const cat = $('#catSelect');
  cat.classList.toggle('hidden', !t);
  if (t) {
    cat.value = categories.includes(t.category) ? t.category : '';
    cat.classList.toggle('unset', !cat.value);
  }

  const escSel = $('#escSelect');
  const showEsc = !!t && maxLvl > 1;
  escSel.classList.toggle('hidden', !showEsc);
  if (showEsc) {
    const cur = t.escalation_level || 1;
    let html = '';
    for (let L = 1; L <= maxLvl; L++) {
      html +=
        `<option value="${L}"${L === cur ? ' selected' : ''}>` +
        `${L === cur ? '● ' : ''}${esc(levelName(L))}` +
        `${L === cur ? ' (actuel)' : ''}</option>`;
    }
    escSel.innerHTML = html;
  }
}

function openTicket(uid) {
  current = uid;
  const t = tickets.get(uid);
  if (t) t.unread = 0;
  $('#input').disabled = false;
  $('#sendBtn').disabled = false;
  syncHeader();
  renderSidebar();
  if (msgCache.has(uid)) renderMessages();
  else {
    $('#msgs').innerHTML = '<div class="placeholder">Chargement…</div>';
    ws.send(JSON.stringify({ type: 'open', userId: uid }));
  }
}

$('#catSelect').addEventListener('change', (e) => {
  if (!current || !ws || ws.readyState !== 1) return;
  ws.send(
    JSON.stringify({
      type: 'set_category',
      userId: current,
      category: e.target.value || null,
    }),
  );
});

$('#takeBtn').addEventListener('click', () => {
  if (!current || !ws || ws.readyState !== 1) return;
  const t = tickets.get(current);
  const mine = !!(t && t.assignee_id === myId);
  ws.send(JSON.stringify({ type: 'assign', userId: current, take: !mine }));
});

$('#escSelect').addEventListener('change', (e) => {
  if (!current || !ws || ws.readyState !== 1) return;
  const t = tickets.get(current);
  const cur = (t && t.escalation_level) || 1;
  const target = parseInt(e.target.value, 10);
  if (!target || target === cur) return;
  const up = target > cur;
  const ok = window.confirm(
    up
      ? `Escalader ce ticket vers « ${levelName(target)} » ?\n\n` +
          `Les staff en dessous de ce niveau perdront l'accès au ticket ` +
          `(toi aussi si tu n'es pas au moins « ${levelName(target)} »).`
      : `Redescendre ce ticket vers « ${levelName(target)} » ?`,
  );
  if (!ok) {
    syncHeader(); // remet le menu sur le niveau actuel
    return;
  }
  ws.send(JSON.stringify({ type: 'escalate', userId: current, level: target }));
});

function renderMessages() {
  const arr = msgCache.get(current) || [];
  const box = $('#msgs');
  box.innerHTML = '';
  if (!arr.length) {
    box.innerHTML = '<div class="placeholder">Aucun message.</div>';
    return;
  }
  for (const msg of arr) {
    const el = document.createElement('div');
    el.className = 'm ' + msg.author;
    el.innerHTML =
      `<div class="meta">${esc(msg.author_name)} · ` +
      `${new Date(msg.created_at).toLocaleString()}</div>${esc(msg.content)}`;
    box.appendChild(el);
  }
  box.scrollTop = box.scrollHeight;
}

/* ---------------- envoi ---------------- */
const noteCheck = $('#noteCheck');

function updateNoteMode() {
  const on = noteCheck.checked;
  $('#composer').classList.toggle('note-mode', on);
  $('#input').placeholder = on
    ? 'Note interne (visible staff uniquement)…'
    : 'Écris ta réponse au client…';
  $('#sendBtn').textContent = on ? 'Ajouter' : 'Envoyer';
}
noteCheck.addEventListener('change', updateNoteMode);

function send() {
  const v = $('#input').value.trim();
  if (!v || !current || !ws || ws.readyState !== 1) return;
  const type = noteCheck.checked ? 'note' : 'reply';
  ws.send(JSON.stringify({ type, userId: current, content: v }));
  $('#input').value = '';
}
$('#sendBtn').addEventListener('click', send);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('#closeBtn').addEventListener('click', () => {
  if (current) ws.send(JSON.stringify({ type: 'close', userId: current }));
});
$('#reopenBtn').addEventListener('click', () => {
  if (current) ws.send(JSON.stringify({ type: 'reopen', userId: current }));
});
