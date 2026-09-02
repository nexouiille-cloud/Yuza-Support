let ws = null;
let current = null;

const tickets = new Map(); // userId -> ticket
const msgCache = new Map(); // userId -> [messages]

let filterMode = 'open';        // 'open' | 'closed' | 'all' | 'towait' | 'unassigned'
let advAssignee = '';
let advPriority = '';
let searchQuery = '';
let searchIds = null;
let categories = [];
const collapsedGroups = new Set();
const NONE = '__none__';

let myId = null;
let myName = '';
let myLevelLabel = '';
let myLevel = 1;
let tiers = [];
let maxLvl = 1;
const blacklist = new Set();
let vapidPublic = '';
let staffOnly = false; // vue "staff seulement" dans la conversation
let presence = []; // staff en ligne
let myRoles = []; // mes rôles Discord (IDs)
let assignRoles = []; // rôles demandables : [{name, roleId}]
let slaMin = 15; // seuil d'alerte SLA (minutes)

const levelName = (L) => (L <= 1 ? 'Support' : tiers[L - 2] || `Niveau ${L}`);
const PRI = { urgent: 0, high: 1, normal: 2, low: 3 };
const ticketLabel = (t) => (t.title ? t.title : t.username);

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

function setStatus(s) { $('#statusText').textContent = s; }

/* ---------------- thème ---------------- */
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt);
  const g = Math.min(255, ((n >> 8) & 255) + amt);
  const b = Math.min(255, (n & 255) + amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
let appName = 'Volt Support';
function applyTheme(t) {
  if (!t) return;
  const r = document.documentElement.style;
  if (/^#[0-9a-f]{6}$/i.test(t.accent || '')) {
    r.setProperty('--accent', t.accent);
    r.setProperty('--accent-bright', lighten(t.accent, 30));
    r.setProperty('--accent-deep', lighten(t.accent, -40));
    r.setProperty('--glow', t.accent + '59');
    r.setProperty('--glow-soft', t.accent + '24');
  }
  if (/^#[0-9a-f]{6}$/i.test(t.bg || '')) {
    r.setProperty('--bg', t.bg);
    r.setProperty('--bg-2', lighten(t.bg, 4));
  }
  if (t.appName) {
    appName = t.appName;
    document.title = appName;
    const parts = appName.split(' ');
    const last = parts.pop();
    $('#login h1').innerHTML = parts.length
      ? `${esc(parts.join(' '))} <span class="accent">${esc(last)}</span>`
      : `<span class="accent">${esc(last)}</span>`;
  }
}
(async () => {
  try {
    const r = await fetch('/api/theme');
    if (r.ok) applyTheme(await r.json());
  } catch {}
})();

function setConn(state) {
  const d = $('#connDot');
  d.className = 'dot' + (state === 'ok' ? ' ok' : state === 'bad' ? ' bad' : '');
}

function updateTitle() {
  let n = 0;
  for (const t of tickets.values()) n += t.unread || 0;
  document.title = (n ? `(${n}) ` : '') + appName;
}

/* ---------------- navigation entre vues ---------------- */
const SVG_LOGO =
  "<svg class='brand' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'>" +
  "<defs><linearGradient id='vg' x1='0' y1='0' x2='1' y2='1'>" +
  "<stop offset='0' stop-color='#ffbb3d'/><stop offset='1' stop-color='#c96f00'/></linearGradient></defs>" +
  "<rect x='6' y='6' width='88' height='88' rx='22' fill='#141317' stroke='url(#vg)' stroke-width='2.5'/>" +
  "<text x='50' y='64' text-anchor='middle' font-family=\"'Chakra Petch',sans-serif\" " +
  "font-weight='700' font-size='40' fill='#f3f1ee'>VH</text>" +
  "<path d='M56 12 L33 53 L46 53 L41 88 L69 43 L54 43 Z' fill='url(#vg)' " +
  "stroke='#1a1206' stroke-width='1.5' stroke-linejoin='round'/></svg>";

// si /logo.png n'existe pas -> logo SVG intégré
$$('img.brand').forEach((img) => {
  const swap = () => {
    if (!img.parentNode) return;
    const span = document.createElement('span');
    span.innerHTML = SVG_LOGO;
    const svg = span.firstChild;
    svg.setAttribute('class', 'brand ' + img.className.replace('brand', '').trim());
    img.replaceWith(svg);
  };
  img.addEventListener('error', swap);
  if (img.complete && img.naturalWidth === 0) swap();
});

function showView(name) {
  const id = 'view' + name.charAt(0).toUpperCase() + name.slice(1);
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  $$('#rail .navbtn[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name),
  );
  if (name === 'home') renderHome();
  if (name === 'staff') renderStaffView();
  if (name === 'stats' && ws && ws.readyState === 1)
    ws.send(JSON.stringify({ type: 'stats' }));
  if (name === 'settings' && ws && ws.readyState === 1)
    ws.send(JSON.stringify({ type: 'get_settings' }));
  if (name === 'members' && ws && ws.readyState === 1)
    ws.send(JSON.stringify({ type: 'members', q: $('#memSearch').value.trim() }));
}

/* ---------------- annuaire des membres du serveur ---------------- */
let dmTarget = null;
function renderMembersView(m) {
  const box = $('#memberList');
  $('#memCount').textContent =
    m.total > m.members.length
      ? `${m.members.length} affichés sur ${m.total} (${m.cached} au total)`
      : `${m.total} membre${m.total > 1 ? 's' : ''}`;
  if (!m.members.length) {
    box.innerHTML = m.cached
      ? '<div class="muted">Aucun membre ne correspond.</div>'
      : '<div class="muted">Liste des membres en cours de chargement… réessaie dans un instant.</div>';
    return;
  }
  box.innerHTML = '';
  for (const mem of m.members) {
    const el = document.createElement('div');
    el.className = 'member-item';
    el.innerHTML =
      `<div class="mi-main"><span class="mi-name">${esc(mem.name)}</span> ` +
      `<span class="mi-tag">@${esc(mem.tag)}</span>` +
      (mem.roles.length
        ? `<div class="mi-roles">${mem.roles.slice(0, 8).map((r) => `<span class="rchip">${esc(r)}</span>`).join('')}</div>`
        : '') +
      `</div>` +
      `<button class="mi-dm" type="button">✉️ MP</button>`;
    el.querySelector('.mi-dm').addEventListener('click', () => {
      dmTarget = mem;
      $('#dmTo').textContent = `MP à ${mem.name}`;
      $('#dmText').value = '';
      $('#dmSend').disabled = false;
      $('#dmModal').classList.remove('hidden');
      $('#dmText').focus();
    });
    box.appendChild(el);
  }
}
let memSearchTimer = null;
$('#memSearch').addEventListener('input', (e) => {
  clearTimeout(memSearchTimer);
  memSearchTimer = setTimeout(() => {
    if (ws && ws.readyState === 1)
      ws.send(JSON.stringify({ type: 'members', q: e.target.value.trim() }));
  }, 250);
});
$('#dmClose').addEventListener('click', () => $('#dmModal').classList.add('hidden'));
$('#dmModal').addEventListener('click', (e) => {
  if (e.target.id === 'dmModal') $('#dmModal').classList.add('hidden');
});
$('#dmSend').addEventListener('click', () => {
  const text = $('#dmText').value.trim();
  if (!text || !dmTarget || !ws || ws.readyState !== 1) return;
  $('#dmSend').disabled = true;
  setStatus('Envoi…');
  ws.send(JSON.stringify({ type: 'dm_member', userId: dmTarget.id, text }));
});

function renderStaffView() {
  const box = $('#staffList');
  if (!box) return;
  $('#staffCount').textContent =
    presence.length + ' en ligne';
  if (!presence.length) {
    box.innerHTML = '<div class="muted">Personne d\'autre n\'est connecté.</div>';
    return;
  }
  box.innerHTML = presence
    .map(
      (s) =>
        `<div class="staff-item"><span class="sdot"></span>` +
        `<span class="sname">${esc(s.name)}${s.uid === myId ? ' <span class="sme">(toi)</span>' : ''}</span>` +
        `<span class="srole">${esc(levelName(s.level))}</span></div>`,
    )
    .join('');
}

$$('#rail .navbtn[data-view]').forEach((b) =>
  b.addEventListener('click', () => showView(b.dataset.view)),
);

$('#presence').addEventListener('click', () => showView('staff'));

$$('.card[data-go]').forEach((c) =>
  c.addEventListener('click', () => {
    const go = c.dataset.go;
    if (go === 'unassigned') {
      $$('#filters button').forEach((x) =>
        x.classList.toggle('active', x.dataset.f === 'unassigned'),
      );
      filterMode = 'unassigned';
      renderSidebar();
      showView('tickets');
    } else {
      showView(go);
    }
  }),
);

function renderHome() {
  let open = 0;
  let unassigned = 0;
  for (const t of tickets.values()) {
    if (t.status === 'closed') continue;
    open++;
    if (!t.assignee_id) unassigned++;
  }
  $('#hiName').textContent = myName || '—';
  $('#hiLevel').textContent = myLevelLabel || levelName(myLevel);
  $('#cOpen').textContent = open;
  $('#cUnassigned').textContent = unassigned;
  $('#cOpenHint').textContent = unassigned
    ? `${unassigned} non assigné${unassigned > 1 ? 's' : ''}`
    : 'tout est pris en charge';

  const myReq = [...tickets.values()].filter(
    (t) => t.requested_role && myRoles.includes(String(t.requested_role.roleId)),
  );
  const hr = $('#homeReq');
  hr.classList.toggle('hidden', !myReq.length);
  if (myReq.length) {
    hr.textContent = `🔔 On te demande sur ${myReq.length} ticket${myReq.length > 1 ? 's' : ''} — clique pour voir`;
    hr.onclick = () => {
      showView('tickets');
      openTicket(myReq[0].user_id);
    };
  }
}

/* ---------------- présence staff ---------------- */
function renderPresence() {
  const box = $('#presence');
  box.classList.toggle('hidden', !presence.length);
  box.innerHTML =
    `<span class="who-lbl">${presence.length} en ligne&nbsp;:</span>` +
    presence
      .map((s) => `<span class="who-chip">${esc(s.name)}</span>`)
      .join('');
  $('#statusPresence').textContent = presence.length
    ? `${presence.length} staff en ligne`
    : '';
  if ($('#viewStaff').classList.contains('active')) renderStaffView();
}

/* ---------------- fiche membre ---------------- */
function renderMemberModal(p, query) {
  const body = $('#mmBody');
  if (!p) {
    body.innerHTML = `<div class="mm-empty">Aucun ticket trouvé pour « ${esc(query || '')} ».</div>`;
    $('#memberModal').classList.remove('hidden');
    return;
  }
  const row = (k, v, bad) => `<div class="mm-row"><span class="k">${k}</span><span class="v${bad ? ' bad' : ''}">${v}</span></div>`;
  const d = (ts) => new Date(ts).toLocaleString('fr-FR');
  body.innerHTML =
    row('Pseudo', esc(p.username)) +
    row('ID Discord', esc(p.user_id)) +
    (p.title ? row('Titre du ticket', esc(p.title)) : '') +
    row('Statut', p.status === 'closed' ? 'clôturé' : 'ouvert') +
    row('Catégorie', esc(p.category || '—')) +
    row('Priorité', esc(p.priority)) +
    (p.escalation_level > 1 ? row('Niveau', esc(levelName(p.escalation_level))) : '') +
    row('Pris en charge par', esc(p.assignee_name || 'personne')) +
    row('Bloqué', p.blacklisted ? 'oui' : 'non', p.blacklisted) +
    row('Premier contact', d(p.first_at)) +
    row('Dernière activité', d(p.last_at)) +
    row('Messages (total)', p.messages_total) +
    row('Messages du client', p.messages_client) +
    row('Notes internes', p.notes_count) +
    row('Staff ayant répondu', p.staff_replied.length ? esc(p.staff_replied.join(', ')) : '—') +
    `<div class="mm-actions"><button class="btn-accent" id="mmOpen">Ouvrir le ticket</button></div>`;
  $('#memberModal').classList.remove('hidden');
  $('#mmOpen').addEventListener('click', () => {
    $('#memberModal').classList.add('hidden');
    showView('tickets');
    openTicket(p.user_id);
  });
}

/* ---------------- demande de rôle sur un ticket ---------------- */
function buildReqRoleSelect() {
  const sel = $('#reqRole');
  if (!sel) return;
  const usable = assignRoles.filter((r) => r.roleId);
  sel.innerHTML =
    `<option value="">🙋 Demander…</option>` +
    usable.map((r) => `<option value="${esc(r.roleId)}">${esc(r.name)}</option>`).join('');
}

function renderReqBanner() {
  const b = $('#reqBanner');
  const t = current ? tickets.get(current) : null;
  const rr = t && t.requested_role;
  if (!rr) { b.classList.add('hidden'); b.innerHTML = ''; return; }
  const mine = myRoles.includes(String(rr.roleId));
  b.classList.remove('hidden');
  b.classList.toggle('small', !mine);
  if (mine) {
    b.innerHTML =
      `<span class="rb-txt">🔔 <strong>${esc(rr.by)}</strong> te demande ici — rôle « ${esc(rr.name)} »</span>` +
      `<button class="btn-accent" id="rbTake" type="button">Prendre le ticket</button>` +
      `<button class="linkbtn" id="rbClear" type="button">Retirer</button>`;
    $('#rbTake').addEventListener('click', () => ws.send(JSON.stringify({ type: 'assign', userId: current, take: true })));
  } else {
    b.innerHTML =
      `<span class="rb-txt">🙋 <strong>${esc(rr.name)}</strong> demandé par ${esc(rr.by)}</span>` +
      `<button class="linkbtn" id="rbClear" type="button">Retirer</button>`;
  }
  $('#rbClear').addEventListener('click', () => ws.send(JSON.stringify({ type: 'clear_request', userId: current })));
}

/* ---------------- notifications ---------------- */
function setupNotifs() {
  const btn = $('#notifBtn');
  if (typeof Notification === 'undefined') {
    btn.classList.add('hidden');
    return;
  }
  if (Notification.permission === 'granted') {
    btn.classList.add('active');
    setupPush();
  }
  btn.onclick = async () => {
    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {}
    }
    if (Notification.permission === 'granted') {
      btn.classList.add('active');
      setStatus('Notifications activées.');
      setupPush();
    } else {
      setStatus('Notifications refusées dans le navigateur.');
    }
  };
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Web Push : notifications même quand l'onglet est fermé (nécessite HTTPS en prod).
async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!vapidPublic || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapidPublic),
      });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    });
  } catch (e) {
    console.warn('[push] non activé :', e.message || e);
  }
}

function maybeNotify(m) {
  if (!document.hidden && m.userId === current) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted')
    return;
  const title = m.isNew
    ? '📩 Nouveau ticket'
    : m.reopened
      ? '📩 Ticket relancé'
      : '💬 Nouveau message';
  const body = `${m.name || 'Client'} : ${m.preview || ''}`.slice(0, 140);
  try {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      showView('tickets');
      openTicket(m.userId);
    };
  } catch {}
}

/* ---------------- démarrage : session ? ---------------- */
async function init() {
  let me = null;
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.ok) me = await r.json();
  } catch {}

  if (!me) {
    const err = new URLSearchParams(location.search).get('error');
    if (err === 'not_staff')
      $('#loginMsg').textContent =
        "Ce compte n'a pas de rôle staff sur le serveur.";
    else if (err === 'bad_state')
      $('#loginMsg').textContent = 'Session de connexion expirée, réessaie.';
    else if (err)
      $('#loginMsg').textContent = `Connexion refusée (${err}).`;
    setStatus('non connecté');
    return;
  }
  connect();
}
init();

/* ---------------- websocket ---------------- */
function connect() {
  const wsUrl = location.origin.replace(/^http/, 'ws') + '/gateway';
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { setConn('ok'); setStatus('connecté'); };
  ws.onclose = () => { setConn('bad'); setStatus('déconnecté — recharge la page'); };
  ws.onerror = () => { setConn('bad'); setStatus('erreur de connexion'); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}

function handle(m) {
  switch (m.type) {
    case 'hello':
      if (m.uid) myId = m.uid;
      myName = m.name || myName;
      myLevel = m.level || 1;
      myLevelLabel = m.levelLabel || levelName(myLevel);
      tiers = Array.isArray(m.tiers) ? m.tiers : [];
      maxLvl = m.maxLevel || 1;
      vapidPublic = m.vapidPublic || vapidPublic;
      blacklist.clear();
      (m.blacklist || []).forEach((id) => blacklist.add(String(id)));
      presence = m.staff || presence;
      if (Array.isArray(m.roles)) myRoles = m.roles.map(String);
      if (Array.isArray(m.assignRoles)) assignRoles = m.assignRoles;
      if (m.slaMinutes) slaMin = m.slaMinutes;
      buildReqRoleSelect();
      $('#login').classList.add('hidden');
      $('#app').classList.add('on');
      setConn('ok');
      setupNotifs();
      setStatus(`${m.name} · ${myLevelLabel}`);
      renderPresence();
      renderSidebar();
      renderHome();
      if (!current) showView('home');
      else syncHeader();
      break;

    case 'presence':
      presence = Array.isArray(m.staff) ? m.staff : [];
      renderPresence();
      break;

    case 'member':
      renderMemberModal(m.profile, m.query);
      break;

    case 'members':
      renderMembersView(m);
      break;

    case 'dm_member_result':
      if (m.ok) {
        $('#dmModal').classList.add('hidden');
        setStatus('MP envoyé.');
      } else {
        setStatus(
          m.error === 'mp_fermes'
            ? '⚠ Ce membre a ses MP fermés — impossible de le contacter.'
            : m.error === 'trop_rapide'
              ? 'Trop de MP d\'affilée, attends une minute.'
              : `Échec de l'envoi (${m.error}).`,
        );
        $('#dmSend').disabled = false;
      }
      break;

    case 'theme':
      applyTheme(m.theme);
      break;

    case 'assign_config':
      assignRoles = Array.isArray(m.assignRoles) ? m.assignRoles : [];
      slaMin = m.slaMinutes || slaMin;
      buildReqRoleSelect();
      if (current) syncHeader();
      break;

    case 'role_requested': {
      setStatus(`🔔 ${m.by} te demande sur « ${m.ticketName} » (${m.roleName})`);
      const row = document.querySelector(`.tk[data-uid="${m.userId}"]`);
      if (row) row.classList.add('flash');
      if (m.userId === current) renderReqBanner();
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const n = new Notification('🔔 On te demande sur un ticket', {
            body: `${m.by} — ${m.ticketName} (${m.roleName})`,
          });
          n.onclick = () => {
            window.focus();
            showView('tickets');
            openTicket(m.userId);
          };
        }
      } catch {}
      renderHome();
      break;
    }

    case 'settings_meta':
      $('#settingsNav').classList.toggle('hidden', !m.canEditSettings);
      if (m.theme) applyTheme(m.theme);
      break;

    case 'settings':
      fillSettings(m.settings, m.canEdit);
      break;

    case 'settings_saved':
      $('#setStatus').textContent = m.ok
        ? '✓ enregistré'
        : m.reason === 'forbidden'
          ? 'réservé au niveau le plus élevé'
          : 'échec';
      break;

    case 'blacklist':
      blacklist.clear();
      (m.list || []).forEach((id) => blacklist.add(String(id)));
      renderSidebar();
      if (current) syncHeader();
      break;

    case 'kicked':
      $('#app').classList.remove('on');
      $('#login').classList.remove('hidden');
      $('#loginMsg').textContent =
        'Ton rôle staff a été retiré : accès révoqué.';
      if (ws) ws.close();
      break;

    case 'error':
      setStatus(`session invalide (${m.reason}) — recharge la page`);
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
      renderHome();
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
        t.status = 'open';
        if (m.userId !== current) t.unread = (t.unread || 0) + 1;
        maybeNotify(m);
      }
      tickets.set(m.userId, t);
      renderSidebar();
      renderHome();
      if (!m.fromStaff) {
        const row = document.querySelector(`.tk[data-uid="${m.userId}"]`);
        if (row) row.classList.add('flash');
      }
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

    case 'stats':
      renderStats(m.stats);
      break;

    case 'dm_failed':
      setStatus(
        "⚠ impossible d'envoyer le MP à ce client (il a peut-être fermé ses MP).",
      );
      break;
  }
}

/* ---------------- stats ---------------- */
function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const mn = Math.round(s / 60);
  if (mn < 60) return mn + ' min';
  const h = Math.floor(mn / 60);
  return `${h} h ${mn % 60} min`;
}

function rowBar(label, val, max) {
  const pct = Math.round((val / Math.max(1, max)) * 100);
  return (
    `<div class="srow"><span class="sl">${esc(label)}</span>` +
    `<span class="sbar"><span style="width:${pct}%"></span></span>` +
    `<span class="sv">${val}</span></div>`
  );
}

function renderStats(s) {
  const kpi = (l, v) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const maxDay = Math.max(1, ...s.perDay.map((d) => d.count));
  const bars = s.perDay
    .map(
      (d) =>
        `<div class="bar" title="${d.date} : ${d.count}">` +
        `<div class="fill" style="height:${Math.round((d.count / maxDay) * 100)}%"></div>` +
        `<div class="bl">${d.date.slice(8)}</div></div>`,
    )
    .join('');

  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...cats.map((c) => c[1]));
  const catRows = cats.length
    ? cats.map(([k, v]) => rowBar(k, v, catMax)).join('')
    : '<div class="muted">—</div>';

  const staff = Object.entries(s.byStaff).sort((a, b) => b[1] - a[1]);
  const staffMax = Math.max(1, ...staff.map((c) => c[1]));
  const staffRows = staff.length
    ? staff.map(([k, v]) => rowBar(k, v, staffMax)).join('')
    : '<div class="muted">—</div>';

  $('#statsBody').innerHTML =
    `<div class="kpis">${kpi('Total', s.total)}${kpi('Ouverts', s.open)}` +
    `${kpi('Clôturés', s.closed)}${kpi('Non assignés', s.unassigned)}` +
    `${kpi('Réponse moy.', fmtDur(s.avgResponseMs))}</div>` +
    `<h4>Tickets créés (14 derniers jours)</h4><div class="chart">${bars}</div>` +
    `<h4>Par catégorie</h4>${catRows}` +
    `<h4>Réponses par staff</h4>${staffRows}`;
}

$('#statsClose').addEventListener('click', () => showView('home'));

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
$('#advToggle').addEventListener('click', () => {
  const hidden = $('#advFilters').classList.toggle('hidden');
  $('#advToggle').textContent = hidden ? '＋ filtres avancés' : '－ filtres avancés';
});
$('#advAssignee').addEventListener('change', (e) => {
  advAssignee = e.target.value;
  renderSidebar();
});
$('#advPriority').addEventListener('change', (e) => {
  advPriority = e.target.value;
  renderSidebar();
});

/* ---------------- vue ticket ---------------- */
function closeTicketView() {
  current = null;
  $('#msgs').innerHTML =
    '<div class="m system">Sélectionne un ticket à gauche.</div>';
  $('#input').disabled = true;
  $('#sendBtn').disabled = true;
  syncHeader();
  renderSidebar();
}

/* ---------------- rendu sidebar ---------------- */
function ticketRow(t) {
  const el = document.createElement('div');
  const mine = t.assignee_id && t.assignee_id === myId;
  const bl = blacklist.has(String(t.user_id));
  el.className =
    'tk' +
    (t.user_id === current ? ' active' : '') +
    (t.status === 'closed' ? ' closed' : '') +
    (bl ? ' bl' : '') +
    (t.assignee_id && !mine ? ' assigned-other' : '');
  const reqMine = t.requested_role && myRoles.includes(String(t.requested_role.roleId));
  if (reqMine) el.className += ' req-mine';
  el.dataset.uid = t.user_id;
  const pri = t.priority && t.priority !== 'normal'
    ? `<span class="pri ${t.priority}"></span>`
    : '';
  const tags = [];
  if (t.status !== 'closed') {
    if (t.waiting === 'staff') {
      const mn = Math.max(0, Math.round((Date.now() - (t.last_client_at || Date.now())) / 60000));
      tags.push(`<span class="sla${mn > slaMin ? ' late' : ''}">⏱ ${mn}m</span>`);
    } else if (t.waiting === 'client') {
      tags.push(`<span class="wait">attente client</span>`);
    }
  }
  if (t.requested_role) {
    tags.push(`<span class="req">🙋 ${esc(t.requested_role.name)}${reqMine ? ' (toi)' : ''}</span>`);
  }
  el.innerHTML =
    `<div class="n"><span>${pri}${esc(ticketLabel(t))}</span>` +
    `${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</div>` +
    `<div class="p">${esc(t.last_preview || '')}</div>` +
    (tags.length ? `<div class="tags">${tags.join('')}</div>` : '') +
    (t.assignee_id
      ? `<div class="lock">🔒 ${mine ? 'toi' : esc(t.assignee_name || '?')}</div>`
      : '') +
    (bl ? `<div class="blmark">🚫 bloqué</div>` : '');
  el.addEventListener('click', () => openTicket(t.user_id));
  return el;
}

function renderSidebar() {
  let list = [...tickets.values()];
  if (filterMode === 'open') list = list.filter((t) => t.status !== 'closed');
  else if (filterMode === 'closed')
    list = list.filter((t) => t.status === 'closed');
  else if (filterMode === 'unassigned')
    list = list.filter((t) => t.status !== 'closed' && !t.assignee_id);
  else if (filterMode === 'towait')
    list = list.filter((t) => t.status !== 'closed' && t.waiting === 'staff');
  if (advAssignee === 'me') list = list.filter((t) => t.assignee_id === myId);
  else if (advAssignee === 'none') list = list.filter((t) => !t.assignee_id);
  if (advPriority === 'high')
    list = list.filter((t) => t.priority === 'high' || t.priority === 'urgent');
  else if (advPriority === 'urgent')
    list = list.filter((t) => t.priority === 'urgent');
  if (searchIds) list = list.filter((t) => searchIds.has(t.user_id));

  const box = $('#ticketList');
  box.innerHTML = '';
  if (!list.length) {
    const why = searchIds
      ? 'Aucun résultat.'
      : filterMode === 'closed'
        ? 'Aucun ticket clôturé.'
        : filterMode === 'unassigned'
          ? 'Aucun ticket non assigné.'
          : filterMode === 'towait'
            ? 'Rien à traiter — tout est en attente client.'
            : filterMode === 'open'
              ? 'Aucun ticket ouvert.'
              : "Aucun ticket pour l'instant.";
    box.innerHTML = `<div class="empty">${why}</div>`;
    updateTitle();
    return;
  }

  const order = [NONE, ...categories];
  const groups = new Map(order.map((k) => [k, []]));
  for (const t of list) {
    const key =
      t.category && categories.includes(t.category) ? t.category : NONE;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  for (const key of groups.keys()) {
    const items = groups.get(key).sort((a, b) => {
      const pa = PRI[a.priority] ?? 2;
      const pb = PRI[b.priority] ?? 2;
      return pa - pb || (b.updated_at || 0) - (a.updated_at || 0);
    });
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
  updateTitle();
}

function buildCatSelect() {
  const sel = $('#catSelect');
  sel.innerHTML =
    `<option value="">— Non trié —</option>` +
    categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function syncHeader() {
  const t = current ? tickets.get(current) : null;
  $('#headName').textContent = t ? ticketLabel(t) : current || '—';
  $('#headWho').textContent = t
    ? `${t.username} · ID ${current} · ${t.status}`
    : '';
  $('#renameBtn').classList.toggle('hidden', !t);
  $('#ficheBtn').classList.toggle('hidden', !t);
  $('#transcriptBtn').classList.toggle('hidden', !t);
  $('#staffViewBtn').classList.toggle('hidden', !t);
  $('#staffViewBtn').classList.toggle('on', staffOnly);
  $('#reqRole').classList.toggle('hidden', !(t && assignRoles.some((r) => r.roleId)));
  renderReqBanner();

  const pri = $('#priSelect');
  pri.classList.toggle('hidden', !t);
  if (t) {
    pri.value = t.priority || 'normal';
    pri.classList.toggle('p-high', pri.value === 'high');
    pri.classList.toggle('p-urgent', pri.value === 'urgent');
  }

  const mine = !!(t && t.assignee_id && t.assignee_id === myId);
  $('#headAssignee').textContent =
    t && t.assignee_id ? `🔒 ${mine ? 'toi' : t.assignee_name || '?'}` : '';

  $('#closeBtn').classList.toggle('hidden', !t || t.status === 'closed');
  $('#reopenBtn').classList.toggle('hidden', !t || t.status !== 'closed');

  const block = $('#blockBtn');
  const bl = !!(t && blacklist.has(String(t.user_id)));
  block.classList.toggle('hidden', !t);
  block.classList.toggle('on', bl);
  block.textContent = bl ? '✅ Débloquer' : '🚫 Bloquer';

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
    $('#msgs').innerHTML = '<div class="m system">Chargement…</div>';
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

$('#renameBtn').addEventListener('click', () => {
  if (!current || !ws || ws.readyState !== 1) return;
  const t = tickets.get(current);
  const v = window.prompt(
    'Titre du ticket (vide = pseudo du client) :',
    t?.title || '',
  );
  if (v === null) return;
  ws.send(JSON.stringify({ type: 'rename', userId: current, title: v.trim() }));
});

$('#priSelect').addEventListener('change', (e) => {
  if (!current || !ws || ws.readyState !== 1) return;
  ws.send(
    JSON.stringify({ type: 'priority', userId: current, priority: e.target.value }),
  );
});

$('#reqRole').addEventListener('change', (e) => {
  const roleId = e.target.value;
  e.target.value = '';
  if (roleId && current && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'request_role', userId: current, roleId }));
    setStatus('Rôle demandé — les membres du rôle sont alertés.');
  }
});

// rafraîchit les minuteurs SLA
setInterval(() => {
  if ($('#app').classList.contains('on') && $('#viewTickets').classList.contains('active')) {
    renderSidebar();
  }
}, 30000);

/* fiche membre + transcript */
$('#ficheBtn').addEventListener('click', () => {
  if (current && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'member', userId: current }));
  }
});
$('#transcriptBtn').addEventListener('click', () => {
  if (!current) return;
  const a = document.createElement('a');
  a.href = '/api/transcript/' + encodeURIComponent(current);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus('Transcript téléchargé.');
});
$('#memberSearch').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (q && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'member', query: q }));
  }
});
$('#mmClose').addEventListener('click', () => $('#memberModal').classList.add('hidden'));
$('#memberModal').addEventListener('click', (e) => {
  if (e.target.id === 'memberModal') $('#memberModal').classList.add('hidden');
});

/* ---------------- réglages ---------------- */
let settingsCanEdit = false;
function fillSettings(s, canEdit) {
  settingsCanEdit = !!canEdit;
  $('#setBody').classList.toggle('locked', !canEdit);
  $('#setStatus').textContent = canEdit
    ? ''
    : 'lecture seule — réservé au niveau le plus élevé';
  $('#setCats').value = (s.categories || categories).join('\n');
  $('#setWelcome').value = s.welcome ? s.welcome.text : '';
  $('#setWelcomeOn').checked = s.welcome ? s.welcome.enabled !== false : true;
  $('#setClose').value = s.closeMessage
    ? s.closeMessage.text
    : "Ton ticket vient d'être clôturé. Merci de nous avoir contactés — écris-nous à nouveau si tu as besoin. ✅";
  $('#setCloseOn').checked = s.closeMessage ? s.closeMessage.enabled !== false : true;
  $('#setChan').value = s.staffChannelId || '';
  $('#setPing').value = s.staffPingRoleId || '';
  const th = s.theme || {};
  $('#setAppName').value = th.appName || appName;
  $('#setAccent').value = th.accent || '#ff9d00';
  $('#setBg').value = th.bg || '#0a0a0c';
  renderSetRoles(s.assignRoles || assignRoles || []);
  $('#setSla').value = s.slaMinutes || slaMin;
  $('#setAsk').checked = s.askCategory !== false;
  const ac = s.autoClose || {};
  $('#setAcOn').checked = !!ac.enabled;
  $('#setAcWarn').value = ac.warnHours || 48;
  $('#setAcClose').value = ac.closeHours || 72;
  const fl = s.flood || {};
  $('#setFlOn').checked = fl.enabled !== false;
  $('#setFlCount').value = fl.count || 8;
  $('#setFlWin').value = fl.windowSec || 15;
  $('#setFlMute').value = fl.muteMin || 10;
}

function roleRow(name, rid) {
  const d = document.createElement('div');
  d.className = 'setrole';
  d.innerHTML =
    `<input class="nm" placeholder="Nom (ex : Resp Illegal)" value="${esc(name || '')}" />` +
    `<input class="rid" placeholder="ID du rôle Discord (plus tard)" value="${esc(rid || '')}" />` +
    `<button class="rm linkbtn" type="button">✕</button>`;
  d.querySelector('.rm').addEventListener('click', () => d.remove());
  return d;
}
function renderSetRoles(rows) {
  const box = $('#setRoles');
  box.innerHTML = '';
  (rows.length ? rows : [{}]).forEach((r) => box.appendChild(roleRow(r.name, r.roleId)));
}
function gatherSetRoles() {
  return [...$('#setRoles').querySelectorAll('.setrole')]
    .map((d) => ({
      name: d.querySelector('.nm').value.trim(),
      roleId: d.querySelector('.rid').value.trim(),
    }))
    .filter((r) => r.name);
}
$('#setRoleAdd').addEventListener('click', () =>
  $('#setRoles').appendChild(roleRow('', '')),
);
function livePreview() {
  applyTheme({
    appName: $('#setAppName').value.trim() || 'Volt Support',
    accent: $('#setAccent').value,
    bg: $('#setBg').value,
  });
}
['#setAppName', '#setAccent', '#setBg'].forEach((sel) =>
  $(sel).addEventListener('input', livePreview),
);
$('#setSave').addEventListener('click', () => {
  if (!settingsCanEdit || !ws || ws.readyState !== 1) return;
  const cats = $('#setCats').value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  ws.send(
    JSON.stringify({
      type: 'save_settings',
      patch: {
        categories: cats,
        welcome: { text: $('#setWelcome').value, enabled: $('#setWelcomeOn').checked },
        closeMessage: { text: $('#setClose').value, enabled: $('#setCloseOn').checked },
        staffChannelId: $('#setChan').value.trim(),
        staffPingRoleId: $('#setPing').value.trim(),
        assignRoles: gatherSetRoles(),
        slaMinutes: Number($('#setSla').value) || 15,
        askCategory: $('#setAsk').checked,
        autoClose: {
          enabled: $('#setAcOn').checked,
          warnHours: Number($('#setAcWarn').value) || 48,
          closeHours: Number($('#setAcClose').value) || 72,
        },
        flood: {
          enabled: $('#setFlOn').checked,
          count: Number($('#setFlCount').value) || 8,
          windowSec: Number($('#setFlWin').value) || 15,
          muteMin: Number($('#setFlMute').value) || 10,
        },
        theme: {
          appName: $('#setAppName').value.trim() || 'Volt Support',
          accent: $('#setAccent').value,
          bg: $('#setBg').value,
        },
      },
    }),
  );
  $('#setStatus').textContent = 'enregistrement…';
});
$('#setReload').addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'get_settings' }));
});

$('#staffViewBtn').addEventListener('click', () => {
  staffOnly = !staffOnly;
  $('#staffViewBtn').classList.toggle('on', staffOnly);
  renderMessages();
});

$('#takeBtn').addEventListener('click', () => {
  if (!current || !ws || ws.readyState !== 1) return;
  const t = tickets.get(current);
  const mine = !!(t && t.assignee_id === myId);
  ws.send(JSON.stringify({ type: 'assign', userId: current, take: !mine }));
});

$('#blockBtn').addEventListener('click', () => {
  if (!current || !ws || ws.readyState !== 1) return;
  const on = !blacklist.has(String(current));
  if (
    on &&
    !window.confirm(
      "Bloquer ce client ? Ses futurs MP au bot seront ignorés (aucun ticket créé).",
    )
  )
    return;
  ws.send(JSON.stringify({ type: 'blacklist', userId: current, on }));
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
    syncHeader();
    return;
  }
  ws.send(JSON.stringify({ type: 'escalate', userId: current, level: target }));
});

function renderMessages() {
  let arr = msgCache.get(current) || [];
  if (staffOnly) arr = arr.filter((m) => m.author !== 'client');
  const box = $('#msgs');
  box.innerHTML = '';
  if (!arr.length) {
    box.innerHTML = `<div class="m system">${
      staffOnly ? 'Aucun message staff.' : 'Aucun message.'
    }</div>`;
    return;
  }
  for (const msg of arr) {
    const el = document.createElement('div');
    el.className = 'm ' + msg.author;
    let html =
      `<div class="meta">${esc(msg.author_name)} · ` +
      `${new Date(msg.created_at).toLocaleString()}</div>${esc(msg.content)}`;
    for (const a of msg.attachments || []) {
      const isImg =
        (a.contentType || '').startsWith('image/') ||
        /\.(png|jpe?g|gif|webp)$/i.test(a.url || '');
      html += isImg
        ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">` +
          `<img class="att" src="${esc(a.url)}" alt="${esc(a.name || '')}"></a>`
        : `<a class="attfile" href="${esc(a.url)}" target="_blank" rel="noopener">` +
          `📎 ${esc(a.name || 'fichier')}</a>`;
    }
    el.innerHTML = html;
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

/* ---------------- pièce jointe staff -> client ---------------- */
$('#attachBtn').addEventListener('click', () => {
  if (current) $('#fileInput').click();
});
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !current) return;
  setStatus(`Envoi de ${file.name}…`);
  const fd = new FormData();
  fd.append('userId', current); // AVANT le fichier (champs lus dans l'ordre)
  fd.append('caption', $('#input').value.trim());
  fd.append('file', file, file.name);
  try {
    const r = await fetch('/api/attach', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    if (r.ok) {
      $('#input').value = '';
      setStatus('Pièce jointe envoyée.');
    } else {
      const j = await r.json().catch(() => ({}));
      setStatus(`Échec envoi pièce jointe (${j.error || r.status}).`);
    }
  } catch (err) {
    setStatus('Échec envoi pièce jointe : ' + (err.message || err));
  }
});
$('#closeBtn').addEventListener('click', () => {
  if (current) ws.send(JSON.stringify({ type: 'close', userId: current }));
});
$('#reopenBtn').addEventListener('click', () => {
  if (current) ws.send(JSON.stringify({ type: 'reopen', userId: current }));
});

// se reconnecter quand l'onglet redevient actif si la socket est tombée
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ws && ws.readyState === 3) connect();
});
