/* Éditeur de bannières — intégré au site, réservé à l'owner.
   Chargé par index.html ; initBannerEditor() est appelé par app.js au 1er affichage. */
(function () {
  const W = 1200, H = 400;
  let DEFS_EXTRA = '';

  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function lg(id, a, b, c) {
    DEFS_EXTRA += `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c || b}"/></linearGradient>`;
    return `url(#${id})`;
  }
  function mix(a, b, t = 0.5) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
    const m = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    return '#' + m(r1, r2) + m(g1, g2) + m(b1, b2);
  }

  const BG = {
    braise: (b) => `<rect width="${W}" height="${H}" fill="${lg('bg', b.bg1, b.bg2, mix(b.bg1, '#1c130a'))}"/><rect width="${W}" height="${H}" fill="url(#rg)"/><rect width="${W}" height="${H}" fill="url(#rg2)"/>`,
    noir: () => `<rect width="${W}" height="${H}" fill="#060507"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    nuit: () => `<rect width="${W}" height="${H}" fill="${lg('bg', '#0a1020', '#0d1b33', '#0a1020')}"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    alerte: () => `<rect width="${W}" height="${H}" fill="${lg('bg', '#170708', '#2a0d0e', '#170708')}"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    toxic: () => `<rect width="${W}" height="${H}" fill="${lg('bg', '#07140c', '#0c2417', '#07140c')}"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    royal: () => `<rect width="${W}" height="${H}" fill="${lg('bg', '#120a1e', '#1e1233', '#120a1e')}"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    carbon: () => `<rect width="${W}" height="${H}" fill="#0c0b0e"/><rect width="${W}" height="${H}" fill="url(#dots)"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    rayures: () => `<rect width="${W}" height="${H}" fill="#0b0a0d"/><rect width="${W}" height="${H}" fill="url(#stripes)"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    spot: (b) => `<rect width="${W}" height="${H}" fill="#070609"/><ellipse cx="${b.logo && b.side === 'left' ? 170 : W - 200}" cy="200" rx="520" ry="320" fill="${b.glow}" opacity="0.16"/><rect width="${W}" height="${H}" fill="url(#rg)"/>`,
    sweep: (b) => `<rect width="${W}" height="${H}" fill="${lg('bg', mix(b.glow, '#000', 0.75), mix(b.glow, '#000', 0.4), mix(b.glow, '#000', 0.8))}"/>`,
    uni: (b) => `<rect width="${W}" height="${H}" fill="${b.bg1}"/>`,
  };
  const BG_KEYS = Object.keys(BG);
  const BG_LBL = { braise: 'Braise', noir: 'Noir', nuit: 'Nuit', alerte: 'Alerte', toxic: 'Toxic', royal: 'Royal', carbon: 'Carbone', rayures: 'Rayures', spot: 'Projecteur', sweep: 'Dégradé', uni: 'Uni' };

  const GRAD = {
    braise: ['#ffbb3d', '#ff6a00', '#c93a00'], feu: ['#ffe14d', '#ff7a00', '#ff2d2d'],
    or: ['#fff3b0', '#ffcf3d', '#c98f00'], glace: ['#e8fbff', '#7fd4ff', '#2a72ff'],
    toxique: ['#eaff9c', '#7cff4d', '#12b34a'], royal: ['#e9c6ff', '#b36bff', '#6a1fd1'],
    sang: ['#ff8a8a', '#ff2d2d', '#8a0000'], matrix: ['#c8ffcf', '#43d162', '#0b7a2f'],
    coucher: ['#ffd36e', '#ff7a59', '#c9457a'], chrome: ['#ffffff', '#c8ccd6', '#7a8091'],
    rose: ['#ffd9ef', '#ff6ab5', '#c81e78'], ocean: ['#bff3ff', '#1fb6d6', '#0b5f9e'],
  };
  const GRAD_KEYS = Object.keys(GRAD);

  function emberDots(color, n) {
    const seed = [[180, 300, 3], [240, 260, 2], [300, 340, 4], [420, 120, 2], [520, 300, 3], [640, 90, 2], [720, 330, 4], [840, 150, 3], [900, 300, 2], [1000, 110, 3], [1080, 320, 4], [1140, 180, 2], [560, 60, 2], [380, 70, 3], [1030, 260, 2], [760, 60, 2], [210, 120, 2], [470, 330, 3], [660, 280, 2], [930, 70, 3], [1120, 90, 2], [340, 200, 2], [880, 340, 3], [150, 200, 2], [1000, 340, 2], [600, 340, 3], [500, 90, 2], [790, 200, 2], [260, 340, 2], [1160, 300, 3]];
    return seed.slice(0, n).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.9"/><circle cx="${x}" cy="${y}" r="${r * 3}" fill="${color}" opacity="0.18"/>`).join('');
  }

  function svgFor(b, opt) {
    opt = opt || {};
    DEFS_EXTRA = '';
    const gcols = GRAD[b.grad] || GRAD.braise;
    const grad = `<linearGradient id="acc" x1="0" y1="0" x2="1" y2="0">${gcols.map((c, i) => `<stop offset="${i / (gcols.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>`;
    const bgLayer = (BG[b.bgStyle] || BG.braise)(b);

    let logo = '', tx0 = 90;
    if (b.logo) {
      const S = 184, x = b.side === 'right' ? W - 70 - S : 70, y = (H - S) / 2;
      const rx = b.shape === 'circle' ? S / 2 : b.shape === 'rounded' ? 42 : 10;
      tx0 = b.side === 'right' ? 90 : 320;
      const inner = b.logoImg
        ? `<image href="${b.logoImg}" x="${x}" y="${y}" width="${S}" height="${S}" preserveAspectRatio="xMidYMid slice" clip-path="url(#lclip)"/>`
        : `<text x="${x + S / 2}" y="${y + 134}" text-anchor="middle" font-family="Impact,'Arial Black',system-ui,sans-serif" font-size="86" fill="${b.logoFg}" letter-spacing="2">${esc(b.logoText || 'VH')}</text>` +
          (b.bolt ? `<path d="M${x + 108} ${y + 16} L${x + 60} ${y + 100} L${x + 88} ${y + 100} L${x + 78} ${y + 168} L${x + 134} ${y + 82} L${x + 104} ${y + 82} Z" fill="url(#amber)" stroke="#1a1206" stroke-width="3" stroke-linejoin="round"/><g filter="url(#soft)" opacity="0.6"><path d="M${x + 108} ${y + 16} L${x + 60} ${y + 100} L${x + 88} ${y + 100} L${x + 78} ${y + 168} L${x + 134} ${y + 82} L${x + 104} ${y + 82} Z" fill="${b.glow}"/></g>` : '');
      logo = `<clipPath id="lclip"><rect x="${x}" y="${y}" width="${S}" height="${S}" rx="${rx}"/></clipPath>` +
        `<rect x="${x}" y="${y}" width="${S}" height="${S}" rx="${rx}" fill="${b.logoImg ? '#0000' : b.logoBg}" stroke="url(#amber)" stroke-width="5"/>` +
        inner +
        `<rect x="${x}" y="${y}" width="${S}" height="${S}" rx="${rx}" fill="none" stroke="${b.accent}" stroke-width="1" opacity="0.5"/>`;
    }
    const ts = +b.titleSize || 76;
    const align = b.logo ? 'start' : (b.align || 'start');
    const ax = align === 'middle' ? W / 2 : align === 'end' ? W - 90 : tx0;
    const fTag = b.gTag ? 'url(#acc)' : b.accent;
    const fT1 = b.gT1 ? 'url(#acc)' : '#f6f4f1';
    const fT2 = b.gT2 === false ? '#f6f4f1' : 'url(#acc)';
    const fSub = b.gSub ? 'url(#acc)' : '#b9b2a8';
    // en mode animé, le SVG de base est statique (les braises/sweep bougent au canvas)
    const staticEmbers = opt.baseForAnim ? Math.min(8, +b.embers || 0) : +b.embers || 0;
    const showStreak = b.streak && !opt.baseForAnim;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="rg" cx="0.5" cy="1.15" r="0.9"><stop offset="0" stop-color="${b.glow}" stop-opacity="0.5"/><stop offset="0.6" stop-color="${b.glow}" stop-opacity="0.09"/><stop offset="1" stop-color="${b.glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="rg2" cx="1.05" cy="-0.1" r="0.7"><stop offset="0" stop-color="#ff9d00" stop-opacity="0.2"/><stop offset="1" stop-color="#ff9d00" stop-opacity="0"/></radialGradient>
    <linearGradient id="amber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffbb3d"/><stop offset="1" stop-color="#c96f00"/></linearGradient>
    <linearGradient id="streak" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="#ffffff" opacity="0.05"/></pattern>
    <pattern id="stripes" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="17" height="34" fill="#ffffff" opacity="0.03"/></pattern>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>
    <clipPath id="round"><rect width="${W}" height="${H}" rx="26"/></clipPath>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
    ${grad}
    ${DEFS_EXTRA}
  </defs>
  <g clip-path="url(#round)">
    ${bgLayer}
    ${showStreak ? `<g transform="rotate(-18 600 200)"><rect x="-200" y="60" width="1700" height="70" fill="url(#streak)"/><rect x="-200" y="250" width="1700" height="30" fill="url(#streak)"/></g>` : ''}
    ${staticEmbers > 0 ? emberDots(b.glow, staticEmbers) : ''}
    ${b.vignette ? `<rect width="${W}" height="${H}" fill="url(#vig)"/>` : ''}
    ${logo}
    <g font-family="Impact,'Arial Black',system-ui,sans-serif" text-anchor="${align}">
      <text x="${ax}" y="150" font-size="30" letter-spacing="8" fill="${fTag}">${esc(b.tag)}</text>
      <text x="${ax}" y="${150 + ts}" font-size="${ts}" letter-spacing="3" fill="${fT1}">${esc(b.t1)}</text>
      <text x="${ax}" y="${150 + ts * 2 - 4}" font-size="${ts}" letter-spacing="3" fill="${fT2}">${esc(b.t2)}</text>
      <rect x="${align === 'middle' ? ax - 180 : align === 'end' ? ax - 360 : ax + 4}" y="${150 + ts * 2 + 18}" width="360" height="5" rx="2" fill="url(#acc)"/>
      <text x="${ax}" y="${150 + ts * 2 + 56}" font-size="24" letter-spacing="2" font-family="Arial,system-ui,sans-serif" fill="${fSub}">${esc(b.sub)}</text>
    </g>
    ${b.border ? `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="20" fill="none" stroke="${b.borderColor}" stroke-width="2" opacity="0.7"/>` : ''}
  </g>
</svg>`;
  }

  const DEF = (o) => Object.assign({
    tag: 'HORIZON RP', t1: 'TITRE', t2: 'LIGNE 2', sub: 'Sous-titre de la bannière',
    accent: '#ff9d00', glow: '#ff8a00', grad: 'braise',
    gTag: false, gT1: false, gT2: true, gSub: false,
    bgStyle: 'braise', bg1: '#0b0a0c', bg2: '#141017',
    logo: true, side: 'left', shape: 'rounded', bolt: true, logoText: 'VH',
    logoBg: '#141317', logoFg: '#f3f1ee', logoImg: '',
    embers: 16, streak: true, border: true, borderColor: '#ffbb3d', vignette: false,
    titleSize: 76, align: 'start',
    anim: true, animEmbers: true, animGlow: true, animSweep: true, animSpeed: 5,
  }, o);

  const PRESETS = [
    DEF({ key: 'groupes', t1: 'REPRISE DE', t2: 'GROUPES', sub: 'Cartels · Gangs · Clubs motards — dossiers illégaux', accent: '#ff3b3b', glow: '#ff5a2a', grad: 'feu', bgStyle: 'alerte' }),
    DEF({ key: 'entreprises', t1: "REPRISE D'", t2: 'ENTREPRISES', sub: 'Services · Garages · Restaurants · Farm', accent: '#43d162', glow: '#2bd6a0', grad: 'toxique', bgStyle: 'toxic' }),
    DEF({ key: 'boutique', t1: 'BOUTIQUE', t2: 'OFFICIELLE', sub: 'VIP · Véhicules · Packs — soutiens le serveur', accent: '#1fb6d6', glow: '#1fb6d6', grad: 'ocean', bgStyle: 'nuit' }),
    DEF({ key: 'recrutement', t1: 'RECRUTEMENTS', t2: 'STAFF', sub: 'Postule dès maintenant et deviens un pilier du serveur', accent: '#ff9d00', glow: '#ff8a00', grad: 'or', bgStyle: 'braise' }),
    DEF({ key: 'serveur', tag: 'FIVEM · GTA-RP', t1: 'VOLT', t2: 'HORIZON RP', sub: "Los Santos t'attend — immersion & sérieux", grad: 'braise', bgStyle: 'spot' }),
  ];
  const LS = 'volt_banners_v2';

  let inited = false;
  window.initBannerEditor = function () {
    if (inited) return;
    inited = true;
    const root = document.getElementById('beRoot');
    if (!root) return;

    let state = load(), cur = 0;
    const openGroups = { Texte: 1, Logo: 1, Fond: 1, Couleurs: 1, Effets: 0 };

    function load() {
      try {
        const s = JSON.parse(localStorage.getItem(LS));
        if (Array.isArray(s) && s.length === PRESETS.length) return s.map((x, i) => DEF({ ...x, key: PRESETS[i].key }));
      } catch (e) {}
      return JSON.parse(JSON.stringify(PRESETS));
    }
    function persist() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }

    root.innerHTML =
      `<div class="be-tabs"></div><div class="be-wrap">` +
      `<div class="be-form"></div>` +
      `<div class="be-right"><canvas class="be-cv" width="1200" height="400"></canvas>` +
      `<div class="be-actions"><button class="btn-accent be-dl" type="button">💾 PNG</button>` +
      `<button class="linkbtn be-gif" type="button">🎞️ GIF animé</button>` +
      `<button class="linkbtn be-webm" type="button">WEBM (3 s)</button>` +
      `<button class="linkbtn be-dlall" type="button">Tout en PNG</button>` +
      `<button class="linkbtn be-reset" type="button">Réinitialiser cet onglet</button></div>` +
      `<p class="muted">Pour une bannière <b>animée dans l'embed Discord</b> : exporte le <b>GIF</b>, upload-le, colle son lien dans le champ « Bannière » du panneau.</p>` +
      `<p class="muted">1200×400. Télécharge, puis upload sur Discord et colle l'URL dans le champ « Bannière » du panneau.</p></div></div>`;

    const $ = (s) => root.querySelector(s);
    const cv = $('.be-cv'), ctx = cv.getContext('2d');
    let baseImg = null, raf = null, t0 = 0;

    // braises mobiles + sweep + halo, dessinés par-dessus l'image de base (sur n'importe quel contexte 2D)
    function drawOverlayOn(g2, t) {
      const b = state[cur];
      if (!b.anim) return;
      const spd = (+b.animSpeed || 5) / 5;
      if (b.animGlow) {
        const g = g2.createRadialGradient(W / 2, H * 1.15, 0, W / 2, H * 1.15, H * 1.1);
        const a = 0.10 + 0.09 * (0.5 + 0.5 * Math.sin((t / 900) * spd));
        g.addColorStop(0, hexA(b.glow, a)); g.addColorStop(1, hexA(b.glow, 0));
        g2.fillStyle = g; g2.fillRect(0, 0, W, H);
      }
      if (b.animEmbers) {
        const N = Math.max(6, +b.embers || 12);
        g2.save();
        for (let i = 0; i < N; i++) {
          const seed = i * 137.5, sp = 18 + (i % 5) * 9;
          const x = (seed * 7.3) % W;
          const y = H + 30 - (((t / 1000) * sp * spd + seed) % (H + 120));
          const r = 1.5 + (i % 3);
          const a = Math.max(0, Math.min(1, (y / H) * 0.9)) * (0.5 + 0.5 * Math.sin(t / 300 + i));
          g2.beginPath(); g2.arc(x, y, r, 0, 7);
          g2.fillStyle = hexA(b.glow, 0.9 * a); g2.shadowColor = b.glow; g2.shadowBlur = r * 6;
          g2.fill();
        }
        g2.restore();
      }
      if (b.animSweep) {
        const x = -500 + (((t / 14) * spd) % (W + 1000));
        g2.save();
        g2.translate(x, 0); g2.rotate(-0.31);
        const g = g2.createLinearGradient(0, 0, 260, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.13)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        g2.fillStyle = g; g2.fillRect(0, -200, 260, H + 400);
        g2.restore();
      }
    }
    const overlay = (t) => drawOverlayOn(ctx, t);
    function loop(ts) {
      if (!t0) t0 = ts;
      const t = ts - t0;
      if (baseImg) { ctx.clearRect(0, 0, W, H); ctx.drawImage(baseImg, 0, 0, W, H); overlay(t); }
      raf = requestAnimationFrame(loop);
    }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = null; t0 = 0; }
    function draw() {
      stopLoop();
      const b = state[cur];
      const img = new Image();
      img.onload = () => {
        baseImg = img;
        ctx.clearRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
        if (b.anim) raf = requestAnimationFrame(loop);
      };
      img.onerror = () => { ctx.fillStyle = '#300'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.fillText('rendu impossible', 20, 30); };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgFor(b, { baseForAnim: b.anim }))));
    }
    function hexA(h, a) {
      const n = parseInt(h.slice(1), 16);
      return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
    }
    function set(k, v) { state[cur][k] = v; persist(); draw(); }
    function renderTabs() {
      const t = $('.be-tabs'); t.innerHTML = '';
      state.forEach((b, i) => {
        const bt = document.createElement('button');
        bt.textContent = b.key; bt.className = i === cur ? 'on' : '';
        bt.onclick = () => { cur = i; renderTabs(); renderForm(); draw(); };
        t.appendChild(bt);
      });
    }
    const txt = (l, k) => `<label>${l}</label><input type="text" data-k="${k}" value="${esc(state[cur][k])}">`;
    const col = (l, k) => `<label>${l}</label><input type="color" data-k="${k}" value="${state[cur][k]}">`;
    const sel = (l, k, o) => `<label>${l}</label><select data-k="${k}">${o.map(([v, t]) => `<option value="${v}"${state[cur][k] === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    const rng = (l, k, mn, mx) => `<label>${l} : <b>${state[cur][k]}</b></label><input type="range" data-k="${k}" min="${mn}" max="${mx}" value="${state[cur][k]}">`;
    const chk = (l, k) => `<label class="be-chk"><input type="checkbox" data-k="${k}" ${state[cur][k] ? 'checked' : ''}> ${l}</label>`;
    const grp = (name, inner) => `<div class="be-grp${openGroups[name] ? '' : ' closed'}" data-g="${name}"><h4>${name}</h4><div class="be-gbody">${inner}</div></div>`;

    function miniSvg(k, b) {
      DEFS_EXTRA = '';
      const layer = (BG[k] || BG.braise)({ ...b, bgStyle: k });
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="rg" cx="0.5" cy="1.15" r="0.9"><stop offset="0" stop-color="${b.glow}" stop-opacity="0.5"/><stop offset="1" stop-color="${b.glow}" stop-opacity="0"/></radialGradient><radialGradient id="rg2"/><pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="#fff" opacity="0.05"/></pattern><pattern id="stripes" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="17" height="34" fill="#fff" opacity="0.03"/></pattern>${DEFS_EXTRA}</defs>${layer}</svg>`;
    }

    function renderForm() {
      const b = state[cur];
      const bgThumbs = BG_KEYS.map((k) => `<button data-bg="${k}" class="${b.bgStyle === k ? 'on' : ''}" title="${BG_LBL[k]}">${miniSvg(k, b)}</button>`).join('');
      const gradBtns = GRAD_KEYS.map((k) => `<button data-grad="${k}" class="${b.grad === k ? 'on' : ''}" style="background:linear-gradient(90deg,${GRAD[k].join(',')})">${k}</button>`).join('');
      $('.be-form').innerHTML =
        grp('Texte',
          txt('Petit texte du haut', 'tag') + txt('Titre — ligne 1', 't1') + txt('Titre — ligne 2 (en dégradé)', 't2') + txt('Sous-titre', 'sub') +
          rng('Taille du titre', 'titleSize', 48, 100) +
          (b.logo ? '<p class="muted">Alignement dispo quand le logo est masqué.</p>' : sel('Alignement', 'align', [['start', 'Gauche'], ['middle', 'Centré'], ['end', 'Droite']]))
        ) +
        grp('Logo',
          chk('Afficher le logo', 'logo') +
          sel('Côté', 'side', [['left', 'À gauche'], ['right', 'À droite']]) +
          sel('Forme', 'shape', [['square', 'Carré'], ['rounded', 'Carré arrondi'], ['circle', 'Rond']]) +
          txt('Texte du monogramme (ex : VH)', 'logoText') +
          chk('Éclair sur le logo', 'bolt') +
          `<div class="be-row"><div>${col('Fond du carré', 'logoBg')}</div><div>${col('Couleur du texte', 'logoFg')}</div></div>` +
          `<label>Image perso (remplace le monogramme)</label><input type="file" class="be-logofile" accept="image/*">` +
          (b.logoImg ? `<p class="muted">Image chargée. <a href="#" class="be-clearimg">retirer</a></p>` : '<p class="muted">Fichier local — aucun souci d\'hébergement.</p>')
        ) +
        grp('Fond',
          `<label>Modèle de fond</label><div class="be-thumbs">${bgThumbs}</div>` +
          `<div class="be-row"><div>${col('Couleur de fond', 'bg1')}</div><div>${col('2e couleur', 'bg2')}</div></div>` +
          col('Couleur des braises / halo', 'glow')
        ) +
        grp('Couleurs',
          col("Couleur d'accent (petit texte + contour)", 'accent') +
          `<label>Modèle de dégradé</label><div class="be-grads">${gradBtns}</div>` +
          `<label>Appliquer le dégradé sur :</label>` +
          chk('Petit texte du haut', 'gTag') + chk('Titre — ligne 1', 'gT1') +
          chk('Titre — ligne 2', 'gT2') + chk('Sous-titre', 'gSub')
        ) +
        grp('Animation',
          chk('Aperçu animé (braises, halo, balayage)', 'anim') +
          chk('Braises qui montent', 'animEmbers') +
          chk('Halo qui pulse', 'animGlow') +
          chk('Trait de lumière qui balaie', 'animSweep') +
          rng('Vitesse', 'animSpeed', 1, 10) +
          `<p class="muted">L'export <b>PNG</b> est figé. L'export <b>WEBM</b> capture 3 s d'animation (à poster dans un salon Discord).</p>`
        ) +
        grp('Effets',
          rng('Densité des braises', 'embers', 0, 30) +
          chk('Traits de lumière en diagonale', 'streak') +
          chk('Assombrissement des bords (vignette)', 'vignette') +
          chk('Bordure', 'border') + col('Couleur de la bordure', 'borderColor')
        );

      const f = $('.be-form');
      f.querySelectorAll('h4').forEach((h) => h.onclick = () => {
        const g = h.parentElement.dataset.g;
        openGroups[g] = openGroups[g] ? 0 : 1;
        h.parentElement.classList.toggle('closed');
      });
      f.querySelectorAll('input[type=text],input[type=color],select').forEach((inp) =>
        inp.addEventListener('input', () => set(inp.dataset.k, inp.value)),
      );
      f.querySelectorAll('input[type=range]').forEach((inp) =>
        inp.addEventListener('input', () => { set(inp.dataset.k, +inp.value); inp.previousElementSibling.querySelector('b').textContent = inp.value; }),
      );
      f.querySelectorAll('input[type=checkbox]').forEach((inp) =>
        inp.addEventListener('change', () => { set(inp.dataset.k, inp.checked); renderForm(); }),
      );
      f.querySelectorAll('[data-bg]').forEach((bt) => bt.onclick = () => { set('bgStyle', bt.dataset.bg); renderForm(); });
      f.querySelectorAll('[data-grad]').forEach((bt) => bt.onclick = () => { set('grad', bt.dataset.grad); renderForm(); });
      const lf = f.querySelector('.be-logofile');
      if (lf) lf.onchange = (e) => {
        const fr = new FileReader();
        fr.onload = () => { set('logoImg', fr.result); renderForm(); };
        fr.readAsDataURL(e.target.files[0]);
      };
      const ci = f.querySelector('.be-clearimg');
      if (ci) ci.onclick = (e) => { e.preventDefault(); set('logoImg', ''); renderForm(); };
    }

    function download(i, cb) {
      const b = state[i], img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(img, 0, 0, W, H);
        try {
          c.toBlob((bl) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(bl);
            a.download = 'banniere-' + b.key + '.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            cb && cb();
          }, 'image/png');
        } catch (e) {
          alert("Export impossible — retire l'image perso ou réessaie.");
        }
      };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgFor(b))));
    }
    $('.be-dl').onclick = () => download(cur);
    $('.be-dlall').onclick = () => { let i = 0; const step = () => { if (i >= state.length) return; download(i++, () => setTimeout(step, 500)); }; step(); };
    $('.be-reset').onclick = () => { state[cur] = DEF({ ...PRESETS[cur] }); persist(); renderForm(); draw(); };
    $('.be-gif').onclick = function () {
      const btn = this;
      if (typeof GIF === 'undefined') { alert('Encodeur GIF non chargé, recharge la page.'); return; }
      const GW = 900, GH = 300, FRAMES = 20, DELAY = 90; // ~1,8 s de boucle
      // image de base (SVG statique complet) à la taille du GIF
      const b = state[cur];
      const savedAnim = b.anim;
      b.anim = true; // le GIF est forcément animé
      const bimg = new Image();
      bimg.onload = () => {
        const gif = new GIF({ workers: 2, quality: 14, width: GW, height: GH, workerScript: '/vendor/gif.worker.js', repeat: 0, background: '#000' });
        const fc = document.createElement('canvas'); fc.width = GW; fc.height = GH;
        const fx = fc.getContext('2d');
        const sx = GW / W, sy = GH / H;
        for (let i = 0; i < FRAMES; i++) {
          const t = i * DELAY;
          fx.setTransform(1, 0, 0, 1, 0, 0);
          fx.clearRect(0, 0, GW, GH);
          fx.drawImage(bimg, 0, 0, GW, GH);
          fx.save();
          fx.scale(sx, sy); // les effets sont calculés en coord. 1200×400
          drawOverlayOn(fx, t);
          fx.restore();
          gif.addFrame(fc, { delay: DELAY, copy: true });
        }
        gif.on('progress', (p) => { btn.textContent = 'GIF ' + Math.round(p * 100) + '%'; });
        gif.on('finished', (blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'banniere-' + b.key + '.gif';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          btn.textContent = '🎞️ GIF animé'; btn.disabled = false;
          b.anim = savedAnim; draw();
        });
        btn.textContent = 'GIF 0%'; btn.disabled = true;
        gif.render();
      };
      bimg.onerror = () => alert('Rendu impossible.');
      bimg.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgFor(b, { baseForAnim: true }))));
    };

    $('.be-webm').onclick = function () {
      const btn = this;
      if (!cv.captureStream || typeof MediaRecorder === 'undefined') { alert('Ton navigateur ne permet pas l\'export vidéo.'); return; }
      const wasAnim = state[cur].anim;
      state[cur].anim = true; draw();
      const stream = cv.captureStream(30);
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' }); }
      catch (e) { try { rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); } catch (e2) { alert('Export vidéo indisponible.'); return; } }
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'banniere-' + state[cur].key + '.webm';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        btn.textContent = '🎞️ WEBM animé (3 s)'; btn.disabled = false;
        state[cur].anim = wasAnim; draw();
      };
      btn.textContent = 'enregistrement…'; btn.disabled = true;
      rec.start();
      setTimeout(() => rec.stop(), 3200);
    };

    renderTabs(); renderForm(); draw();
  };
})();
