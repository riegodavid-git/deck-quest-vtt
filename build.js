#!/usr/bin/env node
// Build script for Deck Quest VTT v0.4.0.
// Produces metadata-only JSON (no embedded images).
// Cards: { id, name, type, path, backPath }
// Tokens: { id, name, cats, path }
// Build time: < 1 second.
//
// Run: node build.js

const fs   = require('fs');
const path = require('path');

const ROOT      = __dirname;
const PNG_ROOT  = path.join(ROOT, 'Deck Quest Assets');
const TOKEN_ROOT = path.join(PNG_ROOT, 'Tokens');
const TEMPLATES = path.join(ROOT, 'templates');
const FONTS     = path.join(ROOT, 'fonts');
const DIST      = path.join(ROOT, 'dist');

// ── Font embedding ───────────────────────────────────────────────────────────
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

// ── Card backs — relative paths from assets root ─────────────────────────────
const BACKS = {
  role:      'Backs/PNGs/RoleBack-01.png',
  skill:     'Backs/PNGs/SkillBack-01.png',
  item:      'Backs/PNGs/ItemBack-01.png',
  location:  'Backs/PNGs/AreaBack-01.png',
  adversary: 'Backs/PNGs/AdversaryBack-01.png',
  info:      'Backs/PNGs/InfoBack-01.png',
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

// ── Token scanning — metadata only, no image compression ─────────────────────
function scanTokens() {
  const tokens = [];
  function walk(dir, cats, relBase) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), [...cats, e.name], relBase + e.name + '/');
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) {
        const name = e.name.replace(/\.png$/i, '');
        const id = [...cats.map(slugToken), slugToken(name)].join('/');
        tokens.push({ id, name, cats, path: 'Tokens/' + relBase + e.name });
      }
    }
  }
  walk(TOKEN_ROOT, [], '');
  return tokens;
}

// ── Engine inlining ──────────────────────────────────────────────────────────
// The authoritative engine (engine.mjs) is shared with the Durable Object. For the
// browser we strip its ES `export`s and wrap it in a namespaced IIFE so it never
// clashes with shared.js's own globals; shared.js reaches it via `ENGINE.*`.
function inlineEngine() {
  const src = fs.readFileSync(path.join(ROOT, 'engine.mjs'), 'utf8').replace(/^export\s+/gm, '');
  return '/* ===== ENGINE (inlined from engine.mjs) ===== */\nconst ENGINE = (function(){\n'
    + src
    + '\nreturn { newState, migrateState, normalizeZ, applyOp, viewFor, canApply, '
    + 'ensureCharacterToken, ensureSlot, ensureCharactersOnBoard, pickSpawnPoint, boardById, TABLE_OPS };\n})();\n';
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  // Cards
  const cards = [];
  for (const { type, dir } of CARD_FOLDERS) {
    const full = path.join(PNG_ROOT, dir);
    if (!fs.existsSync(full)) { console.warn(`Missing folder: ${full}`); continue; }
    const files = fs.readdirSync(full).filter(f => f.toLowerCase().endsWith('.png'));
    console.log(`${type}: ${files.length} cards`);
    for (const f of files) {
      const name = f.replace(/-01\.png$/i, '').replace(/\.png$/i, '');
      cards.push({
        id: type + '-' + slugify(name),
        name,
        type,
        path: dir + '/' + f,
        backPath: BACKS[type],
      });
    }
  }
  console.log(`Total: ${cards.length} cards`);

  // Tokens
  const tokens = scanTokens();
  console.log(`Tokens: ${tokens.length} found`);

  // JSON payloads
  const cardsJson  = JSON.stringify(cards);
  const tokensJson = JSON.stringify(tokens);
  console.log(`Cards JSON:  ~${(cardsJson.length  / 1024).toFixed(1)} KB`);
  console.log(`Tokens JSON: ~${(tokensJson.length / 1024).toFixed(1)} KB`);

  const shared   = inlineEngine() + '\n' + fs.readFileSync(path.join(TEMPLATES, 'shared.js'), 'utf8');
  const fontsCss = loadFonts();

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);

  function build(templateName, outName, includeAssets) {
    const tpl = fs.readFileSync(path.join(TEMPLATES, templateName), 'utf8');
    const out = tpl
      .replace('%%FONTS_CSS%%',   () => fontsCss)
      .replace('%%SHARED_JS%%',   () => shared)
      .replace('%%CARDS_JSON%%',  () => includeAssets ? cardsJson  : '[]')
      .replace('%%TOKENS_JSON%%', () => includeAssets ? tokensJson : '[]');
    const outPath = path.join(DIST, outName);
    fs.writeFileSync(outPath, out);
    console.log(`Wrote ${outPath} (${(out.length / 1024).toFixed(1)} KB)`);
  }

  build('gm.template.html',     'gm.html',     true);
  // Player gets card metadata (needed to render hands) but not the token library (GM-only panel)
  const playerOut = tpl => tpl
    .replace('%%FONTS_CSS%%',   () => fontsCss)
    .replace('%%SHARED_JS%%',   () => shared)
    .replace('%%CARDS_JSON%%',  () => cardsJson)
    .replace('%%TOKENS_JSON%%', () => '[]');
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
  const playerPath = path.join(DIST, 'player.html');
  const playerTpl  = fs.readFileSync(path.join(TEMPLATES, 'player.template.html'), 'utf8');
  fs.writeFileSync(playerPath, playerOut(playerTpl));
  console.log(`Wrote ${playerPath} (${(fs.statSync(playerPath).size / 1024).toFixed(1)} KB)`);
  console.log('Done.');
}

main();
