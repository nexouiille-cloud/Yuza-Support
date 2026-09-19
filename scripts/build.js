// Compile web-src/ (source lisible, jamais servi) -> web/ (minifié + obfusqué, servi aux clients).
// Tourne automatiquement avant chaque démarrage (voir package.json: build/postinstall/prestart).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'web-src');
const OUT = join(ROOT, 'web');

const OBFUSCATE_OPTS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false, // critique : banner-editor.js expose window.initBannerEditor, lu par app.js
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  selfDefending: false, // évite de casser le débogage / la console du navigateur
  debugProtection: false,
  numbersToExpressions: true,
  simplify: true,
};

async function buildJs(name) {
  const raw = readFileSync(join(SRC, name), 'utf8');
  const minified = await esbuild.transform(raw, { minify: true, loader: 'js', target: 'es2019' });
  const obfuscated = JavaScriptObfuscator.obfuscate(minified.code, OBFUSCATE_OPTS).getObfuscatedCode();
  writeFileSync(join(OUT, name), obfuscated);
  console.log(`[build] ${name} : ${raw.length} -> ${obfuscated.length} octets`);
}

async function buildCss(name) {
  const raw = readFileSync(join(SRC, name), 'utf8');
  const result = await esbuild.transform(raw, { minify: true, loader: 'css' });
  writeFileSync(join(OUT, name), result.code);
  console.log(`[build] ${name} : ${raw.length} -> ${result.code.length} octets`);
}

await buildJs('app.js');
await buildJs('banner-editor.js');
await buildCss('style.css');
console.log('[build] terminé.');
