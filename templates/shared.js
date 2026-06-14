/* Deck Quest VTT — shared core
   Inlined into both gm.template.html and player.template.html.
   Expects globals: CARDS (array from build.js), ROLE ('gm' | 'player').
*/

// =================== Constants ===================
const DECK_TYPES = ['role', 'skill', 'item', 'location', 'adversary'];
const DECK_LABELS = { role: 'Roles', skill: 'Skills', item: 'Items', location: 'Locations', adversary: 'Adversaries' };
const PLAYER_COLORS = ['#3b82f6','#ef4444','#10b981','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
const DEFAULT_STATS = { str:20, agi:20, int:20, cha:20, sta:20 };
const STAT_KEYS = ['str','agi','int','cha','sta'];
const STAT_BASE = 20, STAT_MAX = 50, STAT_STEP = 5, STAT_BUDGET = 100;
// Each 5 points above/below the baseline (20) is +1/-1 to the roll modifier.
function statMod(v) { return Math.round(((v == null ? STAT_BASE : v) - STAT_BASE) / STAT_STEP); }
function fmtMod(m) { return (m >= 0 ? '+' : '') + m; }
const DEFAULT_HP = { current: 20, max: 20 };
const DEFAULT_ARMOR = { current: 0, max: 10 };
const ADJ = ['aqua','crimson','emerald','golden','silver','shadow','radiant','frost','ember','mystic'];
const NOUN = ['falcon','dragon','wolf','tiger','phoenix','kraken','griffin','viper','raven','lynx'];

const CARDS_BY_ID = {};
const CARDS_BY_TYPE = { role:[], skill:[], item:[], location:[], adversary:[], info:[] };
for (const c of CARDS) { CARDS_BY_ID[c.id] = c; CARDS_BY_TYPE[c.type].push(c); }
// Deck source for the engine — arrays of card IDs (the engine works with ids, not card objects).
const CARD_IDS_BY_TYPE = Object.fromEntries(Object.entries(CARDS_BY_TYPE).map(([t, a]) => [t, a.map(c => c.id)]));

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
  { group:'Selection',                 keys:['Ctrl','C'],     label:'Copy selected',           role:'all' },
  { group:'Selection',                 keys:['Ctrl','V'],     label:'Paste at cursor',         role:'all' },
  { group:'Selection',                 keys:['Ctrl','G'],     label:'Group selected',          role:'all' },
  { group:'Selection',                 keys:['Ctrl','⇧','G'], label:'Ungroup',                 role:'all' },
  { group:'Selection',                 keys:['drag'],         label:'Lasso-select on empty table', role:'all' },
  { group:'Cards (hover a table card)',keys:['F'],            label:'Flip card',               role:'all' },
  { group:'Cards (hover a table card)',keys:['L'],            label:'Lock / unlock',           role:'gm' },
  { group:'Cards (hover a table card)',keys:['Del'],          label:'Discard',                 role:'gm' },
  { group:'Tools',                     keys:['1','2','3'],    label:'Pointer / Pen / Eraser',  role:'all' },
  { group:'Tools',                     keys:['T'],            label:'Token stamper',           role:'gm' },
  { group:'Tools',                     keys:['Space'],        label:'Hold to pan',             role:'all' },
  { group:'Tools',                     keys:['W','A','S','D'],label:'Pan the camera',          role:'all' },
  { group:'Tools',                     keys:['←','↑','↓','→'],label:'Move character / selected token', role:'all' },
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
  zone:           '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
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

// =================== Pan / zoom ===================
let tableZoom = 1.0;
let tablePanX = 0, tablePanY = 0;
let spaceHeld = false, isPanning = false;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
function applyTableTransform() {
  const c = $('#tableContent');
  if (c) c.style.transform = `translate(${tablePanX}px,${tablePanY}px) scale(${tableZoom})`;
}
function boardById(id) { return STATE.boards.find(b => b.id === id) || STATE.boards[0]; }

// ── Board management (GM only) ───────────────────────────────────────────────
function gmSwitchView(id) {        // GM previews/edits a board locally; players unaffected
  gmViewBoardId = id;
  STATE.table = boardById(id).table;
  selectionSet.clear();
  renderAllGM();
}
function addBoard() {
  const id = uid();
  sendOp({ type:'board-add', id, name: 'Board ' + (STATE.boards.length + 1) });
  gmViewBoardId = id;   // preview the new board as soon as it arrives
}
function renameBoard(id) {
  const b = boardById(id); const v = prompt('Board name:', b.name);
  if (v != null && v.trim()) sendOp({ type:'board-rename', id, name: v.trim() });
}
function duplicateBoard(id) {
  const newId = uid();
  sendOp({ type:'board-duplicate', id, newId });
  gmViewBoardId = newId;
}
function deleteBoard(id) {
  if (STATE.boards.length <= 1) return alert("Can't delete the only board.");
  if (id === STATE.activeBoardId) return alert("Can't delete the live board — activate a different board first.");
  if (!confirm('Delete this board?')) return;
  if (gmViewBoardId === id) gmSwitchView(STATE.boards[0].id);
  sendOp({ type:'board-delete', id });
}
function activateBoard(id) {        // make a board the live one players see
  sendOp({ type:'board-activate', id });   // host spawns characters, logs, and broadcasts
}
function renderBoardBar() {
  if (ROLE !== 'gm') return;
  const bar = $('#boardBar'); if (!bar || !STATE || !STATE.boards) return;
  bar.innerHTML = '';
  for (const b of STATE.boards) {
    const isView = b.id === gmViewBoardId;
    const isLive = b.id === STATE.activeBoardId;
    const chip = el('div', { class:'board-chip' + (isView ? ' viewing' : '') + (isLive ? ' live' : ''), title: isLive ? 'LIVE — players see this board' : 'Click to preview/edit' });
    chip.appendChild(el('span', { class:'board-name' }, b.name));
    if (isLive) chip.appendChild(el('span', { class:'board-live-dot', title:'Live' }, '●'));
    chip.addEventListener('click', () => { if (b.id !== gmViewBoardId) gmSwitchView(b.id); });
    chip.addEventListener('contextmenu', e => { e.preventDefault(); showBoardMenu(b, e); });
    if (isView && !isLive) {
      const act = el('button', { class:'board-activate', title:'Show this board to players' }, 'Activate');
      act.addEventListener('click', ev => { ev.stopPropagation(); activateBoard(b.id); });
      chip.appendChild(act);
    }
    bar.appendChild(chip);
  }
  const add = el('button', { class:'board-add', title:'New board' }, '+');
  add.addEventListener('click', addBoard);
  bar.appendChild(add);
}
function showBoardMenu(b, e) {
  showMenu([
    { label:'Preview / edit', action: () => gmSwitchView(b.id) },
    { label:'▶ Activate (show players)', action: () => activateBoard(b.id) },
    '-',
    { label:'Rename...', action: () => renameBoard(b.id) },
    { label:'Duplicate', action: () => duplicateBoard(b.id) },
    { label:'🗑 Delete', action: () => deleteBoard(b.id) },
  ], e.clientX, e.clientY);
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
// Re-use the persisted assets-folder handle (re-granting permission) instead of re-picking.
async function tryReuseAssetsFolder() {
  if (ROLE !== 'gm' || !window.showDirectoryPicker) return false;
  try {
    const handle = await getAssetsHandle();
    if (!handle) return false;
    const opts = { mode: 'read' };
    let perm = await handle.queryPermission(opts);
    if (perm !== 'granted') perm = await handle.requestPermission(opts);   // needs the click gesture
    if (perm !== 'granted') return false;
    assetsRootHandle = handle;
    return true;
  } catch { return false; }
}
// GM "Resume your last game?" modal — resolves 'resume' (folder re-allowed) or 'new'.
function showGmResumeModal(saved) {
  return new Promise(resolve => {
    const overlay = el('div', { class:'join-overlay' });
    const box = el('div', { class:'join-box' });
    box.appendChild(el('h2', {}, 'Welcome back, GM'));
    box.appendChild(el('p', { style:{ color:'var(--muted)', fontSize:'13px', margin:'4px 0 14px' } },
      `Resume your last game (room ${saved.room})? You'll re-allow your assets folder.`));
    const resumeBtn = el('button', { class:'primary' }, 'Resume game');
    resumeBtn.addEventListener('click', async () => {
      overlay.remove();
      if (!(await tryReuseAssetsFolder())) await setupAssetsFolder();   // permission lost → re-pick
      resolve('resume');
    });
    const newBtn = el('button', { style:{ marginTop:'8px', background:'transparent', border:'1px solid var(--line)' } }, 'Start a new game instead');
    newBtn.addEventListener('click', () => { overlay.remove(); resolve('new'); });
    box.appendChild(resumeBtn); box.appendChild(newBtn);
    overlay.appendChild(box); document.body.appendChild(overlay);
  });
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
      if (ROLE === 'gm' && !window.DEMO) {
        // GM caches card art locally only. Players pull each card on demand
        // (card-request) — never bulk-pushed — so the relay isn't flooded.
        try {
          const hash = await hashBlob(dataUrl);
          PATH_TO_HASH[relativePath] = hash;
          ASSETS[hash] = dataUrl;
        } catch (_) {}
      }
    };
    reader.onerror = () => res(null);
    reader.readAsDataURL(file);
  });
}

// Card images are served from the edge (Worker + KV) at /a/<path> for GM and players alike —
// no local folder, no relay. The browser caches them (immutable), so repeats are instant.
function artUrl(p) { return RELAY_URL.replace(/^wss/, 'https') + '/a/' + String(p).split('/').map(encodeURIComponent).join('/'); }
function loadCardImage(relativePath, imgEl) {
  if (!relativePath) return;
  if (window.DEMO) { const u = DEMO_CARD_IMAGES[relativePath]; if (u) { imgEl.src = u; imgEl.classList.remove('card-loading'); } return; }
  imgEl.classList.add('card-loading');
  imgEl.addEventListener('load',  () => imgEl.classList.remove('card-loading'), { once: true });
  imgEl.addEventListener('error', () => imgEl.classList.remove('card-loading'), { once: true });
  imgEl.src = artUrl(relativePath);
}

// =================== State ===================
let STATE = null;       // GM only: canonical
let LOCAL_VIEW = null;  // Player: filtered state received from GM
let ASSETS = {};        // hash -> dataUrl (in-memory)
let MY_ID = null;       // 'gm' or 'player1'..'player10'
let MY_NAME = 'GM';
let MY_COLOR = '#3b82f6';
let MY_ROOM = null;

function activeState() { return ROLE === 'gm' ? STATE : LOCAL_VIEW; }

// =================== Logging ===================
function logEntry(who, text, kind='info') {
  sendOp({ type:'log', who, text, kind });   // host appends to the shared log and broadcasts
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
let _diceStatKey = null;   // null = no modifier; else 'str'|'agi'|'int'|'cha'|'sta'
function rollAndLog(spec) {
  // spec like 'd20', 'd6', '2d6+3'
  const m = spec.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) { logEntry(MY_NAME, 'Bad roll: '+spec, 'warn'); return; }
  const n = parseInt(m[1] || '1', 10);
  const sides = parseInt(m[2], 10);
  let mod = parseInt(m[3] || '0', 10);
  // Optional stat modifier picked in the dice roller (the player's own sheet).
  let statTxt = '';
  if (_diceStatKey) {
    const sm = statMod(activeState()?.hands?.[MY_ID]?.stats?.[_diceStatKey]);
    mod += sm;
    statTxt = ` (${_diceStatKey.toUpperCase()} ${fmtMod(sm)})`;
  }
  const rolls = []; for (let i=0;i<n;i++) rolls.push(rollDie(sides));
  const sum = rolls.reduce((a,b)=>a+b,0) + mod;
  const detail = (n>1 ? `[${rolls.join(',')}]` : `${rolls[0]}`) + (mod ? (mod>0?` +${mod}`:` ${mod}`) : '');
  const txt = `rolled ${spec}${statTxt} → ${detail} = ${sum}`;
  sendOp({ type:'log', who: MY_NAME, text: txt, kind:'roll', color: MY_COLOR });
}

// =================== Authoritative host (Cloudflare Durable Object) ===========
// The game state lives in a per-room Durable Object (relay-cf/). Clients — GM and
// players alike — send ops and render the view the host broadcasts. Connect to
// RELAY_URL + '/r/<roomCode>'. Set RELAY_URL after `wrangler deploy` (relay-cf/).
const RELAY_URL = 'wss://deck-quest-vtt.david-riego-01.workers.dev';

let wsConn = null;
let _netPingTimer = null;
let _netPingSent  = 0;

// Movement sync: GM broadcasts tiny move-patches instead of full state for drags.
// Players apply them in-place and keep their own in-flight moves "pending" so an
// unrelated full-state broadcast can't snap a just-moved token back.
const pendingMoves = {}; // instId -> { x, y, timer }

// Optimistic movement: a client moves locally, then the host's authoritative
// move-patch confirms it. Both GM and players use this now.
function tableOf() { const s = activeState(); return s && s.table ? s.table : null; }
function markOptimisticMove(instId, x, y) {
  const tbl = tableOf(); if (!tbl) return;
  const obj = tbl.figurines.find(f => f.instId === instId) || tbl.cards.find(c => c.instId === instId);
  if (obj) { obj.x = x; obj.y = y; }
  if (pendingMoves[instId]?.timer) clearTimeout(pendingMoves[instId].timer);
  pendingMoves[instId] = { x, y, timer: setTimeout(() => { delete pendingMoves[instId]; }, 3000) };
}
function clearPendingMove(instId) {
  if (pendingMoves[instId]) { clearTimeout(pendingMoves[instId].timer); delete pendingMoves[instId]; }
}
function reapplyPendingMoves() {
  const tbl = tableOf(); if (!tbl) return;
  for (const [instId, pm] of Object.entries(pendingMoves)) {
    const obj = tbl.figurines.find(f => f.instId === instId) || tbl.cards.find(c => c.instId === instId);
    if (obj) { obj.x = pm.x; obj.y = pm.y; }
  }
}

// Optimistic drawing: a pen stroke shows instantly and stays painted until the host
// echoes it back (matched by client id), so a flaky socket can never make a stroke
// vanish. Each pending entry is dropped once the authoritative view contains it.
let pendingDrawings = []; // [{ cid, stroke, ts }]
function reapplyPendingDrawings() {
  const tbl = tableOf(); if (!tbl) return;
  const now = Date.now();
  // One pass over the committed drawings to collect confirmed cids → O(drawings+pending).
  const confirmed = new Set();
  for (const d of tbl.drawings) if (d.cid != null) confirmed.add(d.cid);
  pendingDrawings = pendingDrawings.filter(p => (now - p.ts) < 15000 && !confirmed.has(p.cid));
  for (const p of pendingDrawings) tbl.drawings.push({ id: 'local-' + p.cid, by: MY_ID, ...p.stroke });
}
function applyMovePatch(p) {
  // GM editing a NON-viewed board: mutate that board's authoritative table object but
  // skip DOM (it isn't on screen). A missing boardId means "the active/visible board".
  if (ROLE === 'gm' && p.boardId && p.boardId !== gmViewBoardId) {
    const b = STATE && STATE.boards.find(x => x.id === p.boardId);
    if (b) {
      const arr = p.kind === 'card' ? b.table.cards : b.table.figurines;
      const obj = arr.find(o => o.instId === p.instId);
      if (obj) { obj.x = p.x; obj.y = p.y; if (p.z != null) obj.z = p.z; }
    }
    clearPendingMove(p.instId);
    return;
  }
  // Otherwise the patch targets the visible table (GM viewed board, or the player's
  // only/active board) — mutate it and update the DOM.
  const tbl = tableOf(); if (!tbl) { clearPendingMove(p.instId); return; }
  const arr = p.kind === 'card' ? tbl.cards : tbl.figurines;
  const obj = arr.find(o => o.instId === p.instId);
  if (obj) { obj.x = p.x; obj.y = p.y; if (p.z != null) obj.z = p.z; }
  clearPendingMove(p.instId);
  const dom = document.querySelector(`[data-inst-id="${p.instId}"]`);
  if (dom) { dom.style.left = p.x + 'px'; dom.style.top = p.y + 'px'; if (p.z != null) dom.style.zIndex = p.z; }
}

// After adopting a full authoritative view, drop pendingMoves the host has already
// caught up to — but only if the authoritative position EXACTLY matches the value we
// sent. If the user nudged again, pendingMoves[instId] holds the newer x/y, so an
// older authoritative match won't equal it and won't be cleared prematurely. This
// stops a stale full-broadcast from snapping a just-moved token back.
function reconcilePendingMoves() {
  const tbl = tableOf(); if (!tbl) return;
  for (const [instId, pm] of Object.entries(pendingMoves)) {
    const obj = tbl.figurines.find(f => f.instId === instId) || tbl.cards.find(c => c.instId === instId);
    if (obj && obj.x === pm.x && obj.y === pm.y) clearPendingMove(instId);
  }
}

// Apply a targeted {patch} from the host (decision 7). Patches are broadcast to ALL
// sockets including the actor; every mutation is idempotent (set faceUp/effects/label/
// vitals to a value) or deduped (add-drawing by id/cid), so a double-apply is safe.
function applyPatch(p) {
  if (!p) return;
  let tbl, viewed;
  if (ROLE === 'gm') {
    const b = STATE && STATE.boards.find(x => x.id === p.boardId);
    tbl = b ? b.table : null;
    viewed = !!b && p.boardId === gmViewBoardId;
  } else {
    // Players only ever see the active board; the host only sends player-relevant
    // patches, so a present boardId still maps to the player's single visible table.
    tbl = LOCAL_VIEW ? LOCAL_VIEW.table : null;
    viewed = true;
  }
  if (!tbl) return;
  switch (p.kind) {
    case 'add-drawing': {
      const dr = p.drawing; if (!dr) return;
      // Already present by id → nothing to do (idempotent double-apply guard).
      if (tbl.drawings.some(d => d.id === dr.id)) return;
      let removedLocal = false;
      if (dr.cid != null) {
        if (pendingDrawings.some(pd => pd.cid === dr.cid)) {
          pendingDrawings = pendingDrawings.filter(pd => pd.cid !== dr.cid);
        }
        // Drop the optimistic local copy of this stroke so we don't end up with two.
        const before = tbl.drawings.length;
        tbl.drawings = tbl.drawings.filter(d => d.id !== 'local-' + dr.cid);
        removedLocal = tbl.drawings.length !== before;
        // If another (already-confirmed) copy with this cid exists, just repaint.
        if (tbl.drawings.some(d => d.cid === dr.cid)) {
          if (viewed) renderDrawings();
          return;
        }
      }
      tbl.drawings.push(dr);
      if (viewed) {
        // If we removed an optimistic local copy, its pixels are still on the canvas →
        // a full repaint is cleanest. Otherwise paint just the one new stroke (no clear).
        if (removedLocal) renderDrawings();
        else { const canvas = $('#drawLayer'); if (canvas) paintStroke(dr, canvas.getContext('2d')); }
      }
      return;
    }
    case 'flip-card': {
      // Only table cards patch (hand visibility differs per view → engine full-broadcasts hand).
      const c = tbl.cards.find(x => x.instId === p.instId); if (!c) return;
      c.faceUp = p.faceUp;
      if (viewed) renderTableCards();
      return;
    }
    case 'toggle-effect': {
      const f = tbl.figurines.find(x => x.instId === p.instId); if (!f) return;
      (f.effects = f.effects || {})[p.effect] = p.value;
      if (viewed) renderFigurines();
      return;
    }
    case 'set-figurine-vitals': {
      const f = tbl.figurines.find(x => x.instId === p.instId); if (!f) return;
      if ('hp' in p) f.hp = p.hp;
      if ('armor' in p) f.armor = p.armor;
      if (viewed) renderFigurines();
      return;
    }
    case 'set-figurine-label': {
      const f = tbl.figurines.find(x => x.instId === p.instId); if (!f) return;
      f.label = p.label;
      if (viewed) renderFigurines();
      return;
    }
  }
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
    dotColor = _netReconnecting ? '#f59e0b' : '#ef4444';
    label = _netReconnecting ? 'reconnecting…' : 'Offline';
    tip = _netReconnecting ? 'Relay: reconnecting…' : 'Relay: Offline\nPing: —';
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
let cursorThrottle = 0;
let gmViewBoardId = null;   // GM-only, client-local: which board the GM previews/edits

// ── Reconnect + session persistence ──────────────────────────────────────────
let _netReconnecting = false;
let _reconnectTimer = null;
let _reconnectDelay = 1000;
const SESSION_KEY = 'deckquest-session';
function saveSession() {
  if (window.DEMO || !MY_ROOM) return;
  try {
    const s = ROLE === 'gm' ? { role:'gm', room: MY_ROOM }
                            : { role:'player', room: MY_ROOM, slot: MY_ID, name: MY_NAME };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {}
}
function loadSavedSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function scheduleReconnect() {
  if (_reconnectTimer || !MY_ROOM) return;
  _reconnectTimer = setTimeout(() => { _reconnectTimer = null; setupPeer(MY_ROOM); }, _reconnectDelay);
  _reconnectDelay = Math.min(Math.round(_reconnectDelay * 1.7), 10000);   // backoff, capped at 10s
}

// Connect to the authoritative host (Durable Object) for this room.
// GM and players use the same path; the host decides what each may do.
// Drops auto-reconnect (with backoff); the DO persists state so we resume seamlessly.
function setupPeer(room) {
  MY_ROOM = room;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  // Detach the old socket's handlers so closing it (intentional re-connect / New Session) doesn't trigger reconnect.
  if (wsConn) { wsConn.onopen = wsConn.onmessage = wsConn.onclose = wsConn.onerror = null; try { wsConn.close(); } catch {} }
  wsConn = new WebSocket(RELAY_URL + '/r/' + encodeURIComponent(room));
  wsConn.onopen = () => {
    _reconnectDelay = 1000; _netReconnecting = false;
    if (ROLE === 'gm') {
      wsConn.send(JSON.stringify({ type:'register', role:'gm' }));
    } else {
      wsConn.send(JSON.stringify({ type:'register', role:'player', slot: MY_ID, name: MY_NAME, pfpHash: window._pendingPfpHash || null }));
      if (window._pendingPfp) { sendAsset(window._pendingPfpHash, window._pendingPfp, 'pfp'); delete window._pendingPfp; }
    }
    const rc = $('#roomCode'); if (rc) rc.textContent = room;
    saveSession();
    startNetMonitor();
    _flushOnState = true;   // defer the queue flush until the host's first 'state' (room is confirmed inited)
  };
  wsConn.onmessage = e => { let d; try { d = JSON.parse(e.data); } catch { return; } handleFromServer(d); };
  wsConn.onclose = () => {
    clearInterval(_netPingTimer);
    _netReconnecting = true; updateNetStatus(false, null); scheduleReconnect();   // any drop → keep retrying (host persists state)
  };
  wsConn.onerror = () => { updateNetStatus(false, null); };
}
function sendToServer(msg) {
  if (wsConn && wsConn.readyState === WebSocket.OPEN) { wsConn.send(JSON.stringify(msg)); return true; }
  return false;
}
// Ops attempted while the socket is briefly down are queued (not silently dropped) and
// flushed on reconnect — so a connection blip never "eats" a draw / move / card pull.
const _pendingOps = [];
let _flushOnState = false;   // flush queued ops only AFTER the host confirms the room (first 'state'), never into a not-yet-inited room
function flushPendingOps() {
  if (!_pendingOps.length) return;
  const q = _pendingOps.splice(0, _pendingOps.length);
  for (let i = 0; i < q.length; i++) {
    if (!sendToServer({ type:'op', op: q[i] })) { _pendingOps.push(...q.slice(i)); break; }   // socket dropped again → keep the rest
  }
}

// Adopt a full authoritative view from the host.
function applyServerState(d) {
  if (d.myId) {
    const slotChanged = d.myId !== MY_ID;
    MY_ID = d.myId;
    // Dynamic slots: the host allocates a player's slot on join, so persist it once it's
    // known — otherwise a reload re-registers with slot:null and gets a brand-new slot.
    if (slotChanged && ROLE === 'player') saveSession();
  }
  if (ROLE === 'gm') {
    STATE = d.view;
    if (!gmViewBoardId || !STATE.boards.some(b => b.id === gmViewBoardId)) gmViewBoardId = STATE.activeBoardId;
    STATE.table = (STATE.boards.find(b => b.id === gmViewBoardId) || STATE.boards[0]).table;
    reconcilePendingMoves();   // drop confirmed moves so reapply can't snap a newer value back
    reapplyPendingMoves();
    reapplyPendingDrawings();
    renderAllGM();
  } else {
    LOCAL_VIEW = d.view;
    reconcilePendingMoves();   // drop confirmed moves so reapply can't snap a newer value back
    reapplyPendingMoves();
    reapplyPendingDrawings();
    renderAllPlayer();
  }
  requestMissingAssets((activeState() || {}).assetMeta);
  renderChatPanel();
  if (_flushOnState) { _flushOnState = false; flushPendingOps(); }   // room is confirmed → safe to replay queued ops
}

function handleFromServer(d) {
  switch (d.type) {
    case 'pong': updateNetStatus(true, Date.now() - d.ts); return;
    case 'need-init':
      if (ROLE === 'gm') {
        if (!STATE) {   // resumed/connected but the host has no game (lost/evicted) → rebuild a fresh table, never sit on a blank screen
          STATE = ENGINE.newState(CARD_IDS_BY_TYPE);
          gmViewBoardId = STATE.activeBoardId;
          STATE.table = boardById(STATE.activeBoardId).table;
          renderAllGM();
          try { alert('The saved room could not be restored (the server had no game for it). Starting a fresh table.'); } catch {}
        }
        sendToServer({ type:'init-state', state: STATE });
      }
      return;
    case 'waiting': updateNetStatus(true, null); return;
    case 'state': applyServerState(d); return;
    case 'move-patch': applyMovePatch(d); return;
    case 'patch': applyPatch(d.patch); return;
    case 'cursor-update': drawCursor(d.who, d.x, d.y, d.color, d.name, d.pfpHash); return;
    case 'asset-begin': case 'asset-chunk': case 'asset-end': handleAssetMessage(d); return;
    case 'asset-request':  // the host forwarded a peer's request to us — send the bytes back to them
      if (ASSETS[d.hash]) sendAsset(d.hash, ASSETS[d.hash], (activeState()?.assetMeta?.[d.hash]?.kind) || 'figurine', d.from);
      return;
  }
}

// ---- Chunked asset transfer ----
const CHUNK_SIZE = 14000; // bytes of base64 per chunk; safe under typical data-channel limits
const incomingAssets = {}; // hash -> { kind, parts:[], total }

// Stream an asset to the host, which relays it to `to` (a clientId) or, if omitted,
// to every other client. Clients cache locally; the host only tracks assetMeta.
async function sendAsset(hash, dataUrl, kind, to, path) {
  if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
  const total = Math.ceil(dataUrl.length / CHUNK_SIZE);
  wsConn.send(JSON.stringify({ type:'asset-begin', hash, kind, total, to, path }));
  for (let i=0;i<total;i++) {
    // Backpressure: keep the socket's send buffer small so ops/pings/cursors stay
    // responsive even while a big image is uploading (no head-of-line blocking).
    while (wsConn.bufferedAmount > 64 * 1024) {
      await new Promise(r => setTimeout(r, 15));
      if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    }
    wsConn.send(JSON.stringify({ type:'asset-chunk', hash, index:i, data: dataUrl.slice(i*CHUNK_SIZE, (i+1)*CHUNK_SIZE), to }));
  }
  wsConn.send(JSON.stringify({ type:'asset-end', hash, kind, to, path }));
}

// Reassemble an incoming asset and cache it. (Relay/meta-tracking is the host's job.)
async function handleAssetMessage(data) {
  if (data.type === 'asset-begin') {
    incomingAssets[data.hash] = { kind:data.kind, parts:new Array(data.total), total:data.total };
  } else if (data.type === 'asset-chunk') {
    const inc = incomingAssets[data.hash]; if (!inc) return;
    inc.parts[data.index] = data.data;
  } else if (data.type === 'asset-end') {
    const inc = incomingAssets[data.hash]; if (!inc) return;
    const dataUrl = inc.parts.join('');
    ASSETS[data.hash] = dataUrl;
    await cacheAssetPut(data.hash, { kind: inc.kind || data.kind, dataUrl });
    delete incomingAssets[data.hash];
    const assetPath = data.path || activeState()?.assetMeta?.[data.hash]?.path;
    if (assetPath) PATH_TO_HASH[assetPath] = data.hash;
    rerenderAll();
  }
}

function requestMissingAssets(meta) {
  for (const hash of Object.keys(meta || {})) {
    const p = meta[hash]?.path;
    if (ASSETS[hash]) { if (p) PATH_TO_HASH[p] = hash; continue; }
    cacheAssetGet(hash).then(cached => {
      if (cached) {
        ASSETS[hash] = cached.dataUrl;
        if (p) PATH_TO_HASH[p] = hash;
        rerenderAll();
      } else {
        sendToServer({ type:'asset-request', hash });
        if (!_assetRetryTimer && !window.DEMO) _assetRetryTimer = setInterval(retryMissingAssets, 4000);
      }
    });
  }
}
// If the only peer holding an asset was offline when we first asked, keep re-requesting
// on a timer (not just on the next full broadcast) until the bytes finally arrive.
let _assetRetryTimer = null;
function retryMissingAssets() {
  const meta = (activeState() || {}).assetMeta || {};
  const missing = Object.keys(meta).filter(h => !ASSETS[h]);
  if (!missing.length) { clearInterval(_assetRetryTimer); _assetRetryTimer = null; return; }
  for (const hash of missing) sendToServer({ type:'asset-request', hash });
}

// ---- Sending ops to the authoritative host ----
// GM and players both just send ops; the host validates (canApply) and broadcasts.
function tagBoard(op) {
  if (ROLE === 'gm' && op && ENGINE.TABLE_OPS && ENGINE.TABLE_OPS.has(op.type) && op.boardId == null) op.boardId = gmViewBoardId;
}
function sendOp(op) {
  if (ROLE === 'gm') { tagBoard(op); if (op.type === 'batch') (op.ops || []).forEach(tagBoard); }
  if (window.DEMO) return demoApply(op);
  if (!sendToServer({ type:'op', op })) {            // socket down → keep it, flush on reconnect
    _pendingOps.push(op);
    if (_pendingOps.length > 500) _pendingOps.shift();
  }
}

// ---- Offline demo: run the engine locally as a stand-in host ----
function demoConnected() { return demoGame ? Object.keys(demoGame.hands).filter(k => k !== 'gm') : []; }
function demoApply(op) {
  if (!demoGame) return;
  const res = ENGINE.applyOp(demoGame, op, ROLE === 'gm' ? 'gm' : MY_ID, { connected: demoConnected() });
  if (res && res.rejected) return;
  projectDemo();
}
function projectDemo() {
  if (!demoGame) return;
  if (ROLE === 'gm') {
    STATE = ENGINE.viewFor(demoGame, 'gm');
    if (!gmViewBoardId || !STATE.boards.some(b => b.id === gmViewBoardId)) gmViewBoardId = STATE.activeBoardId;
    STATE.table = (STATE.boards.find(b => b.id === gmViewBoardId) || STATE.boards[0]).table;
    renderAllGM();
  } else {
    LOCAL_VIEW = ENGINE.viewFor(demoGame, MY_ID);
    renderAllPlayer();
  }
}

// =================== Save / load ===================
// Serialize STATE without the duplicated top-level `table` reference (boards[] is the
// source of truth; STATE.table is rebuilt from gmViewBoardId on load).
function snapshotState() { const { table, ...rest } = STATE; return rest; }
// Autosave removed by request — the GM saves manually. We only track unsaved changes
// so we can warn before the tab closes. Every op already calls autosave(), so that's
// our "something changed" hook.
let _dirty = false;
function autosave() { if (ROLE === 'gm') _dirty = true; }
function autosaveNow() {}
function downloadSession() {
  const snap = { state: snapshotState(), assets: ASSETS };
  const blob = new Blob([JSON.stringify(snap)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `deckquest-${STATE.roomCode}-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  _dirty = false;   // session saved
}
function loadSessionFile(file) {
  const r = new FileReader();
  r.onload = async () => {
    const snap = JSON.parse(r.result);
    MY_ID = 'gm';
    STATE = ENGINE.migrateState(snap.state, id => CARDS_BY_ID[id]?.type);
    ENGINE.normalizeZ(STATE);
    STATE.roomCode = randomRoom();   // load into a fresh room so the host adopts it cleanly
    gmViewBoardId = STATE.activeBoardId;
    STATE.table = boardById(STATE.activeBoardId).table;
    ASSETS = snap.assets || {};
    for (const [hash, dataUrl] of Object.entries(ASSETS)) {
      const meta = STATE.assetMeta?.[hash] || { kind: 'figurine' };
      await cacheAssetPut(hash, { kind: meta.kind, dataUrl });
    }
    renderAllGM();
    setupPeer(STATE.roomCode);
    _dirty = false;   // just loaded — matches the file on disk
  };
  r.readAsText(file);
}

// =================== Rendering ===================
function rerenderAll() {
  withPreservedFocus(() => {
    if (ROLE === 'gm') renderAllGM();
    else renderAllPlayer();
  });
}
function renderAllGM() {
  renderTopbar(); renderTable(); renderRightRail(); renderLog(); renderChatPanel(); renderBoardBar();
}
function renderAllPlayer() {
  renderTopbarPlayer(); renderTable(); renderRightRailPlayer(); renderLog(); renderChatPanel();
}

function renderTopbar() {
  if (!STATE) return;
  $('#roomCode').textContent = STATE.roomCode;
  $('#playerCountLabel').textContent = Object.keys(STATE.hands).filter(k => k !== 'gm').length;
  const connList = $('#connList'); if (connList) {
    connList.innerHTML = '';
    for (const pid of Object.keys(STATE.hands)) {
      if (pid === 'gm') continue;
      const p = STATE.hands[pid];
      const dot = el('span', { class:'dot', style:{background: p.connected ? p.color : '#444'}});
      connList.appendChild(el('span', { class:'conn-chip', title:p.name||pid }, dot, p.name || pid));
    }
  }
}
function renderTopbarPlayer() {
  if (!LOCAL_VIEW) return;
  $('#roomCode').textContent = LOCAL_VIEW.roomCode;
}

// ---- Table ----
// Keyed-render node caches: instId → DOM node. Reused across renders so we only
// touch changed attributes (no innerHTML='' rebuild → no image re-decode/flicker).
const _cardNodes = new Map();   // instId -> div (with ._srcKey, ._locked)
const _figNodes  = new Map();   // instId -> div (with ._sig, ._locked)

// Toggle the 'selected' class on a single instId's node without a full re-render.
function setSelected(instId, on) {
  const node = _figNodes.get(instId) || _cardNodes.get(instId);
  if (node) node.classList.toggle('selected', on);
}

function renderTable() {
  const s = activeState(); if (!s) return;
  renderDeckStacks();
  renderTableCards();
  renderFigurines();
  renderDrawings();
  renderSpawnZone();
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

// Build a fresh placed-card node (img + lock + drag + contextmenu) and store it in
// _cardNodes. Used on first render of a card and whenever its lock state flips
// (lock toggles whether the move handler is bound, so we replace the node).
function buildCardNode(c, card) {
  const div = el('div', { class:'placed-card', 'data-inst-id': c.instId });
  const cimg = el('img', { class:'card-img', draggable:'false' });
  cimg.style.background = 'var(--panel)';
  const srcKey = c.faceUp ? card.path : card.backPath;
  loadCardImage(srcKey, cimg);
  div.appendChild(cimg);
  if (c.locked) div.appendChild(el('div', { class:'figurine-lock-icon', title:'Locked by GM' }, '🔒'));
  if (!c.locked) {
    makeDraggable(div, (x,y) => sendOp({ type:'move-table-card', instId:c.instId, x, y }), c.instId);
  }
  div.addEventListener('contextmenu', e => {
    e.preventDefault();
    // Read the live card so the menu reflects current faceUp/lock state, not a stale closure.
    const live = (activeState()?.table.cards || []).find(x => x.instId === c.instId) || c;
    showCardContextMenu({ where:'table', instId:live.instId, cardId:live.cardId, faceUp:live.faceUp, locked:live.locked }, e);
  });
  div._img = cimg; div._srcKey = srcKey; div._locked = !!c.locked;
  return div;
}

function renderTableCards() {
  if (_isDragging) return;
  const s = activeState();
  const layer = $('#cardLayer'); if (!layer) return;
  const present = new Set();
  for (const c of s.table.cards) {
    const card = CARDS_BY_ID[c.cardId];
    if (!card) continue;   // unknown card id — skip rather than crash the whole render
    present.add(c.instId);
    let div = _cardNodes.get(c.instId);
    // Lock change rebinds listeners (draggable ↔ not) → replace the node for fresh closures.
    if (div && div._locked !== !!c.locked) { div.remove(); _cardNodes.delete(c.instId); div = null; }
    if (!div) {
      div = buildCardNode(c, card);
      _cardNodes.set(c.instId, div);
      layer.appendChild(div);
    } else {
      // Only re-decode the image if the logical source actually changed (avoids flicker).
      const srcKey = c.faceUp ? card.path : card.backPath;
      if (div._srcKey !== srcKey) { loadCardImage(srcKey, div._img); div._srcKey = srcKey; }
    }
    div.style.left = c.x + 'px';
    div.style.top = c.y + 'px';
    div.style.transform = `rotate(${c.rot||0}deg)`;
    div.style.zIndex = c.z || 1;
    div.classList.toggle('locked', !!c.locked);
    div.classList.toggle('selected', selectionSet.has(c.instId));
    div.classList.toggle('grouped', !!c.groupId);
  }
  // Remove nodes whose instId disappeared from the table.
  for (const [instId, node] of _cardNodes) {
    if (!present.has(instId)) { node.remove(); _cardNodes.delete(instId); }
  }
}

// Resolve the art URL for a figurine, kicking off the async disk-load (GM) for a
// built-in token if needed. On resolve it sets ASSETS[hash] and re-runs the keyed
// renderFigurines() (cheap), so the new node/inner gets the image next pass.
function figurineUrl(f, isChar, charPlayer) {
  if (isChar) {
    const pfpHash = charPlayer?.pfpHash;
    return pfpHash ? ASSETS[pfpHash] : null;
  }
  let url = ASSETS[f.assetHash];
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
  return url;
}

// Build the inner content of a figurine node (art/placeholder, nametag/label, vitals,
// effect badges, lock icon, resize handles). Called on create and whenever the
// per-figurine signature changes. Resize-handle/contextmenu closures capture `f`,
// so rebuilding the inner on a sig change keeps them current.
function buildFigInner(div, f, url, isChar, charPlayer, ringColor) {
  const eff = f.effects || {};
  const sx = f.flipH ? -1 : 1, sy = f.flipV ? -1 : 1;
  div.innerHTML = '';
  if (url) div.appendChild(el('img', { class:'figurine-img', src:url, draggable:'false', style:{ transform:`scale(${sx},${sy})` } }));
  else div.appendChild(el('div', { class:'figurine-loading' }, isChar ? (charPlayer?.name || f.playerId || '?') : 'Loading...'));
  if (isChar) {
    const tag = el('div', { class:'character-nametag', style:{ background: ringColor } }, charPlayer?.name || f.playerId);
    div.appendChild(tag);
  } else if (f.showName && f.label) {
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
    // Center-anchored resize handles on all four corners
    for (const corner of ['tl','tr','bl','br']) {
      const handle = el('div', { class:'figurine-resize ' + corner });
      handle.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        // Read the live figurine + table at event time — the node may be reused across
        // state adoptions, so the build-time `f`/`s` could be stale.
        const s = activeState(); if (!s) return;
        const live = s.table.figurines.find(g => g.instId === f.instId) || f;
        const cx = live.x + live.w/2, cy = live.y + live.h/2;       // center stays fixed
        const tc = $('#tableContent'); const cr = tc.getBoundingClientRect();
        let ns = Math.max(live.w, live.h);
        // Group resize: scale every other selected figurine about its own center.
        const others = (selectionSet.has(live.instId) && selectionSet.size > 1)
          ? [...selectionSet].filter(id => id !== live.instId)
              .map(id => s.table.figurines.find(g => g.instId === id))
              .filter(g => g && !g.locked)
              .map(g => ({ g, cx: g.x + g.w/2, cy: g.y + g.h/2, w0: g.w }))
          : [];
        const onMove = ev => {
          const mx = (ev.clientX - cr.left)/tableZoom, my = (ev.clientY - cr.top)/tableZoom;
          ns = Math.max(40, 2 * Math.max(Math.abs(mx - cx), Math.abs(my - cy)));
          div.style.width = ns+'px'; div.style.height = ns+'px';
          div.style.left = (cx - ns/2)+'px'; div.style.top = (cy - ns/2)+'px';
          const factor = ns / Math.max(live.w, live.h);
          for (const o of others) {
            const os = Math.max(40, Math.round(o.w0 * factor));
            const oel = document.querySelector(`[data-inst-id="${o.g.instId}"]`);
            if (oel) { oel.style.width = os+'px'; oel.style.height = os+'px'; oel.style.left = (o.cx - os/2)+'px'; oel.style.top = (o.cy - os/2)+'px'; }
          }
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const sz = Math.round(ns);
          const factor = ns / Math.max(live.w, live.h);
          const ops = [{ type:'move-figurine', instId:live.instId, x: Math.round(cx - sz/2), y: Math.round(cy - sz/2), w: sz, h: sz }];
          for (const o of others) {
            const os = Math.max(40, Math.round(o.w0 * factor));
            ops.push({ type:'move-figurine', instId:o.g.instId, x: Math.round(o.cx - os/2), y: Math.round(o.cy - os/2), w: os, h: os });
          }
          sendBatch(ops);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      div.appendChild(handle);
    }
  }
}

// Cheap signature of everything buildFigInner depends on. If unchanged across a
// render, we leave innerHTML alone (this is the flicker fix — img.src untouched).
function figSig(f, url, isChar, charPlayer) {
  const hp    = isChar ? charPlayer?.hp    : f.hp;
  const armor = isChar ? charPlayer?.armor : f.armor;
  return [url || '', f.opacity, f.rot, f.w, f.h, f.flipH, f.flipV,
    JSON.stringify(f.effects || {}), JSON.stringify(hp || null), JSON.stringify(armor || null),
    f.showName, f.label, f.locked, isChar, charPlayer?.name, charPlayer?.color].join('|');
}

function renderFigurines() {
  if (_isDragging) return;
  const s = activeState();
  const layer = $('#figurineLayer'); if (!layer) return;
  const present = new Set();
  for (const f of s.table.figurines) {
    present.add(f.instId);
    const isChar = f.kind === 'character';
    const charPlayer = isChar ? s.hands[f.playerId] : null;
    const ringColor = isChar ? (charPlayer?.color || '#f2ca50') : null;
    const url = figurineUrl(f, isChar, charPlayer);
    const eff = f.effects || {};
    let opacity = f.opacity != null ? f.opacity : 1;
    if (eff.invisible) opacity *= 0.35;
    const sig = figSig(f, url, isChar, charPlayer);

    let div = _figNodes.get(f.instId);
    // Lock change rebinds drag/handles → replace node for fresh closures.
    if (div && div._locked !== !!f.locked) { div.remove(); _figNodes.delete(f.instId); div = null; }
    if (!div) {
      div = el('div', { class:'figurine', 'data-inst-id': f.instId });
      buildFigInner(div, f, url, isChar, charPlayer, ringColor);
      div.addEventListener('contextmenu', e => {
        e.preventDefault();
        // Read the live figurine so the menu reflects current state, not a stale closure.
        const live = (activeState()?.table.figurines || []).find(x => x.instId === f.instId) || f;
        showFigurineContextMenu(live, e);
      });
      if (!f.locked) {
        makeDraggable(div, (x,y) => sendOp({ type:'move-figurine', instId:f.instId, x, y }), f.instId);
      }
      div._locked = !!f.locked;
      div._sig = sig;
      _figNodes.set(f.instId, div);
      layer.appendChild(div);
    } else if (div._sig !== sig) {
      buildFigInner(div, f, url, isChar, charPlayer, ringColor);
      div._sig = sig;
    }
    // Position / box attributes (cheap, every pass — never touch innerHTML here).
    div.style.left = f.x + 'px';
    div.style.top = f.y + 'px';
    div.style.width = f.w + 'px';
    div.style.height = f.h + 'px';
    div.style.transform = `rotate(${f.rot||0}deg)`;
    div.style.zIndex = f.z || 1;
    div.style.opacity = opacity;
    div.style.borderColor = isChar ? ringColor : '';
    div.classList.toggle('locked', !!f.locked);
    div.classList.toggle('character', isChar);
    div.classList.toggle('sneaking', !!eff.sneaking);
    div.classList.toggle('downed', !!eff.down);
    div.classList.toggle('selected', selectionSet.has(f.instId));
    div.classList.toggle('grouped', !!f.groupId);
  }
  // Remove nodes whose instId disappeared from the table.
  for (const [instId, node] of _figNodes) {
    if (!present.has(instId)) { node.remove(); _figNodes.delete(instId); }
  }
}

// Stroke a single drawing onto an arbitrary canvas context. Factored out so both
// the committed layer (#drawLayer) and the live overlay (#drawLayerLive) share it.
function paintStroke(d, ctx) {
  ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < d.points.length; i++) {
    const [x, y] = d.points[i];
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
// Keep a canvas's backing-store size in sync with its CSS box. Returns its ctx.
function syncCanvasSize(canvas) {
  if (canvas.width !== canvas.offsetWidth) canvas.width = canvas.offsetWidth;
  if (canvas.height !== canvas.offsetHeight) canvas.height = canvas.offsetHeight;
  return canvas.getContext('2d');
}
// Repaint ALL committed strokes onto #drawLayer. Called only on a state/patch
// adoption — not on every pen mousemove (the live overlay handles in-progress).
function renderDrawings() {
  const s = activeState();
  const canvas = $('#drawLayer'); if (!canvas) return;
  const ctx = syncCanvasSize(canvas);
  // Keep the live overlay's backing store sized too (it shares the table box).
  const live = $('#drawLayerLive'); if (live) syncCanvasSize(live);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const d of s.table.drawings) paintStroke(d, ctx);
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
      // Persist via the engine op (gmOnly broadcast) — no local-only STATE.gmNotes mutation.
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => {
        sendOp({ type:'set-gm-notes', text: ta.value });
        autosave();
      }, 500);
    });
    notes.appendChild(summary);
    notes.appendChild(ta);
    rail.appendChild(notes);
  }
  // GM hand tab
  rail.appendChild(playerPanel('gm', s.hands.gm));
  for (const pid of Object.keys(s.hands)) {
    if (pid === 'gm') continue;
    rail.appendChild(playerPanel(pid, s.hands[pid]));
  }
}
function renderRightRailPlayer() {
  const s = activeState(); if (!s) return;
  const rail = $('#rightRail'); if (!rail) return;
  rail.innerHTML = '';
  // self first
  const me = s.hands[MY_ID];
  if (me) rail.appendChild(playerPanel(MY_ID, me, true));
  for (const pid of Object.keys(s.hands)) {
    if (pid === 'gm' || pid === MY_ID) continue;
    rail.appendChild(playerPanel(pid, s.hands[pid], false));
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
  // GM-only: remove this player slot (deletes their hand + character token everywhere).
  if (pid !== 'gm' && ROLE === 'gm') {
    const rm = el('button', { class:'player-remove', title:'Remove this player' }, '×');
    rm.addEventListener('click', ev => {
      ev.stopPropagation();
      if (confirm('Remove ' + (p.name || pid) + '? Their hand and character token will be deleted.'))
        sendOp({ type:'remove-slot', slot: pid });
    });
    header.appendChild(rm);
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
  // Stats — point-buy sliders (0–50, step 5) with a derived roll modifier and 100-pt cap.
  body.appendChild(statBlock(pid, p, editable));
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

// Point-buy stat sheet: a "Points X/100" line + one row per stat (label, value+modifier,
// and — when editable — a 0–50 step-5 slider). The slider clamps live so the 5 stats can
// never sum above STAT_BUDGET; it commits (set-player-field) only on release.
function statBlock(pid, p, editable) {
  const wrap = el('div', { class:'stats-block' });
  const sliders = {};
  const sumOf = src => STAT_KEYS.reduce((a, k) => a + (parseInt(src(k), 10) || 0), 0);
  const liveVal = k => sliders[k] ? sliders[k].value : (p.stats[k] == null ? STAT_BASE : p.stats[k]);

  const pointsLine = el('div', { class:'stat-points' });
  const refreshPoints = () => {
    const t = sumOf(liveVal);
    pointsLine.innerHTML = '';
    pointsLine.appendChild(el('span', {}, 'Points'));
    pointsLine.appendChild(el('span', { class:'stat-points-val' + (t >= STAT_BUDGET ? ' full' : '') }, `${t} / ${STAT_BUDGET}`));
  };
  wrap.appendChild(pointsLine);

  const grid = el('div', { class:'stat-grid' });
  for (const k of STAT_KEYS) {
    const v = p.stats[k] == null ? STAT_BASE : p.stats[k];
    const row = el('div', { class:'stat-row' });
    row.appendChild(el('div', { class:'stat-row-label' }, k.toUpperCase()));
    const valEl = el('div', { class:'stat-row-val' });
    const renderVal = val => { valEl.innerHTML = ''; valEl.appendChild(el('span', { class:'stat-num' }, String(val))); valEl.appendChild(el('span', { class:'stat-mod' }, fmtMod(statMod(val)))); };
    renderVal(v);
    row.appendChild(valEl);
    if (editable) {
      const s = el('input', { type:'range', class:'stat-slider', min:'0', max:String(STAT_MAX), step:String(STAT_STEP), value:String(v) });
      s.dataset.fieldKey = `${pid}.stats.${k}`;
      sliders[k] = s;
      s.addEventListener('input', () => {
        let nv = parseInt(s.value, 10) || 0;
        const others = STAT_KEYS.filter(x => x !== k).reduce((a, x) => a + (parseInt(liveVal(x), 10) || 0), 0);
        if (nv + others > STAT_BUDGET) { nv = Math.max(0, Math.floor((STAT_BUDGET - others) / STAT_STEP) * STAT_STEP); s.value = String(nv); }
        renderVal(nv); refreshPoints();
      });
      s.addEventListener('change', () => {
        sendOp({ type:'set-player-field', owner:pid, path:'stats.'+k, value: parseInt(s.value, 10) || 0 });
      });
      row.appendChild(s);
    }
    grid.appendChild(row);
  }
  refreshPoints();
  wrap.appendChild(grid);
  return wrap;
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
  const onDocDown = ev => { if (!m.contains(ev.target)) removeMenu(); };
  const removeMenu = () => { m.remove(); document.removeEventListener('mousedown', onDocDown, true); };
  for (const it of items) {
    if (it === '-') { m.appendChild(el('div',{class:'ctx-sep'})); continue; }
    const item = el('div', { class:'ctx-item' + (it.disabled?' disabled':''), onclick: () => { if (!it.disabled){ it.action(); removeMenu(); }} }, it.label);
    m.appendChild(item);
  }
  document.body.appendChild(m);
  // Reposition so the menu stays fully inside the viewport.
  const r = m.getBoundingClientRect();
  if (r.bottom > window.innerHeight) m.style.top  = Math.max(0, y - r.height) + 'px';
  if (r.right  > window.innerWidth)  m.style.left = Math.max(0, x - r.width)  + 'px';
  // Dismiss on any mousedown outside the menu (capture phase so panel/toolbar
  // handlers that stopPropagation can't trap the menu open).
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
function showDrawMenu(deckType, anchor) {
  const r = anchor.getBoundingClientRect();
  const items = [{ label: 'Draw to GM hand', action: () => sendOp({ type:'draw', deck:deckType, to:'gm' }) }];
  items.push({ label: 'Draw to table', action: () => sendOp({ type:'draw', deck:deckType, to:'table' }) });
  items.push('-');
  for (const pid of Object.keys(STATE.hands)) {
    if (pid === 'gm') continue;
    items.push({ label: `Draw to ${STATE.hands[pid].name || pid}`, action: () => sendOp({ type:'draw', deck:deckType, to:pid }) });
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
      sendBatch([...selectionSet].map(id =>
        s.table.cards.find(x => x.instId === id) ? { type:'transfer-card', from:{where:'table',instId:id}, to:{where:'discard'} }
        : s.table.figurines.find(x => x.instId === id) ? { type:'remove-figurine', instId:id } : null).filter(Boolean));
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
      for (const pid of Object.keys(STATE.hands)) {
        if (pid === 'gm' || pid === info.owner) continue;
        items.push({ label:'Give to '+(STATE.hands[pid].name||pid), action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:pid }}) });
      }
      if (info.owner !== 'gm') items.push({ label:'Give to GM', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:'gm' }}) });
    }
    items.push('-');
    items.push({ label:'Discard', action: () => {
      // Brief confirm on a single player hand-card discard (GM acting on a player's hand,
      // or a player discarding their own card) — avoids accidental loss.
      if (ROLE !== 'gm' || info.owner !== 'gm') { if (!confirm('Discard this card?')) return; }
      sendOp({ type:'transfer-card', from:info, to:{ where:'discard' }});
    }});
    items.push({ label:'Return to deck', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'deck' }}) });
  }
  if (info.where === 'table') {
    items.push({ label:'Discard', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'discard' }}) });
    items.push({ label:'Return to deck', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'deck' }}) });
    if (ROLE === 'gm') {
      items.push('-');
      items.push({ label:'To GM hand', action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:'gm', faceUp:true }}) });
      for (const pid of Object.keys(STATE.hands)) {
        if (pid === 'gm') continue;
        items.push({ label:'To '+(STATE.hands[pid].name||pid), action: () => sendOp({ type:'transfer-card', from:info, to:{ where:'hand', owner:pid, faceUp: info.faceUp }}) });
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
// Figurines this action should affect: the whole multi-selection (if f is in it), else just f.
function selFigs(f) {
  const s = activeState(); if (!s) return [f];
  if (selectionSet.has(f.instId) && selectionSet.size > 1)
    return [...selectionSet].map(id => s.table.figurines.find(x => x.instId === id)).filter(Boolean);
  return [f];
}
// Apply a move-figurine edit to every affected figurine (fn computes per-figurine fields).
// One batch op → one broadcast/render instead of N.
function figEdit(f, fn) {
  const ops = selFigs(f).map(t => ({ type:'move-figurine', instId:t.instId, ...fn(t) }));
  sendOp(ops.length === 1 ? ops[0] : { type:'batch', ops });
}
// Build the right move op for an instId (figurine vs table card).
function moveOpFor(instId, x, y) {
  const s = activeState();
  const isFig = s && s.table.figurines.some(f => f.instId === instId);
  return { type: isFig ? 'move-figurine' : 'move-table-card', instId, x: Math.round(x), y: Math.round(y) };
}
// Send many ops as one batch (one broadcast/render) — or a single op directly.
function sendBatch(ops) { if (ops.length) sendOp(ops.length === 1 ? ops[0] : { type:'batch', ops }); }
// Center-anchored scale fields for a figurine.
function scaleFields(t, factor) {
  const cx = t.x + t.w/2, cy = t.y + t.h/2;
  const nw = Math.max(20, Math.round(t.w*factor)), nh = Math.max(20, Math.round(t.h*factor));
  return { w:nw, h:nh, x:Math.round(cx-nw/2), y:Math.round(cy-nh/2) };
}

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
      sendBatch([...selectionSet].map(id =>
        s.table.figurines.find(x => x.instId === id) ? { type:'remove-figurine', instId:id }
        : s.table.cards.find(x => x.instId === id) ? { type:'transfer-card', from:{where:'table',instId:id}, to:{where:'discard'} } : null).filter(Boolean));
      selectionSet.clear();
    }});
    items.push({ label: `🔒 Toggle lock all ${n}`, action: () => {
      const s = activeState();
      sendBatch([...selectionSet].map(id => {
        const fig = s.table.figurines.find(x => x.instId === id);
        return fig ? { type:'move-figurine', instId:id, locked:!fig.locked } : null;
      }).filter(Boolean));
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
  const multi = selectionSet.has(f.instId) && selectionSet.size > 1;
  items.push(
    { label: f.locked ? '🔓 Unlock' : '🔒 Lock', action: () => figEdit(f, t => ({ locked:!t.locked })) },
    { label:'Rename / Label...', action: () => {
        const v = prompt('Label (blank to clear):', f.label || '');
        if (v != null) sendBatch(selFigs(f).map(t => ({ type:'set-figurine-label', instId:t.instId, label: v })));
      } },
    { label: (f.showName ? '✓ ' : '  ') + 'Show name', action: () => figEdit(f, t => ({ showName: !t.showName })) },
    { label:'❤ Edit HP / Armor...', action: () => showTokenDetailPopup(f, e) },
    '-',
    // Status effects — toggle each across the selection.
    ...STATUS_EFFECTS.map(([key, label]) => ({
      label: (eff[key] ? '✓ ' : '  ') + label,
      action: () => sendBatch(selFigs(f).map(t => ({ type:'toggle-effect', instId:t.instId, effect:key }))),
    })),
    '-',
    { label:'Rotate +15°', action: () => figEdit(f, t => ({ rot:(t.rot||0)+15 })) },
    { label:'Rotate -15°', action: () => figEdit(f, t => ({ rot:(t.rot||0)-15 })) },
    { label:'Rotate +90°', action: () => figEdit(f, t => ({ rot:(t.rot||0)+90 })) },
    { label:'Rotate exact...', action: () => {
        const v = prompt('Rotation in degrees:', String(f.rot||0));
        if (v != null) figEdit(f, () => ({ rot: parseFloat(v)||0 }));
      } },
    { label:'Reset rotation', action: () => figEdit(f, () => ({ rot: 0 })) },
    '-',
    { label:'Flip horizontal', action: () => figEdit(f, t => ({ flipH: !t.flipH })) },
    { label:'Flip vertical', action: () => figEdit(f, t => ({ flipV: !t.flipV })) },
    '-',
    { label:'Resize exact...', action: () => {
        const v = prompt('Width × Height (e.g. 400x300):', `${f.w}x${f.h}`);
        if (!v) return;
        const m = v.match(/^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i);
        if (m) figEdit(f, () => ({ w:parseInt(m[1],10), h:parseInt(m[2],10) }));
      } },
    { label:'Fit to original size', action: () => {
        const url = ASSETS[f.assetHash]; if (!url) return;
        const img = new Image(); img.onload = () => sendOp({ type:'move-figurine', instId:f.instId, w:img.naturalWidth, h:img.naturalHeight });
        img.src = url;
      } },
    { label: multi ? 'Scale all ×2' : 'Scale ×2', action: () => figEdit(f, t => scaleFields(t, 2)) },
    { label: multi ? 'Scale all ÷2' : 'Scale ÷2', action: () => figEdit(f, t => scaleFields(t, 0.5)) },
    '-',
    { label:'Transparency...', action: () => showOpacitySlider(f, e.clientX, e.clientY) },
    { label:'Reset transparency', action: () => figEdit(f, () => ({ opacity: 1 })) },
    '-',
    { label:'Bring to front', action: () => figEdit(f, () => ({ bringToFront: true })) },
    { label:'Send to back', action: () => figEdit(f, () => ({ sendToBack: true })) },
    '-',
    { label: multi ? 'Duplicate all' : 'Duplicate', action: () => sendBatch(selFigs(f).map(t => ({ type:'duplicate-figurine', instId:t.instId }))) },
    { label:'Reset all transforms', action: () => figEdit(f, () => ({ rot:0, opacity:1, flipH:false, flipV:false, locked:false })) },
    '-',
    { label: multi ? `🗑 Delete all ${selectionSet.size}` : '🗑 Delete', action: () => {
        if (!confirm(multi ? `Delete ${selectionSet.size} selected items?` : 'Delete this image?')) return;
        sendBatch(selFigs(f).map(t => ({ type:'remove-figurine', instId:t.instId })));
        selectionSet.clear();
      } },
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

// =================== Clipboard + grouping ===================
let lastMouseTableX = 0, lastMouseTableY = 0;   // live cursor in table coords (for paste)
let clipboard = [];                             // copied figurines (tokens/maps)

function copySelection() {
  const s = activeState(); if (!s || !selectionSet.size) return;
  const figs = [...selectionSet]
    .map(id => s.table.figurines.find(x => x.instId === id))
    .filter(f => f && f.kind !== 'character');   // skip player character tokens
  if (!figs.length) return;
  let cx = 0, cy = 0;
  for (const f of figs) { cx += f.x + f.w/2; cy += f.y + f.h/2; }
  cx /= figs.length; cy /= figs.length;
  clipboard = figs.map(f => ({
    assetHash: f.assetHash, w: f.w, h: f.h, rot: f.rot||0, opacity: f.opacity,
    flipH: !!f.flipH, flipV: !!f.flipV, label: f.label || '', showName: !!f.showName,
    dx: (f.x + f.w/2) - cx, dy: (f.y + f.h/2) - cy,   // offset from selection centroid
  }));
}
function pasteClipboard() {
  if (!clipboard.length) return;
  const px = lastMouseTableX, py = lastMouseTableY;
  sendBatch(clipboard.map(it => ({ type:'add-figurine', hash: it.assetHash,
    x: Math.round(px + it.dx - it.w/2), y: Math.round(py + it.dy - it.h/2),
    w: it.w, h: it.h, label: it.label, showName: it.showName,
    rot: it.rot, opacity: it.opacity, flipH: it.flipH, flipV: it.flipV })));
}
function groupSelection() {
  if (selectionSet.size < 2) return;
  sendOp({ type:'set-group', instIds: [...selectionSet], groupId: uid() });
}
function ungroupSelection() {
  const gids = new Set();
  for (const id of selectionSet) { const g = getGroupIdOf(id); if (g) gids.add(g); }
  for (const g of gids) sendOp({ type:'set-group', instIds: getGroupMembers(g), groupId: null });
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

    // Ctrl/Cmd+click → toggle this item in the selection set (selection-only change →
    // just toggle the one node's class, no full re-render).
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      if (instId) {
        const on = !selectionSet.has(instId);
        on ? selectionSet.add(instId) : selectionSet.delete(instId);
        setSelected(instId, on);
      }
      return;
    }

    // Grouped item → select the whole group on plain click. Selection-only change →
    // toggle just the affected nodes' 'selected' class instead of a full re-render.
    if (instId && !selectionSet.has(instId)) {
      const prev = new Set(selectionSet);
      if (!selectWholeGroup(instId)) selectionSet.clear();
      for (const id of prev) if (!selectionSet.has(id)) setSelected(id, false);
      for (const id of selectionSet) if (!prev.has(id)) setSelected(id, true);
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
      if (groupMembers.length) {
        // Move the whole group in one batch — single broadcast/render.
        const dx = lastX - x0, dy = lastY - y0;
        const ops = [moveOpFor(instId, lastX, lastY)];
        if (instId) markOptimisticMove(instId, lastX, lastY);
        for (const g of groupMembers) {
          const gx = Math.round(g.x0 + dx), gy = Math.round(g.y0 + dy);
          ops.push({ type: g.kind === 'figurine' ? 'move-figurine' : 'move-table-card', instId: g.instId, x: gx, y: gy });
          markOptimisticMove(g.instId, gx, gy);
        }
        sendBatch(ops);
      } else {
        onEnd(lastX, lastY);
        if (instId) markOptimisticMove(instId, lastX, lastY);
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
      for (const pid of Object.keys(STATE.hands)) {
        if (pid === 'gm') continue;
        actions.appendChild(el('button', { onclick: () => { spawnSpecificCard(c.id, pid); overlay.remove(); } }, 'To '+(STATE.hands[pid].name||pid)));
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
  sendOp({ type:'spawn-card', cardId, deck: CARDS_BY_ID[cardId].type, to: target });
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
    if (e.key === ' ' && !(e.target.matches && e.target.matches('input,textarea,select')) && !e.ctrlKey && !e.metaKey && !e.altKey) {
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

  // WASD = glide the camera (hold to keep moving). Arrow keys nudge tokens (below).
  const _panHeld = new Set();
  let _panRAF = null;
  const PAN_SPEED = 18; // screen px per frame
  function _panTick() {
    let dx = 0, dy = 0;
    if (_panHeld.has('a')) dx += 1; if (_panHeld.has('d')) dx -= 1;
    if (_panHeld.has('w')) dy += 1; if (_panHeld.has('s')) dy -= 1;
    if (dx || dy) { tablePanX += dx * PAN_SPEED; tablePanY += dy * PAN_SPEED; applyTableTransform(); }
    _panRAF = _panHeld.size ? requestAnimationFrame(_panTick) : null;
  }
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.target.matches && e.target.matches('input,textarea,select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'w' && k !== 'a' && k !== 's' && k !== 'd') return;
    // Leave the GM's deck shortcuts (s=shuffle, d=draw) alone while hovering a deck.
    if (hoverInfo && hoverInfo.kind === 'deck' && ROLE === 'gm' && (k === 's' || k === 'd')) return;
    e.preventDefault();
    _panHeld.add(k);
    if (!_panRAF) _panRAF = requestAnimationFrame(_panTick);
  });
  window.addEventListener('keyup', e => { _panHeld.delete(e.key.toLowerCase()); });
  window.addEventListener('blur', () => { _panHeld.clear(); });

  // Arrow keys move the selected tokens — or, for a player with nothing selected,
  // their own character token. Shift = bigger steps. We mirror the WASD pattern: a held
  // Set + a single rAF loop applies the optimistic DOM move every frame but throttles the
  // outbound op to ~1 per 90ms (coalescing OS auto-repeat), with a guaranteed final send.
  const _arrowHeld = new Set();   // 'ArrowUp'|'ArrowDown'|'ArrowLeft'|'ArrowRight'
  let _arrowShift = false;
  let _arrowRAF = null;
  let _lastArrowSend = 0;
  let _arrowDirty = false;        // an un-sent optimistic move is outstanding
  const ARROW_SEND_MS = 90;
  // Resolve which tokens the arrows should move right now (selection, else own char).
  function _arrowMovers() {
    const s = activeState(); if (!s) return [];
    let movers = [
      ...s.table.figurines.filter(f => selectionSet.has(f.instId) && !f.locked).map(o => ({ o, kind:'fig' })),
      ...s.table.cards.filter(c => selectionSet.has(c.instId) && !c.locked).map(o => ({ o, kind:'card' })),
    ];
    if (!movers.length && ROLE !== 'gm') {
      const mine = s.table.figurines.find(f => f.kind === 'character' && f.playerId === MY_ID && !f.locked);
      if (mine) movers = [{ o: mine, kind:'fig' }];
    }
    return movers;
  }
  // Flush the current optimistic positions of the held movers as one batch.
  function _arrowFlush(movers) {
    const ops = movers.map(({ o, kind }) => kind === 'fig'
      ? { type:'move-figurine', instId:o.instId, x:Math.round(o.x||0), y:Math.round(o.y||0) }
      : { type:'move-table-card', instId:o.instId, x:Math.round(o.x||0), y:Math.round(o.y||0) });
    if (ops.length) sendBatch(ops);
    _lastArrowSend = Date.now();
    _arrowDirty = false;
  }
  function _arrowTick() {
    const step = _arrowShift ? 50 : 10;
    let dx = 0, dy = 0;
    if (_arrowHeld.has('ArrowLeft')) dx -= step; if (_arrowHeld.has('ArrowRight')) dx += step;
    if (_arrowHeld.has('ArrowUp'))   dy -= step; if (_arrowHeld.has('ArrowDown'))  dy += step;
    const movers = _arrowMovers();
    if ((dx || dy) && movers.length) {
      for (const { o } of movers) {
        const nx = Math.round((o.x || 0) + dx), ny = Math.round((o.y || 0) + dy);
        markOptimisticMove(o.instId, nx, ny);   // mutates the live table object + pendingMoves
        const dom = document.querySelector(`[data-inst-id="${o.instId}"]`);
        if (dom) { dom.style.left = nx + 'px'; dom.style.top = ny + 'px'; }
      }
      _arrowDirty = true;
      const now = Date.now();
      if (now - _lastArrowSend >= ARROW_SEND_MS) _arrowFlush(movers);
    }
    if (_arrowHeld.size) { _arrowRAF = requestAnimationFrame(_arrowTick); }
    else {
      _arrowRAF = null;
      if (_arrowDirty) _arrowFlush(_arrowMovers());   // guaranteed trailing send on release
    }
  }
  function _stopArrows() {
    _arrowHeld.clear();
    if (_arrowRAF) { cancelAnimationFrame(_arrowRAF); _arrowRAF = null; }
    if (_arrowDirty) _arrowFlush(_arrowMovers());
  }
  window.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input,textarea,select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
    _arrowShift = e.shiftKey;
    // If there's nothing to move, let the arrows scroll the page normally.
    if (!_arrowHeld.size && !_arrowMovers().length) return;
    e.preventDefault();
    _arrowHeld.add(e.key);
    if (!_arrowRAF) _arrowRAF = requestAnimationFrame(_arrowTick);
  });
  window.addEventListener('keyup', e => {
    if (/^Arrow(Up|Down|Left|Right)$/.test(e.key)) _arrowHeld.delete(e.key);
    _arrowShift = e.shiftKey;
  });
  window.addEventListener('blur', _stopArrows);

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

  // Spawn-zone tool — capture-phase rectangle drag sets the viewed board's zone.
  stage.addEventListener('mousedown', e => {
    if (!spawnZoneMode || e.button !== 0 || spaceHeld) return;
    const onTable = e.target === stage || (e.target.closest && e.target.closest('#tableContent'));
    if (!onTable) return;
    e.preventDefault(); e.stopPropagation();
    const tc = $('#tableContent'); const cr = tc.getBoundingClientRect();
    const sx = (e.clientX - cr.left)/tableZoom, sy = (e.clientY - cr.top)/tableZoom;
    const draft = el('div', { id:'spawnZoneDraft' }); tc.appendChild(draft);
    const bounds = ev => {
      const cx = (ev.clientX - cr.left)/tableZoom, cy = (ev.clientY - cr.top)/tableZoom;
      return { x: Math.min(sx,cx), y: Math.min(sy,cy), w: Math.abs(cx-sx), h: Math.abs(cy-sy) };
    };
    const onMove = ev => { const b = bounds(ev); draft.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;`; };
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      draft.remove();
      const b = bounds(ev);
      if (b.w > 20 && b.h > 20) {
        boardById(gmViewBoardId).spawnZone = { x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.w), h:Math.round(b.h) };
        renderTable(); autosave();
      }
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
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
    lastMouseTableX = x; lastMouseTableY = y;   // for paste-at-cursor
    // throttle cursor broadcast
    const now = Date.now();
    if (now - cursorThrottle > 60) {
      cursorThrottle = now;
      if (!window.DEMO) sendToServer({ type:'cursor', x, y });
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
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (stampMode || spawnZoneMode) { setTool('pointer'); return; }
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

    // Figurine hover (applies to whole selection if hovered item is part of it)
    if (hoverInfo.kind === 'figurine') {
      const f = s.table.figurines.find(x => x.instId === hoverInfo.instId); if (!f) return;
      if (f.locked) { if (k === 'l' && ROLE === 'gm') sendOp({ type:'move-figurine', instId:f.instId, locked:false }); return; }
      if (k === 'f') figEdit(f, t => ({ flipH: !t.flipH }));
      else if (k === 'r') figEdit(f, t => ({ rot: ((t.rot||0)+90)%360 }));
      else if (k === '[') figEdit(f, () => ({ sendToBack:true }));
      else if (k === ']') figEdit(f, () => ({ bringToFront:true }));
      else if (k === 'l' && ROLE === 'gm') figEdit(f, t => ({ locked: !t.locked }));
      else if (k === 'e' && ROLE === 'gm') sendBatch(selFigs(f).map(t => ({ type:'duplicate-figurine', instId:t.instId })));
      else if ((k === 'Delete' || k === 'Backspace') && ROLE === 'gm') sendBatch(selFigs(f).map(t => ({ type:'remove-figurine', instId:t.instId })));
      return;
    }

    // Table card hover
    if (hoverInfo.kind === 'card') {
      const c = s.table.cards.find(x => x.instId === hoverInfo.instId); if (!c) return;
      if (c.locked) { if (k === 'l' && ROLE === 'gm') sendOp({ type:'lock-table-card', instId:c.instId }); return; }
      if (k === 'f') sendOp({ type:'flip-card', where:'table', instId:c.instId });
      else if (k === 'l' && ROLE === 'gm') sendOp({ type:'lock-table-card', instId:c.instId });
      else if ((k === 'Delete' || k === 'Backspace') && ROLE === 'gm') sendOp({ type:'transfer-card', from:{ where:'table', instId:c.instId }, to:{ where:'discard' } });
      return;
    }
  });

  // Ctrl/Cmd shortcuts: copy / paste / group / ungroup
  window.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input,textarea,select')) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'c') { if (selectionSet.size) { copySelection(); e.preventDefault(); } }
    else if (k === 'v') { if (clipboard.length) { pasteClipboard(); e.preventDefault(); } }
    else if (k === 'g') { const hasTarget = selectionSet.size > 0; if (hasTarget) { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); } }
  });

  // Lasso-select: drag on empty table area to rubber-band select figurines/cards
  const tableContent = $('#tableContent');
  if (tableContent) {
    tableContent.addEventListener('mousedown', e => {
      if (e.button !== 0 || spaceHeld || currentTool !== 'pointer') return;
      // Locked figurines/cards (e.g. a locked map) act as table background — a lasso can
      // start on top of them. Only an UNLOCKED item (or a deck stack) blocks the lasso.
      const hit = e.target.closest('.figurine,.placed-card,.deck-stack');
      if (hit && !hit.classList.contains('locked')) return;
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
        // Locked items act as background — never grabbed by a lasso (so you select the
        // tokens sitting on a locked map, not the map itself).
        for (const f of s.table.figurines) {
          if (f.locked) continue;
          if (f.x < selX+selW && f.x+f.w > selX && f.y < selY+selH && f.y+f.h > selY)
            selectionSet.add(f.instId);
        }
        for (const c of s.table.cards) {
          if (c.locked) continue;
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
    const cid = uid();
    const stroke = { ...activeStroke, cid };
    if (!window.DEMO) {
      // Paint it now and remember it; the host echo (matched by cid) confirms it later.
      const tbl = tableOf();
      if (tbl) { tbl.drawings.push({ id: 'local-' + cid, by: MY_ID, ...stroke }); renderDrawings(); }
      pendingDrawings.push({ cid, stroke, ts: Date.now() });
    }
    sendOp({ type:'add-drawing', by: MY_ID, stroke });
  }
  activeStroke = null;
  // The committed stroke now shows on #drawLayer (via renderDrawings above) — clear
  // the live overlay so no ghost double-stroke remains.
  const live = $('#drawLayerLive');
  if (live) { const ctx = live.getContext('2d'); ctx.clearRect(0, 0, live.width, live.height); }
}


// Hit-test a click against every drawing and remove the first stroke the cursor
// is close enough to. "Close enough" = within (strokeWidth/2 + slack) of any segment.
function eraseAt(x, y) {
  const s = activeState(); if (!s) return;
  const slack = 6;
  for (let i = s.table.drawings.length - 1; i >= 0; i--) {
    const d = s.table.drawings[i];
    if (strokeHit(d, x, y, slack)) {
      // A not-yet-confirmed local stroke must be dropped from pendingDrawings too,
      // otherwise reapplyPendingDrawings would repaint it after we remove it.
      if (typeof d.id === 'string' && d.id.startsWith('local-')) {
        const cid = d.id.slice(6);
        pendingDrawings = pendingDrawings.filter(p => p.cid !== cid);
        const tbl = tableOf();
        if (tbl) tbl.drawings = tbl.drawings.filter(x => x !== d);
        renderDrawings();
      }
      sendOp({ type:'remove-drawing', id: d.id });   // harmless if the host never had it
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
// Paint the in-progress stroke onto the small live overlay only — no full-canvas
// repaint of the committed #drawLayer. Clear just the live overlay each frame.
function drawLiveStroke() {
  const live = $('#drawLayerLive'); if (!live) return;
  const ctx = syncCanvasSize(live);
  ctx.clearRect(0, 0, live.width, live.height);
  if (!activeStroke) return;
  paintStroke(activeStroke, ctx);
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
  // Enter/exit spawn-zone mode
  if (t === 'spawnzone') enterSpawnZoneMode();
  else if (spawnZoneMode) exitSpawnZoneMode();
}

// =================== Spawn-zone tool (GM only) ===================
let spawnZoneMode = false;
function enterSpawnZoneMode() {
  if (ROLE !== 'gm' || spawnZoneMode) return;
  spawnZoneMode = true;
  $('#spawnZonePanel')?.remove();
  const panel = el('div', { id:'spawnZonePanel' });
  panel.appendChild(el('span', { class:'sp-label' }, 'Spawn Zone'));
  panel.appendChild(el('span', { class:'sp-hint' }, 'Drag on the map to set where characters first appear · Esc to exit'));
  const clr = el('button', { class:'tool-btn' }, 'Clear zone');
  clr.addEventListener('click', () => { delete boardById(gmViewBoardId).spawnZone; renderTable(); autosave(); });
  panel.appendChild(clr);
  const close = el('button', { class:'tool-btn', title:'Exit' });
  close.appendChild(icon('close'));
  close.addEventListener('click', () => setTool('pointer'));
  panel.appendChild(close);
  document.body.appendChild(panel);
}
function exitSpawnZoneMode() {
  spawnZoneMode = false;
  $('#spawnZonePanel')?.remove();
}
function renderSpawnZone() {
  if (ROLE !== 'gm') return;
  const tc = $('#tableContent'); if (!tc) return;
  let z = $('#spawnZone');
  const zone = (STATE && STATE.boards) ? boardById(gmViewBoardId).spawnZone : null;
  if (!zone) { z?.remove(); return; }
  if (!z) { z = el('div', { id:'spawnZone' }); z.appendChild(el('span', {}, 'Spawn')); tc.appendChild(z); }
  z.style.left = zone.x + 'px'; z.style.top = zone.y + 'px'; z.style.width = zone.w + 'px'; z.style.height = zone.h + 'px';
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
  const anyCat = stampCat === '*';
  const pool = Object.values(TOKENS_BY_ID).filter(t =>
    (anyCat || t.cats[0] === stampCat) &&
    (anyCat || stampSub === '*' || t.cats[1] === stampSub));
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
  catSel.appendChild(el('option', { value:'*', selected: stampCat === '*' }, '🎲 Random (all)'));
  for (const c of stampCategories()) catSel.appendChild(el('option', { value:c, selected: c === stampCat }, c));
  catSel.addEventListener('change', () => { stampCat = catSel.value; stampSub = '*'; fillSubs(); refreshStampPool(); });
  panel.appendChild(catSel);

  const subSel = el('select');
  function fillSubs() {
    subSel.innerHTML = '';
    subSel.appendChild(el('option', { value:'*' }, 'All'));
    if (stampCat !== '*') for (const sc of stampSubcategories(stampCat)) subSel.appendChild(el('option', { value:sc }, sc));
    subSel.value = stampSub;
    subSel.disabled = (stampCat === '*');   // subcategory is meaningless when category is random
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
  const raw = await loadAssetAsDataUrl(tok.path); if (!raw) return;
  const dataUrl = await compressDataUrl(raw, 512, 0.85);   // share a small token, not the full-res file
  const hash = await hashBlob(dataUrl);
  ASSETS[hash] = dataUrl;
  await cacheAssetPut(hash, { kind:'figurine', dataUrl });   // cache so the token survives a GM reload
  if (!activeState()?.assetMeta?.[hash]) sendAsset(hash, dataUrl, 'figurine', undefined, tok.path);
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
  sendAsset(hash, dataUrl, 'pfp');                 // share via host
  sendOp({ type:'set-pfp', owner: pid, hash });    // host updates the sheet + spawns the token
}

// Compress an already-loaded dataUrl (for sharing token-library / stamp art at a small size).
async function compressDataUrl(dataUrl, maxDim, quality, mime='image/png') {
  return await new Promise(res => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxDim) { const r = maxDim / Math.max(w, h); w = Math.round(w*r); h = Math.round(h*r); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { res(c.toDataURL(mime, quality)); } catch { res(dataUrl); }
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

async function uploadFigurine(file, kind='figurine') {
  if (!file) return;
  // Keep shared images small — they travel over the GM's uplink. PNG keeps token transparency.
  const dataUrl = await compressImage(file, kind === 'map' ? 1280 : 640, kind === 'map' ? 0.72 : 0.9, kind === 'map' ? 'image/jpeg' : 'image/png');
  const hash = await hashBlob(dataUrl);
  ASSETS[hash] = dataUrl;
  await cacheAssetPut(hash, { kind, dataUrl });
  sendAsset(hash, dataUrl, kind);                  // share via host
  sendOp({ type:'add-figurine', hash, w: kind==='map'?600:120, h: kind==='map'?400:120 });
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
// =================== Setup wizards ===================
function gmSetupFlow() {
  // No auto-restore — the GM starts fresh and loads a saved session file if they want one.
  // Player slots are allocated dynamically as players join (by name) — no upfront count.
  MY_ID = 'gm';
  STATE = ENGINE.newState(CARD_IDS_BY_TYPE);
  gmViewBoardId = STATE.activeBoardId;
  STATE.table = boardById(STATE.activeBoardId).table;
  renderAllGM();
  setupPeer(STATE.roomCode);   // empty room → host asks for init → we upload STATE
}

function playerJoinFlow(saved) {
  const overlay = el('div', { class:'join-overlay' });
  const box = el('div', { class:'join-box' });
  const roomI = el('input', { type:'text', placeholder:'Room code (from GM)' });
  const nameI = el('input', { type:'text', placeholder:'Your name' });
  const pfpI = el('input', { type:'file', accept:'image/*' });
  const btn = el('button', { class:'primary', onclick: async () => {
    if (!roomI.value || !nameI.value) return alert('Need room code and name');
    MY_ROOM = roomI.value.trim();
    MY_NAME = nameI.value.trim();
    // Rejoin reuses the saved slot; a brand-new join leaves MY_ID null so the host
    // allocates the next free slot and tells us our real id in the first 'state'.
    MY_ID = saved?.slot || null;
    if (pfpI.files[0]) {
      const dataUrl = await compressImage(pfpI.files[0], 256, 0.8);
      const hash = await hashBlob(dataUrl);
      ASSETS[hash] = dataUrl; await cacheAssetPut(hash, { kind:'pfp', dataUrl });
      window._pendingPfp = dataUrl; window._pendingPfpHash = hash;
    }
    overlay.remove();
    setupPeer(MY_ROOM);
  }}, 'Join');
  box.appendChild(el('h2', {}, 'Join Deck Quest'));
  const wrap = (label, child) => { const w=el('div',{class:'jrow'}); w.appendChild(el('label',{},label)); w.appendChild(child); return w; };
  box.appendChild(wrap('Room code', roomI));
  box.appendChild(wrap('Your name', nameI));
  box.appendChild(wrap('Profile pic (optional)', pfpI));
  box.appendChild(btn);
  if (saved) {   // prefill from the last session so the player can one-click rejoin
    roomI.value = saved.room || '';
    nameI.value = saved.name || '';
    btn.textContent = 'Rejoin';
  }
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// =================== Boot ===================
async function boot() {
  if (window.DEMO) return startDemo();   // offline live-preview — no networking, no assets folder
  // Warn before leaving if the GM has unsaved changes.
  window.addEventListener('beforeunload', e => {
    if (ROLE === 'gm' && _dirty) { e.preventDefault(); e.returnValue = ''; }
  });
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
  const _saved = loadSavedSession();
  if (ROLE === 'gm') {
    if (_saved && _saved.role === 'gm' && _saved.room && (await showGmResumeModal(_saved)) === 'resume') {
      MY_ID = 'gm';
      setupPeer(_saved.room);   // DO still holds the game → sends 'state'; GM adopts (no newState)
    } else {
      await setupAssetsFolder();
      gmSetupFlow();
    }
  } else {
    playerJoinFlow(_saved && _saved.role === 'player' ? _saved : null);
  }
}

// =================== Offline demo mode (GitHub live preview) ===================
// Activated only when window.DEMO is injected. No relay, no assets folder, no IndexedDB —
// the board, tokens and cards are all embedded. Lets visitors try the app fully offline.
let DEMO_CARD_IMAGES = {};
let demoGame = null;   // DEMO: the local authoritative state the engine mutates
function startDemo() {
  DEMO_CARD_IMAGES = window.DEMO.cardImages || {};
  ASSETS = window.DEMO.assets || {};
  setupDiceUI();
  setupToolbarUI();
  setupTableInteraction();
  setupFloatingPanels();
  setupAltPreview();
  setupKeybindHelp();
  demoGame = window.DEMO.state;                 // full authoritative state for both roles
  MY_ID = ROLE === 'gm' ? 'gm' : (window.DEMO.myId || 'player1');
  if (ROLE !== 'gm') MY_NAME = demoGame.hands?.[MY_ID]?.name || 'You';
  projectDemo();
  const cs = $('#connStatus');
  if (cs) { cs.innerHTML = '<span class="net-dot" style="background:#10b981"></span>Demo (offline)'; cs.setAttribute('data-tooltip', 'Live preview — nothing is saved or shared. Fully local.'); }
  const rc = $('#roomCode'); if (rc) rc.textContent = 'DEMO';
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
      for (const pid of Object.keys(STATE.hands)) {
        if (pid === 'gm') continue;
        const pn = STATE.hands[pid].name || pid;
        actions.appendChild(el('button', { class:'mini', title:'To '+pn, onclick: () => { discardSend(deckType, idx, { where:'hand', owner:pid }); panel.remove(); showDiscardPanel(deckType); }}, pn));
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
  sendOp({ type:'discard-send', deck: deckType, idx, to });
}

function setupDiceUI() {
  const row = $('#diceRow'); if (!row) return;
  for (const d of [4,6,8,10,12,20,100]) {
    row.appendChild(el('button', { class:'die-btn', onclick: () => rollAndLog('d'+d) }, 'd'+d));
  }
  const customI = el('input', { type:'text', placeholder:'2d6+3', style:{width:'70px'}});
  // Strip stray whitespace so e.g. ' 1d20 + 6 ' still parses.
  customI.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const spec = customI.value.replace(/\s+/g, '');
      if (spec) { rollAndLog(spec); customI.value=''; }
    }
  });
  row.appendChild(customI);
  // Players can fold a stat modifier (from their own sheet) into a roll. The GM has no sheet.
  if (ROLE === 'player') {
    const sel = el('select', { class:'dice-stat-sel', title:'Add a stat modifier from your sheet' });
    sel.appendChild(el('option', { value:'' }, 'No modifier'));
    for (const k of STAT_KEYS) sel.appendChild(el('option', { value:k }, k.toUpperCase()));
    sel.value = _diceStatKey || '';
    sel.addEventListener('change', () => { _diceStatKey = sel.value || null; });
    row.appendChild(sel);
  }
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
    const raw = await loadAssetAsDataUrl(t.path);
    if (!raw) return;
    const dataUrl = await compressDataUrl(raw, 512, 0.85);   // share a small token, not the full-res file
    const hash = await hashBlob(dataUrl);
    ASSETS[hash] = dataUrl;
    await cacheAssetPut(hash, { kind:'figurine', dataUrl });   // cache so the token survives a GM reload
    if (!activeState()?.assetMeta?.[hash]) sendAsset(hash, dataUrl, 'figurine', undefined, t.path);
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
    if (!window.DEMO) {   // these need the GM's local assets folder — hidden in the offline demo
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
    }
    const zoneBtn = el('button', { class:'tool-btn', 'data-tool':'spawnzone', title:'Set spawn zone for this board', onclick:() => setTool(spawnZoneMode ? 'pointer' : 'spawnzone') });
    zoneBtn.appendChild(icon('zone'));
    zoneBtn.appendChild(el('span', {}, 'Spawn'));
    tb.appendChild(zoneBtn);
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
    // GM-only "Edit locked" toggle — adds body.edit-locked, which restores pointer-events
    // on locked figurines (default OFF) so the GM can re-acquire/unlock a locked map while
    // clicks otherwise fall through locked items to the tokens beneath them.
    const lockBtn = el('button', { class:'tool-btn', title:'Edit locked items (lets you grab locked maps)' });
    lockBtn.appendChild(icon('target'));
    lockBtn.appendChild(el('span', {}, 'Edit locked'));
    lockBtn.addEventListener('click', () => {
      const on = document.body.classList.toggle('edit-locked');
      lockBtn.classList.toggle('active', on);
    });
    tb.appendChild(lockBtn);
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
  if (_dirty && !confirm('Start a new session? Unsaved changes will be lost.')) return;
  // Clear optimistic/queued state so old strokes don't ghost onto the new board and
  // stale queued ops aren't flushed into the new room.
  pendingDrawings.length = 0;
  for (const k in pendingMoves) clearPendingMove(k);
  _pendingOps.length = 0;
  // Player slots are allocated dynamically as players join — no upfront count.
  MY_ID = 'gm';
  STATE = ENGINE.newState(CARD_IDS_BY_TYPE);
  gmViewBoardId = STATE.activeBoardId;
  STATE.table = boardById(STATE.activeBoardId).table;
  renderAllGM();
  setupPeer(STATE.roomCode);   // new roomCode → fresh empty room
  _dirty = false;
};
