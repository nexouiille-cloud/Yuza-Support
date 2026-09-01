# Yuza Support

Bot Discord relais de tickets + **interface staff web** (aucune installation).

- Un **client** écrit un MP au bot Discord → ça crée / alimente un ticket.
- Le **staff** ouvre l'URL du serveur dans son navigateur, se connecte avec
  Discord. Le backend vérifie qu'il a un **rôle staff** sur le serveur.
- Le staff répond depuis la page → le bot envoie la réponse dans le MP du
  client, préfixée `Pseudo (Staff) : ...`.
- Si le rôle staff est retiré, l'accès est coupé automatiquement
  (à la connexion + toutes les 5 min).

```
server/         bot Discord + backend HTTP/WebSocket (le token vit ICI)
web/            interface staff (servie par le serveur : index.html + app.js)
launcher/       ancienne app Electron — OPTIONNELLE, garde le web
data.json       tickets + messages (créé au 1er lancement)
```

---

## 1. Prérequis

- Node.js 20+ (tu as v24)
- Un serveur Discord où tu es admin

## 2. Créer l'application Discord

1. https://discord.com/developers/applications → **New Application**
2. Onglet **Bot** :
   - **Reset Token** → `BOT_TOKEN`
   - Active **MESSAGE CONTENT INTENT** ✅ et **SERVER MEMBERS INTENT** ✅
3. Onglet **OAuth2** :
   - copie **Client ID** → `CLIENT_ID`
   - **Reset Secret** → `CLIENT_SECRET`
   - **Redirects** → **Add Redirect** → `http://127.0.0.1:53134/auth/callback`
     (en dev ; ajoute aussi `https://ton-domaine/auth/callback` une fois hébergé)
4. **Inviter le bot** (remplace `CLIENT_ID`) :
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot&permissions=68608`

## 3. Récupérer les IDs

Discord → Paramètres → **Avancés** → **Mode développeur** ON, puis clic droit :

- **GUILD_ID** — sur l'icône du serveur
- **STAFF_ROLE_IDS** — sur le(s) rôle(s) staff (séparés par des virgules)
- **STAFF_CHANNEL_ID** *(option)* — sur le salon d'annonce des tickets
- **STAFF_TIERS** *(option)* — pour l'escalade : `Responsable:roleID,Admin:roleID`
  (du plus bas au plus haut niveau)

## 4. Configurer

```bash
copy .env.example .env
```

Remplis `.env`. `SESSION_SECRET` = n'importe quelle longue chaîne aléatoire.

## 5. Installer + lancer

```bash
npm install
npm run server
```

Tu dois voir `[bot] connecté en tant que ...` et `[server] à l'écoute sur ...`.

## 6. Utiliser

Ouvre **http://127.0.0.1:53134/** dans un navigateur → **Se connecter avec
Discord** → autorise → tu arrives sur l'interface tickets.

Pour tester : depuis un **autre compte Discord** (membre du serveur), envoie un
MP au bot → le ticket apparaît → réponds → le client reçoit le MP.

---

## Fonctionnalités

- **Message d'accueil auto** — à l'ouverture/relance d'un ticket, le bot répond
  au client. Texte éditable dans `server/welcome.txt` (`{name}` = pseudo du
  client ; fichier vide = désactivé). Apparaît en gris dans la conversation.
- **Notes internes** (case à cocher) — visibles staff, jamais envoyées au client
- **Historique** — filtre Ouverts / Clôturés / Tous + recherche (nom, ID, contenu)
- **Catégories** — éditables dans `server/categories.json`, menu par ticket,
  sidebar groupée repliable
- **Assignation** — bouton *Prendre* / *Lâcher* / *Reprendre* ; réponse =
  auto-assignation si personne n'est dessus
- **Escalade** (si `STAFF_TIERS` défini) — menu *niveau* par ticket ; escalader
  = les staff sous ce niveau **perdent l'accès** au contenu (vérifié serveur)
- **Pièces jointes** — le client envoie une image/fichier dans son MP → visible
  dans la conversation (téléchargé et re-servi par le serveur, dossier `uploads/`).
  Le staff clique 📎 dans la barre d'envoi pour renvoyer un fichier au client.
- **Blacklist** — bouton « 🚫 Bloquer » dans l'en-tête du ticket : le client ne
  peut plus ouvrir de ticket (ses MP au bot sont ignorés). Liste de départ
  éditable dans `server/blacklist.json` ; « ✅ Débloquer » pour annuler.
- **Web Push** — notifications même onglet fermé / PC en veille. Clés VAPID
  auto-générées (`server/vapid.json`). **Nécessite HTTPS** en prod (marche sur
  `localhost` en test). Le staff clique « 🔔 Activer les notifications ».
- **Stats** — bouton « 📊 Stats » en bas : total / ouverts / clôturés / non
  assignés, temps de première réponse moyen, graphe tickets/jour (14 j),
  répartition par catégorie et par staff (limité aux tickets visibles à ton niveau)
- **Notifications** :
  - navigateur : bouton « 🔔 Activer les notifications » en bas ; toast quand un
    client écrit et que l'onglet n'est pas au premier plan (garde un onglet ouvert)
  - Discord : si `STAFF_CHANNEL_ID` défini, `@rôle 📩 X a ouvert un ticket`
  - compteur de non-lus dans le titre de l'onglet

## Hébergement 24/7 (pour que les staff y accèdent de chez eux)

Mettre le repo sur une petite VM (Oracle Cloud Always Free, VPS…) et :

1. `.env` : `HOST=0.0.0.0`, `OAUTH_REDIRECT_URI=https://ton-domaine/auth/callback`
2. Ajouter cette redirect dans le Developer Portal
3. Mettre le serveur derrière **HTTPS** (Caddy, Cloudflare Tunnel, nginx) — requis
   pour les cookies sécurisés et les notifications navigateur
4. Lancer `npm run server` en service (pm2, systemd…)
5. Les staff ouvrent `https://ton-domaine/`

## Notes

- Le **token du bot** ne quitte jamais `server/`. Le front reçoit un cookie de
  session signé (HMAC) valable 12 h ; chaque action revérifie le rôle serveur.
- Le dossier `launcher/` (app Electron) reste fonctionnel mais n'est plus la
  voie principale ; il se connecte au même serveur via `?token=`.
- Prochaines idées : macros de réponse, pièces jointes, salon Discord de log,
  Web Push (notifs même onglet fermé).
