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

  function svgFor(b) {
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
    ${b.streak ? `<g transform="rotate(-18 600 200)"><rect x="-200" y="60" width="1700" height="70" fill="url(#streak)"/><rect x="-200" y="250" width="1700" height="30" fill="url(#streak)"/></g>` : ''}
    ${b.embers > 0 ? emberDots(b.glow, +b.embers) : ''}
    ${b.vignette ? `<rect width="${W}" height="${H}" fill="url(#vig)"/>` : ''}
    ${logo}
    <g font-family="Impact,'Arial Black',system-ui,sans-serif" text-anchor="${align}">
      <text x="${ax}" y="150" font-size="30" letter-spacing="8" fill="${b.accent}">${esc(b.tag)}</text>
      <text x="${ax}" y="${150 + ts}" font-size="${ts}" letter-spacing="3" fill="#f6f4f1">${esc(b.t1)}</text>
      <text x="${ax}" y="${150 + ts * 2 - 4}" font-size="${ts}" letter-spacing="3" fill="url(#acc)">${esc(b.t2)}</text>
      <rect x="${align === 'middle' ? ax - 180 : align === 'end' ? ax - 360 : ax + 4}" y="${150 + ts * 2 + 18}" width="360" height="5" rx="2" fill="url(#acc)"/>
      <text x="${ax}" y="${150 + ts * 2 + 56}" font-size="24" letter-spacing="2" font-family="Arial,system-ui,sans-serif" fill="#b9b2a8">${esc(b.sub)}</text>
    </g>
    ${b.border ? `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="20" fill="none" stroke="${b.borderColor}" stroke-width="2" opacity="0.7"/>` : ''}
  </g>
</svg>`;
  }

  const DEF = (o) => Object.assign({
    tag: 'HORIZON RP', t1: 'TITRE', t2: 'LIGNE 2', sub: 'Sous-titre de la bannière',
    accent: '#ff9d00', glow: '#ff8a00', grad: 'braise',
    bgStyle: 'braise', bg1: '#0b0a0c', bg2: '#141017',
    logo: true, side: 'left', shape: 'rounded', bolt: true, logoText: 'VH',
    logoBg: '#141317', logoFg: '#f3f1ee', logoImg: '',
    embers: 16, streak: true, border: true, borderColor: '#ffbb3d', vignette: false,
    titleSize: 76, align: 'start',
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
      `<div class="be-actions"><button class="btn-accent be-dl" type="button">💾 Télécharger ce PNG</button>` +
      `<button class="linkbtn be-dlall" type="button">Tout télécharger</button>` +
      `<button class="linkbtn be-reset" type="button">Réinitialiser cet onglet</button></div>` +
      `<p class="muted">1200×400. Télécharge, puis upload sur Discord et colle l'URL dans le champ « Bannière » du panneau.</p></div></div>`;

    const $ = (s) => root.querySelector(s);
    const cv = $('.be-cv'), ctx = cv.getContext('2d');

    function draw() {
      const img = new Image();
      img.onload = () => { ctx.clearRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H); };
      img.onerror = () => { ctx.fillStyle = '#300'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.fillText('rendu impossible', 20, 30); };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgFor(state[cur]))));
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
          `<label>Dégradé du titre & de la barre</label><div class="be-grads">${gradBtns}</div>`
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

    renderTabs(); renderForm(); draw();
  };
})();
