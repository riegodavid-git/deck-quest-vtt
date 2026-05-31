#!/usr/bin/env node
// Build script for Deck Quest VTT.
// 1. Scans "Deck Quest Open Source PNGs/" — base64-embeds all card art (face + back).
// 2. Scans "1st D&D Token Collection/" — compresses every token to 128×128 PNG.
// 3. Injects both into gm.template.html and player.template.html.
// Outputs dist/gm.html and dist/player.html.
//
// Run once after install:  npm install
// Then any time you edit templates:  node build.js

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT       = __dirname;
const PNG_ROOT   = path.join(ROOT, 'Deck Quest Open Source PNGs');
const TOKEN_ROOT = path.join(PNG_ROOT, '1st D&D Token  Collection');
const TEMPLATES  = path.join(ROOT, 'templates');
const FONTS      = path.join(ROOT, 'fonts');
const DIST       = path.join(ROOT, 'dist');

// ── Font embedding ───────────────────────────────────────────────────────────
// Read each woff2, base64-encode, return a CSS string of @font-face rules.
// Keeps the build self-contained / offline.
const FONT_FACES = [
  { family: 'Libre Caslon Text', weight: 700, file: 'libre-caslon-text-700.woff2' },
  { family: 'Hanken Grotesk',    weight: 400, file: 'hanken-grotesk.woff2' },
  { family: 'Hanken Grotesk',    weight: 600, file: 'hanken-grotesk.woff2' },
  { family: 'JetBrains Mono',    weight: 500, file: 'jetbrains-mono-500.woff2' },
];
function loadFonts() {
  let totalBytes = 0;
  const rules = FONT_FACES.map(({ family, weight, file }) => {
    const p = path.join(FONTS, file);
    const buf = fs.readFileSync(p);
    totalBytes += buf.length;
    const b64 = buf.toString('base64');
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  }).join('\n');
  console.log(`Fonts: ${FONT_FACES.length} @font-face rules, ~${(totalBytes / 1024).toFixed(1)} KB raw`);
  return rules;
}

// ── Card backs ───────────────────────────────────────────────────────────────
const BACKS = {
  role:      'RoleBack-01.png',
  skill:     'SkillBack-01.png',
  item:      'ItemBack-01.png',
  location:  'AreaBack-01.png',
  adversary: 'AdversaryBack-01.png',
  info:      'InfoBack-01.png',
};

const CARD_FOLDERS = [
  { type: 'role',      dir: 'Roles/PNGs' },
  { type: 'skill',     dir: 'Skills/PNGs' },
  { type: 'item',      dir: 'Items/PNGs' },
  { type: 'location',  dir: 'Location/PNGs' },
  { type: 'adversary', dir: 'Adversaries/PNGS' },
  { type: 'info',      dir: 'Info/PNGs' },
];

function slugify(s) {
  return s.toLowerCase().replace(/-01$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function slugToken(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function fileToDataUrl(p) {
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}

// ── Token scanning ────────────────────────────────────────────────────────────
// Walk the token directory tree, compress every PNG to 128×128, return flat array.
// token: { id, name, cats: string[], image: dataUrl }
async function scanTokens() {
  const allFiles = [];
  function walk(dir, cats) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), [...cats, e.name]);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.png'))
        allFiles.push({ filePath: path.join(dir, e.name), name: e.name.replace(/\.png$/i, ''), cats });
    }
  }
  walk(TOKEN_ROOT, []);

  console.log(`Found ${allFiles.length} token PNGs — compressing to 128×128…`);

  // Process in batches of 40 for speed without memory overload
  const BATCH = 40;
  const tokens = [];
  for (let i = 0; i < allFiles.length; i += BATCH) {
    const batch = allFiles.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async ({ filePath, name, cats }) => {
      try {
        const buf = await sharp(filePath)
          .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png({ compressionLevel: 9 })
          .toBuffer();
        const id = [...cats.map(slugToken), slugToken(name)].join('/');
        return { id, name, cats, image: 'data:image/png;base64,' + buf.toString('base64') };
      } catch (e) {
        console.warn(`  ⚠ skip ${name}: ${e.message}`);
        return null;
      }
    }));
    tokens.push(...results.filter(Boolean));
    process.stdout.write(`  ${Math.min(i + BATCH, allFiles.length)}/${allFiles.length} tokens processed\r`);
  }
  process.stdout.write('\n');
  return tokens;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Cards
  console.log('Reading card backs…');
  const backDataUrls = {};
  for (const [type, file] of Object.entries(BACKS)) {
    const p = path.join(PNG_ROOT, 'Backs/PNGs', file);
    backDataUrls[type] = fileToDataUrl(p);
    console.log(`  ${type} back: ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
  }

  const cards = [];
  let cardBytes = 0;
  for (const { type, dir } of CARD_FOLDERS) {
    const full = path.join(PNG_ROOT, dir);
    if (!fs.existsSync(full)) { console.warn(`Missing folder: ${full}`); continue; }
    const files = fs.readdirSync(full).filter(f => f.toLowerCase().endsWith('.png'));
    console.log(`${type}: ${files.length} cards`);
    for (const f of files) {
      const p = path.join(full, f);
      cardBytes += fs.statSync(p).size;
      const name = f.replace(/-01\.png$/i, '').replace(/\.png$/i, '');
      cards.push({ id: type + '-' + slugify(name), name, type, image: fileToDataUrl(p), back: backDataUrls[type] });
    }
  }
  console.log(`Total: ${cards.length} cards, ~${(cardBytes / 1024 / 1024).toFixed(1)} MB raw`);

  // Tokens
  const tokens = await scanTokens();
  console.log(`Tokens: ${tokens.length} embedded`);

  // Payload sizes
  const cardsJson  = JSON.stringify(cards);
  const tokensJson = JSON.stringify(tokens);
  console.log(`Cards JSON: ~${(cardsJson.length  / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Tokens JSON: ~${(tokensJson.length / 1024 / 1024).toFixed(1)} MB`);

  const shared   = fs.readFileSync(path.join(TEMPLATES, 'shared.js'), 'utf8');
  const fontsCss = loadFonts();

  function build(templateName, outName) {
    const tpl = fs.readFileSync(path.join(TEMPLATES, templateName), 'utf8');
    const out = tpl
      .replace('%%FONTS_CSS%%',   () => fontsCss)
      .replace('%%SHARED_JS%%',   () => shared)
      .replace('%%CARDS_JSON%%',  () => cardsJson)
      .replace('%%TOKENS_JSON%%', () => tokensJson);
    if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
    const outPath = path.join(DIST, outName);
    fs.writeFileSync(outPath, out);
    console.log(`Wrote ${outPath} (${(out.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  build('gm.template.html',     'gm.html');
  build('player.template.html', 'player.html');
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
