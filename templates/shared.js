/* Deck Quest VTT — shared core
   Inlined into both gm.template.html and player.template.html.
   Expects globals: CARDS (array from build.js), ROLE ('gm' | 'player').
*/

// =================== Constants ===================
const DECK_TYPES = ['role', 'skill', 'item', 'location', 'adversary'];
const DECK_LABELS = { role: 'Roles', skill: 'Skills', item: 'Items', location: 'Locations', adversary: 'Adversaries' };
const PLAYER_COLORS = ['#3b82f6','#ef4444','#10b981','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
const DEFAULT_STATS = { str:10, agi:10, int:10, cha:10, sta:10 };
const DEFAULT_HP = { current: 20, max: 20 };
const DEFAULT_ARMOR = { current: 0, max: 10 };
const ADJ = ['aqua','crimson','emerald','golden','silver','shadow','radiant','frost','ember','mystic'];
const NOUN = ['falcon','dragon','wolf','tiger','phoenix','kraken','griffin','viper','raven','lynx'];

const CARDS_BY_ID = {};
const CARDS_BY_TYPE = { role:[], skill:[], item:[], location:[], adversary:[], info:[] };
for (const c of CARDS) { CARDS_BY_ID[c.id] = c; CARDS_BY_TYPE[c.type].push(c); }

// Built-in token lookup — id → token object
const TOKENS_BY_ID = {};
// Metadata is tiny now (~30 KB) — populate synchronously at startup
(function() {
  const el = document.getElementById('_tokens_data');
  if (!el) return;
  for (const t of JSON.parse(el.textContent)) TOKENS_BY_ID[t.id] = t;
  el.remove();
})();

// Multi-select — set of instIds currently selected
const selectionSet = new Set();

// =================== Keyboard shortcuts (source of truth) ===================
// Hover-context: the action targets whatever the mouse is over.
// `role`: 'gm' | 'all'. group: shown as a section in the help panel.
const KEYBIND_HELP = [
  { group:'Decks (hover a deck)',      keys:['S'],            label:'Shuffle deck',            role:'gm' },
  { group:'Decks (hover a deck)',      keys:['D'],            label:'Draw to table',           role:'gm' },
  { group:'Decks (hover a deck)',      keys:['G'],            label:'Draw to GM hand',         role:'gm' },
  { group:'Tokens (hover a token)',    keys:['F'],            label:'Flip horizontally',       role:'all' },
  { group:'Tokens (hover a token)',    keys:['R'],            label:'Rotate 90°',              role:'all' },
  { group:'Tokens (hover a token)',    keys:['[',']'],       label:'Send back / bring front', role:'all' },
  { group:'Tokens (hover a token)',    keys:['L'],            label:'Lock / unlock',           role:'gm' },
  { group:'Tokens (hover a token)',    keys:['E'],            label:'Duplicate',               role:'gm' },
  { group:'Tokens (hover a token)',    keys:['Del'],          label:'Delete',                  role:'gm' },
  { group:'Cards (hover a table card)',keys:['F'],            label:'Flip card',               role:'all' },
  { group:'Cards (hover a table card)',keys:['L'],            label:'Lock / unlock',           role:'gm' },
  { group:'Cards (hover a table card)',keys:['Del'],          label:'Discard',                 role:'gm' },
  { group:'Tools',                     keys:['1','2','3'],    label:'Pointer / Pen / Eraser',  role:'all' },
  { group:'Tools',                     keys:['T'],            label:'Token stamper',           role:'gm' },
  { group:'Tools',                     keys:['Space'],        label:'Hold to pan',             role:'all' },
  { group:'Tools',                     keys:['Esc'],          label:'Exit tool / clear select',role:'all' },
  { group:'Tools',                     keys:['Alt'],          label:'Hold + hover: preview card', role:'all' },
];

// Tracks what the mouse is currently over, for hover-context keybinds.
let hoverInfo = null;

// =================== Inline SVG icons ===================
// Self-contained icon set (no font dependency). Stroke-based, scales to currentColor.
const ICONS = {
  pointer:        '<svg viewBox="0 0 24 24"><path d="M5 3 L19 11 L12 13 L9 20 Z"/></svg>',
  pen:            '<svg viewBox="0 0 24 24"><path d="M16 3 L21 8 L8 21 L3 21 L3 16 Z"/><path d="M13 6 L18 11"/></svg>',
  eraser:         '<svg viewBox="0 0 24 24"><path d="M20 20 L9 20 L3 14 L13 4 L21 12 Z"/><path d="M9 20 L15 14"/></svg>',
  target:         '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1 L12 5 M12 19 L12 23 M1 12 L5 12 M19 12 L23 12"/></svg>',
  deck:           '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="14" height="18" rx="2"/><path d="M7 3 L7 21 M11 3 L11 21"/></svg>',
  discard:        '<svg viewBox="0 0 24 24"><path d="M4 7 L20 7 M9 7 L9 4 L15 4 L15 7"/><path d="M6 7 L7 21 L17 21 L18 7"/><path d="M10 11 L10 17 M14 11 L14 17"/></svg>',
  tokens:         '<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="5"/><circle cx="16" cy="16" r="5"/></svg>',
  map:            '<svg viewBox="0 0 24 24"><path d="M3 6 L9 4 L15 6 L21 4 L21 18 L15 20 L9 18 L3 20 Z"/><path d="M9 4 L9 18 M15 6 L15 20"/></svg>',
  search:         '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21 L16 16"/></svg>',
  dice:           '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/></svg>',
  close:          '<svg viewBox="0 0 24 24"><path d="M5 5 L19 19 M19 5 L5 19"/></svg>',
  trash:          '<svg viewBox="0 0 24 24"><path d="M4 7 L20 7 M9 7 L9 4 L15 4 L15 7 M6 7 L7 21 L17 21 L18 7"/></svg>',
  'chevron-up':    '<svg viewBox="0 0 24 24"><path d="M5 15 L12 8 L19 15"/></svg>',
  'chevron-down':  '<svg viewBox="0 0 24 24"><path d="M5 9 L12 16 L19 9"/></svg>',
  'chevron-left':  '<svg viewBox="0 0 24 24"><path d="M15 5 L8 12 L15 19"/></svg>',
  'chevron-right': '<svg viewBox="0 0 24 24"><path d="M9 5 L16 12 L9 19"/></svg>',
  plus:           '<svg viewBox="0 0 24 24"><path d="M12 4 L12 20 M4 12 L20 12"/></svg>',
  save:           '<svg viewBox="0 0 24 24"><path d="M5 3 L17 3 L21 7 L21 21 L5 21 Z"/><path d="M7 3 L7 9 L15 9 L15 3 M7 14 L17 14 L17 21 L7 21 Z"/></svg>',
  load:           '<svg viewBox="0 0 24 24"><path d="M4 5 L10 5 L12 7 L20 7 L20 19 L4 19 Z"/></svg>',
  refresh:        '<svg viewBox="0 0 24 24"><path d="M3 12 A9 9 0 0 1 19 6"/><path d="M21 4 L21 9 L16 9"/><path d="M21 12 A9 9 0 0 1 5 18"/><path d="M3 20 L3 15 L8 15"/></svg>',
  stamp:          '<svg viewBox="0 0 24 24"><path d="M9 3 L15 3 L14 10 L16 10 L16 14 L8 14 L8 10 L10 10 Z"/><path d="M4 18 L20 18 L20 21 L4 21 Z"/></svg>',
  help:           '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.2 9.2 A2.8 2.8 0 1 1 12 13 L12 15"/><circle cx="12" cy="18.5" r="0.6" fill="currentColor"/></svg>',
};

function icon(name, opts) {
  const span = document.createElement('span');
  span.className = 'icon' + (opts && opts.class ? ' ' + opts.class : '');
  span.innerHTML = ICONS[name] || '';
  if (opts && opts.title) span.title = opts.title;
  return span;
}

// Populate any element with a data-icon attribute by injecting the SVG.
function paintStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(node => {
    const name = node.getAttribute('data-icon');
    if (!ICONS[name]) return;
    node.replaceChildren(icon(name));
  });
}

// =================== Utilities ===================
function $(sel, root) { return (root||document).querySelector(sel); }
function $$(sel, root) { return Array.from((root||document).querySelectorAll(sel)); }
function el(tag, attrs={}, ...children) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function shuffle(a) { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
let _zCounter = 1;
function nextZ() { return ++_zCounter; }

// =================== Pan / zoom ===================
let tableZoom = 1.0;
let tablePanX = 0, tablePanY = 0;
let spaceHeld = false, isPanning = false;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
function applyTableTransform() {
  const c = $('#tableContent');
  if (c) c.style.transform = `translate(${tablePanX}px,${tablePanY}px) scale(${tableZoom})`;
}
function migrateState(state) {
  if (!state || !state.hands) return;
  if (Array.isArray(state.hands.gm)) {
    state.hands.gm = { name:'GM', color:'#3b82f6', hand: state.hands.gm };
  } else if (state.hands.gm && !state.hands.gm.hand) {
    state.hands.gm.hand = [];
  }
  if (!state.chat) state.chat = [];
  if (state.gmNotes === undefined) state.gmNotes = '';
}
function normalizeZ(state) {
  // Re-sequence all card/figurine z values to small ints, preserving visual order.
  // Necessary after loading sessions that used Date.now() z values (which browsers
  // clamp to int32 max and tie with overlay z-indexes).
  if (!state) return;
  const items = [
    ...state.table.cards.map(c => ({ obj: c })),
    ...state.table.figurines.map(f => ({ obj: f })),
  ];
  items.sort((a,b) => (a.obj.z||0) - (b.obj.z||0));
  _zCounter = 0;
  for (const { obj } of items) obj.z = ++_zCounter;
}
function rollDie(n) { return 1 + Math.floor(Math.random() * n); }
async function hashBlob(dataUrl) {
  const enc = new TextEncoder().encode(dataUrl);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).slice(0,8).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function randomRoom() {
  return ADJ[Math.floor(Math.random()*ADJ.length)] + '-' + NOUN[Math.floor(Math.random()*NOUN.length)] + '-' + Math.floor(Math.random()*100);
}

// =================== IndexedDB asset cache ===================
const ASSET_DB_NAME = 'deckquest-assets';
let assetDB = null;
function openAssetDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(ASSET_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('assets');
    req.onsuccess = () => { assetDB = req.result; res(); };
    req.onerror = () => rej(req.error);
  });
}
function cacheAssetGet(hash) {
  return new Promise(res => {
    if (!assetDB) return res(null);
    const tx = assetDB.transaction('assets', 'readonly');
    const r = tx.objectStore('assets').get(hash);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  });
}
function cacheAssetPut(hash, val) {
  return new Promise(res => {
    if (!assetDB) return res();
    const tx = assetDB.transaction('assets', 'readwrite');
    tx.objectStore('assets').put(val, hash);
    tx.oncomplete = () => res();
  });
}

// =================== File System Asset Access (GM only) ===================
const ASSETS_DIR_IDB_KEY = 'dq-assets-handle';
let assetsRootHandle = null;
const PATH_CACHE = {};   // relativePath → dataUrl

async function getAssetsHandle() {
  return new Promise(res => {
    const tx = assetDB.transaction('assets', 'readonly');
    const r = tx.objectStore('assets').get(ASSETS_DIR_IDB_KEY);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  });
}
async function saveAssetsHandle(handle) {
  return new Promise(res => {
    const tx = assetDB.transaction('assets', 'readwrite');
    tx.objectStore('assets').put(handle, ASSETS_DIR_IDB_KEY);
    tx.oncomplete = res;
  });
}
async function showFolderPickerModal() {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'join-overlay' });
    const box = el('div', { class: 'join-box' });
    box.appendChild(el('h2', {}, 'Deck Quest VTT — GM Setup'));

    const steps = [
      '1. Download the Deck Quest Assets folder from Google Drive (link below) — request access if needed.',
      '2. Extract / save it anywhere on your computer.',
      '3. Click "Open Assets Folder" and select the downloaded "Deck Quest Assets" folder.',
      '4. Chrome will ask for permission — click Allow. You\'re good to go!',
    ];
    for (const s of steps) {
      box.appendChild(el('p', { style: { color: 'var(--muted)', fontSize: '12px', margin: '4px 0' } }, s));
    }

    const driveLink = el('a', {
      href: 'https://drive.google.com/drive/folders/1BWYKOh0a8kXQD-DMUdobWBtP-_GkkLVl?usp=sharing',
      target: '_blank',
      style: { display: 'block', marginBottom: '16px', fontSize: '12px', color: 'var(--accent)', wordBreak: 'break-all' },
    }, 'Google Drive — Deck Quest Assets');
    box.appendChild(driveLink);

    const btn = el('button', { class: 'primary' }, 'Open Assets Folder');
    btn.addEventListener('click', async () => {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        await saveAssetsHandle(handle);
        assetsRootHandle = handle;
        overlay.remove();
        resolve();
      } catch (e) {
        if (e.name !== 'AbortError') alert('Could not open folder: ' + e.message);
      }
    });
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}
async function setupAssetsFolder() {
  if (ROLE !== 'gm') return;
  if (!window.showDirectoryPicker) {
    alert('Deck Quest GM requires Google Chrome for file system access.');
    return;
  }
  await showFolderPickerModal();
}
async function resolveAssetFile(relativePath) {
  if (!assetsRootHandle) return null;
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let dir = assetsRootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(parts[i]); }
    catch { return null; }
  }
  try {
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch { return null; }
}
async function loadAssetAsDataUrl(relativePath) {
  if (PATH_CACHE[relativePath]) return PATH_CACHE[relativePath];
  const file = await resolveAssetFile(relativePath);
  if (!file) return null;
  return new Promise(res => {
    const reader = new FileReader();
    reader.onload = async e => {
      const dataUrl = e.target.result;
      PATH_CACHE[relativePath] = dataUrl;
      res(dataUrl);
      // GM: register hash+path in assetMeta and push to connected players
      // so they can render cards/tokens received via state
      if (ROLE === 'gm' && STATE?.assetMeta) {
        try {
          const hash = await hashBlob(dataUrl);
          PATH_TO_HASH[relativePath] = hash;
          ASSETS[hash] = dataUrl;
          if (!STATE.assetMeta[hash]) {
            STATE.assetMeta[hash] = { kind: 'asset', size: dataUrl.length, path: relativePath };
            for (const conn of Object.values(connections)) sendAsset(conn, hash, dataUrl, 'asset');
          }
        } catch (_) {}
      }
    };
    reader.onerror = () => res(null);
    reader.readAsDataURL(file);
  });
}

// Render a card image on any element — GM loads from filesystem,
// player uses hash-based ASSETS received via sendAsset from GM.
function loadCardImage(relativePath, imgEl) {
  if (!relativePath) return;
  if (ROLE === 'gm') {
    loadAssetAsDataUrl(relativePath).then(url => { if (url) imgEl.src = url; });
  } else {
    const hash = PATH_TO_HASH[relativePath];
    if (hash && ASSETS[hash]) {
      imgEl.src = ASSETS[hash];
      imgEl.classList.remove('card-loading');
    } else {
      // Shimmer until image arrives; rerenderAll() from handleAssetMessage
      // will re-call loadCardImage, find the image, and clear the shimmer.
      imgEl.classList.add('card-loading');
    }
  }
}

// =================== State ===================
let STATE = null;       // GM only: canonical
let LOCAL_VIEW = null;  // Player: filtered state received from GM
let ASSETS = {};        // hash -> dataUrl (in-memory)
let MY_ID = null;       // 'gm' or 'player1'..'player10'
let MY_NAME = 'GM';
let MY_COLOR = '#3b82f6';
let MY_ROOM = null;

function newState(playerCount) {
  const decks = {}; const discards = {};
  for (const t of DECK_TYPES) {
    decks[t] = shuffle(CARDS_BY_TYPE[t].map(c => c.id));
    discards[t] = [];
  }
  const hands = { gm: { name: 'GM', color: '#3b82f6', hand: [] } };
  for (let i=1; i<=playerCount; i++) {
    hands['player'+i] = {
      name: '',
      pfpHash: null,
      stats: { ...DEFAULT_STATS },
      hp: { ...DEFAULT_HP },
      armor: { ...DEFAULT_ARMOR },
      info: { class: '', race: '', age: '', weight: '' },
      gold: 0,
      inventory: [],
      notes: '',
      hand: [],
      connected: false,
      color: PLAYER_COLORS[i-1],
    };
  }
  return {
    roomCode: randomRoom(),
    playerCount,
    decks, discards,
    table: { cards: [], figurines: [], drawings: [] },
    hands,
    assetMeta: {},
    log: [],
    chat: [],
    gmNotes: '',
  };
}

function viewFor(playerId) {
  // Strip GM hand; players see other players' face-down cards as just {faceUp:false}.
  const s = STATE;
  const view = JSON.parse(JSON.stringify({
    roomCode: s.roomCode, playerCount: s.playerCount,
    decks: Object.fromEntries(Object.entries(s.decks).map(([k,v])=>[k,v.length])),
    discards: s.discards,
    table: s.table,
    hands: {},
    assetMeta: s.assetMeta,
    log: s.log,
    chat: s.chat || [],
  }));
  for (const [pid, p] of Object.entries(s.hands)) {
    if (pid === 'gm') continue; // never send GM hand to players
    view.hands[pid] = { ...p };
    // Player hands are fully visible to all players — no face-down hiding.
    // (GM hand is still excluded entirely above.)
  }
  return view;
}

function activeState() { return ROLE === 'gm' ? STATE : LOCAL_VIEW; }

// =================== Logging ===================
function logEntry(who, text, kind='info') {
  const entry = { ts: Date.now(), who, text, kind };
  if (ROLE === 'gm') {
    STATE.log.push(entry);
    if (STATE.log.length > 200) STATE.log.shift();
    renderLog();
    broadcast({ type: 'state' });
    autosave();
  } else {
    sendToGM({ type: 'log', entry });
  }
}
function renderLog() {
  const log = activeState()?.log || [];
  const c = $('#logEntries'); if (!c) return;
  c.innerHTML = '';
  for (const e of log.slice(-100)) {
    c.appendChild(el('div', { class: 'log-entry log-' + e.kind },
      el('span', { class: 'log-who', style: { color: e.color || '#888' } }, e.who + ': '),
      e.text
    ));
  }
  c.scrollTop = c.scrollHeight;
}

// =================== Dice ===================
function rollAndLog(spec) {
  // spec like 'd20', 'd6', '2d6+3'
  const m = spec.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) { logEntry(MY_NAME, 'Bad roll: '+spec, 'warn'); return; }
  const n = parseInt(m[1] || '1', 10);
  const sides = parseInt(m[2], 10);
  const mod = parseInt(m[3] || '0', 10);
  const rolls = []; for (let i=0;i<n;i++) rolls.push(rollDie(sides));
  const sum = rolls.reduce((a,b)=>a+b,0) + mod;
  const detail = (n>1 ? `[${rolls.join(',')}]` : `${rolls[0]}`) + (mod ? (mod>0?` +${mod}`:` ${mod}`) : '');
  const txt = `rolled ${spec} → ${detail} = ${sum}`;
  if (ROLE === 'gm') {
    STATE.log.push({ ts:Date.now(), who:MY_NAME, text:txt, kind:'roll', color:MY_COLOR });
    if (STATE.log.length>200) STATE.log.shift();
    renderLog(); broadcast({ type:'state' }); autosave();
  } else {
    sendToGM({ type:'log', entry:{ ts:Date.now(), who:MY_NAME, text:txt, kind:'roll', color:MY_COLOR } });
  }
}

// =================== WebSocket relay networking ===================
// ┌─────────────────────────────────────────────────────────────────┐
// │  RELAY_URL — update this after deploying relay/server.js        │
// │  to Render.com, then run  node build.js  to rebuild the HTMLs.  │
// │  Example: 'wss://deck-quest-relay.onrender.com'                 │
// └─────────────────────────────────────────────────────────────────┘
const RELAY_URL = 'wss://deck-quest-vtt.onrender.com';

let wsConn = null;
let _netPingTimer = null;
let _netPingSent  = 0;

// Movement sync: GM broadcasts tiny move-patches instead of full state for drags.
// Players apply them in-place and keep their own in-flight moves "pending" so an
// unrelated full-state broadcast can't snap a just-moved token back.
const pendingMoves = {}; // instId -> { x, y, timer }

function broadcastMovePatch(patch) {
  if (ROLE !== 'gm') return;
  const msg = { type: 'move-patch', ...patch };
  for (const conn of Object.values(connections)) conn.send(msg);
}
function markOptimisticMove(instId, x, y) {
  if (ROLE === 'gm' || !LOCAL_VIEW) return;
  const obj = LOCAL_VIEW.table.figurines.find(f => f.instId === instId)
           || LOCAL_VIEW.table.cards.find(c => c.instId === instId);
  if (obj) { obj.x = x; obj.y = y; }
  if (pendingMoves[instId]?.timer) clearTimeout(pendingMoves[instId].timer);
  pendingMoves[instId] = { x, y, timer: setTimeout(() => { delete pendingMoves[instId]; }, 3000) };
}
function clearPendingMove(instId) {
  if (pendingMoves[instId]) { clearTimeout(pendingMoves[instId].timer); delete pendingMoves[instId]; }
}
function reapplyPendingMoves() {
  if (!LOCAL_VIEW) return;
  for (const [instId, pm] of Object.entries(pendingMoves)) {
    const obj = LOCAL_VIEW.table.figurines.find(f => f.instId === instId)
             || LOCAL_VIEW.table.cards.find(c => c.instId === instId);
    if (obj) { obj.x = pm.x; obj.y = pm.y; }
  }
}
function applyMovePatch(p) {
  if (!LOCAL_VIEW) return;
  const arr = p.kind === 'card' ? LOCAL_VIEW.table.cards : LOCAL_VIEW.table.figurines;
  const obj = arr.find(o => o.instId === p.instId);
  if (obj) { obj.x = p.x; obj.y = p.y; if (p.z != null) obj.z = p.z; }
  clearPendingMove(p.instId); // GM confirmed this position
  const dom = document.querySelector(`[data-inst-id="${p.instId}"]`);
  if (dom) { dom.style.left = p.x + 'px'; dom.style.top = p.y + 'px'; if (p.z != null) dom.style.zIndex = p.z; }
}

function startNetMonitor() {
  clearInterval(_netPingTimer);
  updateNetStatus(true, null);
  _netPingTimer = setInterval(() => {
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) { updateNetStatus(false, null); return; }
    _netPingSent = Date.now();
    wsConn.send(JSON.stringify({ type: 'ping', ts: _netPingSent }));
  }, 5000);
}

function updateNetStatus(online, ms) {
  const el = $('#connStatus'); if (!el) return;
  let dotColor, label, tip;
  if (!online) {
    dotColor = '#ef4444'; label = 'Offline';
    tip = 'Relay: Offline\nPing: —';
  } else if (ms == null) {
    dotColor = '#f59e0b'; label = '…';
    tip = 'Relay: Online\nPing: measuring…';
  } else if (ms < 100) {
    dotColor = '#10b981'; label = ms + ' ms';
    tip = `Relay: Online\nPing: ${ms} ms  ✓ Good`;
  } else if (ms < 300) {
    dotColor = '#f59e0b'; label = ms + ' ms';
    tip = `Relay: Online\nPing: ${ms} ms  ⚠ Fair`;
  } else {
    dotColor = '#ef4444'; label = ms + ' ms';
    tip = `Relay: Online\nPing: ${ms} ms  ✕ High`;
  }
  el.innerHTML = `<span class="net-dot" style="background:${dotColor}"></span>${label}`;
  el.setAttribute('data-tooltip', tip);
}
let connections = {};    // GM: { slot: fakeConn }. Player: { gm: fakeConn }
let cursorThrottle = 0;

// Lightweight fake-connection object so all existing broadcast/sendToGM
// code continues to work without changes.
function makeConn(slot) {
  return {
    _playerId: slot,
    open: true,
    close() { /* no-op; server handles teardown */ },
    send(msg) {
      if (wsConn && wsConn.readyState === WebSocket.OPEN) {
        wsConn.send(JSON.stringify({ to: slot, msg }));
      }
    },
  };
}

function setupPeerGM(roomCode) {
  if (wsConn) wsConn.close();
  wsConn = new WebSocket(RELAY_URL);
  wsConn.onopen = () => {
    wsConn.send(JSON.stringify({ type: 'register', room: roomCode, role: 'gm' }));
    $('#roomCode').textContent = roomCode;
    startNetMonitor();
  };
  wsConn.onmessage = e => {
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (data.type === 'pong') { updateNetStatus(true, Date.now() - data.ts); return; }
    // Internal lifecycle: player WebSocket connected/disconnected
    if (data.type === '_ws-connected') {
      const slot = data.slot;
      if (!connections[slot]) connections[slot] = makeConn(slot);
      connections[slot].open = true;
      return;
    }
    if (data.type === '_ws-disconnected') {
      const slot = data.slot;
      onPlayerDisconnect(connections[slot] || { _playerId: slot });
      return;
    }
    // Game message from a player: { from: slot, msg: {...} }
    if (data.from) {
      const slot = data.from;
      if (!connections[slot]) connections[slot] = makeConn(slot);
      handleFromPlayer(connections[slot], data.msg);
    }
  };
  wsConn.onclose = () => { clearInterval(_netPingTimer); updateNetStatus(false, null); };
  wsConn.onerror = () => { updateNetStatus(false, null); };
}

function setupPeerPlayer(roomCode) {
  if (wsConn) wsConn.close();
  wsConn = new WebSocket(RELAY_URL);
  wsConn.onopen = () => {
    wsConn.send(JSON.stringify({ type: 'register', room: roomCode, role: 'player', slot: MY_ID }));
    connections.gm = makeConn('gm');
    connections.gm.open = true;
    connections.gm.send({ type: 'join', slot: MY_ID, name: MY_NAME, pfpHash: window._pendingPfpHash || null });
    if (window._pendingPfp) {
      sendAsset(connections.gm, window._pendingPfpHash, window._pendingPfp, 'pfp');
      delete window._pendingPfp;
    }
    startNetMonitor();
  };
  wsConn.onmessage = e => {
    let data; try { data = JSON.parse(e.data); } catch { return; }
    handleFromGM(data);
  };
  wsConn.onclose = () => {
    $('#connStatus').textContent = 'GM offline';
    if (connections.gm) connections.gm.open = false;
  };
  wsConn.onclose = () => { clearInterval(_netPingTimer); updateNetStatus(false, null); if (connections.gm) connections.gm.open = false; };
  wsConn.onerror = () => { updateNetStatus(false, null); };
}

// ---- Chunked asset transfer ----
const CHUNK_SIZE = 14000; // bytes of base64 per chunk; safe under typical data-channel limits
const incomingAssets = {}; // hash -> { kind, parts:[], total }

function sendAsset(conn, hash, dataUrl, kind) {
  const total = Math.ceil(dataUrl.length / CHUNK_SIZE);
  conn.send({ type:'asset-begin', hash, kind, total });
  for (let i=0;i<total;i++) {
    conn.send({ type:'asset-chunk', hash, index:i, data: dataUrl.slice(i*CHUNK_SIZE, (i+1)*CHUNK_SIZE) });
  }
  conn.send({ type:'asset-end', hash });
}

async function handleAssetMessage(data, fromConn) {
  if (data.type === 'asset-begin') {
    incomingAssets[data.hash] = { kind:data.kind, parts:new Array(data.total), total:data.total };
  } else if (data.type === 'asset-chunk') {
    const inc = incomingAssets[data.hash]; if (!inc) return;
    inc.parts[data.index] = data.data;
  } else if (data.type === 'asset-end') {
    const inc = incomingAssets[data.hash]; if (!inc) return;
    const dataUrl = inc.parts.join('');
    ASSETS[data.hash] = dataUrl;
    await cacheAssetPut(data.hash, { kind: inc.kind, dataUrl });
    delete incomingAssets[data.hash];
    // Update path→hash map so card rendering can find the image
    const assetPath = activeState()?.assetMeta?.[data.hash]?.path;
    if (assetPath) PATH_TO_HASH[assetPath] = data.hash;
    if (ROLE === 'gm') {
      STATE.assetMeta[data.hash] = { kind: inc.kind, size: dataUrl.length };
      // forward to all other players
      for (const [pid, c] of Object.entries(connections)) {
        if (c !== fromConn) sendAsset(c, data.hash, dataUrl, inc.kind);
      }
      broadcast({ type:'state' });
      autosave();
    }
    rerenderAll();
  } else if (data.type === 'asset-request') {
    const dataUrl = ASSETS[data.hash];
    if (dataUrl) sendAsset(fromConn, data.hash, dataUrl, (STATE?.assetMeta?.[data.hash]?.kind) || 'figurine');
  }
}

function requestMissingAssets(meta) {
  // Player side: compare meta vs local cache; request anything missing.
  for (const hash of Object.keys(meta || {})) {
    const p = meta[hash]?.path;
    if (ASSETS[hash]) { if (p) PATH_TO_HASH[p] = hash; continue; }
    cacheAssetGet(hash).then(cached => {
      if (cached) {
        ASSETS[hash] = cached.dataUrl;
        if (p) PATH_TO_HASH[p] = hash;
        rerenderAll();
      } else {
        connections.gm?.send({ type:'asset-request', hash });
      }
    });
  }
}

// ---- Message handlers ----
function handleFromPlayer(conn, data) {
  if (['asset-begin','asset-chunk','asset-end','asset-request'].includes(data.type)) {
    return handleAssetMessage(data, conn);
  }
  if (data.type === 'join') {
    const slot = data.slot;
    if (!STATE.hands[slot]) {
      conn.send({ type:'join-rejected', reason:'No such slot.' });
      conn.close(); return;
    }
    // Reject if slot is already held by a live player.
    if (STATE.hands[slot].connected) {
      conn.send({ type:'join-rejected', reason:`Slot already taken by ${STATE.hands[slot].name || slot}.` });
      return;
    }
    connections[slot] = conn;
    conn._playerId = slot;
    STATE.hands[slot].name = data.name || ('Player ' + slot.slice(6));
    STATE.hands[slot].pfpHash = data.pfpHash || STATE.hands[slot].pfpHash;
    STATE.hands[slot].connected = true;
    logEntry(STATE.hands[slot].name, 'joined', 'sys');
    // Auto-add a character token for this player on first join (if they have a pfp).
    if (STATE.hands[slot].pfpHash) ensureCharacterToken(slot);
    // send the new player their initial filtered view + ID
    conn.send({ type:'state', view: viewFor(slot), myId: slot, takenSlots: Object.keys(connections).filter(s => connections[s]?.open) });
    broadcastTakenSlots();
    return;
  }
  if (data.type === 'request-taken-slots') {
    conn.send({ type:'taken-slots', slots: Object.keys(connections).filter(s => connections[s]?.open) });
    return;
  }
  if (data.type === 'log') {
    STATE.log.push({ ...data.entry });
    if (STATE.log.length>200) STATE.log.shift();
    renderLog(); broadcast({ type:'state' }); autosave(); return;
  }
  if (data.type === 'cursor') {
    broadcastCursor(conn._playerId, data.x, data.y);
    return;
  }
  if (data.type === 'draw-stroke') {
    STATE.table.drawings.push({ id: uid(), by: conn._playerId, ...data.stroke });
    broadcast({ type:'state' }); renderTable(); autosave(); return;
  }
  if (data.type === 'op') return applyOp(data.op, conn._playerId);
}

function handleFromGM(data) {
  if (data.type === 'pong') { updateNetStatus(true, Date.now() - data.ts); return; }
  if (data.type === 'move-patch') { applyMovePatch(data); return; }
  if (['asset-begin','asset-chunk','asset-end'].includes(data.type)) return handleAssetMessage(data, connections.gm);
  if (data.type === 'state') {

    LOCAL_VIEW = data.view;
    if (data.myId) MY_ID = data.myId;
    reapplyPendingMoves(); // keep our just-moved tokens put; don't snap back on unrelated broadcasts
    rerenderAll();
    requestMissingAssets(LOCAL_VIEW.assetMeta);
    renderChatPanel();
    return;
  }
  if (data.type === 'cursor-update') {
    drawCursor(data.who, data.x, data.y, data.color, data.name, data.pfpHash);
    return;
  }
  if (data.type === 'join-rejected') {
    alert('Could not join: ' + (data.reason || 'unknown reason'));
    location.reload();
    return;
  }
  if (data.type === 'taken-slots') {
    window._takenSlots = data.slots || [];
    updateJoinSlotSelect();
    return;
  }
}

function ensureCharacterToken(playerId) {
  // GM only: make sure each player has exactly one character token on the table.
  if (ROLE !== 'gm' || !STATE) return;
  const existing = STATE.table.figurines.find(f => f.kind === 'character' && f.playerId === playerId);
  if (existing) return; // already present, render() will pick up current pfp
  const baseX = 400 + (parseInt(playerId.slice(6),10) - 1) * 90;
  STATE.table.figurines.push({
    instId: uid(), kind:'character', playerId,
    x: baseX, y: 500, w: 80, h: 80, rot: 0, z: nextZ(),
    opacity: 1, locked: false, flipH:false, flipV:false,
    label: STATE.hands[playerId]?.name || playerId,
    effects: {},
  });
}

function broadcastTakenSlots() {
  if (ROLE !== 'gm') return;
  const slots = Object.keys(connections).filter(s => connections[s]?.open);
  for (const c of Object.values(connections)) {
    if (c.open) c.send({ type:'taken-slots', slots });
  }
}

function onPlayerDisconnect(conn) {
  const pid = conn._playerId; if (!pid) return;
  delete connections[pid];
  if (STATE.hands[pid]) { STATE.hands[pid].connected = false; logEntry(STATE.hands[pid].name || pid, 'disconnected', 'sys'); }
  broadcast({ type:'state' });
  broadcastTakenSlots();
}

function broadcast(msg) {
  if (ROLE !== 'gm') return;
  for (const [pid, conn] of Object.entries(connections)) {
    if (msg.type === 'state') conn.send({ type:'state', view: viewFor(pid), myId: pid });
    else conn.send(msg);
  }
  rerenderAll();
}

function broadcastCursor(who, x, y) {
  if (ROLE !== 'gm') return;
  const player = STATE.hands[who];
  const payload = { type:'cursor-update', who, x, y, color: player?.color || '#fff', name: player?.name || who, pfpHash: player?.pfpHash };
  for (const c of Object.values(connections)) c.send(payload);
  drawCursor(who, x, y, payload.color, payload.name, payload.pfpHash);
}

function sendToGM(msg) {
  connections.gm?.send(msg);
}
function sendOp(op) {
  if (ROLE === 'gm') applyOp(op, 'gm');
  else sendToGM({ type:'op', op });
}

// =================== State operations (GM-applied) ===================
function applyOp(op, by) {
  if (ROLE !== 'gm') return;
  const s = STATE;
  switch (op.type) {
    case 'draw': {
      const deck = s.decks[op.deck]; if (!deck || !deck.length) return;
      const cardId = deck.shift();
      const target = op.to || 'gm';
      const inst = { instId: uid(), cardId, faceUp: target === 'gm' || target === by ? true : false };
      if (target === 'table') { s.table.cards.push({ ...inst, x: 400, y: 300, rot:0, z:nextZ() }); }
      else { s.hands[target].hand.push(inst); }
      const targetName = target === 'gm' ? 'GM' : s.hands[target]?.name || target;
      logEntry(by==='gm'?'GM':(s.hands[by]?.name||by), `drew ${op.deck} → ${targetName}`, 'sys');
      break;
    }
    case 'shuffle-deck': {
      shuffle(s.decks[op.deck]);
      logEntry('GM', `shuffled ${op.deck}`, 'sys');
      break;
    }
    case 'flip-card': {
      // op.where: 'hand' | 'table', op.owner (for hand), op.instId
      let c = null;
      if (op.where === 'table') c = s.table.cards.find(c => c.instId === op.instId);
      else c = s.hands[op.owner]?.hand.find(c => c.instId === op.instId);
      if (!c) return;
      if (op.where === 'table' && c.locked && by !== 'gm') return;
      c.faceUp = !c.faceUp;
      break;
    }
    case 'move-table-card': {
      const c = s.table.cards.find(c => c.instId === op.instId); if (!c) return;
      if (c.locked && by !== 'gm') return;
      c.x = op.x; c.y = op.y; c.z = nextZ();
      // In-place update — no destroy/recreate flash
      const domCard = document.querySelector(`[data-inst-id="${op.instId}"]`);
      if (domCard) { domCard.style.left = c.x + 'px'; domCard.style.top = c.y + 'px'; domCard.style.zIndex = c.z; }
      broadcastMovePatch({ kind:'card', instId:op.instId, x:c.x, y:c.y, z:c.z });
      autosave();
      return;
    }
    case 'lock-table-card': {
      if (by !== 'gm') return;
      const c = s.table.cards.find(c => c.instId === op.instId); if (!c) return;
      c.locked = !c.locked;
      break;
    }
    case 'transfer-card': {
      // from {where:'hand'|'table', owner?, instId} → to {where, owner?}
      let card = null;
      if (op.from.where === 'table') {
        const i = s.table.cards.findIndex(c => c.instId === op.from.instId);
        if (i<0) return;
        if (s.table.cards[i].locked && by !== 'gm') return;
        card = s.table.cards.splice(i,1)[0];
      } else {
        const arr = s.hands[op.from.owner]?.hand; if (!arr) return;
        const i = arr.findIndex(c => c.instId === op.from.instId);
        if (i<0) return; card = arr.splice(i,1)[0];
      }
      if (op.to.where === 'discard') {
        s.discards[CARDS_BY_ID[card.cardId].type].push(card.cardId);
      } else if (op.to.where === 'deck') {
        s.decks[CARDS_BY_ID[card.cardId].type].push(card.cardId);
      } else if (op.to.where === 'table') {
        s.table.cards.push({ ...card, x: op.to.x || 400, y: op.to.y || 300, rot: 0, z: nextZ() });
      } else if (op.to.where === 'hand') {
        const inst = { instId: card.instId, cardId: card.cardId, faceUp: op.to.faceUp ?? card.faceUp };
        s.hands[op.to.owner].hand.push(inst);
      }
      break;
    }
    case 'set-player-field': {
      const p = s.hands[op.owner]; if (!p) return;
      // op.path like 'hp.current', 'stats.str', 'name', 'gold', 'info.class'
      const parts = op.path.split('.');
      let o = p; for (let i=0;i<parts.length-1;i++) o = o[parts[i]];
      o[parts[parts.length-1]] = op.value;
      break;
    }
    case 'set-pfp': {
      const p = s.hands[op.owner]; if (!p) return;
      p.pfpHash = op.hash;
      ensureCharacterToken(op.owner);
      break;
    }
    case 'toggle-effect': {
      const f = s.table.figurines.find(f => f.instId === op.instId); if (!f) return;
      f.effects = f.effects || {};
      f.effects[op.effect] = !f.effects[op.effect];
      break;
    }
    case 'set-figurine-label': {
      const f = s.table.figurines.find(f => f.instId === op.instId); if (!f) return;
      f.label = op.label;
      break;
    }
    case 'add-inventory': {
      s.hands[op.owner].inventory.push({ id: uid(), name: op.name });
      break;
    }
    case 'remove-inventory': {
      const p = s.hands[op.owner]; if (!p) return;
      p.inventory = p.inventory.filter(i => i.id !== op.id);
      break;
    }
    case 'add-figurine': {
      s.table.figurines.push({ instId: uid(), assetHash: op.hash, x: op.x||300, y: op.y||300, w: op.w||200, h: op.h||200, rot: 0, z: nextZ(), label: op.label || '' });
      break;
    }
    case 'move-figurine': {
      const f = s.table.figurines.find(f => f.instId === op.instId); if (!f) return;
      if (op.x != null) f.x = op.x; if (op.y != null) f.y = op.y;
      if (op.w != null) f.w = op.w; if (op.h != null) f.h = op.h;
      if (op.rot != null) f.rot = op.rot;
      if (op.locked != null) f.locked = op.locked;
      if (op.opacity != null) f.opacity = op.opacity;
      if (op.flipH != null) f.flipH = op.flipH;
      if (op.flipV != null) f.flipV = op.flipV;
      if (op.label != null) f.label = op.label;
      if (op.bringToFront) f.z = nextZ();
      else if (op.sendToBack) {
        const minZ = Math.min(...s.table.figurines.map(g => g.z||1));
        f.z = minZ - 1;
      }
      // Pure drag (x/y only) — update existing DOM element in-place, no destroy/recreate flash
      const isDrag = op.x != null && op.y != null &&
        op.w == null && op.h == null && op.rot == null && op.locked == null &&
        op.opacity == null && op.flipH == null && op.flipV == null && op.label == null &&
        !op.bringToFront && !op.sendToBack;
      if (isDrag) {
        const domFig = document.querySelector(`[data-inst-id="${op.instId}"]`);
        if (domFig) { domFig.style.left = f.x + 'px'; domFig.style.top = f.y + 'px'; }
        broadcastMovePatch({ kind:'figurine', instId:op.instId, x:f.x, y:f.y, z:f.z });
        autosave();
        return;
      }
      break;
    }
    case 'remove-figurine': {
      s.table.figurines = s.table.figurines.filter(f => f.instId !== op.instId);
      break;
    }
    case 'duplicate-figurine': {
      const f = s.table.figurines.find(f => f.instId === op.instId); if (!f) return;
      s.table.figurines.push({ ...f, instId: uid(), x: f.x + 30, y: f.y + 30, z: nextZ() });
      break;
    }
    case 'clear-drawings': {
      s.table.drawings = []; logEntry('GM', 'cleared drawings', 'sys'); break;
    }
    case 'clear-my-drawings': {
      s.table.drawings = s.table.drawings.filter(d => d.by !== op.by); break;
    }
    case 'undo-drawing': {
      for (let i=s.table.drawings.length-1; i>=0; i--) {
        if (s.table.drawings[i].by === op.by) { s.table.drawings.splice(i,1); break; }
      } break;
    }
    case 'add-drawing': {
      s.table.drawings.push({ id: uid(), by: op.by, ...op.stroke }); break;
    }
    case 'remove-drawing': {
      s.table.drawings = s.table.drawings.filter(d => d.id !== op.id);
      break;
    }
    case 'set-group': {
      const ids = op.instIds || [];
      const gid = op.groupId || null;
      for (const id of ids) {
        const f = s.table.figurines.find(x => x.instId === id);
        if (f) { if (gid) f.groupId = gid; else delete f.groupId; }
        const c = s.table.cards.find(x => x.instId === id);
        if (c) { if (gid) c.groupId = gid; else delete c.groupId; }
      }
      break;
    }
    case 'send-chat': {
      if (!s.chat) s.chat = [];
      s.chat.push({ who: op.who, text: op.text, color: op.color || 'var(--text)', ts: op.ts || Date.now() });
      if (s.chat.length > 200) s.chat.splice(0, s.chat.length - 200);
      // Don't rerenderAll for chat — just update the chat panel
      broadcast({ type:'state' });
      renderAllGM();
      autosave();
      return;
    }
    case 'set-figurine-vitals': {
      const f = s.table.figurines.find(x => x.instId === op.instId); if (!f) break;
      if (op.hp  !== undefined) f.hp   = op.hp;
      if (op.armor !== undefined) f.armor = op.armor;
      break;
    }
    case 'set-gm-notes': {
      s.gmNotes = op.text || '';
      // GM notes are local — no broadcast needed, but we autosave
      autosave();
      return;
    }
  }
  broadcast({ type:'state' });
  renderAllGM();
  autosave();
}

// =================== Save / load / autosave ===================
function autosave() {
  if (ROLE !== 'gm') return;
  try {
    const snap = { state: STATE, assets: ASSETS };
    localStorage.setItem('deckquest-session-' + STATE.roomCode, JSON.stringify(snap));
    localStorage.setItem('deckquest-last-room', STATE.roomCode);
  } catch (e) { console.warn('autosave failed (storage full?)', e); }
}
function downloadSession() {
  const snap = { state: STATE, assets: ASSETS };
  const blob = new Blob([JSON.stringify(snap)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `deckquest-${STATE.roomCode}-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}
function loadSessionFile(file) {
  const r = new FileReader();
  r.onload = async () => {
    const snap = JSON.parse(r.result);
    STATE = snap.state;
    migrateState(STATE); normalizeZ(STATE);
    ASSETS = snap.assets || {};
    for (const [hash, dataUrl] of Object.entries(ASSETS)) {
      const meta = STATE.assetMeta[hash] || { kind: 'figurine' };
      await cacheAssetPut(hash, { kind: meta.kind, dataUrl });
    }
    setupPeerGM(STATE.roomCode);
    renderAllGM();
    logEntry('GM', 'loaded session', 'sys');
  };
  r.readAsText(file);
}
function tryRestoreLast() {
  const last = localStorage.getItem('deckquest-last-room');
  if (!last) return false;
  const raw = localStorage.getItem('deckquest-session-' + last);
  if (!raw) return false;
  try {
    const snap = JSON.parse(raw);
    STATE = snap.state; migrateState(STATE); normalizeZ(STATE); ASSETS = snap.assets || {};
    return true;
  } catch { return false; }
}

// =================== Rendering ===================
function rerenderAll() {
  withPreservedFocus(() => {
    if (ROLE === 'gm') renderAllGM();
    else renderAllPlayer();
  });
}
function renderAllGM() {
  renderTopbar(); renderTable(); renderRightRail(); renderLog(); renderChatPanel();
}
function renderAllPlayer() {
  renderTopbarPlayer(); renderTable(); renderRightRailPlayer(); renderLog(); renderChatPanel();
}

function renderTopbar() {
  if (!STATE) return;
  $('#roomCode').textContent = STATE.roomCode;
  $('#playerCountLabel').textContent = STATE.playerCount;
  const connList = $('#connList'); if (connList) {
    connList.innerHTML = '';
    for (let i=1;i<=STATE.playerCount;i++) {
      const pid='player'+i; const p=STATE.hands[pid];
      const dot = el('span', { class:'dot', style:{background: p.connected ? p.color : '#444'}});
      connList.appendChild(el('span', { class:'conn-chip', title:p.name||pid }, dot, p.name || ('P'+i)));
    }
  }
}
function renderTopbarPlayer() {
  if (!LOCAL_VIEW) return;
  $('#roomCode').textContent = LOCAL_VIEW.roomCode;
}

// ---- Table ----
function renderTable() {
  const s = activeState(); if (!s) return;
  renderDeckStacks();
  renderTableCards();
  renderFigurines();
  renderDrawings();
}
function renderDeckStacks() {
  const s = activeState();
  const c = $('#deckStacks'); if (!c) return;
  c.innerHTML = '';
  for (const t of DECK_TYPES) {
    const count = ROLE==='gm' ? s.decks[t].length : s.decks[t];
    const stack = el('div', { class:'deck-stack', title: `${DECK_LABELS[t]} (${count})`, 'data-deck': t });
    const backCard = CARDS_BY_TYPE[t][0];
    if (count > 0 && backCard) {
      const bimg = el('img', { class:'card-img', draggable:'false' });
      bimg.style.background = 'var(--panel)';
      loadCardImage(backCard.backPath, bimg);
      stack.appendChild(bimg);
    } else {
      stack.appendChild(el('div', { class:'card-empty' }, 'Empty'));
    }
    stack.appendChild(el('div', { class:'deck-label' }, `${DECK_LABELS[t]} · ${count}`));
    if (ROLE === 'gm') {
      stack.addEventListener('click', () => showDrawMenu(t, stack));
      stack.addEventListener('contextmenu', e => { e.preventDefault(); showDeckContextMenu(t, e); });
    }
    c.appendChild(stack);
  }
  // discards
  const dc = $('#discardStacks'); if (dc) {
    dc.innerHTML = '';
    for (const t of DECK_TYPES) {
      const arr = s.discards[t]; const top = arr[arr.length-1];
      const stack = el('div', { class:'deck-stack discard', 'data-deck': t });
      if (top) {
        const dimg = el('img', { class:'card-img' });
        dimg.style.background = 'var(--panel)';
        loadCardImage(CARDS_BY_ID[top].path, dimg);
        stack.appendChild(dimg);
      }
      else stack.appendChild(el('div', { class:'card-empty' }, 'Discard'));
      stack.appendChild(el('div', { class:'deck-label' }, `${DECK_LABELS[t]} discard · ${arr.length}`));
      stack.style.cursor = 'pointer';
      stack.addEventListener('click', () => showDiscardPanel(t));
      dc.appendChild(stack);
    }
  }
}

function renderTableCards() {
  if (_isDragging) return;
  const s = activeState();
  const layer = $('#cardLayer'); if (!layer) return;
  layer.innerHTML = '';
  for (const c of s.table.cards) {
    const card = CARDS_BY_ID[c.cardId];
    const div = el('div', { class:'placed-card' + (c.locked?' locked':'') + (selectionSet.has(c.instId)?' selected':'') + (c.groupId?' grouped':''), style:{ left:c.x+'px', top:c.y+'px', transform:`rotate(${c.rot||0}deg)`, zIndex:c.z||1 }, 'data-inst-id': c.instId });
    const cimg = el('img', { class:'card-img', draggable:'false' });
    cimg.style.background = 'var(--panel)';
    loadCardImage(c.faceUp ? card.path : card.backPath, cimg);
    div.appendChild(cimg);
    if (c.locked) div.appendChild(el('div', { class:'figurine-lock-icon', title:'Locked by GM' }, '🔒'));
    if (!c.locked) {
      makeDraggable(div, (x,y) => sendOp({ type:'move-table-card', instId:c.instId, x, y }), c.instId);
    }
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      showCardContextMenu({ where:'table', instId:c.instId, cardId:c.cardId, faceUp:c.faceUp, locked:c.locked }, e);
    });
    layer.appendChild(div);
  }
}

function renderFigurines() {
  if (_isDragging) return;
  const s = activeState();
  const layer = $('#figurineLayer'); if (!layer) return;
  layer.innerHTML = '';
  for (const f of s.table.figurines) {
    let url, isChar = f.kind === 'character', charPlayer = null, ringColor = null;
    if (isChar) {
      charPlayer = s.hands[f.playerId];
      const pfpHash = charPlayer?.pfpHash;
      url = pfpHash ? ASSETS[pfpHash] : null;
      ringColor = charPlayer?.color || '#f2ca50';
    } else {
      url = ASSETS[f.assetHash];
      if (!url) {
        const tok = TOKENS_BY_ID[f.assetHash];
        if (tok) {
          url = PATH_CACHE[tok.path];
          if (!url) {
            loadAssetAsDataUrl(tok.path).then(loaded => {
              if (loaded) { ASSETS[f.assetHash] = loaded; renderFigurines(); }
            });
          }
        }
      }
    }
    const eff = f.effects || {};
    let opacity = f.opacity != null ? f.opacity : 1;
    if (eff.invisible) opacity *= 0.35;
    const sx = f.flipH ? -1 : 1, sy = f.flipV ? -1 : 1;
    const tf = `rotate(${f.rot||0}deg) scale(${sx},${sy})`;
    const classes = 'figurine'
      + (f.locked ? ' locked' : '')
      + (isChar ? ' character' : '')
      + (eff.sneaking ? ' sneaking' : '')
      + (eff.down ? ' downed' : '')
      + (selectionSet.has(f.instId) ? ' selected' : '')
      + (f.groupId ? ' grouped' : '');
    const style = { left:f.x+'px', top:f.y+'px', width:f.w+'px', height:f.h+'px', transform:tf, zIndex:f.z||1, opacity };
    if (isChar) style.borderColor = ringColor;
    const div = el('div', { class:classes, style, 'data-inst-id': f.instId });
    if (url) div.appendChild(el('img', { class:'figurine-img', src:url, draggable:'false' }));
    else div.appendChild(el('div', { class:'figurine-loading' }, isChar ? (charPlayer?.name || '?') : 'Loading...'));
    if (isChar) {
      const tag = el('div', { class:'character-nametag', style:{ background: ringColor } }, charPlayer?.name || f.playerId);
      div.appendChild(tag);
    } else if (f.label) {
      div.appendChild(el('div', { class:'figurine-label' }, f.label));
    }
    // HP / Armor vitals bars — non-character tokens use f.hp / f.armor; character tokens use player sheet
    const hp    = isChar ? charPlayer?.hp    : f.hp;
    const armor = isChar ? charPlayer?.armor : f.armor;
    if (hp) {
      const vitalsDiv = el('div', { class:'fig-vitals' });
      const hpPct = Math.max(0, Math.min(100, hp.max > 0 ? (hp.current / hp.max) * 100 : 100));
      const hpWrap = el('div', { class:'fig-bar-wrap', style:{ width: Math.max(f.w, 48) + 'px' } });
      hpWrap.appendChild(el('div', { class:'fig-bar-hp', style:{ width: hpPct + '%' } }));
      vitalsDiv.appendChild(hpWrap);
      if (armor && armor.current > 0) {
        const arPct = Math.max(0, Math.min(100, armor.max > 0 ? (armor.current / armor.max) * 100 : 100));
        const arWrap = el('div', { class:'fig-bar-wrap', style:{ width: Math.max(f.w, 48) + 'px' } });
        arWrap.appendChild(el('div', { class:'fig-bar-armor', style:{ width: arPct + '%' } }));
        vitalsDiv.appendChild(arWrap);
      }
      div.appendChild(vitalsDiv);
      // Skull overlay when HP is 0
      if (hp.current <= 0) {
        div.appendChild(el('div', { class:'fig-skull' }, '💀'));
      }
    }
    // Effect badges (skip on non-characters too — generic tokens can carry effects)
    const badges = [];
    if (eff.attacking) badges.push(['⚔️','attacking','Attacking']);
    if (eff.bleeding) badges.push(['🩸','bleeding','Bleeding']);
    if (eff.poisoned) badges.push(['☠️','poisoned','Poisoned']);
    if (eff.stunned) badges.push(['💫','stunned','Stunned']);
    if (eff.defending) badges.push(['🛡️','defending','Defending']);
    if (eff.invisible) badges.push(['👻','invisible','Invisible']);
    if (eff.sneaking) badges.push(['🌫️','sneaking','Sneaking']);
    if (eff.down) badges.push(['💀','down','Down']);
    if (badges.length) {
      const bar = el('div', { class:'effect-bar' });
      for (const [icon, cls, title] of badges) bar.appendChild(el('span', { class:'effect-badge effect-'+cls, title }, icon));
      div.appendChild(bar);
    }
    if (f.locked) div.appendChild(el('div', { class:'figurine-lock-icon', title:'Locked' }, '🔒'));
    if (!f.locked) {
      makeDraggable(div, (x,y) => sendOp({ type:'move-figurine', instId:f.instId, x, y }), f.instId);
      // resize handle
      const handle = el('div', { class:'figurine-resize' });
      handle.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        const startX = e.clientX, startY = e.clientY, w0 = f.w, h0 = f.h;
        const size0 = Math.max(w0, h0);
        const onMove = ev => {
          const delta = ((ev.clientX - startX) + (ev.clientY - startY)) / 2 / tableZoom;
          const ns = Math.max(40, size0 + delta);
          div.style.width = ns+'px'; div.style.height = ns+'px';
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const ns = parseInt(div.style.width, 10);
          sendOp({ type:'move-figurine', instId:f.instId, w:ns, h:ns });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      div.appendChild(handle);
    }
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      showFigurineContextMenu(f, e);
    });
    layer.appendChild(div);
  }
}

function renderDrawings() {
  const s = activeState();
  const canvas = $('#drawLayer'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (canvas.width !== canvas.offsetWidth) canvas.width = canvas.offsetWidth;
  if (canvas.height !== canvas.offsetHeight) canvas.height = canvas.offsetHeight;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for (const d of s.table.drawings) {
    ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath();
    for (let i=0;i<d.points.length;i++) {
      const [x,y] = d.points[i];
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
}

// ---- Cursors ----
const cursorEls = {};
function drawCursor(who, x, y, color, name, pfpHash) {
  if (who === MY_ID) return;
  const layer = $('#cursorLayer'); if (!layer) return;
  let c = cursorEls[who];
  if (!c) {
    c = el('div', { class:'cursor', style:{ color } });
    c.appendChild(el('div', { class:'cursor-arrow' }));
    c.appendChild(el('div', { class:'cursor-label' }, name || who));
    layer.appendChild(c);
    cursorEls[who] = c;
  }
  c.style.left = x + 'px'; c.style.top = y + 'px';
  c.querySelector('.cursor-label').textContent = name || who;
  const arrow = c.querySelector('.cursor-arrow');
  if (pfpHash && ASSETS[pfpHash]) arrow.style.backgroundImage = 'url('+ASSETS[pfpHash]+')';
  arrow.style.background = pfpHash && ASSETS[pfpHash] ? `url(${ASSETS[pfpHash]}) center/cover` : color;
}

// =================== Right rail ===================
function renderRightRail() {
  const s = activeState(); if (!s) return;
  const rail = $('#rightRail'); if (!rail) return;
  rail.innerHTML = '';
  // GM private notes (GM only)
  if (ROLE === 'gm') {
    const notes = el('details', { id:'gmNotesPanel' });
    const summary = el('summary', {}, 'GM Notes');
    const ta = el('textarea', { placeholder:'Private notes (not visible to players)…', rows:'5' }, s.gmNotes || '');
    let notesTimer = null;
    ta.addEventListener('input', () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => {
        STATE.gmNotes = ta.value;
        autosave();
      }, 500);
    });
    notes.appendChild(summary);
    notes.appendChild(ta);
    rail.appendChild(notes);
  }
  // GM hand tab
  rail.appendChild(playerPanel('gm', s.hands.gm));
  for (let i=1;i<=s.playerCount;i++) {
    const pid='player'+i; const p=s.hands[pid];
    rail.appendChild(playerPanel(pid, p));
  }
}
function renderRightRailPlayer() {
  const s = activeState(); if (!s) return;
  const rail = $('#rightRail'); if (!rail) return;
  rail.innerHTML = '';
  // self first
  const me = s.hands[MY_ID];
  if (me) rail.appendChild(playerPanel(MY_ID, me, true));
  for (let i=1;i<=s.playerCount;i++) {
    const pid='player'+i; if (pid===MY_ID) continue;
    const p=s.hands[pid]; rail.appendChild(playerPanel(pid, p, false));
  }
}

const expandedPanels = new Set();
function playerPanel(pid, p, isSelfOrEditable) {
  const editable = ROLE === 'gm' || isSelfOrEditable;
  // First render: auto-expand own panel + GM tab (for GM).
  if (!expandedPanels.has(pid) && !expandedPanels.has('_initialized:' + pid)) {
    expandedPanels.add('_initialized:' + pid);
    if (pid === MY_ID || (pid === 'gm' && ROLE === 'gm')) expandedPanels.add(pid);
  }
  const expanded = expandedPanels.has(pid);
  const panel = el('div', { class:'player-panel' + (expanded?' expanded':'') });
  // header
  const header = el('div', { class:'player-header', style:{ borderColor: p.color || 'var(--accent)' }});
  const pfp = el('div', { class:'pfp' });
  if (p.pfpHash && ASSETS[p.pfpHash]) pfp.style.backgroundImage = 'url('+ASSETS[p.pfpHash]+')';
  header.appendChild(pfp);
  header.appendChild(el('div', { class:'player-name' }, p.name || (pid==='gm'?'GM':pid)));
  if (pid !== 'gm' && p.hp && p.armor) {
    const vitals = el('div', { class:'header-vitals' });
    const hpMed = el('div', { class:'stat-medallion hp', title:`HP ${p.hp.current}/${p.hp.max}` });
    hpMed.appendChild(el('div', { class:'stat-medallion-val' }, String(p.hp.current ?? '—')));
    hpMed.appendChild(el('div', { class:'stat-medallion-lbl' }, 'HP'));
    vitals.appendChild(hpMed);
    const arMed = el('div', { class:'stat-medallion armor', title:`Armor ${p.armor.current}/${p.armor.max}` });
    arMed.appendChild(el('div', { class:'stat-medallion-val' }, String(p.armor.current ?? '—')));
    arMed.appendChild(el('div', { class:'stat-medallion-lbl' }, 'AC'));
    vitals.appendChild(arMed);
    header.appendChild(vitals);
  }
  header.addEventListener('click', () => {
    if (expandedPanels.has(pid)) expandedPanels.delete(pid);
    else expandedPanels.add(pid);
    panel.classList.toggle('expanded');
  });
  panel.appendChild(header);
  if (pid === 'gm') {
    if (ROLE === 'gm') {
      const body = el('div', { class:'player-body' });
      body.appendChild(el('div', { class:'section-label' }, `Hand (${p.hand.length})`));
      const handDiv = el('div', { class:'hand-cards' });
      for (const c of p.hand) {
        handDiv.appendChild(handCardEl(c, 'gm'));
      }
      body.appendChild(handDiv);
      panel.appendChild(body);
    }
    return panel;
  }
  // stats body
  const body = el('div', { class:'player-body' });
  // Name + info
  body.appendChild(field('Name', p.name, editable, v => sendOp({ type:'set-player-field', owner:pid, path:'name', value:v }), 'text', `${pid}.name`));
  const infoRow = el('div', { class:'row' });
  for (const k of ['class','race','age','weight']) {
    infoRow.appendChild(field(k[0].toUpperCase()+k.slice(1), p.info[k], editable, v => sendOp({ type:'set-player-field', owner:pid, path:'info.'+k, value:v }), 'text', `${pid}.info.${k}`));
  }
  body.appendChild(infoRow);
  // HP / Armor
  const vitalRow = el('div', { class:'row' });
  vitalRow.appendChild(vitalBar('HP', p.hp, 'hp', '#ffb4a8', editable, pid));
  vitalRow.appendChild(vitalBar('Armor', p.armor, 'armor', '#c3cee5', editable, pid));
  body.appendChild(vitalRow);
  // Stats
  const statRow = el('div', { class:'stat-grid' });
  for (const k of ['str','agi','int','cha','sta']) {
    statRow.appendChild(field(k.toUpperCase(), p.stats[k], editable, v => sendOp({ type:'set-player-field', owner:pid, path:'stats.'+k, value:parseInt(v,10)||0 }), 'number', `${pid}.stats.${k}`));
  }
  body.appendChild(statRow);
  // Gold
  body.appendChild(field('Gold', p.gold, editable, v => sendOp({ type:'set-player-field', owner:pid, path:'gold', value:parseInt(v,10)||0 }), 'number', `${pid}.gold`));
  // Notes
  body.appendChild(textareaField('Notes', p.notes, editable, v => sendOp({ type:'set-player-field', owner:pid, path:'notes', value:v }), `${pid}.notes`));
  // Inventory
  const inv = el('div', { class:'inventory' });
  inv.appendChild(el('div', { class:'section-label' }, 'Inventory'));
  for (const item of p.inventory || []) {
    const row = el('div', { class:'inv-row' }, item.name);
    if (editable) row.appendChild(el('button', { class:'mini', onclick: () => sendOp({ type:'remove-inventory', owner:pid, id:item.id }) }, '×'));
    inv.appendChild(row);
  }
  if (editable) {
    const add = el('div', { class:'inv-add' });
    const input = el('input', { type:'text', placeholder:'Add item (Enter)...' });
    input.dataset.fieldKey = `${pid}.inv-add`;
    input.addEventListener('keydown', e => { if (e.key==='Enter' && input.value.trim()) { sendOp({ type:'add-inventory', owner:pid, name:input.value.trim() }); input.value=''; }});
    add.appendChild(input);
    inv.appendChild(add);
  }
  body.appendChild(inv);
  // PFP upload (self or GM)
  if (editable) {
    const pfpBtn = el('label', { class:'pfp-upload' }, 'Set profile pic');
    const fi = el('input', { type:'file', accept:'image/*', style:{ display:'none' }});
    fi.addEventListener('change', e => uploadPfp(pid, e.target.files[0]));
    pfpBtn.appendChild(fi);
    body.appendChild(pfpBtn);
  }
  // Hand
  const handDiv = el('div', { class:'hand-cards' });
  for (const c of p.hand || []) handDiv.appendChild(handCardEl(c, pid, editable));
  body.appendChild(el('div', { class:'section-label' }, 'Hand'));
  body.appendChild(handDiv);
  panel.appendChild(body);
  return panel;
}

function field(label, val, editable, onChange, type='text', key) {
  const wrap = el('div', { class:'field' });
  wrap.appendChild(el('label', {}, label));
  if (editable) {
    const inp = el('input', { type, value: val==null?'':val });
    if (key) inp.dataset.fieldKey = key;
    // Commit only on Enter or blur — typing is local until then, so concurrent
    // state updates don't wipe what the user is mid-typing.
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); onChange(e.target.value); e.target.blur(); }
      else if (e.key === 'Escape') { e.target.value = val==null?'':String(val); e.target.blur(); }
    });
    inp.addEventListener('blur', e => {
      const cur = type === 'number' ? String(val==null?'':val) : (val==null?'':String(val));
      if (e.target.value !== cur) onChange(e.target.value);
    });
    wrap.appendChild(inp);
  } else {
    wrap.appendChild(el('div', { class:'val' }, String(val==null?'':val)));
  }
  return wrap;
}

function textareaField(label, val, editable, onChange, key) {
  const wrap = el('div', { class:'field' });
  wrap.appendChild(el('label', {}, label));
  if (editable) {
    const ta = el('textarea', { rows:'3', placeholder:'Notes...' });
    ta.value = val || '';
    if (key) ta.dataset.fieldKey = key;
    ta.addEventListener('keydown', e => {
      // Ctrl/Cmd+Enter commits; Enter alone makes a newline.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onChange(e.target.value); e.target.blur(); }
      else if (e.key === 'Escape') { e.target.value = val || ''; e.target.blur(); }
    });
    ta.addEventListener('blur', e => { if (e.target.value !== (val || '')) onChange(e.target.value); });
    wrap.appendChild(ta);
  } else {
    wrap.appendChild(el('div', { class:'val', style:{whiteSpace:'pre-wrap'} }, val || ''));
  }
  return wrap;
}

// Run a render but preserve typing in the currently-focused input.
function withPreservedFocus(renderFn) {
  const active = document.activeElement;
  const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  const key = isInput ? active.dataset.fieldKey : null;
  const liveValue = isInput ? active.value : null;
  const selStart = isInput ? active.selectionStart : null;
  const selEnd = isInput ? active.selectionEnd : null;
  renderFn();
  if (key) {
    const newEl = document.querySelector('[data-field-key="' + key.replace(/"/g, '\\"') + '"]');
    if (newEl) {
      newEl.value = liveValue;  // restore uncommitted text exactly as typed
      newEl.focus();
      try { newEl.setSelectionRange(selStart, selEnd); } catch {}
    }
  }
}

function vitalBar(label, obj, key, color, editable, pid) {
  const wrap = el('div', { class:'vital' });
  wrap.appendChild(el('label', {}, label));
  const bar = el('div', { class:'bar' });
  const fill = el('div', { class:'bar-fill', style:{ width: (100*obj.current/Math.max(1,obj.max)) + '%', background: color }});
  bar.appendChild(fill);
  wrap.appendChild(bar);
  const num = el('div', { class:'vital-num' });
  if (editable) {
    const mkInput = (val, path) => {
      const inp = el('input', { type:'number', value:val, style:{width:'50px'}});
      inp.dataset.fieldKey = `${pid}.${path}`;
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); sendOp({ type:'set-player-field', owner:pid, path, value:parseInt(e.target.value,10)||0 }); e.target.blur(); }
        else if (e.key === 'Escape') { e.target.value = val; e.target.blur(); }
      });
      inp.addEventListener('blur', e => {
        const v = parseInt(e.target.value,10)||0;
        if (v !== val) sendOp({ type:'set-player-field', owner:pid, path, value:v });
      });
      return inp;
    };
    num.appendChild(mkInput(obj.current, key+'.current'));
    num.appendChild(document.createTextNode(' / '));
    num.appendChild(mkInput(obj.max, key+'.max'));
  } else {
    num.textContent = obj.current + ' / ' + obj.max;
  }
  wrap.appendChild(num);
  return wrap;
}

function handCardEl(c, owner, editable) {
  const card = c.cardId ? CARDS_BY_ID[c.cardId] : null;
  // All hands (other than the GM's, which is filtered upstream) are now visible to
  // every player. Show the face whenever we have the cardId.
  const showFace = !!card;
  const div = el('div', { class:'hand-card', title: showFace ? card.name : '' });
  const himg = el('img', { class:'card-img' });
  himg.style.background = 'var(--panel)';
  const hPath = showFace ? card?.path : (card?.backPath || CARDS_BY_TYPE.role[0]?.backPath);
  loadCardImage(hPath, himg);
  div.appendChild(himg);
  if (editable !== false && (ROLE === 'gm' || owner === MY_ID)) {
    div.addEventListener('click', () => sendOp({ type:'flip-card', where:'hand', owner, instId:c.instId }));
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      showCardContextMenu({ where:'hand', owner, instId:c.instId, cardId:c.cardId, faceUp:c.faceUp }, e);
    });
  }
  return div;
}

// =================== Context menus ===================
function showMenu(items, x, y) {
  $$('.ctx-menu').forEach(m => m.remove());
  const m = el('div', { class:'ctx-menu', style:{ left:x+'px', top:y+'px' }});
  for (const it of items) {
    if (it === '-') { m.appendChild(el('div',{class:'ctx-sep'})); continue; }
    const item = el('div', { class:'ctx-item' + (it.disabled?' disabled':''), onclick: () => { if (!it.disabled){ it.action(); m.remove(); }} }, it.label);
    m.appendChild(item);
  }
  document.body.appendChild(m);
  // Reposition so the menu stays fully inside the viewport.
  const r = m.getBoundingClientRect();
  if (r.bottom > window.innerHeight) m.style.top  = Math.max(0, y - r.height) + 'px';
  if (r.right  > window.innerWidth)  m.style.left = Math.max(0, x - r.width)  + 'px';
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once:true }), 0);
}
function showDrawMenu(deckType, anchor) {
  const r = anchor.getBoundingClientRect();
  const items = [{ label: 'Draw to GM hand', action: () => sendOp({ type:'draw', deck:deckType, to:'gm' }) }];
  items.push({ label: 'Draw to table', action: () => sendOp({ type:'draw', deck:deckType, to:'table' }) });
  items.push('-');
  for (let i=1;i<=STATE.playerCount;i++) {
    items.push({ label: `Draw to ${STATE.hands['player'+i].name || 'P'+i}`, action: () => sendOp({ type:'draw', deck:deckType, to:'player'+i }) });
  }
  showMenu(items, r.left, r.bottom);
}
function showDeckContextMenu(deckType, e) {
  showMenu([
    { label: 'Shuffle deck', action: () => sendOp({ type:'shuffle-deck', deck:deckType }) },
    { label: 'Search...', action: () => openSearch(deckType) },
  ], e.clientX, e.clientY);
}
function showCardContextMenu(info, e) {
  // Auto-expand selection to the whole group when right-clicking a grouped item
  if (info.where === 'table' && info.instId && !selectionSet.has(info.instId)) {
    if (selectWholeGroup(info.instId)) rerenderAll();
  }
  const items = [];
  if (info.where === 'table' && selectionSet.size > 1 && selectionSet.has(info.instId)) {
    const n = selectionSet.size;
    items.push({ label: `${n} items selected`, disabled: true });
    items.push({ label: `🗑 Discard all ${n}`, action: () => {
      if (!confirm(`Discard ${n} selected items?`)) return;
      const s = activeState();
      for (const id of [...selectionSet]) {
        if (s.table.cards.find(x => x.instId === id)) sendOp({ type:'transfer-card', from:{where:'table',instId:id}, to:{where:'discard'} });
        else if (s.table.figurines.find(x => x.instId === id)) sendOp({ type:'remove-figurine', instId:id });
      }
      selectionSet.clear();
    }});
    items.push({ label: `✕ Deselect all`, action: () => { selectionSet.clear(); rerenderAll(); }});
    // Make Group / Ungroup
    const ids = [...selectionSet];
    const firstGid = getGroupIdOf(ids[0]);
    const allSameGroup = firstGid && ids.every(id => getGroupIdOf(id) === firstGid);
    if (allSameGroup) {
      items.push({ label: `🔓 Ungroup`, action: () => {
        sendOp({ type:'set-group', instIds: getGroupMembers(firstGid), groupId: null });
      }});
    } else {
      items.push({ label: `🔗 Make Group`, action: () => {
        sendOp({ type:'set-group', instIds: ids, groupId: uid() });
      }});
    }
    items.push('-');
  }
  // Ungroup option for a single right-clicked grouped item
  if (info.where === 'table' && selectionSet.size <= 1) {
    const gid = getGroupIdOf(info.instId);
    if (gid) {
      items.push({ label: `🔓 Ungroup`, action: () => {
        sendOp({ type:'set-group', instIds: getGroupMembers(gid), groupId: null });
      }});
      items.push('-');
    }
  }
  items.push(
    { label: info.faceUp ? 'Flip face-down' : 'Flip face-up', action: () => sendOp({ type:'flip-card', where:info.where, owner:info.owner, instId:info.instId }) },
  );
  if (info.where === 'table' && ROLE === 'gm') {
    items.push({ label: info.locked ? '🔓 Unlock (allow players to move)' : '🔒 Lock (only GM can move)',
      action: () => sendOp({ type:'lock-table-card', instId: info.instId }) });
  }
  if (info.where === 'hand') {
    items.push({ label:'Move to table', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'table' }}) });
    if (ROLE === 'gm') {
      items.push('-');
      for (let i=1;i<=STATE.playerCount;i++) {
        if ('player'+i === info.owner) continue;
        items.push({ label:'Give to '+(STATE.hands['player'+i].name||'P'+i), action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:'player'+i }}) });
      }
      if (info.owner !== 'gm') items.push({ label:'Give to GM', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:'gm' }}) });
    }
    items.push('-');
    items.push({ label:'Discard', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'discard' }}) });
    items.push({ label:'Return to deck', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'deck' }}) });
  }
  if (info.where === 'table') {
    items.push({ label:'Discard', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'discard' }}) });
    items.push({ label:'Return to deck', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'deck' }}) });
    if (ROLE === 'gm') {
      items.push('-');
      items.push({ label:'To GM hand', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:'gm', faceUp:true }}) });
      for (let i=1;i<=STATE.playerCount;i++) {
        items.push({ label:'To '+(STATE.hands['player'+i].name||'P'+i), action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:'player'+i, faceUp: info.faceUp }}) });
      }
    }
  }
  showMenu(items, e.clientX, e.clientY);
}
const STATUS_EFFECTS = [
  ['attacking', '⚔️ Attacking'],
  ['defending', '🛡️ Defending'],
  ['bleeding',  '🩸 Bleeding'],
  ['poisoned',  '☠️ Poisoned'],
  ['stunned',   '💫 Stunned'],
  ['invisible', '👻 Invisible'],
  ['sneaking',  '🌫️ Sneaking'],
  ['down',      '💀 Down'],
];
function showFigurineContextMenu(f, e) {
  // Auto-expand selection to the whole group when right-clicking a grouped item
  if (!selectionSet.has(f.instId)) {
    if (selectWholeGroup(f.instId)) rerenderAll();
  }
  const eff = f.effects || {};
  const items = [];
  // Group actions when multiple items are selected
  if (selectionSet.size > 1 && selectionSet.has(f.instId)) {
    const n = selectionSet.size;
    items.push({ label: `${n} items selected`, disabled: true });
    items.push({ label: `🗑 Delete all ${n}`, action: () => {
      if (!confirm(`Delete ${n} selected items?`)) return;
      const s = activeState();
      for (const id of [...selectionSet]) {
        if (s.table.figurines.find(x => x.instId === id)) sendOp({ type:'remove-figurine', instId:id });
        else if (s.table.cards.find(x => x.instId === id)) sendOp({ type:'transfer-card', from:{where:'table',instId:id}, to:{where:'discard'} });
      }
      selectionSet.clear();
    }});
    items.push({ label: `🔒 Toggle lock all ${n}`, action: () => {
      const s = activeState();
      for (const id of selectionSet) {
        const fig = s.table.figurines.find(x => x.instId === id);
        if (fig) sendOp({ type:'move-figurine', instId:id, locked:!fig.locked });
      }
    }});
    items.push({ label: `✕ Deselect all`, action: () => { selectionSet.clear(); rerenderAll(); }});
    // Make Group / Ungroup
    const ids = [...selectionSet];
    const firstGid = getGroupIdOf(ids[0]);
    const allSameGroup = firstGid && ids.every(id => getGroupIdOf(id) === firstGid);
    if (allSameGroup) {
      items.push({ label: `🔓 Ungroup`, action: () => {
        sendOp({ type:'set-group', instIds: getGroupMembers(firstGid), groupId: null });
      }});
    } else {
      items.push({ label: `🔗 Make Group`, action: () => {
        sendOp({ type:'set-group', instIds: ids, groupId: uid() });
      }});
    }
    items.push('-');
  } else if (f.groupId) {
    items.push({ label: `🔓 Ungroup`, action: () => {
      sendOp({ type:'set-group', instIds: getGroupMembers(f.groupId), groupId: null });
    }});
    items.push('-');
  }
  items.push(
    { label: f.locked ? '🔓 Unlock' : '🔒 Lock', action: () => sendOp({ type:'move-figurine', instId:f.instId, locked:!f.locked }) },
    { label:'Rename / Label...', action: () => {
        const v = prompt('Label (blank to clear):', f.label || '');
        if (v != null) sendOp({ type:'set-figurine-label', instId:f.instId, label: v });
      } },
    { label:'❤ Edit HP / Armor...', action: () => showTokenDetailPopup(f, e) },
    '-',
    // Status effects — toggle each.
    ...STATUS_EFFECTS.map(([key, label]) => ({
      label: (eff[key] ? '✓ ' : '  ') + label,
      action: () => sendOp({ type:'toggle-effect', instId:f.instId, effect:key }),
    })),
    '-',
    { label:'Rotate +15°', action: () => sendOp({ type:'move-figurine', instId:f.instId, rot:(f.rot||0)+15 }) },
    { label:'Rotate -15°', action: () => sendOp({ type:'move-figurine', instId:f.instId, rot:(f.rot||0)-15 }) },
    { label:'Rotate +90°', action: () => sendOp({ type:'move-figurine', instId:f.instId, rot:(f.rot||0)+90 }) },
    { label:'Rotate exact...', action: () => {
        const v = prompt('Rotation in degrees:', String(f.rot||0));
        if (v != null) sendOp({ type:'move-figurine', instId:f.instId, rot: parseFloat(v)||0 });
      } },
    { label:'Reset rotation', action: () => sendOp({ type:'move-figurine', instId:f.instId, rot: 0 }) },
    '-',
    { label:'Flip horizontal', action: () => sendOp({ type:'move-figurine', instId:f.instId, flipH: !f.flipH }) },
    { label:'Flip vertical', action: () => sendOp({ type:'move-figurine', instId:f.instId, flipV: !f.flipV }) },
    '-',
    { label:'Resize exact...', action: () => {
        const v = prompt('Width × Height (e.g. 400x300):', `${f.w}x${f.h}`);
        if (!v) return;
        const m = v.match(/^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i);
        if (m) sendOp({ type:'move-figurine', instId:f.instId, w:parseInt(m[1],10), h:parseInt(m[2],10) });
      } },
    { label:'Fit to original size', action: () => {
        const url = ASSETS[f.assetHash]; if (!url) return;
        const img = new Image(); img.onload = () => sendOp({ type:'move-figurine', instId:f.instId, w:img.naturalWidth, h:img.naturalHeight });
        img.src = url;
      } },
    { label:'Scale ×2', action: () => sendOp({ type:'move-figurine', instId:f.instId, w:f.w*2, h:f.h*2 }) },
    { label:'Scale ÷2', action: () => sendOp({ type:'move-figurine', instId:f.instId, w:Math.max(20,f.w/2), h:Math.max(20,f.h/2) }) },
    '-',
    { label:'Transparency...', action: () => showOpacitySlider(f, e.clientX, e.clientY) },
    { label:'Reset transparency', action: () => sendOp({ type:'move-figurine', instId:f.instId, opacity: 1 }) },
    '-',
    { label:'Bring to front', action: () => sendOp({ type:'move-figurine', instId:f.instId, bringToFront: true }) },
    { label:'Send to back', action: () => sendOp({ type:'move-figurine', instId:f.instId, sendToBack: true }) },
    '-',
    { label:'Duplicate', action: () => sendOp({ type:'duplicate-figurine', instId:f.instId }) },
    { label:'Reset all transforms', action: () => sendOp({ type:'move-figurine', instId:f.instId, rot:0, opacity:1, flipH:false, flipV:false, locked:false }) },
    '-',
    { label:'🗑 Delete', action: () => { if (confirm('Delete this image?')) sendOp({ type:'remove-figurine', instId:f.instId }); } },
  );
  showMenu(items, e.clientX, e.clientY);
}

function showOpacitySlider(f, x, y) {
  $$('.ctx-menu').forEach(m => m.remove());
  $$('.opacity-popup').forEach(m => m.remove());
  const cur = f.opacity != null ? f.opacity : 1;
  const popup = el('div', { class:'ctx-menu opacity-popup', style:{ left:x+'px', top:y+'px', padding:'10px', minWidth:'200px' }});
  popup.appendChild(el('div', { style:{ fontSize:'11px', color:'#9bb1c9', marginBottom:'6px' }}, 'Transparency'));
  const val = el('div', { style:{ fontSize:'11px', textAlign:'right', marginBottom:'4px' }}, Math.round(cur*100) + '%');
  popup.appendChild(val);
  const slider = el('input', { type:'range', min:'10', max:'100', value: String(Math.round(cur*100)), style:{ width:'100%' }});
  slider.addEventListener('input', () => { val.textContent = slider.value + '%'; });
  slider.addEventListener('change', () => {
    sendOp({ type:'move-figurine', instId:f.instId, opacity: parseInt(slider.value,10)/100 });
  });
  popup.appendChild(slider);
  const close = el('button', { style:{ marginTop:'6px', width:'100%' }, onclick: () => popup.remove() }, 'Close');
  popup.appendChild(close);
  document.body.appendChild(popup);
}

// =================== Group helpers ===================
function getGroupIdOf(instId) {
  const s = activeState(); if (!s) return null;
  const f = s.table.figurines.find(x => x.instId === instId);
  if (f && f.groupId) return f.groupId;
  const c = s.table.cards.find(x => x.instId === instId);
  if (c && c.groupId) return c.groupId;
  return null;
}
function getGroupMembers(groupId) {
  const s = activeState(); if (!s || !groupId) return [];
  const ids = [];
  for (const f of s.table.figurines) if (f.groupId === groupId) ids.push(f.instId);
  for (const c of s.table.cards)     if (c.groupId === groupId) ids.push(c.instId);
  return ids;
}
function selectWholeGroup(instId) {
  const gid = getGroupIdOf(instId);
  if (!gid) return false;
  selectionSet.clear();
  for (const id of getGroupMembers(gid)) selectionSet.add(id);
  return true;
}

// =================== Drag helper ===================
let _isDragging = false; // suppresses renderFigurines/renderTableCards during drag

// instId (optional): enables Ctrl+click selection and group drag.
function makeDraggable(elm, onEnd, instId) {
  elm.style.cursor = 'move';
  elm.addEventListener('mousedown', e => {
    if (e.target.classList.contains('figurine-resize')) return;
    if (e.button !== 0) return;
    if (spaceHeld) return;

    // Ctrl/Cmd+click → toggle this item in the selection set
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      if (instId) {
        selectionSet.has(instId) ? selectionSet.delete(instId) : selectionSet.add(instId);
        rerenderAll();
      }
      return;
    }

    // Grouped item → select the whole group on plain click
    if (instId && !selectionSet.has(instId)) {
      if (!selectWholeGroup(instId)) selectionSet.clear();
      rerenderAll(); // selection highlight re-render — happens before drag starts
    }

    e.preventDefault();

    // Re-read position from the live element after any rerenderAll above
    const liveEl = () => instId ? document.querySelector(`[data-inst-id="${instId}"]`) : elm;
    const ref = liveEl();
    const startX = e.clientX, startY = e.clientY;
    const x0 = parseFloat(ref?.style.left) || 0;
    const y0 = parseFloat(ref?.style.top)  || 0;
    let lastX = x0, lastY = y0;

    // Capture all other selected items for group drag
    const groupMembers = [];
    if (instId && selectionSet.size > 1 && selectionSet.has(instId)) {
      const s = activeState();
      if (s) {
        for (const sid of selectionSet) {
          if (sid === instId) continue;
          const f = s.table.figurines.find(f => f.instId === sid);
          const c = s.table.cards.find(c => c.instId === sid);
          if (f && !f.locked) groupMembers.push({ instId: sid, x0: f.x, y0: f.y, kind: 'figurine' });
          else if (c && !c.locked) groupMembers.push({ instId: sid, x0: c.x, y0: c.y, kind: 'card' });
        }
      }
    }

    _isDragging = true;

    const onMove = ev => {
      const dx = (ev.clientX - startX) / tableZoom;
      const dy = (ev.clientY - startY) / tableZoom;
      lastX = x0 + dx; lastY = y0 + dy;
      // Always look up the live element — it may have been replaced by an earlier rerenderAll
      const live = liveEl();
      if (live) { live.style.left = lastX + 'px'; live.style.top = lastY + 'px'; }
      for (const g of groupMembers) {
        const gel = document.querySelector(`[data-inst-id="${g.instId}"]`);
        if (gel) { gel.style.left = (g.x0 + dx) + 'px'; gel.style.top = (g.y0 + dy) + 'px'; }
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      _isDragging = false;
      onEnd(lastX, lastY);
      // Optimistic: apply our own move to LOCAL_VIEW now so an unrelated broadcast
      // arriving before the GM confirms doesn't snap the token back (players only).
      if (instId) markOptimisticMove(instId, lastX, lastY);
      // Send ops for group members
      if (groupMembers.length) {
        const dx = lastX - x0, dy = lastY - y0;
        for (const g of groupMembers) {
          const gx = Math.round(g.x0 + dx), gy = Math.round(g.y0 + dy);
          if (g.kind === 'figurine')
            sendOp({ type: 'move-figurine', instId: g.instId, x: gx, y: gy });
          else
            sendOp({ type: 'move-table-card', instId: g.instId, x: gx, y: gy });
          markOptimisticMove(g.instId, gx, gy);
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// =================== Search overlay ===================
function openSearch(filterType) {
  const overlay = el('div', { class:'search-overlay', onclick: e => { if (e.target === overlay) overlay.remove(); }});
  const box = el('div', { class:'search-box' });
  const input = el('input', { type:'text', placeholder:'Search cards...', autofocus:true });
  const results = el('div', { class:'search-results' });
  function update() {
    const q = input.value.toLowerCase();
    results.innerHTML = '';
    let list = CARDS.filter(c => (!filterType || c.type === filterType) && c.name.toLowerCase().includes(q));
    list = list.slice(0, 50);
    for (const c of list) {
      const r = el('div', { class:'search-result' });
      const simg = el('img');
      simg.style.background = 'var(--panel)';
      loadCardImage(c.path, simg);
      r.appendChild(simg);
      r.appendChild(el('div', {}, c.name + ' (' + c.type + ')'));
      const actions = el('div', { class:'sr-actions' });
      actions.appendChild(el('button', { onclick: () => { spawnSpecificCard(c.id, 'table'); overlay.remove(); } }, 'To table'));
      for (let i=1;i<=STATE.playerCount;i++) {
        actions.appendChild(el('button', { onclick: () => { spawnSpecificCard(c.id, 'player'+i); overlay.remove(); } }, 'To P'+i));
      }
      actions.appendChild(el('button', { onclick: () => { spawnSpecificCard(c.id, 'gm'); overlay.remove(); } }, 'To GM'));
      r.appendChild(actions);
      results.appendChild(r);
    }
  }
  input.addEventListener('input', update);
  box.appendChild(input); box.appendChild(results);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  input.focus(); update();
}
function spawnSpecificCard(cardId, target) {
  // Remove from deck if present, then add to target as an instance
  const t = CARDS_BY_ID[cardId].type;
  const i = STATE.decks[t].indexOf(cardId);
  if (i >= 0) STATE.decks[t].splice(i, 1);
  const inst = { instId: uid(), cardId, faceUp: target === 'gm' || target === 'table' };
  if (target === 'table') STATE.table.cards.push({ ...inst, x:400, y:300, rot:0, z:nextZ() });
  else STATE.hands[target].hand.push(inst);
  broadcast({ type:'state' }); renderAllGM(); autosave();
}

// =================== Drawing & cursor on table ===================
let currentTool = 'pointer';
let currentColor = '#3b82f6';
let currentWidth = 3;
let activeStroke = null;
const PATH_TO_HASH = {};   // relativePath → hash; lets players look up received card images by path
let _chatUnread = 0;
let _chatPaneActive = false;
let _lastChatCount = 0;
function _updateChatBadge() {
  const badge = $('#chatBadge'); if (!badge) return;
  if (_chatUnread > 0) { badge.style.display = 'inline'; badge.textContent = _chatUnread > 99 ? '99+' : String(_chatUnread); }
  else { badge.style.display = 'none'; }
}

function setupTableInteraction() {
  const canvas = $('#drawLayer'); const stage = $('#tableStage');
  if (!stage) return;

  // Space = pan mode
  window.addEventListener('keydown', e => {
    if (e.key === ' ' && !e.target.matches('input,textarea,select')) {
      e.preventDefault();
      spaceHeld = true;
      stage.style.cursor = 'grab';
    }
  });
  window.addEventListener('keyup', e => {
    if (e.key === ' ') {
      spaceHeld = false;
      isPanning = false;
      stage.style.cursor = '';
    }
  });

  // Pan start
  stage.addEventListener('mousedown', e => {
    if (spaceHeld && e.button === 0) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panOriginX = tablePanX; panOriginY = tablePanY;
      stage.style.cursor = 'grabbing';
    }
  });

  // Token stamper — capture-phase so a click always stamps (never starts a drag/lasso).
  // Only stamp on the actual table surface, never on toolbar / floating panels
  // (which live inside #tableStage but outside #tableContent).
  stage.addEventListener('mousedown', e => {
    if (!stampMode || e.button !== 0 || spaceHeld) return;
    const onTable = e.target === stage || (e.target.closest && e.target.closest('#tableContent'));
    if (!onTable) return;
    e.preventDefault(); e.stopPropagation();
    stampAt(e.clientX, e.clientY);
  }, true);
  // Ghost follows the cursor while stamping
  stage.addEventListener('mousemove', e => {
    if (!stampMode || !stampGhost) return;
    const tc = $('#tableContent'); if (!tc) return;
    const cr = tc.getBoundingClientRect();
    const x = (e.clientX - cr.left) / tableZoom - stampSize / 2;
    const y = (e.clientY - cr.top)  / tableZoom - stampSize / 2;
    stampGhost.style.display = 'block';
    stampGhost.style.left = x + 'px';
    stampGhost.style.top  = y + 'px';
  });

  // Wheel zoom (centered on cursor)
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(4, tableZoom * factor));
    const r = stage.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    tablePanX = mx - (mx - tablePanX) * (newZoom / tableZoom);
    tablePanY = my - (my - tablePanY) * (newZoom / tableZoom);
    tableZoom = newZoom;
    applyTableTransform();
  }, { passive: false });

  stage.addEventListener('mousemove', e => {
    if (isPanning) {
      tablePanX = panOriginX + (e.clientX - panStartX);
      tablePanY = panOriginY + (e.clientY - panStartY);
      applyTableTransform();
      return;
    }
    // Convert to table space for cursor + drawing
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left - tablePanX) / tableZoom;
    const y = (e.clientY - r.top  - tablePanY) / tableZoom;
    // throttle cursor broadcast
    const now = Date.now();
    if (now - cursorThrottle > 60) {
      cursorThrottle = now;
      if (ROLE === 'gm') broadcastCursor('gm', x, y);
      else sendToGM({ type:'cursor', x, y });
    }
    // Only extend the stroke while the left mouse button is still held.
    if (activeStroke && (e.buttons & 1)) {
      activeStroke.points.push([x, y]);
      drawLiveStroke();
    } else if (activeStroke && !(e.buttons & 1)) {
      // Mouse button was released outside the window or the up event was missed.
      finishStroke();
    }
  });

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (currentTool === 'pen') {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      activeStroke = { color: currentColor, width: currentWidth, points: [[(e.clientX - r.left) / tableZoom, (e.clientY - r.top) / tableZoom]] };
    } else if (currentTool === 'eraser') {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      eraseAt((e.clientX - r.left) / tableZoom, (e.clientY - r.top) / tableZoom);
    }
  });
  canvas.addEventListener('mousemove', e => {
    // Continuous-erase: while LMB held in eraser mode, erase strokes under the cursor.
    if (currentTool !== 'eraser' || !(e.buttons & 1)) return;
    const r = canvas.getBoundingClientRect();
    eraseAt((e.clientX - r.left) / tableZoom, (e.clientY - r.top) / tableZoom);
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) {
      finishStroke();
      if (isPanning) {
        isPanning = false;
        stage.style.cursor = spaceHeld ? 'grab' : '';
      }
    }
  });
  window.addEventListener('blur', () => { finishStroke(); spaceHeld = false; isPanning = false; });

  // Escape = clear selection / exit stamper
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (stampMode) { setTool('pointer'); return; }
      selectionSet.clear(); $$('.ctx-menu').forEach(m => m.remove()); rerenderAll();
    }
  });

  // Hover tracker — what is the mouse currently over? (for hover-context keybinds)
  document.addEventListener('mousemove', e => {
    const t = e.target;
    const deck = t.closest && t.closest('.deck-stack');
    const fig  = t.closest && t.closest('.figurine');
    const card = t.closest && t.closest('.placed-card');
    if (deck && deck.dataset.deck) hoverInfo = { kind:'deck', deck: deck.dataset.deck, discard: deck.classList.contains('discard') };
    else if (fig && fig.dataset.instId)  hoverInfo = { kind:'figurine', instId: fig.dataset.instId };
    else if (card && card.dataset.instId) hoverInfo = { kind:'card', instId: card.dataset.instId };
    else hoverInfo = null;
  });

  // Global hover-context keybinds
  window.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input,textarea,select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const s = activeState();

    // Global: tools (all roles)
    if (k === '1') return setTool('pointer');
    if (k === '2') return setTool('pen');
    if (k === '3') return setTool('eraser');
    if (k === 't' && ROLE === 'gm') { setTool(stampMode ? 'pointer' : 'stamp'); return; }

    if (!hoverInfo || !s) return;

    // Deck hover (GM only)
    if (hoverInfo.kind === 'deck' && ROLE === 'gm') {
      if (k === 's') { sendOp({ type:'shuffle-deck', deck: hoverInfo.deck }); e.preventDefault(); }
      else if (k === 'd') { sendOp({ type:'draw', deck: hoverInfo.deck, to:'table' }); e.preventDefault(); }
      else if (k === 'g') { sendOp({ type:'draw', deck: hoverInfo.deck, to:'gm' }); e.preventDefault(); }
      return;
    }

    // Figurine hover
    if (hoverInfo.kind === 'figurine') {
      const f = s.table.figurines.find(x => x.instId === hoverInfo.instId); if (!f) return;
      if (f.locked && ROLE !== 'gm') return;
      if (k === 'f') sendOp({ type:'move-figurine', instId:f.instId, flipH: !f.flipH });
      else if (k === 'r') sendOp({ type:'move-figurine', instId:f.instId, rot: ((f.rot||0)+90)%360 });
      else if (k === '[') sendOp({ type:'move-figurine', instId:f.instId, sendToBack:true });
      else if (k === ']') sendOp({ type:'move-figurine', instId:f.instId, bringToFront:true });
      else if (k === 'l' && ROLE === 'gm') sendOp({ type:'move-figurine', instId:f.instId, locked: !f.locked });
      else if (k === 'e' && ROLE === 'gm') sendOp({ type:'duplicate-figurine', instId:f.instId });
      else if ((k === 'Delete' || k === 'Backspace') && ROLE === 'gm') sendOp({ type:'remove-figurine', instId:f.instId });
      return;
    }

    // Table card hover
    if (hoverInfo.kind === 'card') {
      const c = s.table.cards.find(x => x.instId === hoverInfo.instId); if (!c) return;
      if (c.locked && ROLE !== 'gm') return;
      if (k === 'f') sendOp({ type:'flip-card', where:'table', instId:c.instId });
      else if (k === 'l' && ROLE === 'gm') sendOp({ type:'lock-table-card', instId:c.instId });
      else if ((k === 'Delete' || k === 'Backspace') && ROLE === 'gm') sendOp({ type:'transfer-card', from:{ where:'table', instId:c.instId }, to:{ where:'discard' } });
      return;
    }
  });

  // Lasso-select: drag on empty table area to rubber-band select figurines/cards
  const tableContent = $('#tableContent');
  if (tableContent) {
    tableContent.addEventListener('mousedown', e => {
      if (e.button !== 0 || spaceHeld || currentTool !== 'pointer') return;
      if (e.target.closest('.figurine,.placed-card,.deck-stack')) return;
      if (!e.ctrlKey && !e.metaKey) selectionSet.clear();
      const cr = tableContent.getBoundingClientRect();
      const sx = (e.clientX - cr.left) / tableZoom;
      const sy = (e.clientY - cr.top)  / tableZoom;
      const rectEl = document.createElement('div');
      rectEl.className = 'select-rect';
      tableContent.appendChild(rectEl);
      const onMove = ev => {
        const cx = (ev.clientX - cr.left) / tableZoom, cy = (ev.clientY - cr.top) / tableZoom;
        const x = Math.min(sx,cx), y = Math.min(sy,cy);
        rectEl.style.cssText = `left:${x}px;top:${y}px;width:${Math.abs(cx-sx)}px;height:${Math.abs(cy-sy)}px;`;
      };
      const onUp = ev => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        rectEl.remove();
        const cx = (ev.clientX - cr.left) / tableZoom, cy = (ev.clientY - cr.top) / tableZoom;
        const selX = Math.min(sx,cx), selY = Math.min(sy,cy);
        const selW = Math.abs(cx-sx),  selH = Math.abs(cy-sy);
        if (selW < 5 || selH < 5) { rerenderAll(); return; }
        const s = activeState(); if (!s) return;
        for (const f of s.table.figurines) {
          if (f.locked && ROLE !== 'gm') continue;
          if (f.x < selX+selW && f.x+f.w > selX && f.y < selY+selH && f.y+f.h > selY)
            selectionSet.add(f.instId);
        }
        for (const c of s.table.cards) {
          if (c.locked && ROLE !== 'gm') continue;
          if (c.x < selX+selW && c.x+140 > selX && c.y < selY+selH && c.y+196 > selY)
            selectionSet.add(c.instId);
        }
        rerenderAll();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }
}

function finishStroke() {
  if (activeStroke && activeStroke.points.length > 1) {
    if (ROLE === 'gm') {
      STATE.table.drawings.push({ id: uid(), by:'gm', ...activeStroke });
      broadcast({ type:'state' }); renderDrawings(); autosave();
    } else {
      sendToGM({ type:'draw-stroke', stroke: activeStroke });
    }
  }
  activeStroke = null;
}


// Hit-test a click against every drawing and remove the first stroke the cursor
// is close enough to. "Close enough" = within (strokeWidth/2 + slack) of any segment.
function eraseAt(x, y) {
  const s = activeState(); if (!s) return;
  const slack = 6;
  for (let i = s.table.drawings.length - 1; i >= 0; i--) {
    const d = s.table.drawings[i];
    if (strokeHit(d, x, y, slack)) {
      sendOp({ type:'remove-drawing', id: d.id });
      return; // one per cursor sample
    }
  }
}
function strokeHit(d, x, y, slack) {
  const r = (d.width || 3) / 2 + slack;
  const pts = d.points;
  if (pts.length === 1) {
    const dx = pts[0][0]-x, dy = pts[0][1]-y;
    return dx*dx + dy*dy <= r*r;
  }
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(x, y, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]) <= r) return true;
  }
  return false;
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) { const ex=px-ax, ey=py-ay; return Math.sqrt(ex*ex+ey*ey); }
  let t = ((px - ax)*dx + (py - ay)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t*dx, cy = ay + t*dy;
  const ex = px - cx, ey = py - cy;
  return Math.sqrt(ex*ex + ey*ey);
}
function drawLiveStroke() {
  renderDrawings();
  if (!activeStroke) return;
  const canvas = $('#drawLayer'); const ctx = canvas.getContext('2d');
  ctx.strokeStyle = activeStroke.color; ctx.lineWidth = activeStroke.width; ctx.lineCap='round';
  ctx.beginPath();
  for (let i=0;i<activeStroke.points.length;i++) {
    const [x,y] = activeStroke.points[i];
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}

function setTool(t) {
  currentTool = t;
  $$('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const canvas = $('#drawLayer');
  if (canvas) {
    const drawing = (t === 'pen' || t === 'eraser');
    canvas.style.pointerEvents = drawing ? 'auto' : 'none';
    // Raise above cards/figurines while drawing so clicks aren't swallowed by them.
    canvas.style.zIndex = drawing ? '999999' : 'auto';
    canvas.style.cursor = t === 'pen' ? 'crosshair' : t === 'eraser' ? 'cell' : 'default';
  }
  // Enter/exit token stamper mode
  if (t === 'stamp') enterStampMode();
  else if (stampMode) exitStampMode();
}

// =================== Token Stamper (GM only) ===================
let stampMode = false;
let stampCat = null, stampSub = '*', stampSize = 120;
let stampGhost = null, stampNextToken = null;
const STAMP_PRESETS = { S:80, M:120, L:200, XL:320 };

function stampCategories() {
  const set = new Set();
  for (const t of Object.values(TOKENS_BY_ID)) if (t.cats[0]) set.add(t.cats[0]);
  return [...set].sort();
}
function stampSubcategories(cat) {
  const set = new Set();
  for (const t of Object.values(TOKENS_BY_ID)) if (t.cats[0] === cat && t.cats[1]) set.add(t.cats[1]);
  return [...set].sort();
}
function pickStampToken() {
  const pool = Object.values(TOKENS_BY_ID).filter(t =>
    t.cats[0] === stampCat && (stampSub === '*' || t.cats[1] === stampSub));
  return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
}
function updateStampGhostImage() {
  if (!stampGhost) return;
  const img = stampGhost.querySelector('img');
  if (stampNextToken) loadAssetAsDataUrl(stampNextToken.path).then(url => { if (url && img) img.src = url; });
  else if (img) img.removeAttribute('src');
}
function refreshStampPool() {
  stampNextToken = pickStampToken();
  updateStampGhostImage();
}

function enterStampMode() {
  if (ROLE !== 'gm' || stampMode) return;
  stampMode = true;
  if (!stampCat) stampCat = stampCategories()[0] || null;
  refreshStampPool();
  buildStampPanel();
  // Ghost element lives inside the transformed table content
  const tc = $('#tableContent');
  stampGhost = el('div', { id:'stampGhost' });
  stampGhost.appendChild(el('img', { draggable:'false' }));
  stampGhost.style.display = 'none';
  if (tc) tc.appendChild(stampGhost);
  updateStampGhostImage();
}

function exitStampMode() {
  stampMode = false;
  $('#stampPanel')?.remove();
  stampGhost?.remove(); stampGhost = null;
}

function buildStampPanel() {
  $('#stampPanel')?.remove();
  const panel = el('div', { id:'stampPanel' });

  panel.appendChild(el('span', { class:'sp-label' }, 'Stamp'));

  const catSel = el('select');
  for (const c of stampCategories()) catSel.appendChild(el('option', { value:c, selected: c === stampCat }, c));
  catSel.addEventListener('change', () => { stampCat = catSel.value; stampSub = '*'; fillSubs(); refreshStampPool(); });
  panel.appendChild(catSel);

  const subSel = el('select');
  function fillSubs() {
    subSel.innerHTML = '';
    subSel.appendChild(el('option', { value:'*' }, 'All'));
    for (const sc of stampSubcategories(stampCat)) subSel.appendChild(el('option', { value:sc }, sc));
    subSel.value = stampSub;
  }
  fillSubs();
  subSel.addEventListener('change', () => { stampSub = subSel.value; refreshStampPool(); });
  panel.appendChild(subSel);

  panel.appendChild(el('span', { class:'sp-label' }, 'Size'));
  const sizeBtns = {};
  const slider = el('input', { type:'range', min:'40', max:'400', value:String(stampSize) });
  const sizeVal = el('span', { class:'sp-hint' }, stampSize + 'px');
  function setSize(px, fromSlider) {
    stampSize = px;
    if (!fromSlider) slider.value = String(px);
    sizeVal.textContent = px + 'px';
    for (const [k, b] of Object.entries(sizeBtns)) b.classList.toggle('active', STAMP_PRESETS[k] === px);
    if (stampGhost) { stampGhost.style.width = px + 'px'; stampGhost.style.height = px + 'px'; }
  }
  for (const [k, px] of Object.entries(STAMP_PRESETS)) {
    const b = el('button', { class:'tool-btn sp-size-btn' }, k);
    b.addEventListener('click', () => setSize(px, false));
    sizeBtns[k] = b; panel.appendChild(b);
  }
  slider.addEventListener('input', () => setSize(parseInt(slider.value, 10), true));
  panel.appendChild(slider);
  panel.appendChild(sizeVal);

  panel.appendChild(el('span', { class:'sp-hint' }, '· Click map to stamp · Esc to exit'));
  const closeBtn = el('button', { class:'tool-btn', title:'Exit stamper' });
  closeBtn.appendChild(icon('close'));
  closeBtn.addEventListener('click', () => setTool('pointer'));
  panel.appendChild(closeBtn);

  document.body.appendChild(panel);
  setSize(stampSize, false);
}

async function stampAt(clientX, clientY) {
  const tc = $('#tableContent'); if (!tc) return;
  const cr = tc.getBoundingClientRect();
  const x = Math.round((clientX - cr.left) / tableZoom - stampSize / 2);
  const y = Math.round((clientY - cr.top)  / tableZoom - stampSize / 2);
  const tok = stampNextToken || pickStampToken(); if (!tok) return;
  const dataUrl = await loadAssetAsDataUrl(tok.path); if (!dataUrl) return;
  const hash = await hashBlob(dataUrl);
  ASSETS[hash] = dataUrl;
  PATH_TO_HASH[tok.path] = hash;
  if (ROLE === 'gm' && !STATE.assetMeta[hash]) {
    STATE.assetMeta[hash] = { kind:'figurine', size:dataUrl.length, path:tok.path };
    for (const c of Object.values(connections)) sendAsset(c, hash, dataUrl, 'figurine');
  }
  sendOp({ type:'add-figurine', hash, x, y, w:stampSize, h:stampSize, label:tok.name });
  refreshStampPool();                          // new random pick for the next stamp + ghost
}

// =================== Asset upload ===================
async function compressImage(file, maxDim, quality, mime) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise(r => { img.onload = r; img.src = url; });
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const r = maxDim / Math.max(width, height);
    width *= r; height *= r;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  // For PNG we leave the canvas transparent so alpha is preserved; JPEG must be opaque.
  const outMime = mime || (file.type === 'image/png' ? 'image/png' : 'image/jpeg');
  if (outMime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,width,height); }
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);
  return canvas.toDataURL(outMime, quality);
}

async function uploadPfp(pid, file) {
  if (!file) return;
  const dataUrl = await compressImage(file, 256, 0.8);
  const hash = await hashBlob(dataUrl);
  ASSETS[hash] = dataUrl;
  await cacheAssetPut(hash, { kind:'pfp', dataUrl });
  if (ROLE === 'gm') {
    STATE.assetMeta[hash] = { kind:'pfp', size: dataUrl.length };
    STATE.hands[pid].pfpHash = hash;
    for (const c of Object.values(connections)) sendAsset(c, hash, dataUrl, 'pfp');
    broadcast({ type:'state' }); renderAllGM(); autosave();
  } else {
    window._pendingPfp = dataUrl; window._pendingPfpHash = hash;
    sendAsset(connections.gm, hash, dataUrl, 'pfp');
    sendToGM({ type:'op', op:{ type:'set-pfp', owner:pid, hash }});
  }
}

async function uploadFigurine(file, kind='figurine') {
  if (!file) return;
  // Use PNG to preserve transparency for tokens; JPEG fine for maps where size matters.
  const dataUrl = await compressImage(file, kind === 'map' ? 2048 : 1024, 0.9, kind === 'map' ? 'image/jpeg' : 'image/png');
  const hash = await hashBlob(dataUrl);
  ASSETS[hash] = dataUrl;
  await cacheAssetPut(hash, { kind, dataUrl });
  if (ROLE === 'gm') {
    STATE.assetMeta[hash] = { kind, size: dataUrl.length };
    for (const c of Object.values(connections)) sendAsset(c, hash, dataUrl, kind);
    sendOp({ type:'add-figurine', hash, w: kind==='map'?600:120, h: kind==='map'?400:120, by: 'gm' });
  } else {
    // Player upload: ship the asset to the GM (who relays to other players), then ask GM to spawn the figurine.
    sendAsset(connections.gm, hash, dataUrl, kind);
    sendToGM({ type:'op', op:{ type:'add-figurine', hash, w: kind==='map'?600:120, h: kind==='map'?400:120, by: MY_ID }});
  }
}

// =================== Battlemap browser ===================
async function listBattlemapCategories() {
  if (!assetsRootHandle) return [];
  try {
    const dir = await assetsRootHandle.getDirectoryHandle('Battlemaps');
    const cats = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory' && !name.startsWith('.'))
        cats.push({ name, handle });
    }
    return cats.sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function openBattlemapBrowser() {
  if (document.getElementById('battlemapBrowser')) return;
  const overlay = el('div', { class: 'search-overlay', id: 'battlemapBrowser' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const box = el('div', { class: 'search-box' });
  const hdr = el('div', { class: 'token-header' });
  hdr.appendChild(el('span', {}, 'Battlemaps'));
  hdr.appendChild(el('button', { class: 'mini', onclick: () => overlay.remove() }, '×'));
  box.appendChild(hdr);
  const content = el('div', { class: 'token-content' });
  box.appendChild(content);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  async function collectFiles(dirHandle, files = []) {
    for await (const [name, h] of dirHandle.entries()) {
      if (h.kind === 'directory') await collectFiles(h, files);
      else if (h.kind === 'file' && /\.(png|jpe?g|webp)$/i.test(name)) files.push({ name, handle: h });
    }
    return files;
  }

  async function showCat(catHandle, catName) {
    content.innerHTML = '';
    const backBtn = el('button', { class: 'mini', style: { marginBottom: '8px' } }, '← Back');
    backBtn.addEventListener('click', showCats);
    content.appendChild(backBtn);
    content.appendChild(el('div', { style: { fontWeight: 600, marginBottom: '8px' } }, catName));
    content.appendChild(el('div', { class: 'token-empty' }, 'Loading…'));
    const files = await collectFiles(catHandle);
    content.innerHTML = '';
    content.appendChild(backBtn);
    content.appendChild(el('div', { style: { fontWeight: 600, marginBottom: '8px' } }, catName));
    if (!files.length) { content.appendChild(el('div', { class: 'token-empty' }, 'No images in this category.')); return; }
    const grid = el('div', { class: 'token-grid' });
    for (const { name, handle } of files) {
      const thumb = el('div', { class: 'token-thumb', title: name });
      const img = el('img', { draggable: 'false' });
      img.style.cssText = 'background:var(--panel);width:100%;height:80px;object-fit:cover';
      handle.getFile().then(file => { img.src = URL.createObjectURL(file); });
      thumb.appendChild(img);
      thumb.appendChild(el('div', { class: 'token-name' }, name));
      thumb.addEventListener('click', async () => {
        const file = await handle.getFile();
        overlay.remove();
        uploadFigurine(file, 'map');
      });
      grid.appendChild(thumb);
    }
    content.appendChild(grid);
  }

  async function showCats() {
    content.innerHTML = '';
    content.appendChild(el('div', { class: 'token-empty' }, 'Loading categories…'));
    const cats = await listBattlemapCategories();
    content.innerHTML = '';
    if (!cats.length) {
      content.appendChild(el('div', { class: 'token-empty' }, 'No Battlemaps folder found. Make sure your assets folder contains a Battlemaps/ subfolder.'));
      return;
    }
    const list = el('div', { style: { display:'flex', flexDirection:'column', gap:'4px' } });
    for (const { name, handle } of cats) {
      const btn = el('button', { class: 'tool-btn', style: { justifyContent:'flex-start', width:'100%' } }, name);
      btn.addEventListener('click', () => showCat(handle, name));
      list.appendChild(btn);
    }
    content.appendChild(list);
  }

  showCats();
}

// =================== Background card prefetch ===================
// Silently loads every card image from disk after session starts.
// Each load auto-sends to connected players via loadAssetAsDataUrl's pipeline,
// so future card deals render instantly on player screens.
async function prefetchCardImages() {
  if (ROLE !== 'gm' || !assetsRootHandle) return;
  // Collect unique paths not already cached
  const seen = new Set();
  const paths = [];
  for (const card of CARDS) {
    for (const p of [card.path, card.backPath]) {
      if (p && !PATH_CACHE[p] && !seen.has(p)) { seen.add(p); paths.push(p); }
    }
  }
  if (!paths.length) return;
  // Load in small batches to avoid flooding the relay
  const BATCH = 4;
  for (let i = 0; i < paths.length; i += BATCH) {
    if (!assetsRootHandle) break; // session ended
    await Promise.all(paths.slice(i, i + BATCH).map(p => loadAssetAsDataUrl(p)));
    await new Promise(r => setTimeout(r, 120)); // breathing room between batches
  }
}

// =================== Setup wizards ===================
function gmSetupFlow() {
  // restore previous session?
  if (tryRestoreLast()) {
    if (confirm('Restore previous session ' + STATE.roomCode + '?')) {
      setupPeerGM(STATE.roomCode);
      renderAllGM();
      setTimeout(prefetchCardImages, 1500); // start after initial render settles
      return;
    }
  }
  const pc = parseInt(prompt('Number of players (1-10)?', '4'), 10);
  STATE = newState(Math.max(1, Math.min(10, pc || 4)));
  setupPeerGM(STATE.roomCode);
  renderAllGM();
  autosave();
  setTimeout(prefetchCardImages, 1500); // start after initial render settles
}

function updateJoinSlotSelect() {
  const sel = $('#joinSlotSel'); if (!sel) return;
  const taken = window._takenSlots || [];
  for (const opt of sel.options) {
    const isTaken = taken.includes(opt.value);
    opt.disabled = isTaken;
    const base = 'Slot ' + opt.value.slice(6);
    opt.textContent = isTaken ? base + ' (taken)' : base;
  }
}

function playerJoinFlow() {
  const overlay = el('div', { class:'join-overlay' });
  const box = el('div', { class:'join-box' });
  box.appendChild(el('h2', {}, 'Join Deck Quest'));
  const roomI = el('input', { type:'text', placeholder:'Room code (from GM)' });
  const nameI = el('input', { type:'text', placeholder:'Your name' });
  const slotSel = el('select', { id: 'joinSlotSel' });
  for (let i=1;i<=10;i++) slotSel.appendChild(el('option', { value:'player'+i }, 'Slot '+i));
  const pfpI = el('input', { type:'file', accept:'image/*' });
  const btn = el('button', { class:'primary', onclick: async () => {
    if (!roomI.value || !nameI.value) return alert('Need room code and name');
    MY_ROOM = roomI.value.trim();
    MY_NAME = nameI.value.trim();
    MY_ID = slotSel.value;
    MY_COLOR = PLAYER_COLORS[parseInt(MY_ID.slice(6),10)-1];
    if (pfpI.files[0]) {
      const dataUrl = await compressImage(pfpI.files[0], 256, 0.8);
      const hash = await hashBlob(dataUrl);
      ASSETS[hash] = dataUrl; await cacheAssetPut(hash, { kind:'pfp', dataUrl });
      window._pendingPfp = dataUrl; window._pendingPfpHash = hash;
    }
    overlay.remove();
    setupPeerPlayer(MY_ROOM);
  }}, 'Join');
  box.appendChild(field('Room code', '', true, v => roomI.value = v));
  box.appendChild(field('Your name', '', true, v => nameI.value = v));
  // simpler: just use the inputs
  box.innerHTML = '';
  box.appendChild(el('h2', {}, 'Join Deck Quest'));
  const wrap = (label, child) => { const w=el('div',{class:'jrow'}); w.appendChild(el('label',{},label)); w.appendChild(child); return w; };
  box.appendChild(wrap('Room code', roomI));
  box.appendChild(wrap('Your name', nameI));
  box.appendChild(wrap('Slot', slotSel));
  box.appendChild(wrap('Profile pic (optional)', pfpI));
  box.appendChild(btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// =================== Boot ===================
async function boot() {
  await openAssetDB();
  // Re-hydrate in-memory ASSETS from IDB cache
  await new Promise(res => {
    const tx = assetDB.transaction('assets', 'readonly');
    const req = tx.objectStore('assets').openCursor();
    req.onsuccess = e => {
      const cur = e.target.result;
      if (cur) { ASSETS[cur.key] = cur.value.dataUrl; cur.continue(); } else res();
    };
  });
  setupDiceUI();
  setupToolbarUI();
  setupTableInteraction();
  setupFloatingPanels();
  setupAltPreview();
  setupKeybindHelp();
  if (activeState()) renderTable();
  if (ROLE === 'gm') {
    await setupAssetsFolder();
    gmSetupFlow();
  } else {
    playerJoinFlow();
  }
}

// =================== Alt-hover card preview ===================
// =================== Keybind help (? icon) ===================
function setupKeybindHelp() {
  const btn = el('div', { id:'kbHelpBtn', title:'Keyboard shortcuts' });
  btn.appendChild(icon('help'));
  const panel = el('div', { id:'kbHelpPanel' });
  panel.appendChild(el('div', { class:'kbHelp-title' }, 'Keyboard Shortcuts'));
  // Group the role-appropriate rows
  const groups = {};
  for (const b of KEYBIND_HELP) {
    if (b.role === 'gm' && ROLE !== 'gm') continue;
    (groups[b.group] = groups[b.group] || []).push(b);
  }
  for (const [name, rows] of Object.entries(groups)) {
    panel.appendChild(el('div', { class:'kbHelp-group' }, name));
    for (const r of rows) {
      const row = el('div', { class:'kbHelp-row' });
      const keys = el('div', { class:'kbHelp-keys' });
      r.keys.forEach((kk, i) => {
        keys.appendChild(el('kbd', {}, kk));
        if (i < r.keys.length - 1) keys.appendChild(el('span', { class:'kbHelp-sep' }, '/'));
      });
      row.appendChild(keys);
      row.appendChild(el('div', { class:'kbHelp-label' }, r.label));
      panel.appendChild(row);
    }
  }
  btn.appendChild(panel);
  document.body.appendChild(btn);
}

let altDown = false;
let hoverImg = null;
function setupAltPreview() {
  const preview = el('div', { id:'altPreview' });
  preview.appendChild(el('img', {}));
  document.body.appendChild(preview);
  window.addEventListener('keydown', e => {
    if (e.key === 'Alt') { altDown = true; updatePreview(); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'Alt') { altDown = false; preview.style.display = 'none'; }
  });
  window.addEventListener('blur', () => { altDown = false; preview.style.display = 'none'; });
  document.addEventListener('mousemove', e => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('card-img')) {
      hoverImg = t.src;
    } else {
      hoverImg = null;
    }
    updatePreview();
  });
  function updatePreview() {
    if (altDown && hoverImg) {
      preview.querySelector('img').src = hoverImg;
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  }
}

// =================== Combined Log & Chat panel ===================
function setupLogChatPanel() {
  const panel    = $('#logChatPanel'); if (!panel) return;
  const body     = $('#lcBody');
  const tabLog   = $('#lcTabLog');
  const tabChat  = $('#lcTabChat');
  const logPane  = $('#logPane');
  const chatPane = $('#chatPane');
  const minBtn   = $('#lcMinBtn');

  // Minimise button
  minBtn.appendChild(icon('chevron-down'));
  let minimised = false;
  minBtn.addEventListener('click', () => {
    minimised = !minimised;
    body.classList.toggle('lc-min', minimised);
    minBtn.replaceChildren(icon(minimised ? 'chevron-up' : 'chevron-down'));
  });

  // Tab switching — clicking a tab also expands if minimised
  function expand() {
    if (minimised) { minimised = false; body.classList.remove('lc-min'); minBtn.replaceChildren(icon('chevron-down')); }
  }
  tabLog.addEventListener('click', () => {
    expand();
    tabLog.classList.add('lc-active'); tabChat.classList.remove('lc-active');
    logPane.style.display = 'flex'; chatPane.style.display = 'none';
    _chatPaneActive = false;
  });
  tabChat.addEventListener('click', () => {
    expand();
    tabChat.classList.add('lc-active'); tabLog.classList.remove('lc-active');
    logPane.style.display = 'none'; chatPane.style.display = 'flex';
    _chatPaneActive = true;
    _chatUnread = 0; _updateChatBadge();
    const msgs = $('#chatMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });

  // Chat send
  const input   = $('#chatInputField');
  const sendBtn = $('#chatSendBtn');
  const doSend  = () => {
    const text = input?.value?.trim(); if (!text) return;
    const who   = (ROLE === 'gm') ? (STATE?.hands?.gm?.name || 'GM') : MY_NAME;
    const color = (ROLE === 'gm') ? (STATE?.hands?.gm?.color || '#f2ca50') : MY_COLOR;
    sendOp({ type:'send-chat', who, text, color, ts: Date.now() });
    if (input) input.value = '';
  };
  if (input)   input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
  if (sendBtn) sendBtn.addEventListener('click', doSend);
}

// =================== Discard pile viewer ===================
function showDiscardPanel(deckType) {
  $$('.discard-panel').forEach(p => p.remove());
  const s = activeState();
  const ids = s.discards[deckType] || [];
  const panel = el('div', { class:'discard-panel' });
  const header = el('div', { class:'discard-header' });
  header.appendChild(el('span', {}, `${DECK_LABELS[deckType]} discard (${ids.length})`));
  header.appendChild(el('button', { class:'mini', onclick: () => panel.remove() }, '×'));
  panel.appendChild(header);
  const grid = el('div', { class:'discard-grid' });
  ids.forEach((cardId, idx) => {
    const card = CARDS_BY_ID[cardId]; if (!card) return;
    const item = el('div', { class:'discard-item' });
    const dimg = el('img', { class:'card-img', title: card.name });
    dimg.style.background = 'var(--panel)';
    loadCardImage(card.path, dimg);
    item.appendChild(dimg);
    item.appendChild(el('div', { class:'discard-name' }, card.name));
    if (ROLE === 'gm') {
      const actions = el('div', { class:'discard-actions' });
      actions.appendChild(el('button', { class:'mini', title:'To table', onclick: () => { discardSend(deckType, idx, { where:'table' }); panel.remove(); showDiscardPanel(deckType); }}, 'Table'));
      actions.appendChild(el('button', { class:'mini', title:'To deck', onclick: () => { discardSend(deckType, idx, { where:'deck' }); panel.remove(); showDiscardPanel(deckType); }}, 'Deck'));
      actions.appendChild(el('button', { class:'mini', title:'To GM', onclick: () => { discardSend(deckType, idx, { where:'hand', owner:'gm' }); panel.remove(); showDiscardPanel(deckType); }}, 'GM'));
      for (let i=1;i<=STATE.playerCount;i++) {
        const pn = STATE.hands['player'+i].name || ('P'+i);
        actions.appendChild(el('button', { class:'mini', title:'To '+pn, onclick: () => { discardSend(deckType, idx, { where:'hand', owner:'player'+i }); panel.remove(); showDiscardPanel(deckType); }}, pn));
      }
      item.appendChild(actions);
    }
    grid.appendChild(item);
  });
  if (ids.length === 0) grid.appendChild(el('div', { class:'discard-empty' }, 'Discard pile is empty.'));
  panel.appendChild(grid);
  document.body.appendChild(panel);
}
function discardSend(deckType, idx, to) {
  if (ROLE !== 'gm') return;
  const cardId = STATE.discards[deckType].splice(idx, 1)[0];
  if (!cardId) return;
  const card = { instId: uid(), cardId, faceUp: true };
  if (to.where === 'table') STATE.table.cards.push({ ...card, x: 400, y: 300, rot: 0, z: nextZ() });
  else if (to.where === 'deck') STATE.decks[deckType].push(cardId);
  else if (to.where === 'hand') STATE.hands[to.owner].hand.push(card);
  broadcast({ type:'state' }); renderAllGM(); autosave();
  logEntry('GM', `moved ${CARDS_BY_ID[cardId].name} from ${deckType} discard`, 'sys');
}

function setupDiceUI() {
  const row = $('#diceRow'); if (!row) return;
  for (const d of [4,6,8,10,12,20,100]) {
    row.appendChild(el('button', { class:'die-btn', onclick: () => rollAndLog('d'+d) }, 'd'+d));
  }
  const customI = el('input', { type:'text', placeholder:'2d6+3', style:{width:'70px'}});
  customI.addEventListener('keydown', e => { if (e.key==='Enter' && customI.value) { rollAndLog(customI.value); customI.value=''; }});
  row.appendChild(customI);
}

// =================== Token panel ===================
const tokenCatCollapsed = new Set();

function openTokenPanel() {
  $$('.token-panel').forEach(p => p.remove());

  const overlay = el('div', { class: 'token-panel' });
  const box     = el('div', { class: 'token-box' });

  // Header
  const hdr = el('div', { class: 'token-header' });
  hdr.appendChild(el('span', {}, 'D&D Token Collection'));
  const searchI = el('input', { type: 'text', placeholder: 'Search by name or category…', class: 'token-search' });
  hdr.appendChild(searchI);
  hdr.appendChild(el('button', { class: 'mini', onclick: () => overlay.remove() }, '×'));
  box.appendChild(hdr);

  const content = el('div', { class: 'token-content' });
  box.appendChild(content);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Tokens are populated synchronously at startup — render immediately

  async function addTokenToTable(t) {
    const stage = $('#tableStage');
    const r = stage ? stage.getBoundingClientRect() : { width: 800, height: 600 };
    const cx = (r.width  / 2 - tablePanX) / tableZoom - 60;
    const cy = (r.height / 2 - tablePanY) / tableZoom - 60;
    const dataUrl = await loadAssetAsDataUrl(t.path);
    if (!dataUrl) return;
    const hash = await hashBlob(dataUrl);
    PATH_CACHE[t.path] = dataUrl;
    ASSETS[hash] = dataUrl;
    if (ROLE === 'gm') {
      STATE.assetMeta[hash] = { kind: 'figurine', size: dataUrl.length };
      for (const c of Object.values(connections)) sendAsset(c, hash, dataUrl, 'figurine');
    }
    sendOp({ type: 'add-figurine', hash, w: 120, h: 120, label: t.name, x: Math.round(cx), y: Math.round(cy) });
  }

  function tokenThumb(t) {
    const div = el('div', { class: 'token-thumb', title: t.name });
    const timg = el('img', { draggable: 'false', style: { background: 'var(--panel)' } });
    loadAssetAsDataUrl(t.path).then(url => { if (url) timg.src = url; });
    div.appendChild(timg);
    div.appendChild(el('div', { class: 'token-name' }, t.name));
    div.addEventListener('click', () => addTokenToTable(t));
    return div;
  }

  function buildTree() {
    // tree[cat][subcat|'_root'] = [tokens]
    const tree = {};
    for (const t of Object.values(TOKENS_BY_ID)) {
      const cat = t.cats[0] || 'Uncategorized';
      const sub = t.cats[1] || '_root';
      if (!tree[cat]) tree[cat] = {};
      if (!tree[cat][sub]) tree[cat][sub] = [];
      tree[cat][sub].push(t);
    }
    // Sort subcategories, keeping _root first
    for (const cat of Object.keys(tree)) {
      const subs = tree[cat];
      const root = subs['_root'];
      delete subs['_root'];
      const sorted = {};
      if (root) sorted['_root'] = root;
      for (const k of Object.keys(subs).sort()) sorted[k] = subs[k];
      tree[cat] = sorted;
    }
    return tree;
  }

  function render(q) {
    content.innerHTML = '';
    const query = q.trim().toLowerCase();

    if (query) {
      // Flat filtered results
      const hits = Object.values(TOKENS_BY_ID).filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.cats.join(' ').toLowerCase().includes(query)
      );
      if (!hits.length) { content.appendChild(el('div', { class: 'token-empty' }, 'No tokens found.')); return; }
      const grid = el('div', { class: 'token-grid' });
      for (const t of hits.slice(0, 300)) grid.appendChild(tokenThumb(t));
      if (hits.length > 300) grid.appendChild(el('div', { style: { color: 'var(--muted)', fontSize: '11px', padding: '4px' } }, `…and ${hits.length - 300} more — refine your search`));
      content.appendChild(grid);
      return;
    }

    // Grouped by category
    const tree = buildTree();
    for (const [cat, subs] of Object.entries(tree).sort(([a],[b]) => a.localeCompare(b))) {
      const catKey = 'cat:' + cat;
      const collapsed = tokenCatCollapsed.has(catKey);
      let total = 0;
      for (const ts of Object.values(subs)) total += ts.length;

      const catHdr = el('div', { class: 'token-cat-hdr', onclick: () => {
        collapsed ? tokenCatCollapsed.delete(catKey) : tokenCatCollapsed.add(catKey);
        render(searchI.value);
      }}, (collapsed ? '▶ ' : '▼ ') + cat + ' (' + total + ')');
      content.appendChild(catHdr);

      if (!collapsed) {
        const catBody = el('div', { class: 'token-cat-body' });
        for (const [sub, tokens] of Object.entries(subs)) {
          if (sub === '_root') {
            const grid = el('div', { class: 'token-grid' });
            for (const t of tokens) grid.appendChild(tokenThumb(t));
            catBody.appendChild(grid);
          } else {
            const subKey = 'sub:' + cat + '/' + sub;
            const subCollapsed = tokenCatCollapsed.has(subKey);
            const subHdr = el('div', { class: 'token-subcat-hdr', onclick: () => {
              subCollapsed ? tokenCatCollapsed.delete(subKey) : tokenCatCollapsed.add(subKey);
              render(searchI.value);
            }}, (subCollapsed ? '  ▶ ' : '  ▼ ') + sub + ' (' + tokens.length + ')');
            catBody.appendChild(subHdr);
            if (!subCollapsed) {
              const grid = el('div', { class: 'token-grid' });
              for (const t of tokens) grid.appendChild(tokenThumb(t));
              catBody.appendChild(grid);
            }
          }
        }
        content.appendChild(catBody);
      }
    }
  }

  searchI.addEventListener('input', () => render(searchI.value));
  render('');
  setTimeout(() => searchI.focus(), 50);
}

function setupToolbarUI() {
  const tb = $('#toolbar'); if (!tb) return;
  // Draw tools
  const TOOL_ICON = { pointer:'pointer', pen:'pen', eraser:'eraser' };
  for (const t of ['pointer','pen','eraser']) {
    const b = el('button', { class:'tool-btn'+(t==='pointer'?' active':''), 'data-tool':t, title:t, onclick: () => setTool(t) });
    b.appendChild(icon(TOOL_ICON[t]));
    tb.appendChild(b);
  }
  // Color picker (same height as tool buttons)
  const colorI = el('input', { type:'color', value: currentColor, title:'Pen color',
    style:{ width:'32px', height:'32px', padding:'2px', cursor:'pointer', border:'1px solid var(--line)', borderRadius:'var(--radius)', background:'transparent', verticalAlign:'middle' } });
  colorI.addEventListener('change', e => currentColor = e.target.value);
  tb.appendChild(colorI);
  // Clear — beside color picker, clears all (GM) or own strokes (player)
  const clrTitle = ROLE === 'gm' ? 'Clear all drawings' : 'Clear my drawings';
  const clrOp    = ROLE === 'gm' ? { type:'clear-drawings' } : { type:'clear-my-drawings', by: MY_ID };
  const clrBtn = el('button', { class:'tool-btn', title: clrTitle, onclick: () => sendOp(clrOp) });
  clrBtn.appendChild(icon('eraser'));
  clrBtn.appendChild(el('span', {}, 'Clear'));
  tb.appendChild(clrBtn);
  // Reset pan/zoom
  const resetBtn = el('button', { class:'tool-btn', title:'Reset pan & zoom', onclick: () => {
    tableZoom = 1; tablePanX = 0; tablePanY = 0; applyTableTransform();
  }});
  resetBtn.appendChild(icon('target'));
  tb.appendChild(resetBtn);
  // Custom token upload — available to everyone
  const tokenBtn = el('label', { class:'tool-btn', title:'Upload a custom token' });
  tokenBtn.appendChild(icon('plus'));
  tokenBtn.appendChild(el('span', {}, 'Token'));
  const tokenI = el('input', { type:'file', accept:'image/*', style:{display:'none'}});
  tokenI.addEventListener('change', e => { uploadFigurine(e.target.files[0], 'figurine'); tokenI.value=''; });
  tokenBtn.appendChild(tokenI); tb.appendChild(tokenBtn);
  // GM-only: token library, battlemaps browser, map upload, search
  if (ROLE === 'gm') {
    const tokenLibBtn = el('button', { class:'tool-btn', title:'Browse & add D&D tokens', onclick: () => openTokenPanel() });
    tokenLibBtn.appendChild(icon('tokens'));
    tokenLibBtn.appendChild(el('span', {}, 'Tokens'));
    tb.appendChild(tokenLibBtn);
    const bmBtn = el('button', { class:'tool-btn', title:'Browse saved battlemaps' });
    bmBtn.appendChild(icon('map'));
    bmBtn.appendChild(el('span', {}, 'Battlemaps'));
    bmBtn.addEventListener('click', openBattlemapBrowser);
    tb.appendChild(bmBtn);
    const stampBtn = el('button', { class:'tool-btn', 'data-tool':'stamp', title:'Token stamper (T)', onclick:() => setTool(stampMode ? 'pointer' : 'stamp') });
    stampBtn.appendChild(icon('stamp'));
    stampBtn.appendChild(el('span', {}, 'Stamp'));
    tb.appendChild(stampBtn);
    const mapBtn = el('label', { class:'tool-btn', title:'Upload a battle map' });
    mapBtn.appendChild(icon('map'));
    mapBtn.appendChild(el('span', {}, 'Map'));
    const mapI = el('input', { type:'file', accept:'image/*', style:{display:'none'}});
    mapI.addEventListener('change', e => { uploadFigurine(e.target.files[0], 'map'); mapI.value=''; });
    mapBtn.appendChild(mapI); tb.appendChild(mapBtn);
    const searchBtn = el('button', { class:'tool-btn', title:'Search cards', onclick: () => openSearch() });
    searchBtn.appendChild(icon('search'));
    searchBtn.appendChild(el('span', {}, 'Search'));
    tb.appendChild(searchBtn);
  }
}

// =================== Slide-toggle floating panels ===================
function setupSlidePanel(panelId, tabId) {
  const panel = $('#' + panelId);
  const tab   = $('#' + tabId);
  if (!panel || !tab) return;
  const hideBtn = panel.querySelector('.panel-hide-btn');
  const collapse = () => { panel.classList.add('collapsed'); tab.style.display = 'block'; };
  const expand   = () => { panel.classList.remove('collapsed'); tab.style.display = 'none'; };
  if (hideBtn) hideBtn.addEventListener('click', collapse);
  tab.addEventListener('click', expand);
}

function setupRailToggle() {
  const rail = $('#rightRail');
  const tab  = $('#railTab');
  if (!rail || !tab) return;
  let collapsed = false;
  const update = () => {
    rail.classList.toggle('collapsed', collapsed);
    tab.replaceChildren(icon(collapsed ? 'chevron-left' : 'chevron-right'));
    tab.style.right = collapsed ? '0px' : '340px';
    tab.title = collapsed ? 'Show players panel' : 'Hide players panel';
  };
  tab.addEventListener('click', () => { collapsed = !collapsed; update(); });
  update();
}

function setupToolbarToggle() {
  const toolbar = $('#toolbar');
  const tab     = $('#toolbarTab');
  if (!toolbar || !tab) return;
  const hideBtn = el('button', { class:'tool-btn', title:'Hide toolbar' });
  hideBtn.appendChild(icon('chevron-up'));
  hideBtn.addEventListener('click', () => {
    toolbar.classList.add('collapsed');
    tab.style.display = 'block';
  });
  toolbar.appendChild(hideBtn);
  tab.addEventListener('click', () => {
    toolbar.classList.remove('collapsed');
    tab.style.display = 'none';
  });
}

function setupFloatingPanels() {
  paintStaticIcons();
  setupSlidePanel('deckPanel', 'deckTab');
  setupRailToggle();
  setupToolbarToggle();
  setupLogChatPanel();
}


function renderChatPanel() {
  const s = activeState(); if (!s) return;
  const container = $('#chatMessages'); if (!container) return;
  const msgs = s.chat || [];
  if (!_chatPaneActive && msgs.length > _lastChatCount) {
    _chatUnread += msgs.length - _lastChatCount;
    _updateChatBadge();
  }
  _lastChatCount = msgs.length;
  const myWho = (ROLE === 'gm') ? (s.hands?.gm?.name || 'GM') : MY_NAME;
  container.innerHTML = '';
  for (const msg of msgs) {
    const isMe = msg.who === myWho;
    const row = el('div', { class: 'chat-msg' + (isMe ? ' chat-msg-me' : '') });
    const who = el('span', { class: 'chat-msg-who', style: { color: msg.color || 'var(--accent)' } }, msg.who + ': ');
    const text = el('span', { class: 'chat-msg-text' }, msg.text);
    row.appendChild(who);
    row.appendChild(text);
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}

// =================== Token detail popup ===================
function showTokenDetailPopup(f, e) {
  $$('.token-detail-popup').forEach(p => p.remove());
  const isChar = f.kind === 'character';
  const hp    = isChar ? activeState()?.hands?.[f.playerId]?.hp    : (f.hp || { current: 20, max: 20 });
  const armor = isChar ? activeState()?.hands?.[f.playerId]?.armor : (f.armor || { current: 0, max: 10 });

  const popup = el('div', { class: 'token-detail-popup', style: { left: e.clientX + 'px', top: e.clientY + 'px' } });
  const closeBtn = el('button', { class: 'close-btn', onclick: () => popup.remove() }, '×');
  popup.appendChild(closeBtn);
  popup.appendChild(el('h4', {}, (f.label || f.kind || 'Token') + ' — Vitals'));

  const makeRow = (labelText, cur, max, onChange) => {
    const row = el('div', { class: 'token-detail-row' });
    row.appendChild(el('label', {}, labelText));
    const curI = el('input', { type:'number', value: String(cur), min:'0', style:{ width:'50px' } });
    row.appendChild(curI);
    row.appendChild(el('span', { style:{ color:'var(--muted)', margin:'0 4px' } }, '/'));
    const maxI = el('input', { type:'number', value: String(max), min:'1', style:{ width:'50px' } });
    row.appendChild(maxI);
    const onChg = () => onChange(parseInt(curI.value,10)||0, parseInt(maxI.value,10)||1);
    curI.addEventListener('change', onChg);
    maxI.addEventListener('change', onChg);
    return row;
  };

  if (isChar && f.playerId) {
    popup.appendChild(makeRow('HP', hp.current, hp.max, (c, m) =>
      sendOp({ type:'set-player-field', owner: f.playerId, path:'hp', value:{ current:c, max:m } })));
    popup.appendChild(makeRow('Armor', armor.current, armor.max, (c, m) =>
      sendOp({ type:'set-player-field', owner: f.playerId, path:'armor', value:{ current:c, max:m } })));
  } else {
    popup.appendChild(makeRow('HP', hp.current, hp.max, (c, m) =>
      sendOp({ type:'set-figurine-vitals', instId: f.instId, hp:{ current:c, max:m } })));
    popup.appendChild(makeRow('Armor', armor.current, armor.max, (c, m) =>
      sendOp({ type:'set-figurine-vitals', instId: f.instId, armor:{ current:c, max:m } })));
  }

  document.body.appendChild(popup);
  // Keep within viewport
  const r = popup.getBoundingClientRect();
  if (r.right  > window.innerWidth)  popup.style.left = (window.innerWidth  - r.width  - 8) + 'px';
  if (r.bottom > window.innerHeight) popup.style.top  = (window.innerHeight - r.height - 8) + 'px';
  // Close on outside click
  const close = ev => { if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

window.addEventListener('DOMContentLoaded', boot);

// Save/load wiring (called from buttons in template)
window._saveSession = downloadSession;
window._loadSession = file => loadSessionFile(file);
window._newSession = () => {
  if (!confirm('Start a new session? Current session will be discarded from autosave.')) return;
  const pc = parseInt(prompt('Number of players (1-10)?', String(STATE.playerCount)), 10);
  STATE = newState(Math.max(1, Math.min(10, pc || 4)));
  if (wsConn) { wsConn.close(); wsConn = null; }
  setupPeerGM(STATE.roomCode);
  renderAllGM();
  autosave();
};
