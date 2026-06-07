#!/usr/bin/env node
// One-time publish: upload the Deck Quest card images to the Worker's KV-backed art store,
// keyed by the same relative path the catalog uses (e.g. "Roles/PNGs/Alchemist-01.png").
// Cards are small (~100 KB) so they go up as-is. Run once:  node scripts/publish-cards.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.join(__dirname, '..');
const PNG_ROOT = path.join(ROOT, 'Deck Quest Assets');
const WORKER   = process.env.WORKER || 'https://deck-quest-vtt.david-riego-01.workers.dev';
const SECRET   = fs.readFileSync(path.join(ROOT, 'relay-cf', '.publish-secret'), 'utf8').trim();

// Card faces (all decks) + the card backs.
const CARD_DIRS = ['Roles/PNGs','Skills/PNGs','Items/PNGs','Location/PNGs','Adversaries/PNGS','Info/PNGs','Backs/PNGs'];

function listPngs() {
  const files = [];
  for (const dir of CARD_DIRS) {
    const abs = path.join(PNG_ROOT, dir);
    if (!fs.existsSync(abs)) { console.warn('  (missing folder: ' + dir + ')'); continue; }
    for (const f of fs.readdirSync(abs)) if (/\.png$/i.test(f)) files.push(dir + '/' + f);
  }
  return files;
}
const artUrl = rel => WORKER + '/a/' + rel.split('/').map(encodeURIComponent).join('/');

async function put(rel) {
  const buf = fs.readFileSync(path.join(PNG_ROOT, rel));
  const res = await fetch(artUrl(rel), { method:'PUT', headers:{ 'Content-Type':'image/png', 'x-publish-secret': SECRET }, body: buf });
  if (!res.ok) throw new Error(rel + ' → ' + res.status + ' ' + (await res.text()).slice(0,80));
}

async function main() {
  const files = listPngs();
  console.log(`Publishing ${files.length} card images → ${WORKER}`);
  let done = 0, fail = 0;
  const CONC = 8;
  for (let i = 0; i < files.length; i += CONC) {
    await Promise.all(files.slice(i, i + CONC).map(f =>
      put(f).then(() => done++).catch(e => { fail++; console.error('\n  ✗ ' + e.message); })));
    process.stdout.write(`\r  ${done + fail}/${files.length}`);
  }
  console.log(`\nDone. ${done} uploaded, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
}
main();
