import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ActivityType,
  AttachmentBuilder,
} from 'discord.js';
import { config } from './config.js';
import {
  upsertTicket,
  addMessage,
  isBlacklisted,
  effectiveWelcome,
  effectiveStaffChannel,
  effectiveStaffPingRole,
  effectiveCategories,
  effectiveAskCategory,
  effectiveFlood,
  archiveTicket,
  effectivePanel,
  setPanelMessageId,
  effectiveAskRating,
  setTicketRating,
  effectiveAnnounceChannel,
  effectiveSanctionChannel,
  effectiveReportChannel,
  effectiveBotStatus,
  effectiveConvoChannel,
  effectiveShopChannel,
  effectiveRecruit,
  setRecruit,
  getPanel,
  setPanelMsg,
  setTicketCategory,
  getTicket,
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

let onTicketUpdate = () => {};
export function setTicketUpdateHandler(fn) {
  onTicketUpdate = fn;
}

/* ---------------- anti-flood ---------------- */
const floodLog = new Map(); // userId -> [timestamps]
const mutedUntil = new Map(); // userId -> timestamp
function checkFlood(userId) {
  const cfg = effectiveFlood();
  if (!cfg.enabled) return false;
  const now = Date.now();
  if ((mutedUntil.get(userId) || 0) > now) return true;
  const arr = (floodLog.get(userId) || []).filter((t) => now - t < cfg.windowSec * 1000);
  arr.push(now);
  floodLog.set(userId, arr);
  if (arr.length > cfg.count) {
    mutedUntil.set(userId, now + cfg.muteMin * 60000);
    floodLog.delete(userId);
    return true;
  }
  return false;
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
  refreshMembers();
  setInterval(refreshMembers, 10 * 60000).unref?.();
  applyBotStatus();
});

// Statut affiché sous le nom du bot. Plusieurs lignes = ça défile (~7 s).
let statusTimer = null;
export function applyBotStatus() {
  clearInterval(statusTimer);
  statusTimer = null;
  if (!bot.user) return;
  const { lines, type } = effectiveBotStatus();
  const map = {
    playing: ActivityType.Playing,
    watching: ActivityType.Watching,
    listening: ActivityType.Listening,
    custom: ActivityType.Custom,
  };
  const t = map[type] ?? ActivityType.Custom;
  const setLine = (text) => {
    try {
      const activity =
        t === ActivityType.Custom
          ? { name: text, type: ActivityType.Custom, state: text }
          : { name: text, type: t };
      bot.user.setPresence({ activities: [activity], status: 'online' });
    } catch (e) {
      console.error('[bot] statut échoué :', e?.message || e);
    }
  };
  if (!lines.length) {
    try { bot.user.setPresence({ activities: [], status: 'online' }); } catch {}
    return;
  }
  let i = 0;
  setLine(lines[0]);
  if (lines.length > 1) {
    // Discord limite les changements de statut : ~7 s est safe
    statusTimer = setInterval(() => {
      i = (i + 1) % lines.length;
      setLine(lines[i]);
    }, 7000);
    statusTimer.unref?.();
  }
}

/* ---------------- cache des membres du serveur ---------------- */
let membersCache = [];
export async function refreshMembers() {
  try {
    const guild = await bot.guilds.fetch(config.guildId);
    const members = await guild.members.fetch();
    membersCache = [...members.values()]
      .filter((m) => !m.user.bot)
      .map((m) => ({
        id: m.id,
        name: m.nickname || m.user.globalName || m.user.username,
        tag: m.user.username,
        roles: [...m.roles.cache.values()]
          .filter((r) => r.name !== '@everyone')
          .sort((a, b) => b.position - a.position)
          .map((r) => r.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('[bot] refreshMembers échoué :', err?.message || err);
  }
}
export function searchMembers(query, limit = 80) {
  const q = String(query || '').trim().toLowerCase();
  let list = membersCache;
  if (q) {
    list = list.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.tag.toLowerCase().includes(q) ||
        m.id.includes(q) ||
        m.roles.some((r) => r.toLowerCase().includes(q)),
    );
  }
  return { total: list.length, cached: membersCache.length, members: list.slice(0, limit) };
}

// Envoi d'un MP à un membre (convocation) + trace dans le salon d'annonce.
export async function sendConvocation(userId, text, byName) {
  const user = await bot.users.fetch(userId);
  await user.send(text);
  const ch = effectiveStaffChannel();
  if (ch) {
    try {
      const c = await bot.channels.fetch(ch);
      if (c?.isTextBased()) {
        await c.send({
          content: `✉️ **${byName}** a envoyé un MP à <@${userId}>`,
          allowedMentions: { users: [], roles: [] },
        });
      }
    } catch {}
  }
}

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

    if (checkFlood(userId)) {
      const mins = Math.ceil(((mutedUntil.get(userId) || 0) - Date.now()) / 60000);
      const already = getTicket(userId)?.muted_notice;
      if (!already) {
        try {
          await sendDM(userId, `⏳ Tu envoies trop de messages. Merci de patienter ${mins} min, un membre du staff te répondra.`);
        } catch {}
        const t = getTicket(userId);
        if (t) t.muted_notice = true;
      }
      console.log(`[bot] MP ignoré (flood) : ${msg.author.tag}`);
      return;
    }
    { const t = getTicket(userId); if (t) t.muted_notice = false; }

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

    // ticket déjà clôturé -> on l'archive : ce MP crée une NOUVELLE demande
    const prev = getTicket(userId);
    if (prev && prev.status === 'closed') {
      archiveTicket(userId);
      onTicketUpdate(userId); // rafraîchit la liste (l'ancien disparaît)
    }

    const preview = (text || '📎 pièce jointe').slice(0, 120);
    const res = upsertTicket(userId, username, preview);
    const stored = addMessage(userId, 'client', username, text, atts);
    onClientMessage(stored, res);
    if (res.created || res.reopened) {
      announceNewTicket(username, preview, res);
      if (res.created) await askCategory(userId);
      sendWelcome(userId, username);
    }
  } catch (err) {
    console.error('[bot] erreur MessageCreate:', err);
  }
});

// Boutons de catégorie envoyés au client au 1er MP.
async function askCategory(userId) {
  if (!effectiveAskCategory()) return;
  const cats = effectiveCategories().slice(0, 25);
  if (!cats.length) return;
  try {
    const rows = [];
    for (let i = 0; i < cats.length; i += 5) {
      rows.push(
        new ActionRowBuilder().addComponents(
          cats.slice(i, i + 5).map((c) =>
            new ButtonBuilder()
              .setCustomId('cat:' + c.slice(0, 90))
              .setLabel(c.slice(0, 80))
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      );
    }
    await sendDM(userId, {
      content: '👉 Choisis la catégorie qui correspond à ta demande :',
      components: rows,
    });
  } catch (err) {
    console.error('[bot] menu catégorie échoué :', err?.message || err);
  }
}

// Clics sur les boutons : panneau support, note de satisfaction, catégorie.
bot.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    const id = interaction.customId;
    const uid = interaction.user.id;

    // --- bouton « Ouvrir un ticket » du panneau ---
    if (id === 'open_ticket') {
      if (isBlacklisted(uid)) {
        await interaction.reply({ content: 'Tu ne peux pas ouvrir de ticket.', ephemeral: true });
        return;
      }
      try {
        await interaction.user.send(
          '👋 Décris ton problème ici, en message privé — un membre du staff te répondra dès que possible.',
        );
        await interaction.reply({
          content: '📩 Regarde tes messages privés : écris-nous ta demande là-bas.',
          ephemeral: true,
        });
      } catch {
        await interaction.reply({
          content:
            "⚠ Je n'arrive pas à t'envoyer de MP. Autorise les messages privés des membres du serveur (Paramètres → Confidentialité), puis réessaie.",
          ephemeral: true,
        });
      }
      return;
    }

    // --- note de satisfaction (1 à 5) ---
    if (id.startsWith('rate:')) {
      const n = parseInt(id.slice(5), 10);
      if (!getTicket(uid) || !(n >= 1 && n <= 5)) {
        await interaction.reply({ content: "Ce retour n'est plus disponible.", ephemeral: true });
        return;
      }
      setTicketRating(uid, n);
      const sys = addMessage(uid, 'system', 'Système', `⭐ Le client a noté le support : ${n}/5`);
      onSystemMessage(sys);
      onTicketUpdate(uid);
      await interaction.update({
        content: `Merci pour ton retour ! (${'★'.repeat(n)}${'☆'.repeat(5 - n)})`,
        components: [],
      });
      return;
    }

    // --- bouton de catégorie ---
    if (id.startsWith('cat:')) {
      const cat = id.slice(4);
      if (!getTicket(uid) || !effectiveCategories().includes(cat)) {
        await interaction.reply({ content: 'Catégorie indisponible.', ephemeral: true });
        return;
      }
      setTicketCategory(uid, cat);
      const sys = addMessage(uid, 'system', 'Système', `Catégorie choisie par le client : ${cat}`);
      onSystemMessage(sys);
      onTicketUpdate(uid);
      await interaction.update({
        content: `✅ Catégorie : **${cat}**. Un membre du staff va te répondre.`,
        components: [],
      });
      return;
    }
  } catch (err) {
    console.error('[bot] interaction bouton échouée :', err?.message || err);
  }
});

// Publie (ou met à jour) le panneau « Contacter le support » dans son salon.
export async function publishSupportPanel() {
  const p = effectivePanel();
  if (!p.channelId) throw new Error('salon non configuré');
  const ch = await bot.channels.fetch(p.channelId);
  if (!ch || !ch.isTextBased()) throw new Error('salon introuvable');
  const embed = new EmbedBuilder()
    .setTitle(p.title)
    .setDescription(p.description)
    .setColor(0xff9d00);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket')
      .setLabel(p.buttonLabel)
      .setStyle(ButtonStyle.Primary),
  );
  if (p.messageId) {
    try {
      const m = await ch.messages.fetch(p.messageId);
      await m.edit({ embeds: [embed], components: [row] });
      return { edited: true, messageId: m.id };
    } catch {
      /* message supprimé : on en poste un nouveau */
    }
  }
  const m = await ch.send({ embeds: [embed], components: [row] });
  setPanelMessageId(m.id);
  return { edited: false, messageId: m.id };
}

// Envoie au client les boutons de note de satisfaction (après clôture).
export async function sendRatingRequest(userId) {
  if (!effectiveAskRating()) return;
  try {
    const row = new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map((n) =>
        new ButtonBuilder()
          .setCustomId('rate:' + n)
          .setLabel('⭐'.repeat(n))
          .setStyle(ButtonStyle.Secondary),
      ),
    );
    await sendDM(userId, {
      content:
        "Comment évaluerais-tu l'aide reçue ? (1 = pas satisfait · 5 = très satisfait)",
      components: [row],
    });
  } catch (err) {
    console.error('[bot] demande de note échouée :', err?.message || err);
  }
}

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
    // rôle Discord le plus haut (hors @everyone) — affiché dans le site
    const topRole = [...member.roles.cache.values()]
      .filter((r) => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)[0];
    const roleName = topRole ? topRole.name : null;
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
    return { member, isStaff, level, roleIds, roleName };
  } catch (err) {
    console.error(
      `[auth] getStaffMember échoué (guild=${config.guildId}, user=${userId}) :`,
      err?.message || err,
    );
    return { member: null, isStaff: false, level: 0, roleIds: [], roleName: null };
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

// Publie une annonce dans le salon annonces.
export async function postAnnouncement(text, byName) {
  const channelId = effectiveAnnounceChannel();
  if (!channelId) throw new Error('salon annonces non configuré');
  const ch = await bot.channels.fetch(channelId);
  if (!ch || !ch.isTextBased()) throw new Error('salon annonces introuvable');
  const embed = new EmbedBuilder()
    .setDescription(String(text).slice(0, 4000))
    .setColor(0xff9d00)
    .setFooter({ text: `Annonce · ${byName || 'staff'}` })
    .setTimestamp(new Date());
  await ch.send({ embeds: [embed] });
}

// Trace une sanction dans le salon sanctions.
export async function postSanction({ targetId, targetName, reason, byName, count }) {
  const channelId = effectiveSanctionChannel();
  if (!channelId) return;
  try {
    const ch = await bot.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle(`⚠ Sanction ${count}/3`)
      .setColor(count >= 3 ? 0xff5f5f : 0xff9d00)
      .addFields(
        { name: 'Membre', value: `${targetName} (<@${targetId}>)`, inline: false },
        { name: 'Raison', value: reason || '—', inline: false },
        { name: 'Par', value: byName || '—', inline: true },
      )
      .setTimestamp(new Date());
    if (count >= 3) {
      embed.setDescription("**3 sanctions atteintes → accès au site retiré.**");
    }
    await ch.send({ embeds: [embed], allowedMentions: { users: [] } });
  } catch (err) {
    console.error('[bot] trace sanction échouée :', err?.message || err);
  }
}

// Trace un signalement (bug / problème) dans le salon dédié.
export async function postReport({ byName, kind, text }) {
  const channelId = effectiveReportChannel();
  if (!channelId) return;
  try {
    const ch = await bot.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle(kind === 'bug' ? '🐞 Bug signalé' : '⚠ Problème signalé')
      .setDescription(String(text).slice(0, 4000))
      .setColor(kind === 'bug' ? 0xff5f5f : 0xff9d00)
      .setFooter({ text: `par ${byName || 'staff'}` })
      .setTimestamp(new Date());
    await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error('[bot] trace signalement échouée :', err?.message || err);
  }
}

/* ---------------- convocations ---------------- */
export async function postConvocation({ targetId, targetName, byName, reason, when, text }) {
  const user = await bot.users.fetch(targetId);
  const body =
    text ||
    `📌 **Convocation**\n` +
      (reason ? `**Motif :** ${reason}\n` : '') +
      (when ? `**Quand :** ${when}\n` : '') +
      `\nMerci de te rendre disponible. — L'équipe`;
  await user.send(body);
  const ch = effectiveConvoChannel();
  if (ch) {
    try {
      const c = await bot.channels.fetch(ch);
      if (c?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('📌 Convocation envoyée')
          .setColor(0xff9d00)
          .addFields(
            { name: 'Membre', value: `${targetName} (<@${targetId}>)` },
            { name: 'Par', value: byName || '—', inline: true },
            ...(reason ? [{ name: 'Motif', value: reason, inline: true }] : []),
            ...(when ? [{ name: 'Quand', value: when }] : []),
          )
          .setTimestamp(new Date());
        await c.send({ embeds: [embed], allowedMentions: { users: [] } });
      }
    } catch {}
  }
}

/* ---------------- panneaux « Reprise » ---------------- */
const PANEL_EMOJI = {
  circle: { ok: '🟢', no: '🔴', slot: '🟢' },
  square: { ok: '🟩', no: '🟥', slot: '🟩' },
};

// télécharge une image (pour l'attacher au message : Discord l'héberge, elle s'affiche toujours)
async function fetchImage(url, max = 8 * 1024 * 1024) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error('http ' + r.status);
  const ab = await r.arrayBuffer();
  if (ab.byteLength > max) throw new Error('image trop lourde');
  if (ab.byteLength < 64) throw new Error('fichier vide');
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const low = url.toLowerCase();
  const ext =
    ct.includes('gif') || low.includes('.gif') ? 'gif'
    : ct.includes('webp') || low.includes('.webp') ? 'webp'
    : ct.includes('jpeg') || ct.includes('jpg') || /\.jpe?g/.test(low) ? 'jpg'
    : 'png';
  return { buf: Buffer.from(ab), ext };
}

export async function publishReprisePanel(id) {
  const p = getPanel(id);
  if (!p) throw new Error('panneau introuvable');
  if (!p.channelId) throw new Error('salon non configuré');
  const ch = await bot.channels.fetch(p.channelId);
  if (!ch || !ch.isTextBased()) throw new Error('salon introuvable');

  const embed = new EmbedBuilder().setColor(parseInt(p.color.slice(1), 16) || 0xff9d00);
  if (p.title) embed.setTitle(p.title);
  if (p.footer) embed.setFooter({ text: p.footer });

  // sections dans la description (rendu propre, comme sur les panneaux Horizon)
  const EM = PANEL_EMOJI[p.statusStyle] || PANEL_EMOJI.circle;
  const eOk = p.emojiOk || EM.ok;
  const eNo = p.emojiNo || EM.no;
  const eSlot = p.emojiSlot || p.emojiOk || EM.slot;
  const emFor = (st) => (st === 'no' ? eNo : st === 'slot' ? eSlot : eOk);
  let desc = p.description ? p.description.trim() + '\n' : '';
  for (const s of p.sections) {
    if (s.header) desc += `\n**${s.header}**\n`;
    else desc += '\n';
    desc += s.items.map((it) => `${emFor(it.status)} ${it.label}`).join('\n') + '\n';
  }
  embed.setDescription((desc.trim() || '—').slice(0, 4096));

  // bannière + icône : on les télécharge et on les JOINT au message
  const files = [];
  if (p.bannerUrl) {
    try {
      const { buf, ext } = await fetchImage(p.bannerUrl);
      files.push(new AttachmentBuilder(buf, { name: `banner.${ext}` }));
      embed.setImage(`attachment://banner.${ext}`);
    } catch (e) {
      console.error('[bot] bannière panneau non chargée :', e?.message || e);
      if (/^https?:\/\//.test(p.bannerUrl)) embed.setImage(p.bannerUrl); // fallback URL directe
    }
  }
  if (p.iconUrl) {
    try {
      const { buf, ext } = await fetchImage(p.iconUrl);
      files.push(new AttachmentBuilder(buf, { name: `icon.${ext}` }));
      embed.setThumbnail(`attachment://icon.${ext}`);
    } catch (e) {
      if (/^https?:\/\//.test(p.iconUrl)) embed.setThumbnail(p.iconUrl);
    }
  }

  if (p.messageId) {
    try {
      const m = await ch.messages.fetch(p.messageId);
      await m.edit({ content: '', embeds: [embed], files, attachments: [] });
      return { edited: true, messageId: m.id };
    } catch {}
  }
  const m = await ch.send({ embeds: [embed], files });
  setPanelMsg(id, m.id);
  return { edited: false, messageId: m.id };
}

/* ---------------- boutique ---------------- */
export async function postShopAnnounce({ title, text, bannerUrl, linkUrl, linkLabel, channelId }) {
  const chId = channelId || effectiveShopChannel();
  if (!chId) throw new Error('salon boutique non configuré');
  const ch = await bot.channels.fetch(chId);
  if (!ch || !ch.isTextBased()) throw new Error('salon boutique introuvable');
  const embed = new EmbedBuilder().setColor(0x1fb6d6);
  if (title) embed.setTitle(title);
  if (text) embed.setDescription(text);
  const files = [];
  if (bannerUrl) {
    try {
      const { buf, ext } = await fetchImage(bannerUrl);
      files.push(new AttachmentBuilder(buf, { name: `shop.${ext}` }));
      embed.setImage(`attachment://shop.${ext}`);
    } catch (e) {
      if (/^https?:\/\//.test(bannerUrl)) embed.setImage(bannerUrl);
    }
  }
  if (linkUrl) embed.addFields({ name: '​', value: `🔗 [${linkLabel || 'Voir la boutique'}](${linkUrl})` });
  const row = linkUrl
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(linkLabel || 'Ouvrir la boutique').setURL(linkUrl),
        ),
      ]
    : [];
  await ch.send({ embeds: [embed], components: row, files });
}

/* ---------------- recrutement staff ---------------- */
export async function publishRecruit() {
  const r = effectiveRecruit();
  if (!r.channelId) throw new Error('salon recrutement non configuré');
  const ch = await bot.channels.fetch(r.channelId);
  if (!ch || !ch.isTextBased()) throw new Error('salon recrutement introuvable');
  const embed = new EmbedBuilder()
    .setTitle(r.open ? '✅ Recrutements staff — OUVERTS' : '❌ Recrutements staff — FERMÉS')
    .setDescription(r.open ? r.textOpen : r.textClosed)
    .setColor(r.open ? 0x43d162 : 0xff5f5f)
    .setTimestamp(new Date());
  const files = [];
  if (r.bannerUrl) {
    try {
      const { buf, ext } = await fetchImage(r.bannerUrl);
      files.push(new AttachmentBuilder(buf, { name: `recruit.${ext}` }));
      embed.setImage(`attachment://recruit.${ext}`);
    } catch (e) {
      if (/^https?:\/\//.test(r.bannerUrl)) embed.setImage(r.bannerUrl);
    }
  }
  if (r.open && r.formUrl) embed.addFields({ name: '​', value: `📝 [Formulaire de candidature](${r.formUrl})` });
  const components =
    r.open && r.formUrl
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Formulaire de recrutement').setURL(r.formUrl),
          ),
        ]
      : [];
  const content = r.open && r.roleId ? `<@&${r.roleId}>` : undefined;
  const allowedMentions = r.roleId ? { roles: [r.roleId] } : { parse: [] };

  if (r.messageId) {
    try {
      const m = await ch.messages.fetch(r.messageId);
      await m.edit({ content: content ?? '', embeds: [embed], components, allowedMentions, files, attachments: [] });
      return { edited: true, messageId: m.id };
    } catch {}
  }
  const m = await ch.send({ content, embeds: [embed], components, allowedMentions, files });
  setRecruit({ messageId: m.id });
  return { edited: false, messageId: m.id };
}

export async function startBot() {
  await bot.login(config.botToken);
}
