# Héberger Yuza Support gratuitement (24/7)

Objectif : un lien `https://xxxxx.duckdns.org/` que tu donnes à tes staff, qui
marche même PC éteint, sans terminal chez toi.

Pile : VM gratuite Google Cloud + sous-domaine DuckDNS + Caddy (HTTPS auto) +
pm2 (redémarre tout seul).

Tu ne tapes des commandes qu'**une seule fois**, dans le terminal du navigateur
fourni par Google (bouton « SSH »). Rien à installer sur ton PC.

---

## 1. Mettre le code sur GitHub

Aucun secret n'est dans le code (`.env`, `vapid.json`, `data.json` sont ignorés),
donc un dépôt **public** est OK et plus simple.

1. Crée un compte sur https://github.com si tu n'en as pas.
2. Nouveau dépôt : https://github.com/new → nom `yuza-support` → **Public** →
   *Create repository*.
3. Dans PowerShell, dans le dossier du projet, **une fois** :

```bash
git init
git add .
git commit -m "Yuza Support"
git branch -M main
git remote add origin https://github.com/TON_PSEUDO/yuza-support.git
git push -u origin main
```

(Git te demandera de te connecter à GitHub dans le navigateur.)

Plus tard, pour publier une modif : `git add . && git commit -m "maj" && git push`

---

## 2. Créer la VM gratuite Google Cloud

1. Va sur https://console.cloud.google.com → connecte-toi, accepte l'essai
   (carte demandée pour vérification, **la VM e2-micro reste gratuite à vie**,
   tu ne seras pas débité tant que tu restes sur cette VM).
2. Menu ☰ → **Compute Engine** → **Instances de VM** → active l'API si demandé.
3. **Créer une instance** :
   - Nom : `yuza`
   - Région : **`us-central1`** (Iowa) — zone `us-central1-a`
     *(obligatoire pour la gratuité : us-central1, us-west1 ou us-east1)*
   - Type de machine : série **E2** → **`e2-micro`** (2 vCPU / 1 Go)
   - Disque de démarrage : **Ubuntu 24.04 LTS**, taille **30 Go** (standard)
   - Pare-feu : coche **Autoriser le trafic HTTP** et **Autoriser le trafic HTTPS**
   - **Créer**
4. Note l'**adresse IP externe** de la ligne `yuza` (ex : `34.71.x.x`).

> Recommandé : clique sur l'IP externe → *Réserver une adresse IP statique*,
> pour qu'elle ne change pas.

---

## 3. Sous-domaine gratuit (DuckDNS)

1. https://www.duckdns.org → connecte-toi (Google/GitHub).
2. Champ « sub domain » : choisis un nom, ex `yuza-support` → **add domain**.
3. Sur la ligne créée, mets ton **IP externe GCP** dans « current ip » → **update ip**.

Ton domaine : `yuza-support.duckdns.org`

---

## 4. Se connecter à la VM

Dans la console GCP → Compute Engine → Instances → ligne `yuza` → bouton **SSH**.
Un terminal s'ouvre **dans le navigateur**. Tout ce qui suit se colle là.

---

## 5. Installation (bloc à coller une fois)

Remplace `yuza-support.duckdns.org` et `TON_PSEUDO` avant de coller.

```bash
# --- système + swap (1 Go, sécurité pour 1 Go de RAM) ---
sudo apt update && sudo apt -y upgrade
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# --- Node.js 20 ---
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# --- Caddy (HTTPS automatique) ---
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# --- pm2 ---
sudo npm install -g pm2

# --- le projet ---
cd ~
git clone https://github.com/TON_PSEUDO/yuza-support.git
cd yuza-support
npm install
```

---

## 6. Créer le `.env` sur la VM

```bash
nano .env
```

Colle ceci en remplaçant les valeurs (reprends celles de ton `.env` local, et
adapte les 3 lignes marquées) :

```
BOT_TOKEN=...
CLIENT_ID=...
CLIENT_SECRET=...
GUILD_ID=...
STAFF_ROLE_IDS=...
SESSION_SECRET=...

PORT=53134
HOST=127.0.0.1
OAUTH_REDIRECT_URI=https://yuza-support.duckdns.org/auth/callback   # <-- ton domaine

STAFF_SUFFIX=(Staff)
ROLE_RECHECK_SECONDS=300
STAFF_CHANNEL_ID=
STAFF_PING_ROLE_ID=
STAFF_TIERS=
PUSH_CONTACT=mailto:toi@exemple.com
```

`Ctrl+O` puis `Entrée` pour enregistrer, `Ctrl+X` pour quitter.

---

## 7. Lancer en permanence

```bash
pm2 start npm --name yuza -- run server
pm2 logs yuza --lines 20      # vérifie : "[bot] connecté", "[server] à l'écoute"
                              # Ctrl+C pour sortir des logs (le serveur continue)
pm2 save
pm2 startup                   # colle et exécute la commande que ça affiche
```

À partir de là, le serveur redémarre tout seul (crash, reboot de la VM…).

---

## 8. Brancher le domaine (Caddy)

```bash
sudo nano /etc/caddy/Caddyfile
```

Remplace **tout** le contenu par (avec ton domaine) :

```
yuza-support.duckdns.org {
    reverse_proxy localhost:53134
}
```

Puis :

```bash
sudo systemctl reload caddy
```

Caddy récupère automatiquement un certificat HTTPS (quelques secondes).

---

## 9. Discord : autoriser la nouvelle adresse

Developer Portal → ton application → **OAuth2** → **Redirects** → **Add** :

```
https://yuza-support.duckdns.org/auth/callback
```

(garde aussi l'ancienne `http://127.0.0.1:53134/auth/callback` pour tes tests locaux)

---

## 10. C'est en ligne

Ouvre `https://yuza-support.duckdns.org/` → connexion Discord → interface tickets.
**Partage ce lien à tes staff.** Ton PC peut être éteint.

---

## Mettre à jour le site plus tard

Sur ton PC : `git add . && git commit -m "maj" && git push`

Dans le SSH de la VM :

```bash
cd ~/yuza-support && git pull && npm install && pm2 restart yuza
```

---

## Notes

- **Données** : `data.json` (tickets/messages), `uploads/` (pièces jointes) et
  `server/vapid.json` restent sur le disque de la VM → conservés entre les mises
  à jour et les reboots. Pense à une sauvegarde de temps en temps :
  `cp ~/yuza-support/data.json ~/data-backup-$(date +%F).json`
- **DuckDNS** : si l'IP de la VM change un jour (évité si tu l'as réservée),
  remets-la sur duckdns.org.
- **Coût** : 0 € tant que tu restes sur une seule VM `e2-micro` dans une région
  éligible. Surveille la page *Facturation* les 2 premiers mois pour être sûr.
