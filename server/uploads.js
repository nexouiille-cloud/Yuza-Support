// Enregistrement local des pièces jointes (dossier ../uploads, servi en /uploads).
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_OK = /^\.(png|jpe?g|gif|webp|mp4|webm|mov|pdf|txt|log|json|zip|mp3|ogg|wav)$/i;
const TYPE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'text/plain': '.txt',
};

function safeExt(name = '', contentType = '') {
  const e = extname(String(name)).toLowerCase();
  if (EXT_OK.test(e)) return e;
  return TYPE_EXT[contentType] || '.bin';
}

export function saveBuffer(buf, name, contentType) {
  const ext = safeExt(name, contentType);
  const file = `${crypto.randomBytes(12).toString('hex')}${ext}`;
  writeFileSync(join(UPLOAD_DIR, file), buf);
  return {
    url: `/uploads/${file}`,
    name: name || file,
    contentType: contentType || '',
    size: buf.length,
  };
}

export async function saveFromUrl(url, name, contentType, maxBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`téléchargement ${res.status}`);
  const ab = await res.arrayBuffer();
  if (maxBytes && ab.byteLength > maxBytes) throw new Error('trop volumineux');
  return saveBuffer(
    Buffer.from(ab),
    name,
    contentType || res.headers.get('content-type') || '',
  );
}
