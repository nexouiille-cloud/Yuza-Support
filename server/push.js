// Web Push : clés VAPID + envoi aux abonnements dont le niveau suffit.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import { config } from './config.js';
import { listPushSubs, removePushSub } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYFILE = join(__dirname, 'vapid.json');

let keys = null;

export function initPush() {
  if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
    keys = {
      publicKey: process.env.VAPID_PUBLIC,
      privateKey: process.env.VAPID_PRIVATE,
    };
  } else if (existsSync(KEYFILE)) {
    try {
      keys = JSON.parse(readFileSync(KEYFILE, 'utf8'));
    } catch {
      keys = null;
    }
  }
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    try {
      writeFileSync(KEYFILE, JSON.stringify(keys, null, 2));
      console.log('[push] clés VAPID générées -> server/vapid.json');
    } catch (e) {
      console.error('[push] impossible d\'écrire vapid.json :', e.message);
    }
  }
  webpush.setVapidDetails(config.pushContact, keys.publicKey, keys.privateKey);
}

export function vapidPublicKey() {
  return keys?.publicKey || '';
}

// envoie une notif à tous les abonnements dont le niveau >= needLevel
export function pushToLevel(needLevel, payload) {
  if (!keys) return;
  const body = JSON.stringify(payload);
  for (const rec of [...listPushSubs()]) {
    if ((rec.level || 1) < needLevel) continue;
    webpush.sendNotification(rec.sub, body).catch((err) => {
      const code = err?.statusCode;
      if (code === 404 || code === 410) removePushSub(rec.sub.endpoint);
      else console.error('[push] envoi échoué :', code || err?.message || err);
    });
  }
}
