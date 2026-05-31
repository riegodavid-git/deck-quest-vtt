#!/usr/bin/env node
// Build script for Deck Quest VTT.
// Scans the "Deck Quest Open Source PNGs" folder, base64-embeds every card
// (face + matching back) plus the info cards, then injects them into the
// gm.template.html and player.template.html templates.
// Outputs dist/gm.html and dist/player.html.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PNG_ROOT = path.join(ROOT, 'Deck Quest Open Source PNGs');
const TEMPLATES = path.join(ROOT, 'templates');
const DIST = path.join(ROOT, 'dist');

const BACKS = {
  role: 'RoleBack-01.png',
  skill: 'SkillBack-01.png',
  item: 'ItemBack-01.png',
  location: 'AreaBack-01.png',
  adversary: 'AdversaryBack-01.png',
  info: 'InfoBack-01.png',
};

const FOLDERS = [
  { type: 'role',      dir: 'Roles/PNGs' },
  { type: 'skill',     dir: 'Skills/PNGs' },
  { type: 'item',      dir: 'Items/PNGs' },
  { type: 'location',  dir: 'Location/PNGs' },
  { type: 'adversary', dir: 'Adversaries/PNGS' },
  { type: 'info',      dir: 'Info/PNGs' },
];

function slugify(s) {
  return s.toLowerCase()
    .replace(/-01$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function fileToDataUrl(p) {
  const b64 = fs.readFileSync(p).toString('base64');
  return 'data:image/png;base64,' + b64;
}

console.log('Reading backs...');
const backDataUrls = {};
for (const [type, file] of Object.entries(BACKS)) {
  const p = path.join(PNG_ROOT, 'Backs/PNGs', file);
  backDataUrls[type] = fileToDataUrl(p);
  console.log(`  ${type} back: ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
}

const cards = [];
let totalBytes = 0;
for (const { type, dir } of FOLDERS) {
  const full = path.join(PNG_ROOT, dir);
  if (!fs.existsSync(full)) { console.warn(`Missing folder: ${full}`); continue; }
  const files = fs.readdirSync(full).filter(f => f.toLowerCase().endsWith('.png'));
  console.log(`${type}: ${files.length} cards`);
  for (const f of files) {
    const p = path.join(full, f);
    const sz = fs.statSync(p).size;
    totalBytes += sz;
    const name = f.replace(/-01\.png$/i, '').replace(/\.png$/i, '');
    cards.push({
      id: type + '-' + slugify(name),
      name,
      type,
      image: fileToDataUrl(p),
      back: backDataUrls[type],
    });
  }
}
console.log(`Total: ${cards.length} cards, ~${(totalBytes / 1024 / 1024).toFixed(1)} MB raw PNGs`);

const cardsJson = JSON.stringify(cards);
console.log(`JSON payload: ~${(cardsJson.length / 1024 / 1024).toFixed(1)} MB`);

const shared = fs.readFileSync(path.join(TEMPLATES, 'shared.js'), 'utf8');

function build(templateName, outName) {
  const tpl = fs.readFileSync(path.join(TEMPLATES, templateName), 'utf8');
  const out = tpl
    .replace('%%SHARED_JS%%', () => shared)
    .replace('%%CARDS_JSON%%', () => cardsJson);
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
  const outPath = path.join(DIST, outName);
  fs.writeFileSync(outPath, out);
  console.log(`Wrote ${outPath} (${(out.length / 1024 / 1024).toFixed(1)} MB)`);
}

build('gm.template.html', 'gm.html');
build('player.template.html', 'player.html');
console.log('Done.');
