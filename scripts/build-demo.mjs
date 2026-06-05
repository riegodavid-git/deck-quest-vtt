#!/usr/bin/env node
// Generates the offline live-preview demos: docs/gm-demo.html and docs/player-demo.html.
// Embeds (base64) one battlemap, a few tokens and a handful of cards per deck, plus a
// pre-built board state, and injects `window.DEMO = {…}` so shared.js runs in DEMO mode.
//
// Run: node scripts/build-demo.mjs   (after `node build.js` exists / templates are current)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const PNG_ROOT  = path.join(ROOT, 'Deck Quest Assets');
const TEMPLATES = path.join(ROOT, 'templates');
const FONTS     = path.join(ROOT, 'fonts');
const DOCS      = path.join(ROOT, 'docs');

const PLAYER_COLORS = ['#3b82f6','#ef4444','#10b981','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];

const FONT_FACES = [
  { family:'Libre Caslon Text', weight:700, file:'libre-caslon-text-700.woff2' },
  { family:'Hanken Grotesk',    weight:400, file:'hanken-grotesk.woff2' },
  { family:'Hanken Grotesk',    weight:600, file:'hanken-grotesk.woff2' },
  { family:'JetBrains Mono',    weight:500, file:'jetbrains-mono-500.woff2' },
];
function loadFonts() {
  return FONT_FACES.map(({ family, weight, file }) => {
    const b64 = fs.readFileSync(path.join(FONTS, file)).toString('base64');
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  }).join('\n');
}

const BACKS = {
  role:'Backs/PNGs/RoleBack-01.png', skill:'Backs/PNGs/SkillBack-01.png', item:'Backs/PNGs/ItemBack-01.png',
  location:'Backs/PNGs/AreaBack-01.png', adversary:'Backs/PNGs/AdversaryBack-01.png', info:'Backs/PNGs/InfoBack-01.png',
};
const CARD_FOLDERS = [
  { type:'role', dir:'Roles/PNGs' }, { type:'skill', dir:'Skills/PNGs' }, { type:'item', dir:'Items/PNGs' },
  { type:'location', dir:'Location/PNGs' }, { type:'adversary', dir:'Adversaries/PNGS' }, { type:'info', dir:'Info/PNGs' },
];
const slugify = s => s.toLowerCase().replace(/-01$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MIME = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
function dataUrl(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  return `data:${MIME[ext] || 'image/png'};base64,` + fs.readFileSync(absPath).toString('base64');
}
function walk(dir, hit) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, hit);
    else if (e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)) hit(p);
  }
}

// ── Catalog (id/name/type) from card folders, same as build.js ──────────────
function buildCatalog() {
  const cards = [];
  for (const { type, dir } of CARD_FOLDERS) {
    const full = path.join(PNG_ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter(f => /\.png$/i.test(f))) {
      const name = f.replace(/-01\.png$/i, '').replace(/\.png$/i, '');
      cards.push({ id: type + '-' + slugify(name), name, type, path: dir + '/' + f, backPath: BACKS[type] });
    }
  }
  return cards;
}

function main() {
  const catalog = buildCatalog();
  const byType = t => catalog.filter(c => c.type === t);

  // ── Embed images ──────────────────────────────────────────────────────────
  const cardImages = {};               // cardPath → dataUrl
  const assets = {};                   // assetHash → dataUrl
  const DECKS = ['role','skill','item','location','adversary'];
  const deckIds = {};
  for (const t of DECKS) {
    const five = byType(t).slice(0, 5);
    deckIds[t] = five.map(c => c.id);
    for (const c of five) { cardImages[c.path] = dataUrl(path.join(PNG_ROOT, c.path)); }
  }
  // Card backs for the deck stacks (the first card of each type defines the back path).
  for (const t of ['role','skill','item','location','adversary','info']) {
    const bp = BACKS[t]; const abs = path.join(PNG_ROOT, bp);
    if (fs.existsSync(abs)) cardImages[bp] = dataUrl(abs);
  }

  // One battlemap (first found) + five tokens (first five found).
  let mapPath = null; walk(path.join(PNG_ROOT, 'Battlemaps'), p => { if (!mapPath) mapPath = p; });
  if (mapPath) assets['map0'] = dataUrl(mapPath);
  const tokenPaths = []; walk(path.join(PNG_ROOT, 'Tokens'), p => { if (tokenPaths.length < 5) tokenPaths.push(p); });
  tokenPaths.forEach((p, i) => { assets['tok' + i] = dataUrl(p); });

  const tokenName = p => path.basename(p).replace(/\.[^.]+$/, '');

  // ── Demo state ────────────────────────────────────────────────────────────
  const players = [
    { id:'player1', name:'Aria',  cls:'Ranger' },
    { id:'player2', name:'Bo',    cls:'Cleric' },
    { id:'player3', name:'Cael',  cls:'Wizard' },
  ];
  const figs = [];
  if (mapPath) figs.push({ instId:'fig-map', assetHash:'map0', x:0, y:0, w:1500, h:950, rot:0, z:1, locked:true, opacity:1, flipH:false, flipV:false, label:'', showName:false, effects:{} });
  // 3 player character tokens (use 3 tokens as their pfps) + 2 NPC tokens.
  const charPos = [[430,560],[560,610],[690,560]];
  players.forEach((p, i) => {
    figs.push({ instId:'fig-' + p.id, kind:'character', playerId:p.id, x:charPos[i][0], y:charPos[i][1], w:96, h:96, rot:0, z:10 + i, opacity:1, locked:false, flipH:false, flipV:false, label:p.name, effects:{} });
  });
  const npc = [[980,360,'tok3','Goblin'],[1120,470,'tok4','Ogre']];
  npc.forEach(([x,y,hash,label], i) => {
    figs.push({ instId:'fig-npc' + i, assetHash:hash, x, y, w:104, h:104, rot:0, z:8, opacity:1, locked:false, flipH:false, flipV:false, label, showName:true, effects:{} });
  });

  const tableCards = [
    { instId:'card-t1', cardId: deckIds.location[0], x:1180, y:90,  rot:-4, z:20, faceUp:true },
    { instId:'card-t2', cardId: deckIds.adversary[0], x:1180, y:430, rot:5,  z:21, faceUp:true },
  ];

  const decks = {}, discards = {};
  for (const t of DECKS) { decks[t] = [...deckIds[t]]; discards[t] = []; }

  function sheet(p, i) {
    return {
      name: p.name, pfpHash: 'tok' + i, color: PLAYER_COLORS[i],
      stats: { str:35, agi:25, int:20, cha:5, sta:15 },   // point-buy: sums to 100; mods +3/+1/+0/-3/-1
      hp: { current: 18, max: 22 }, armor: { current: 4, max: 10 },
      info: { class: p.cls, race: 'Human', age: '24', weight: '—' }, gold: 35,
      inventory: [{ id:'inv1', name:'Torch' }, { id:'inv2', name:'Rope' }],
      notes: '', connected: true,
      hand: i === 0 ? [
        { instId:'h1', cardId: deckIds.item[1], faceUp: true },
        { instId:'h2', cardId: deckIds.skill[1], faceUp: true },
        { instId:'h3', cardId: deckIds.item[2], faceUp: true },
      ] : [ { instId:'h'+i+'a', cardId: deckIds.role[i] || deckIds.role[0], faceUp: true } ],
    };
  }
  const hands = { gm: { name:'GM', color:'#3b82f6', hand:[
    { instId:'g1', cardId: deckIds.adversary[1], faceUp: true },
    { instId:'g2', cardId: deckIds.item[3], faceUp: true },
  ] } };
  players.forEach((p, i) => { hands[p.id] = sheet(p, i); });

  const table = { cards: tableCards, figurines: figs, drawings: [] };
  const board = { id:'board-main', name:'Main', table };
  const log = [ { ts:Date.now(), who:'GM', text:'Welcome to the Deck Quest VTT live demo!', kind:'sys' } ];
  const chat = [ { who:'GM', text:'Drag tokens, draw with the pen, draw cards — it’s all local.', color:'#f2ca50', ts:Date.now() } ];

  const gmState = {
    roomCode:'DEMO', playerCount: players.length,
    decks, discards, boards:[board], activeBoardId: board.id, gmViewBoardId: board.id, table,
    hands, assetMeta:{}, log, chat, gmNotes:'These are your private notes. Try the panels, draw cards from a deck, and switch boards.',
  };
  // Player view = viewFor('player1'): decks as counts, table, hands without gm, no boards array.
  const view = {
    roomCode:'DEMO', playerCount: players.length,
    decks: Object.fromEntries(Object.entries(decks).map(([k,v]) => [k, v.length])),
    discards, table,
    hands: Object.fromEntries(Object.entries(hands).filter(([k]) => k !== 'gm')),
    assetMeta:{}, log, chat,
  };

  // ── Emit the two HTML files ───────────────────────────────────────────────
  const engineSrc = fs.readFileSync(path.join(ROOT, 'engine.mjs'), 'utf8').replace(/^export\s+/gm, '');
  const engineNs  = '/* ===== ENGINE (inlined) ===== */\nconst ENGINE = (function(){\n' + engineSrc
    + '\nreturn { newState, migrateState, normalizeZ, applyOp, viewFor, canApply, ensureCharacterToken, ensureCharactersOnBoard, pickSpawnPoint, boardById, TABLE_OPS };\n})();\n';
  const shared   = engineNs + '\n' + fs.readFileSync(path.join(TEMPLATES, 'shared.js'), 'utf8');
  const fontsCss = loadFonts();
  const cardsJson = JSON.stringify(catalog);
  if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS);

  function emit(templateName, outName, role, demoExtra) {
    const tpl = fs.readFileSync(path.join(TEMPLATES, templateName), 'utf8');
    const demo = JSON.stringify({ assets, cardImages, ...demoExtra });
    const out = tpl
      .replace('%%FONTS_CSS%%',   () => fontsCss)
      .replace('%%SHARED_JS%%',   () => shared)
      .replace('%%CARDS_JSON%%',  () => cardsJson)
      .replace('%%TOKENS_JSON%%', () => '[]')
      .replace(`const ROLE = '${role}';`, `const ROLE = '${role}';\nwindow.DEMO = ${demo};`);
    fs.writeFileSync(path.join(DOCS, outName), out);
    console.log(`Wrote docs/${outName} (${(out.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  emit('gm.template.html',     'gm-demo.html',     'gm',     { state: gmState });
  emit('player.template.html', 'player-demo.html', 'player', { state: gmState, myId:'player1' });
  console.log(`Embedded: 1 map, ${tokenPaths.length} tokens, ${Object.keys(cardImages).length} card images.`);
  console.log('Done.');
}

main();
