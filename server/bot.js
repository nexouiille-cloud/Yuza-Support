import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from 'discord.js';
import { config } from './config.js';
import {
  upsertTicket,
  addMessage,
  isBlacklisted,
  effectiveWelcome,
  effectiveStaffChannel,
  effectiveStaffPingRole,
} from './db.js';
import { saveFromUrl } from './uploads.js';

export const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

let onClientMessage = () => {};
export function setClientMessageHandler(fn) {
  onClientMessage = fn;
}

let onSystemMessage = () => {};
export function setSystemMessageHandler(fn) {
  onSystemMessage = fn;
}

bot.once(Events.ClientReady, async (c) => {
  console.log(`[bot] connecté en tant que ${c.user.tag}`);
  const guilds = await c.guilds.fetch();
  console.log('[bot] serveurs où le bot est présent :');
  for (const [id, g] of guilds) {
    console.log(`      ${g.name}  ->  GUILD_ID=${id}`);
  }
  if (!guilds.has(config.guildId)) {
    console.log(
      `[bot] ⚠  le GUILD_ID du .env (${config.guildId}) n'est PAS dans cette liste`,
    );
  }
});

// Un client écrit un MP au bot -> ça alimente / crée un ticket.
bot.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;
    if (msg.guild) return; // on ne traite que les MP

    const userId = msg.author.id;
    const username = msg.author.globalName || msg.author.username;

    if (isBlacklisted(userId)) {
      console.log(`[bot] MP ignoré (blacklist) : ${msg.author.tag}`);
      return;
    }

    let text = (msg.content || '').trim();
    const atts = [];
    for (const a of msg.attachments.values()) {
      try {
        atts.push(
          await saveFromUrl(a.url, a.name, a.contentType, config.maxAttachmentBytes),
        );
      } catch (e) {
        console.error('[bot] pièce jointe client non enregistrée :', e.message);
        text += (text ? '\n' : '') + a.url; // fallback : lien brut
      }
    }
    if (!text && !atts.length) return;

    const preview = (text || '📎 pièce jointe').slice(0, 120);
    const res = upsertTicket(userId, username, preview);
    const stored = addMessage(userId, 'client', username, text, atts);
    onClientMessage(stored, res);
    if (res.created || res.reopened) {
      announceNewTicket(username, preview, res);
      sendWelcome(userId, username);
    }
  } catch (err) {
    console.error('[bot] erreur MessageCreate:', err);
  }
});

// Réponse automatique à l'ouverture / relance d'un ticket.
async function sendWelcome(userId, username) {
  const tpl = effectiveWelcome();
  if (!tpl) return;
  const text = tpl.replace(/\{name\}/g, username);
  try {
    await sendDM(userId, text);
    const stored = addMessage(userId, 'system', 'Message auto', text);
    onSystemMessage(stored);
  } catch (err) {
    console.error("[bot] message d'accueil échoué :", err?.message || err);
  }
}

// Annonce dans le salon staff : "X a ouvert un ticket" + ping du rôle.
async function announceNewTicket(username, preview, res) {
  const channelId = effectiveStaffChannel();
  if (!channelId) return;
  const pingRole = effectiveStaffPingRole();
  try {
    const ch = await bot.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) return;
    const ping = pingRole ? `<@&${pingRole}> ` : '';
    const verb = res.created ? 'a ouvert un ticket' : 'a relancé un ticket';
    await ch.send({
      content: `${ping}📩 **${username}** ${verb}\n> ${preview || '(pièce jointe)'}`,
      allowedMentions: { roles: pingRole ? [pingRole] : [] },
    });
  } catch (err) {
    console.error('[bot] annonce ticket échouée :', err?.message || err);
  }
}

export async function sendDM(userId, content) {
  const user = await bot.users.fetch(userId);
  await user.send(content);
}

// Envoi d'un fichier au client. file = { buffer, name }
export async function sendDMFile(userId, content, file) {
  const user = await bot.users.fetch(userId);
  await user.send({
    content: content || undefined,
    files: [{ attachment: file.buffer, name: file.name || 'fichier' }],
  });
}

export async function getStaffMember(userId) {
  try {
    const guild = await bot.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(userId);
    const roleIds = [...member.roles.cache.keys()];
    const isStaff = roleIds.some((id) => config.staffRoleIds.includes(id));
    if (!isStaff) {
      console.log(`[auth] ${member.user.tag} : aucun rôle staff détecté`);
      console.log(`       rôles du membre : ${roleIds.join(', ') || '(aucun)'}`);
      console.log(`       rôles attendus  : ${config.staffRoleIds.join(', ')}`);
    }
    // niveau : 1 = support de base, +1 par tier possédé (le plus haut compte)
    let level = isStaff ? 1 : 0;
    config.staffTiers.forEach((tier, i) => {
      if (roleIds.includes(tier.roleId)) level = Math.max(level, i + 2);
    });
    return { member, isStaff, level, roleIds };
  } catch (err) {
    console.error(
      `[auth] getStaffMember échoué (guild=${config.guildId}, user=${userId}) :`,
      err?.message || err,
    );
    return { member: null, isStaff: false, level: 0, roleIds: [] };
  }
}

// Ping d'un rôle dans le salon d'annonce (demande de rôle sur un ticket).
export async function pingRoleInChannel(roleId, text) {
  const channelId = effectiveStaffChannel();
  if (!channelId || !roleId) return;
  try {
    const ch = await bot.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) return;
    await ch.send({
      content: `<@&${roleId}> ${text}`,
      allowedMentions: { roles: [roleId] },
    });
  } catch (err) {
    console.error('[bot] ping rôle échoué :', err?.message || err);
  }
}

export async function startBot() {
  await bot.login(config.botToken);
}
