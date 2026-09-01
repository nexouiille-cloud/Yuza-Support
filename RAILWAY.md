# Déployer Yuza Support sur Railway

Pour la personne qui héberge (client). ~10 min, zéro terminal.
Essai gratuit (~5 $ de crédit, ~30 jours) puis plan Hobby 5 $/mois.

---

## 1. Le code sur GitHub

Le dépôt doit être accessible par le compte Railway (public, ou privé avec
Railway autorisé). Aucun secret n'est dans le code.

## 2. Créer le projet Railway

1. https://railway.app → **Login with GitHub**.
2. **New Project** → **Deploy from GitHub repo** → choisir le dépôt.
3. Railway détecte Node et lance `npm install` puis `npm start`. Laisse-le finir
   (le 1er déploiement va « échouer » ou rester en attente : normal, il manque
   les variables, on les met à l'étape suivante).

## 3. Variables d'environnement

Onglet **Variables** → **Raw Editor** → coller (en remplaçant les valeurs) :

```
BOT_TOKEN=...
CLIENT_ID=...
CLIENT_SECRET=...
GUILD_ID=...
STAFF_ROLE_IDS=...
SESSION_SECRET=une-longue-chaine-aleatoire

HOST=0.0.0.0
OAUTH_REDIRECT_URI=https://REMPLACER-APRES-ETAPE-4/auth/callback

STAFF_SUFFIX=(Staff)
ROLE_RECHECK_SECONDS=300
STAFF_CHANNEL_ID=
STAFF_PING_ROLE_ID=
STAFF_TIERS=
PUSH_CONTACT=mailto:toi@exemple.com
DATA_DIR=/data
```

- **Ne pas** mettre `PORT` : Railway le fournit automatiquement.
- `HOST=0.0.0.0` est **obligatoire** (sinon Railway ne peut pas router).
- `DATA_DIR=/data` : voir étape 5.

## 4. Domaine public

**Settings → Networking → Generate Domain**.
Tu obtiens `xxxxx.up.railway.app` (HTTPS géré par Railway).

Retourne dans **Variables** et mets la vraie valeur :

```
OAUTH_REDIRECT_URI=https://xxxxx.up.railway.app/auth/callback
```

## 5. Disque persistant (pour ne PAS perdre les tickets)

Sur Railway, le disque est **effacé à chaque redéploiement** sauf si un Volume
est monté. (Volume = plan Hobby, pas l'essai gratuit.)

1. Sur le service → **Settings → Volumes** (ou clic droit sur le service →
   *Add Volume*) → **Mount path : `/data`**.
2. La variable `DATA_DIR=/data` (déjà mise) fait que `data.json`, `uploads/` et
   `vapid.json` vont dans ce volume → conservés entre les mises à jour.

> Sur l'essai gratuit sans volume : le site marche, mais les tickets se
> réinitialisent à chaque nouveau déploiement. Ajouter le volume dès le passage
> en Hobby.

## 6. Redéployer

Onglet **Deployments** → **Redeploy** (ou pousser un commit sur GitHub).
Les logs doivent montrer :

```
[bot] connecté en tant que ...
[server] à l'écoute sur http://0.0.0.0:...
```

## 7. Discord : autoriser l'URL

Developer Portal → l'application → **OAuth2 → Redirects → Add** :

```
https://xxxxx.up.railway.app/auth/callback
```

## 8. En ligne

Ouvrir `https://xxxxx.up.railway.app/` → connexion Discord → interface tickets.

---

## Mises à jour

Pousser sur GitHub → Railway redéploie tout seul (~1 min). Avec le Volume, les
données sont conservées.

## Coût

- Essai : ~5 $ de crédit offert (≈ 1 mois pour ce petit service).
- Ensuite : plan **Hobby 5 $/mois** (inclut 5 $ d'usage) + Volume.
