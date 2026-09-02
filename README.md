# Volt Support

Bot Discord relais de tickets + interface staff web (thème "Volt", GTA-RP / FiveM).

- Un **client** écrit un MP au bot Discord → ça crée / alimente un ticket.
- Le **staff** ouvre l'URL du site, se connecte avec Discord (cookie de session,
  12 h). Le backend vérifie qu'il a un **rôle staff** sur le serveur.
- Le staff répond depuis le site → le bot envoie la réponse dans le MP du client,
  préfixée `Pseudo (Staff) : ...`.
- Rôle staff retiré → accès coupé (à la connexion + toutes les 5 min).

```
server/     bot Discord + backend HTTP/WebSocket (le token vit ICI)
  index.js    point d'entrée : routes OAuth, /api/*, statique, gateway
  config.js   lecture .env + categories.json + welcome.txt + blacklist.json
  bot.js      client discord.js : DM clients, envoi DM, message d'accueil, blacklist
  auth.js     OAuth2 Discord + sessions signées HMAC
  gateway.js  WebSocket : toute la logique tickets (réponses, notes, escalade…)
  db.js       stockage JSON (tickets, messages, blacklist, abonnements push)
  push.js     Web Push (clés VAPID, envoi filtré par niveau)
  uploads.js  pièces jointes -> dossier uploads/
web/        interface staff (servie par le serveur)
  index.html  connexion + rail de nav + vues Accueil / Tickets / Stats
  app.js      logique client (WebSocket, rendu, vues)
  style.css   thème "Volt" (variables CSS, animations)
  sw.js       service worker (notifications push)
launcher/   ancienne app Electron — ABANDONNÉE, ne pas utiliser
data.json   base (créée au 1er lancement ; sur un volume si DATA_DIR défini)
```

---

## Fonctionnalités (toutes en place)

| Domaine | Détail |
|---|---|
| **Tickets** | créés depuis un MP au bot ; liste groupée par catégorie, repliable |
| **Réponses** | staff → client en MP Discord ; auto-assignation à la 1re réponse |
| **Notes internes** | case à cocher ; visibles par tout le staff, jamais envoyées au client (= chat interne du ticket) |
| **Renommer** | bouton ✏️ : donner un titre au ticket (sinon = pseudo client) |
| **Priorité** | basse / normale / haute / urgente ; pastille colorée ; urgents remontés en haut |
| **Assignation** | Prendre / Lâcher / Reprendre ; 🔒 dans la liste + en-tête ; trace écrite dans la conversation |
| **Catégories** | éditables dans `server/categories.json` ; menu par ticket |
| **Escalade** | si `STAFF_TIERS` défini : menu niveau ; escalader = les staff sous ce niveau **perdent l'accès au contenu** (vérifié serveur) |
| **Historique** | filtres Ouverts / Non assignés / Clôturés / Tous + recherche (nom, ID, contenu des messages) |
| **Vue Staff** | bouton 👁 : masque les messages client, ne montre que staff + notes + système |
| **Pièces jointes** | client → image/fichier visible dans la conversation ; staff → bouton 📎 renvoie un fichier au client |
| **Blacklist** | bouton 🚫 : le client ne peut plus ouvrir de ticket. Liste de départ : `server/blacklist.json` |
| **Message d'accueil** | réponse auto à l'ouverture d'un ticket. Texte : `server/welcome.txt` ou Réglages (`{name}` = pseudo ; vide = désactivé) |
| **Message de clôture** | MP auto envoyé au client quand un ticket est clôturé. Éditable dans Réglages (`{name}` ; activé par défaut). |
| **Stats** | vue dédiée : total / ouverts / clôturés / non assignés, temps de réponse moyen, graphe 14 j, par catégorie, par staff |
| **Notifications** | toast navigateur (onglet ouvert) + **Web Push** (onglet fermé, HTTPS requis) + compteur dans le titre + ping Discord dans un salon (`STAFF_CHANNEL_ID`) |
| **Accueil** | écran à cartes : Tickets ouverts, Non assignés, Statistiques (+ Macros / Réglages « bientôt ») |
| **Présence staff** | qui est en ligne — chips sur l'accueil + onglet **👥 Équipe** (liste nom/rôle) + compteur dans la barre de statut, temps réel |
| **Fiche membre** | recherche pseudo/ID sur l'accueil (ou bouton 👤 dans un ticket) → profil : 1er contact, nb messages, staff ayant répondu, statut, blacklist… |
| **Annuaire du serveur** | onglet 📇 : tous les membres Discord + leurs rôles, recherche par pseudo ou rôle, bouton **✉️ MP** → le bot envoie un message individuel (convocation, avertissement…). Trace postée dans le salon d'annonce. Envoi 1 par 1, limité à 15/min/staff. |
| **Transcript** | bouton ⬇ dans un ticket → télécharge la conversation en fichier HTML autonome |
| **Réglages** | onglet ⚙️ (niveau le plus élevé) : catégories, message d'accueil, salon d'annonce, **rôles demandables** (nom + ID), **seuil SLA**, **Apparence** (nom, accent + fond, aperçu live). Stocké dans `data.json`, surcharge `.env` / `*.json`. |
| **Demande de rôle** | dans un ticket, menu 🙋 « Demander… » → choisis un rôle (configuré dans Réglages). Les staff qui ont ce rôle Discord reçoivent : une **grosse bannière** sur le ticket, une notif, un ping dans le salon d'annonce, et une alerte sur l'accueil. Satisfait dès qu'un membre du rôle prend/répond. |
| **Statut d'attente** | chaque ticket affiche s'il attend le **staff** (⏱ minuteur SLA, rouge au-delà du seuil) ou le **client** ; filtre « À traiter ». |
| **Menu catégorie** | au 1er MP, le bot envoie au client des **boutons Discord** (une par catégorie) → le ticket arrive déjà trié. Activable dans Réglages. |
| **Fermeture auto** | tickets ouverts en attente client : relance auto après X h, fermeture après Y h. Réglages (désactivé par défaut). |
| **Anti-flood** | trop de MP en peu de temps → le client est mis en pause N min (message auto). Réglages (activé par défaut). |
| **Filtres avancés** | sous la recherche : par assigné (à moi / non assignés) et priorité. |

**Non modifiables depuis le site** (dans les variables d'hébergement) : `BOT_TOKEN`,
`STAFF_ROLE_IDS`, `STAFF_TIERS`, `GUILD_ID`, `OAUTH_REDIRECT_URI`.

---

## État du déploiement (au 2026-09-01)

| | Sur GitHub / en ligne | Seulement en local (à pousser) |
|---|---|---|
| Bot + web + toutes les fonctions ci-dessus | ✅ (commits `Yuza Support` + `refonte design Volt`) | — |
| **Passe 1** : renommer, priorité, trace d'assignation, vue Staff | ❌ | ✅ (fichiers modifiés non commités) |

Pour mettre en ligne la Passe 1 (dans le dossier du projet, sur ton PC) :

```bash
git add .
```
```bash
git commit -m "passe 1 : renommer, priorite, vue staff"
```
```bash
git push
```

→ Railway redéploie automatiquement (~1 min). Onglet **Deployments** dans Railway :
attends le vert, puis recharge le site avec **Ctrl + Shift + R**.

---

## Config (.env / Railway Variables)

| Variable | Rôle |
|---|---|
| `BOT_TOKEN` `CLIENT_ID` `CLIENT_SECRET` | application Discord |
| `GUILD_ID` | serveur où on vérifie les rôles |
| `STAFF_ROLE_IDS` | rôles autorisés (virgules) |
| `SESSION_SECRET` | signe les sessions (longue chaîne au hasard) |
| `HOST` | `0.0.0.0` sur Railway, `127.0.0.1` en local |
| `PORT` | 8080 sur Railway (ou laissé à Railway) ; 53134 en local |
| `OAUTH_REDIRECT_URI` | `https://ton-domaine/auth/callback` — **identique dans Discord Portal** |
| `DATA_DIR` | `/data` sur Railway (avec un Volume) pour garder les données |
| `STAFF_CHANNEL_ID` | *(option)* salon d'annonce des nouveaux tickets |
| `STAFF_PING_ROLE_ID` | *(option)* rôle mentionné dans l'annonce |
| `STAFF_TIERS` | *(option)* `Responsable:roleID,Admin:roleID` pour l'escalade |
| `PUSH_CONTACT` | *(option)* `mailto:toi@exemple.com` pour le Web Push |

Fichiers éditables à la main : `server/categories.json`, `server/welcome.txt`,
`server/blacklist.json`.

---

## Voir / tester en local

```bash
npm install
npm run server
```

Puis ouvre `http://127.0.0.1:53134/`. (Le launcher Electron n'est plus utilisé.)

## Mettre à jour

Sur ton PC : `git add .` → `git commit -m "..."` → `git push`.
Railway redéploie tout seul. Les données du volume sont conservées.

## Hébergement

Guide Railway : `RAILWAY.md`. Guide VM gratuite : `DEPLOY.md`.
