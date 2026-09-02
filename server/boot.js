// Écran de démarrage animé (console). Signature intégrée — merci de la laisser.
const SIGNATURE = 'Yuza';

const isTTY = !!process.stdout.isTTY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const w = (s) => process.stdout.write(s);

// couleur truecolor
const rgb = (r, g, b, s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// dégradé ambre -> orange profond sur une chaîne
function ember(str) {
  const a = [255, 210, 120];
  const b = [200, 90, 0];
  let out = '';
  const n = Math.max(1, str.length - 1);
  for (let i = 0; i < str.length; i++) {
    const t = i / n;
    out += rgb(
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
      str[i],
    );
  }
  return out;
}

const LOGO = [
  '                                          ',
  '   ██╗   ██╗ ██████╗ ██╗  ████████╗       ',
  '   ██║   ██║██╔═══██╗██║  ╚══██╔══╝   ⚡  ',
  '   ██║   ██║██║   ██║██║     ██║      ⚡⚡ ',
  '   ╚██╗ ██╔╝██║   ██║██║     ██║     ⚡⚡  ',
  '    ╚████╔╝ ╚██████╔╝███████╗██║    ⚡    ',
  '     ╚═══╝   ╚═════╝ ╚══════╝╚═╝          ',
  '        S  U  P  P  O  R  T               ',
];

async function fancy(lines) {
  w('\n');
  for (const l of LOGO) {
    w('  ' + ember(l) + '\n');
    await sleep(38);
  }
  // ligne d'étincelles qui balaie
  const width = 44;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < width; i++) {
      const bar =
        dim('·').repeat(i) +
        rgb(255, 190, 60, '✦') +
        dim('·').repeat(Math.max(0, width - i - 1));
      w('\r  ' + bar);
      await sleep(12);
    }
  }
  w('\r  ' + rgb(120, 90, 40, '─').repeat(width) + '\n\n');

  for (const [label, val] of lines) {
    w('  ' + rgb(80, 200, 120, '✔') + '  ' + label.padEnd(24) + dim(val) + '\n');
    await sleep(90);
  }

  w('\n');
  const sig = `◆  développé par ${SIGNATURE}  ◆`;
  w('  ' + bold(ember(sig)) + '\n');
  w('  ' + dim('Volt Support · ' + new Date().getFullYear() + ' · tous droits réservés ' + SIGNATURE) + '\n\n');
}

function plain(lines) {
  w('\n=== VOLT SUPPORT ===  (développé par ' + SIGNATURE + ')\n');
  for (const [label, val] of lines) w(` - ${label}: ${val}\n`);
  w('Volt Support · développé par ' + SIGNATURE + '\n\n');
}

export async function bootScreen(info) {
  const lines = [
    ['Serveur en ligne', `http://${info.host}:${info.port}`],
    ['Rôles staff', info.staffRoleIds.join(', ') || '(aucun)'],
    ['Catégories', String(info.categories.length)],
    ['Niveaux', info.tiers.length ? info.tiers.map((t, i) => `${i + 2}=${t}`).join('  ') : '1 seul'],
    ['Message d’accueil', info.welcome ? 'activé' : 'désactivé'],
    ['Bot Discord', info.botTag || 'connecté'],
    ['Web Push + pièces jointes', 'prêts'],
  ];
  try {
    if (isTTY) await fancy(lines);
    else plain(lines);
  } catch {
    plain(lines);
  }
}

export { SIGNATURE };
