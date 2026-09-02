import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCategories() {
  const fallback = ['Support general', 'Refund', 'Boutique', 'Ban/UnBan', 'Autre'];
  const file = join(__dirname, 'categories.json');
  if (!existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(parsed) && parsed.length) {
      return [...new Set(parsed.map((s) => String(s).trim()).filter(Boolean))];
    }
  } catch (e) {
    console.error('[config] categories.json invalide, liste par défaut:', e.message);
  }
  return fallback;
}

// Message d'accueil auto : contenu de server/welcome.txt (vide = désactivé).
function loadWelcome() {
  try {
    const txt = readFileSync(join(__dirname, 'welcome.txt'), 'utf8').trim();
    return txt || null;
  } catch {
    return null;
  }
}

// Blacklist de départ : server/blacklist.json (tableau d'IDs Discord).
function loadBlacklistSeed() {
  try {
    const parsed = JSON.parse(readFileSync(join(__dirname, 'blacklist.json'), 'utf8'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function req(name) {
  const v = process.env[name];
  if (!v || v.startsWith('colle-ici') || v.startsWith('id-de') || v.startsWith('id-du') || v.startsWith('remplace-moi')) {
    console.error(`\n[config] Variable manquante ou non remplie dans .env : ${name}\n`);
    process.exit(1);
  }
  return v;
}

const port = Number(process.env.PORT || 53134);
const host = process.env.HOST || '127.0.0.1';

// IDs Discord des "owners" : accès complet aux Réglages.
// Vide => on retombe sur "niveau le plus élevé".
const ownerIds = (process.env.OWNER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const staffRoleIds = req('STAFF_ROLE_IDS')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// STAFF_TIERS = "Responsable:roleId,Admin:roleId" (du plus bas au plus haut).
// Niveau d'un staff : 1 (support de base), 2 = 1er tier, 3 = 2e tier, ...
function parseTiers() {
  return (process.env.STAFF_TIERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.lastIndexOf(':');
      return i === -1
        ? { name: pair, roleId: '' }
        : { name: pair.slice(0, i).trim(), roleId: pair.slice(i + 1).trim() };
    })
    .filter((t) => t.name && t.roleId);
}

export const config = {
  botToken: req('BOT_TOKEN'),
  clientId: req('CLIENT_ID'),
  clientSecret: req('CLIENT_SECRET'),
  guildId: req('GUILD_ID'),
  staffRoleIds,
  ownerIds,
  port,
  host,
  oauthRedirectUri:
    process.env.OAUTH_REDIRECT_URI || `http://127.0.0.1:${port}/auth/callback`,
  sessionSecret: req('SESSION_SECRET'),
  staffSuffix: process.env.STAFF_SUFFIX || '(Staff)',
  roleRecheckSeconds: Number(process.env.ROLE_RECHECK_SECONDS || 300),
  categories: loadCategories(),
  // salon Discord d'annonce des nouveaux tickets (optionnel)
  staffChannelId: (process.env.STAFF_CHANNEL_ID || '').trim(),
  // rôle à ping dans l'annonce (par défaut : 1er rôle staff)
  staffPingRoleId:
    (process.env.STAFF_PING_ROLE_ID || '').trim() || staffRoleIds[0] || '',
  // hiérarchie d'escalade
  staffTiers: parseTiers(),
  // message d'accueil auto (null = désactivé)
  welcomeMessage: loadWelcome(),
  // blacklist de départ (IDs qui ne peuvent pas ouvrir de ticket)
  blacklistSeed: loadBlacklistSeed(),
  // adresse de contact pour les serveurs de push (VAPID)
  pushContact: process.env.PUSH_CONTACT || 'mailto:admin@example.com',
  // taille max d'une pièce jointe staff -> client (octets)
  maxAttachmentBytes: Number(process.env.MAX_ATTACHMENT_BYTES || 25 * 1024 * 1024),
  // statut affiché sous le nom du bot (surchargé par les Réglages du site)
  botActivity: (process.env.BOT_ACTIVITY || '').trim(),
  botActivityType: (process.env.BOT_ACTIVITY_TYPE || 'custom').trim(),
};

export const maxLevel = config.staffTiers.length + 1;

export function levelName(level) {
  if (level <= 1) return 'Support';
  return config.staffTiers[level - 2]?.name || `Niveau ${level}`;
}
