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
  { group:'Tools',                     keys:['Q'],            label:'Hold to ping (laser pointer)', role:'all' },
  { group:'Tools',                     keys:['M'],            label:'Measure / ruler (drag to measure)', role:'all' },
  { group:'Tools',                     keys:['T'],            label:'Token stamper',           role:'gm' },
  { group:'Tools',                     keys:['Space'],        label:'Hold to pan',             role:'all' },
  { group:'Tools',                     keys:['Middle-drag'],  label:'Pan the camera',          role:'all' },
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
  grid:           '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9 L21 9 M3 15 L21 15 M9 3 L9 21 M15 3 L15 21"/></svg>',
  ping:           '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="7"/><path d="M12 2 L12 4 M12 20 L12 22 M2 12 L4 12 M20 12 L22 12"/></svg>',
  ruler:          '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="1" transform="rotate(-45 12 12)"/><path d="M8.5 8.5 L10 10 M11 6 L13 8 M13.5 3.5 L16 6 M6 11 L8 13 M3.5 13.5 L6 16"/></svg>',
  aoe:            '<svg viewBox="0 0 24 24"><path d="M4 4 L20 9 L20 15 L4 20 Z"/><circle cx="4" cy="12" r="1.6" fill="currentColor"/></svg>',
  fog:            '<svg viewBox="0 0 24 24"><path d="M7 18 A4 4 0 0 1 7 10 A5 5 0 0 1 17 9 A4 4 0 0 1 17 18 Z"/><path d="M4 21 L20 21"/></svg>',
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
  updatePingArrows();   // off-screen ping arrows live outside #tableContent — re-aim them on pan/zoom
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
// Normalize a chosen room name to a URL-safe slug: lowercase, letters/digits/dashes,
// collapse runs of other chars to single dashes, strip leading/trailing dashes.
function slugifyRoom(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
// Read a room name from the launch URL: `#room=<name>` (hash, preferred — never hits
// the Worker) or `?room=<name>`. Returns a normalized slug or '' if absent.
function roomFromUrl() {
  try {
    const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const q = new URLSearchParams(location.search || '');
    return slugifyRoom(h.get('room') || q.get('room') || '');
  } catch { return ''; }
}
// Lightweight transient toast (self-styled so it needs no template CSS).
let _toastEl = null, _toastTimer = null;
function toast(msg) {
  if (!_toastEl) {
    _toastEl = el('div', { style: {
      position:'fixed', bottom:'18px', left:'50%', transform:'translateX(-50%)',
      background:'rgba(20,20,24,.95)', color:'#fff', padding:'9px 16px', borderRadius:'8px',
      font:'500 13px/1.3 system-ui, sans-serif', boxShadow:'0 6px 22px rgba(0,0,0,.6)',
      zIndex:2147483647, pointerEvents:'none', maxWidth:'80vw', textAlign:'center', opacity:'0',
      transition:'opacity .15s', border:'1px solid rgba(255,255,255,.12)'
    }});
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { if (_toastEl) _toastEl.style.opacity = '0'; }, 2400);
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
// Pick the table array a move-patch targets by its kind.
function moveArrFor(tbl, kind) {
  return kind === 'card' ? tbl.cards : kind === 'template' ? (tbl.templates || []) : tbl.figurines;
}
function applyMovePatch(p) {
  // GM editing a NON-viewed board: mutate that board's authoritative table object but
  // skip DOM (it isn't on screen). A missing boardId means "the active/visible board".
  if (ROLE === 'gm' && p.boardId && p.boardId !== gmViewBoardId) {
    const b = STATE && STATE.boards.find(x => x.id === p.boardId);
    if (b) {
      const obj = moveArrFor(b.table, p.kind).find(o => o.instId === p.instId);
      if (obj) { obj.x = p.x; obj.y = p.y; if (p.z != null) obj.z = p.z; }
    }
    clearPendingMove(p.instId);
    return;
  }
  // Otherwise the patch targets the visible table (GM viewed board, or the player's
  // only/active board) — mutate it and update the DOM.
  const tbl = tableOf(); if (!tbl) { clearPendingMove(p.instId); return; }
  const obj = moveArrFor(tbl, p.kind).find(o => o.instId === p.instId);
  if (obj) { obj.x = p.x; obj.y = p.y; if (p.z != null) obj.z = p.z; }
  clearPendingMove(p.instId);
  const dom = document.querySelector(`[data-inst-id="${p.instId}"]`);
  if (!dom) return;
  if (p.kind === 'template') {
    // Templates are SVG <g> nodes positioned by a transform (origin + aim), not left/top.
    dom.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${obj ? (obj.rot||0) : 0})`);
  } else {
    dom.style.left = p.x + 'px'; dom.style.top = p.y + 'px'; if (p.z != null) dom.style.zIndex = p.z;
  }
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
    case 'set-template': {
      const t = (tbl.templates || []).find(x => x.instId === p.instId); if (!t) return;
      // Idempotent: set each changed field to the broadcast value (mirror set-figurine-vitals).
      if ('rot'    in p) t.rot    = p.rot;
      if ('size'   in p) t.size   = p.size;
      if ('width'  in p) t.width  = p.width;
      if ('color'  in p) t.color  = p.color;
      if ('locked' in p) t.locked = p.locked;
      if (viewed) renderTemplates();
      return;
    }
    case 'fog-set': {
      // Replace the whole fog object (used by fog-fill). Idempotent — we just adopt
      // the broadcast value. tbl is the board the patch targets (GM: p.boardId; player:
      // their single visible table).
      tbl.fog = p.fog || ENGINE.defaultFog();
      if (viewed) renderFog();
      return;
    }
    case 'fog-add': {
      const shape = p.shape; if (!shape) return;
      tbl.fog = tbl.fog || ENGINE.defaultFog();
      if (tbl.fog.shapes.some(sh => sh.id === shape.id)) return;   // idempotent double-apply guard (by id)
      // Drop the optimistic 'local-fog' placeholder (the actor's instant copy) before
      // adopting the authoritative shape, so a cut never ends up applied twice.
      tbl.fog.shapes = tbl.fog.shapes.filter(sh => sh.id !== 'local-fog');
      tbl.fog.shapes.push(shape);
      if (viewed) renderFog();
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
let pingThrottle = 0;       // gate hold/laser ping streaming to ~60ms like the cursor send
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
    if (ROLE === 'gm') addRecentCampaign(room);   // update quick-rejoin list on every (re)connect
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
    case 'ping-show':
      // Ignore pings meant for a board we aren't currently viewing (mirror applyMovePatch's
      // GM guard). Players only ever see the live/active board, so — like applyMovePatch —
      // they take no board check and just render onto their one visible table.
      if (ROLE === 'gm' && d.boardId && d.boardId !== gmViewBoardId) return;
      showPing(d.x, d.y, d.color, d.name, d.pfpHash);
      return;
    case 'ruler-show':
      // Same board guard as ping: the GM ignores rulers for a board it isn't viewing.
      if (ROLE === 'gm' && d.boardId && d.boardId !== gmViewBoardId) return;
      showRuler(d.who, d.ax, d.ay, d.bx, d.by, d.metric, d.color, d.name);
      return;
    case 'ruler-hide': hideRuler(d.who); return;
    case 'whisper': receiveWhisper(d); return;   // private message — append to local buffer, never to state.chat
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
  // No second socket in the demo: echo a whisper straight into the local buffer (mirrors
  // the host echoing the whisper back to the sender) so the panel doesn't look broken.
  if (res && res.whisper) { receiveWhisper(res.whisper); return; }
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
    const room = MY_ROOM || STATE?.roomCode;   // load INTO the current named room by default so continuity holds
    STATE = ENGINE.migrateState(snap.state, id => CARDS_BY_ID[id]?.type);
    ENGINE.normalizeZ(STATE);
    STATE.roomCode = room || randomRoom();   // keep the stable name; fall back to a fresh room only if none yet
    gmViewBoardId = STATE.activeBoardId;
    STATE.table = boardById(STATE.activeBoardId).table;
    ASSETS = snap.assets || {};
    for (const [hash, dataUrl] of Object.entries(ASSETS)) {
      const meta = STATE.assetMeta?.[hash] || { kind: 'figurine' };
      await cacheAssetPut(hash, { kind: meta.kind, dataUrl });
    }
    // Clear optimistic/queued state so old strokes/ops don't bleed into the loaded table.
    pendingDrawings.length = 0;
    for (const k in pendingMoves) clearPendingMove(k);
    _pendingOps.length = 0;
    renderAllGM();
    // Already connected to the stable room → force the host to overwrite with the loaded state.
    if (!sendToServer({ type:'reset-room', state: STATE })) setupPeer(STATE.roomCode);
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
const _tplNodes  = new Map();   // instId -> <g> (with ._sig, ._locked) — AoE templates

// Toggle the 'selected' class on a single instId's node without a full re-render.
function setSelected(instId, on) {
  const node = _figNodes.get(instId) || _cardNodes.get(instId);
  if (node) node.classList.toggle('selected', on);
}

function renderTable() {
  const s = activeState(); if (!s) return;
  renderDeckStacks();
  renderGrid();
  renderTemplates();
  renderTableCards();
  renderFigurines();
  renderDrawings();
  renderFog();
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
  if (f.aura && f.aura.radius > 0) {
    const a = f.aura;
    const d = a.radius * 2;
    div.appendChild(el('div', { class:'figurine-aura', style:{
      width: d+'px', height: d+'px',
      left: (f.w/2 - a.radius)+'px', top: (f.h/2 - a.radius)+'px',
      background: a.color || '#3b82f6',
      borderRadius: a.shape === 'square' ? '0' : '50%',
      opacity: a.opacity != null ? String(a.opacity) : '0.18',
    }}));
  }
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
function figSig(f, url, isChar, charPlayer, isTurn) {
  const hp    = isChar ? charPlayer?.hp    : f.hp;
  const armor = isChar ? charPlayer?.armor : f.armor;
  return [url || '', f.opacity, f.rot, f.w, f.h, f.flipH, f.flipV,
    JSON.stringify(f.effects || {}), JSON.stringify(hp || null), JSON.stringify(armor || null),
    f.showName, f.label, f.locked, f.hidden, isChar, charPlayer?.name, charPlayer?.color,
    JSON.stringify(f.aura || null), !!isTurn].join('|');
}
// instId of the figurine whose initiative row is currently active (null if none /
// the active row is an ad-hoc combatant). Used to ring the on-turn token.
function activeTurnInstId() {
  const ini = activeState()?.table?.initiative;
  const e = ini && ini.entries ? ini.entries[ini.active] : null;
  return e ? (e.instId || null) : null;
}

function renderFigurines() {
  if (_isDragging) return;
  const s = activeState();
  const layer = $('#figurineLayer'); if (!layer) return;
  const present = new Set();
  const turnInstId = activeTurnInstId();
  for (const f of s.table.figurines) {
    present.add(f.instId);
    const isChar = f.kind === 'character';
    const charPlayer = isChar ? s.hands[f.playerId] : null;
    const ringColor = isChar ? (charPlayer?.color || '#f2ca50') : null;
    const isTurn = !!turnInstId && f.instId === turnInstId;
    const url = figurineUrl(f, isChar, charPlayer);
    const eff = f.effects || {};
    let opacity = f.opacity != null ? f.opacity : 1;
    if (eff.invisible) opacity *= 0.35;
    // GM-only staging: a hidden token never reaches players (filtered in viewFor),
    // but the GM still sees it ghosted (dashed outline via .hidden-gm + reduced opacity).
    const ghosted = ROLE === 'gm' && f.hidden;
    if (ghosted) opacity *= 0.4;
    const sig = figSig(f, url, isChar, charPlayer, isTurn);

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
    div.classList.toggle('hidden-gm', ghosted);
    div.classList.toggle('init-turn', isTurn);
  }
  // Remove nodes whose instId disappeared from the table.
  for (const [instId, node] of _figNodes) {
    if (!present.has(instId)) { node.remove(); _figNodes.delete(instId); }
  }
}

// =================== AoE / spell-area templates (cone, circle, line, cube) ===================
// Free-placed, aimed, translucent area shapes. They live in board.table.templates and
// render in #templateLayer (an SVG world-space layer below the tokens, above the grid).
// Keyed/diffed like renderFigurines: a per-template <g> node, rebuilt only when its
// tplSig() changes, repositioned cheaply every pass.
const SVGNS = 'http://www.w3.org/2000/svg';
const TPL_DEFAULT_PX_PER_CELL = 50;       // px per "cell" when no grid is enabled
const TPL_CONE_SPREAD_DEG = 60;           // cone half-spread total angle (apex angle)
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
}
// One "cell" → px. Grid enabled → its cellSize; otherwise a fixed default.
function tplPxPerCell() {
  const g = currentGrid();
  return (g && g.enabled && g.cellSize) ? Math.max(20, g.cellSize) : TPL_DEFAULT_PX_PER_CELL;
}
// Build the shape primitive at the LOCAL origin (0,0), un-rotated. The parent <g> applies
// translate(x,y) rotate(rot). Origin conventions: cone apex=origin opening toward 0° (+x);
// circle center=origin; line starts at origin going +x; cube top-left corner=origin.
// `size` = primary dimension in cells; `width` = line thickness in cells.
function tplGeometry(shape, sizePx, widthPx) {
  switch (shape) {
    case 'circle':
      return svgEl('circle', { cx: 0, cy: 0, r: sizePx });
    case 'cone': {
      // Isoceles triangle apex at origin, length=sizePx along +x, apex angle TPL_CONE_SPREAD_DEG.
      const half = (TPL_CONE_SPREAD_DEG / 2) * Math.PI / 180;
      const bx = sizePx, by1 = Math.tan(half) * sizePx, by2 = -by1;
      return svgEl('polygon', { points: `0,0 ${bx},${by1.toFixed(2)} ${bx},${by2.toFixed(2)}` });
    }
    case 'line': {
      // Rectangle from origin along +x: length=sizePx, thickness=widthPx (centered on the axis).
      const h = Math.max(2, widthPx);
      return svgEl('rect', { x: 0, y: -h / 2, width: sizePx, height: h });
    }
    case 'cube':
    default:
      // Square, top-left corner at origin, side=sizePx.
      return svgEl('rect', { x: 0, y: 0, width: sizePx, height: sizePx });
  }
}
// Where the size/rotate handles sit in LOCAL coords (before the <g> transform), so the
// size handle tracks the shape's far edge and the rotate handle floats just past it.
function tplHandleAnchors(shape, sizePx) {
  switch (shape) {
    case 'circle': return { size: { x: sizePx, y: 0 }, rotate: { x: sizePx + 18, y: 0 } };
    case 'cube':   return { size: { x: sizePx, y: sizePx }, rotate: { x: sizePx + 18, y: -18 } };
    default:       return { size: { x: sizePx, y: 0 }, rotate: { x: sizePx + 18, y: 0 } };  // cone/line: along +x axis
  }
}
// Cheap signature — rebuild the <g>'s children only when one of these changes.
function tplSig(t, pxPerCell) {
  return [t.shape, t.size, t.width, t.color, t.locked, pxPerCell, ROLE].join('|');
}
function buildTplInner(g, t, pxPerCell) {
  g.replaceChildren();
  const sizePx = Math.max(8, (t.size || 1) * pxPerCell);
  const widthPx = Math.max(1, (t.width || 1)) * pxPerCell;
  const shapeEl = tplGeometry(t.shape, sizePx, widthPx);
  shapeEl.setAttribute('class', 'tpl-shape' + (t.locked ? ' locked' : ''));
  shapeEl.setAttribute('fill', t.color || '#3b82f6');
  shapeEl.setAttribute('stroke', t.color || '#3b82f6');
  // Drag the whole template by its body (unless locked).
  if (!t.locked) makeTemplateDraggable(shapeEl, t.instId);
  shapeEl.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    const live = (activeState()?.table.templates || []).find(x => x.instId === t.instId) || t;
    showTemplateContextMenu(live, e);
  });
  g.appendChild(shapeEl);
  // Size + rotate handles (unlocked only) — mirror the figurine handle pattern.
  if (!t.locked) {
    const anchors = tplHandleAnchors(t.shape, sizePx);
    const sizeH = svgEl('circle', { class:'tpl-handle tpl-size', cx: anchors.size.x, cy: anchors.size.y, r: 6 });
    sizeH.addEventListener('mousedown', e => startTemplateResize(e, t.instId));
    const rotLine = svgEl('line', { class:'tpl-rotate-arm', x1: anchors.size.x, y1: anchors.size.y, x2: anchors.rotate.x, y2: anchors.rotate.y, stroke: t.color || '#3b82f6', 'stroke-opacity':'0.6', 'stroke-width':'1.5' });
    const rotH = svgEl('circle', { class:'tpl-handle tpl-rotate', cx: anchors.rotate.x, cy: anchors.rotate.y, r: 6 });
    rotH.addEventListener('mousedown', e => startTemplateRotate(e, t.instId));
    g.appendChild(rotLine); g.appendChild(sizeH); g.appendChild(rotH);
  }
}
function renderTemplates() {
  if (_isDragging) return;   // suppress full re-render mid-drag (mirror renderFigurines)
  const s = activeState();
  const layer = $('#templateLayer'); if (!layer) return;
  const pxPerCell = tplPxPerCell();
  const present = new Set();
  // SVG stacks by document order (no per-node z-index), so iterate in z order and append
  // in sequence — this is what makes bringToFront/sendToBack actually reorder overlaps.
  const templates = [...((s && s.table && s.table.templates) || [])].sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const t of templates) {
    present.add(t.instId);
    const sig = tplSig(t, pxPerCell);
    let g = _tplNodes.get(t.instId);
    // Lock change rebinds drag/handles → replace the node for fresh closures.
    if (g && g._locked !== !!t.locked) { g.remove(); _tplNodes.delete(t.instId); g = null; }
    if (!g) {
      g = svgEl('g', { 'data-inst-id': t.instId });
      buildTplInner(g, t, pxPerCell);
      g._locked = !!t.locked; g._sig = sig;
      _tplNodes.set(t.instId, g);
    } else if (g._sig !== sig) {
      buildTplInner(g, t, pxPerCell);
      g._sig = sig;
    }
    // Append in z order — moves an existing node to the end if it's already a child.
    layer.appendChild(g);
    // Position / aim — cheap every pass (never touches the children).
    g.setAttribute('transform', `translate(${t.x||0},${t.y||0}) rotate(${t.rot||0})`);
  }
  for (const [instId, node] of _tplNodes) {
    if (!present.has(instId)) { node.remove(); _tplNodes.delete(instId); }
  }
}

// Drag a placed template by its body. Optimistic local move + move-template op (mirror
// makeDraggable's figurine path, but in SVG transform space — no DOM left/top).
function makeTemplateDraggable(shapeEl, instId) {
  shapeEl.addEventListener('mousedown', e => {
    if (e.button !== 0 || spaceHeld || currentTool !== 'pointer') return;
    e.preventDefault(); e.stopPropagation();
    const s = activeState(); if (!s) return;
    const t0 = s.table.templates.find(x => x.instId === instId); if (!t0 || t0.locked) return;
    const startX = e.clientX, startY = e.clientY;
    const x0 = t0.x || 0, y0 = t0.y || 0;
    let lastX = x0, lastY = y0;
    _isDragging = true;
    const g = _tplNodes.get(instId);
    const onMove = ev => {
      lastX = x0 + (ev.clientX - startX) / tableZoom;
      lastY = y0 + (ev.clientY - startY) / tableZoom;
      if (g) g.setAttribute('transform', `translate(${Math.round(lastX)},${Math.round(lastY)}) rotate(${t0.rot||0})`);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      _isDragging = false;
      const nx = Math.round(lastX), ny = Math.round(lastY);
      const live = (activeState()?.table.templates || []).find(x => x.instId === instId);
      if (live) { live.x = nx; live.y = ny; }   // optimistic: keep the new pos until the host echoes
      sendOp({ type:'move-template', instId, x: nx, y: ny });
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  });
}
// Drag the size handle → grow/shrink `size` (in cells). Live-updates the geometry locally,
// commits via update-template on release.
function startTemplateResize(e, instId) {
  e.preventDefault(); e.stopPropagation();
  const s = activeState(); if (!s) return;
  const t = s.table.templates.find(x => x.instId === instId); if (!t || t.locked) return;
  const tc = $('#tableContent'); const cr = tc.getBoundingClientRect();
  const pxPerCell = tplPxPerCell();
  const g = _tplNodes.get(instId);
  let newSize = t.size;
  const onMove = ev => {
    const mx = (ev.clientX - cr.left) / tableZoom, my = (ev.clientY - cr.top) / tableZoom;
    const distPx = Math.hypot(mx - (t.x||0), my - (t.y||0));   // origin→cursor distance
    newSize = Math.max(0.5, Math.round((distPx / pxPerCell) * 2) / 2);   // snap to half-cells
    if (g) buildTplInner(g, { ...t, size: newSize }, pxPerCell);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    if (newSize !== t.size) { t.size = newSize; sendOp({ type:'update-template', instId, size: newSize }); }
  };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}
// Drag the rotate handle → set `rot` (deg). Shift snaps to 15°. Commits via update-template.
function startTemplateRotate(e, instId) {
  e.preventDefault(); e.stopPropagation();
  const s = activeState(); if (!s) return;
  const t = s.table.templates.find(x => x.instId === instId); if (!t || t.locked) return;
  const tc = $('#tableContent'); const cr = tc.getBoundingClientRect();
  const g = _tplNodes.get(instId);
  let newRot = t.rot || 0;
  const onMove = ev => {
    const mx = (ev.clientX - cr.left) / tableZoom, my = (ev.clientY - cr.top) / tableZoom;
    let deg = Math.atan2(my - (t.y||0), mx - (t.x||0)) * 180 / Math.PI;
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    newRot = Math.round(deg);
    if (g) g.setAttribute('transform', `translate(${t.x||0},${t.y||0}) rotate(${newRot})`);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    if (newRot !== (t.rot||0)) { t.rot = newRot; sendOp({ type:'update-template', instId, rot: newRot }); }
  };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}

// Right-click menu for a placed template — mirrors showFigurineContextMenu's pattern.
const TPL_SHAPES = [['cone','▲ Cone'],['circle','● Circle'],['line','▬ Line'],['cube','■ Cube']];
function showTemplateContextMenu(t, e) {
  const items = [];
  items.push({ label: `Template · ${t.shape}`, disabled: true });
  items.push('-');
  items.push({ label: t.locked ? '🔓 Unlock' : '🔒 Lock', action: () => sendOp({ type:'update-template', instId:t.instId, locked: !t.locked }) });
  if (!t.locked) {
    items.push('-');
    items.push({ label:'Rotate +15°', action: () => sendOp({ type:'update-template', instId:t.instId, rot:(t.rot||0)+15 }) });
    items.push({ label:'Rotate +45°', action: () => sendOp({ type:'update-template', instId:t.instId, rot:(t.rot||0)+45 }) });
    items.push({ label:'Rotate exact…', action: () => { const v = prompt('Aim angle (degrees):', String(t.rot||0)); if (v != null) sendOp({ type:'update-template', instId:t.instId, rot: parseFloat(v)||0 }); } });
    items.push({ label:'Resize… (cells)', action: () => { const v = prompt('Size in grid cells:', String(t.size)); if (v != null && !isNaN(parseFloat(v))) sendOp({ type:'update-template', instId:t.instId, size: Math.max(0.5, parseFloat(v)) }); } });
    if (t.shape === 'line') items.push({ label:'Line width… (cells)', action: () => { const v = prompt('Line thickness in cells:', String(t.width||1)); if (v != null && !isNaN(parseFloat(v))) sendOp({ type:'update-template', instId:t.instId, width: Math.max(0.25, parseFloat(v)) }); } });
    items.push({ label:'🎨 Recolor…', action: () => showTemplateColorPicker(t, e.clientX, e.clientY) });
    items.push('-');
    items.push({ label:'Duplicate', action: () => sendOp({ type:'add-template', shape:t.shape, x:(t.x||0)+30, y:(t.y||0)+30, rot:t.rot||0, size:t.size, width:t.width, color:t.color }) });
  }
  items.push('-');
  items.push({ label:'🗑 Delete', action: () => sendOp({ type:'remove-template', instId:t.instId }) });
  if (ROLE === 'gm') items.push({ label:'🗑 Clear all templates', action: () => { if (confirm('Clear ALL templates on this board?')) sendOp({ type:'clear-templates' }); } });
  showMenu(items, e.clientX, e.clientY);
}
// Small color popup reusing the pen-style <input type=color>, committing via update-template.
function showTemplateColorPicker(t, x, y) {
  $$('.ctx-menu').forEach(m => m.remove());
  const popup = el('div', { class:'ctx-menu', style:{ left:x+'px', top:y+'px', padding:'10px' }});
  popup.appendChild(el('div', { style:{ fontSize:'11px', color:'#9bb1c9', marginBottom:'6px' }}, 'Template color'));
  const colorI = el('input', { type:'color', value: t.color || '#3b82f6', style:{ width:'100%', height:'32px', cursor:'pointer' }});
  colorI.addEventListener('change', () => { sendOp({ type:'update-template', instId:t.instId, color: colorI.value }); popup.remove(); });
  popup.appendChild(colorI);
  document.body.appendChild(popup);
  const rect = popup.getBoundingClientRect();
  if (rect.right > window.innerWidth)  popup.style.left = Math.max(0, window.innerWidth  - rect.width  - 4) + 'px';
  if (rect.bottom > window.innerHeight) popup.style.top = Math.max(0, window.innerHeight - rect.height - 4) + 'px';
  const onAway = ev => { if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('mousedown', onAway, true); } };
  document.addEventListener('mousedown', onAway, true);
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

// ---- Fog of war (per-board, GM-authored) ----
// The fog GEOMETRY is vector shapes (not a pixel mask): we fill the whole 4000×3000
// canvas with fog, then replay shapes IN ORDER — a `reveal` carves fog away with
// destination-out compositing, a `hide` paints fog back with source-over. Read the fog
// for the table currently on screen (GM: the previewed board via STATE.table; player:
// their single LOCAL_VIEW.table — both reached through activeState().table, exactly like
// renderDrawings). The canvas opacity is the ONLY per-role difference: GM 0.5 (sees
// through to author), players 1.0 (opaque). NOTE: fog is presentation-layer concealment,
// not secrecy — the geometry reaches the player's client (it must, to render the opaque
// fog), so a player reading the socket could derive the hidden outline. This mirrors
// drawings / face-down cards and is acceptable for a manual-reveal GM tool.
const FOG_COLOR = '#0b0f1a';   // near-opaque dark "unexplored" fog
function paintFogShape(ctx, shape) {
  if (shape.kind === 'rect' && shape.rect) {
    const { x, y, w, h } = shape.rect;
    ctx.fillRect(x, y, w, h);
  } else if (shape.points && shape.points.length) {
    // Brush = a thick stroked polyline along the captured points (round caps/joins so
    // a single click still carves a dot of the brush width).
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = shape.width || 80;
    ctx.beginPath();
    for (let i = 0; i < shape.points.length; i++) {
      const [x, y] = shape.points[i];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (shape.points.length === 1) { const [x, y] = shape.points[0]; ctx.lineTo(x + 0.01, y); }
    ctx.stroke();
  }
}
function renderFog() {
  const s = activeState();
  const canvas = $('#fogLayer'); if (!canvas) return;
  const ctx = syncCanvasSize(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  const fog = s && s.table ? s.table.fog : null;
  const shapes = fog && fog.shapes ? fog.shapes : [];
  if (!fog || (!fog.filled && !shapes.length)) {
    canvas.style.opacity = '0';   // nothing to show
    return;
  }
  // Base fog: cover the whole board if `filled`; otherwise start clear (hide shapes paint in).
  ctx.fillStyle = FOG_COLOR;
  if (fog.filled) ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Replay shapes IN ORDER so cut-then-re-hide composes correctly.
  for (const shape of shapes) {
    if (shape.mode === 'reveal') {
      ctx.globalCompositeOperation = 'destination-out';   // carve fog away
      ctx.strokeStyle = ctx.fillStyle = '#000';
    } else {
      ctx.globalCompositeOperation = 'source-over';       // paint fog back
      ctx.strokeStyle = ctx.fillStyle = FOG_COLOR;
    }
    paintFogShape(ctx, shape);
  }
  ctx.globalCompositeOperation = 'source-over';
  // The single GM-sees-through vs player-opaque switch.
  canvas.style.opacity = ROLE === 'gm' ? '0.5' : '1';
}

// ---- Grid overlay (per-board, GM-authored) ----
// Read the grid config for the table currently on screen: the GM's previewed board
// carries it directly; the player view carries the active board's grid as a sibling
// field (projected in engine viewFor) since the player view has no boards[].
function currentGrid() {
  if (ROLE === 'gm') {
    if (!STATE || !STATE.boards) return null;
    return boardById(gmViewBoardId).grid || null;
  }
  return LOCAL_VIEW ? (LOCAL_VIEW.grid || null) : null;
}
// Repaint the grid onto #gridLayer (world coords, below tokens). Like renderDrawings,
// this runs only on state/patch adoption + config change — the CSS transform on
// #tableContent handles pan/zoom, so we never repaint per frame.
function renderGrid() {
  const canvas = $('#gridLayer'); if (!canvas) return;
  const ctx = syncCanvasSize(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const g = currentGrid();
  if (!g || !g.enabled) return;
  const W = canvas.width, H = canvas.height;
  const cell = Math.max(20, g.cellSize || 50);
  const offX = ((g.offsetX || 0) % cell + cell) % cell;
  const offY = ((g.offsetY || 0) % cell + cell) % cell;
  ctx.save();
  ctx.globalAlpha = g.opacity != null ? g.opacity : 0.25;
  ctx.strokeStyle = g.color || '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash(g.lineStyle === 'dashed' ? [6, 6] : []);
  ctx.beginPath();
  if (g.type === 'hex') {
    // Flat-top hexes on offset rows. Cell size = full hex width (corner-to-corner across).
    const r = cell / 2;                       // circumradius
    const hStep = r * 1.5;                     // horizontal spacing between hex centers
    const vStep = r * Math.sqrt(3);            // vertical spacing between hex centers
    let col = 0;
    for (let cx = offX; cx - r <= W; cx += hStep, col++) {
      const yShift = (col % 2) ? vStep / 2 : 0;   // stagger every other column
      for (let cy = offY + yShift; cy - vStep <= H; cy += vStep) {
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 180 * (60 * i);     // flat-top: first vertex at 0°
          const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
  } else {
    // Square grid — nested moveTo/lineTo across the full extent.
    for (let x = offX; x <= W; x += cell) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = offY; y <= H; y += cell) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  }
  ctx.stroke();
  ctx.restore();
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

// ---- Pings (laser-pointer markers) ----
// Transient, never persisted. Each ping is a fading marker placed in table space
// inside #cursorLayer, plus a live off-screen edge arrow (in a non-transformed
// overlay on #tableStage) that points toward the ping when it's outside the viewport.
const PING_LIFETIME_MS = 1500;
const _livePings = [];   // { x, y, color, el, arrow } — live pings for off-screen-arrow tracking
const PING_ARROW_CAP = 6;   // don't clutter the edge if many pings fire at once
// Place one ping marker (and its off-screen arrow) at table coords x,y.
function showPing(x, y, color, name, pfpHash) {
  const layer = $('#cursorLayer'); if (!layer) return;
  const c = el('div', { class:'ping', style:{ left: x+'px', top: y+'px', color } });
  const dot = el('div', { class:'ping-dot' });
  if (pfpHash && ASSETS[pfpHash]) dot.style.background = `url(${ASSETS[pfpHash]}) center/cover`;
  else dot.style.background = color;
  c.appendChild(dot);
  c.appendChild(el('div', { class:'ping-label', style:{ color } }, name || ''));
  layer.appendChild(c);
  // Off-screen guide arrow lives in a non-transformed overlay attached to #tableStage.
  const arrowLayer = ensurePingArrowLayer();
  const arrow = arrowLayer ? el('div', { class:'ping-arrow', style:{ color } }) : null;
  if (arrow) arrowLayer.appendChild(arrow);
  const entry = { x, y, color, el: c, arrow };
  _livePings.push(entry);
  updatePingArrow(entry);
  // Both the marker and its arrow share the ~1.5s lifetime; remove on the marker's anim end.
  c.addEventListener('animationend', () => {
    const i = _livePings.indexOf(entry); if (i >= 0) _livePings.splice(i, 1);
    c.remove(); if (arrow) arrow.remove();
  });
}
function ensurePingArrowLayer() {
  const stage = $('#tableStage'); if (!stage) return null;
  let layer = $('#pingArrowLayer');
  if (!layer) { layer = el('div', { id:'pingArrowLayer' }); stage.appendChild(layer); }
  return layer;
}
// Position/rotate one ping's edge arrow: project the table point to stage-local screen
// space (inverse of the cursor transform), and if it's outside the stage rect, clamp it
// to the nearest edge and rotate the glyph toward the true point. Hidden when on-screen.
function updatePingArrow(entry) {
  const arrow = entry.arrow; if (!arrow) return;
  const stage = $('#tableStage'); if (!stage) { arrow.style.display = 'none'; return; }
  const r = stage.getBoundingClientRect();
  const sx = entry.x * tableZoom + tablePanX;   // stage-local x (inverse of cursor formula)
  const sy = entry.y * tableZoom + tablePanY;   // stage-local y
  const M = 18;   // keep the arrow this far inside the edge
  const inside = sx >= 0 && sx <= r.width && sy >= 0 && sy <= r.height;
  if (inside) { arrow.style.display = 'none'; return; }
  arrow.style.display = '';
  const cx = r.width / 2, cy = r.height / 2;
  const ang = Math.atan2(sy - cy, sx - cx);     // heading from viewport center to the ping
  const clampedX = Math.max(M, Math.min(r.width  - M, sx));
  const clampedY = Math.max(M, Math.min(r.height - M, sy));
  arrow.style.left = clampedX + 'px';
  arrow.style.top  = clampedY + 'px';
  arrow.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
}
// Re-aim every live ping arrow — call after any pan/zoom so arrows track the camera.
function updatePingArrows() {
  if (!_livePings.length) return;
  const extra = _livePings.length - PING_ARROW_CAP;   // cap visible arrows so the edge doesn't clutter
  for (let i = 0; i < _livePings.length; i++) {
    const entry = _livePings[i];
    if (entry.arrow && extra > 0 && i < extra) { entry.arrow.style.display = 'none'; continue; }
    updatePingArrow(entry);
  }
}
// Drop a ping at the current cursor (table coords). Pure relay — never an op, never
// persisted. In DEMO mode there's no socket, so render it locally so the demo shows it.
function sendPing() {
  const x = lastMouseTableX, y = lastMouseTableY;
  const boardId = ROLE === 'gm' ? gmViewBoardId : (STATE && STATE.activeBoardId);
  if (window.DEMO) { showPing(x, y, MY_COLOR, MY_NAME, window._pendingPfpHash); return; }
  // The relay echoes ping-show to everyone EXCEPT the sender, so render our own ping locally too.
  showPing(x, y, MY_COLOR, MY_NAME, window._pendingPfpHash);
  sendToServer({ type:'ping', x, y, boardId });
}

// ---- Ruler / measure tool ----
// Transient measuring aid: a line A→B with a live distance label at its midpoint,
// rendered in table space inside #cursorLayer (so it inherits pan/zoom). Streamed to
// peers like the cursor/ping — NEVER an op, never persisted, never in the save JSON.
const rulerEls = {};        // who -> { el, line, label } — one rendered ruler per sender
let rulerMetric = 'euclid'; // 'euclid' | 'cheby' | 'manhattan' — selectable distance metric
let _rulerSend = 0;         // throttle gate (~60ms, like cursor/ping)
let _rulerAnchor = null;    // { x, y } local drag start in table coords, while measuring

// Distance between two table-space points under the active metric, formatted for the
// active board's grid: cells (1 decimal, + feet at 5ft/cell) when the grid is enabled,
// otherwise raw pixels. `metric` defaults to the local rulerMetric (sender) but peers
// pass the received metric so the label matches what the measurer chose.
function rulerDistanceLabel(ax, ay, bx, by, metric) {
  const dx = bx - ax, dy = by - ay;
  let px;
  if (metric === 'cheby')          px = Math.max(Math.abs(dx), Math.abs(dy));
  else if (metric === 'manhattan') px = Math.abs(dx) + Math.abs(dy);
  else                             px = Math.hypot(dx, dy);   // euclid (default)
  const g = currentGrid();
  if (g && g.enabled) {
    const cell = Math.max(20, g.cellSize || 50);
    const cells = px / cell;
    return cells.toFixed(1) + ' cells · ' + Math.round(cells * 5) + ' ft';
  }
  return '≈ ' + Math.round(px) + ' px';
}

// Render (or update) the ruler for `who`: a rotated line from A→B plus a midpoint label.
function showRuler(who, ax, ay, bx, by, metric, color, name) {
  const layer = $('#cursorLayer'); if (!layer) return;
  let r = rulerEls[who];
  if (!r) {
    const root  = el('div', { class:'ruler', style:{ color } });
    const line  = el('div', { class:'ruler-line' });
    const label = el('div', { class:'ruler-label', style:{ color } });
    root.appendChild(line); root.appendChild(label);
    layer.appendChild(root);
    r = rulerEls[who] = { el: root, line, label };
  }
  r.el.style.color = color;
  r.label.style.color = color;
  const len = Math.hypot(bx - ax, by - ay);
  const ang = Math.atan2(by - ay, bx - ax);
  // Line: anchored at A, length = |A→B|, rotated toward B (origin at its left edge).
  r.line.style.left   = ax + 'px';
  r.line.style.top    = ay + 'px';
  r.line.style.width  = len + 'px';
  r.line.style.transform = `rotate(${ang}rad)`;
  // Label sits at the midpoint.
  r.label.style.left = ((ax + bx) / 2) + 'px';
  r.label.style.top  = ((ay + by) / 2) + 'px';
  r.label.textContent = rulerDistanceLabel(ax, ay, bx, by, metric);
}

// Remove a sender's ruler (on release / ruler-hide).
function hideRuler(who) {
  const r = rulerEls[who]; if (!r) return;
  r.el.remove(); delete rulerEls[who];
}

// Stream the in-progress ruler to peers (throttled). Pure relay — like sendPing, we
// render our own ruler locally because the relay echoes ruler-show to everyone else.
function sendRuler(ax, ay, bx, by, force) {
  const now = Date.now();
  if (!force && now - _rulerSend < 60) return;
  _rulerSend = now;
  showRuler(MY_ID, ax, ay, bx, by, rulerMetric, MY_COLOR, MY_NAME);
  if (window.DEMO) return;
  const boardId = ROLE === 'gm' ? gmViewBoardId : (STATE && STATE.activeBoardId);
  sendToServer({ type:'ruler', ax, ay, bx, by, metric: rulerMetric, boardId });
}

// Clear our ruler locally and tell peers to drop it. Always safe to call.
function clearRuler() {
  _rulerAnchor = null;
  hideRuler(MY_ID);
  if (!window.DEMO) sendToServer({ type:'ruler-clear' });
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
  // Initiative / turn-order tracker (GM-driven)
  const initPanel = renderInitiative(); if (initPanel) rail.appendChild(initPanel);
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
  // Initiative / turn-order tracker (read-only for players)
  const initPanel = renderInitiative(); if (initPanel) rail.appendChild(initPanel);
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

// ── Initiative / turn-order tracker (right-rail panel) ───────────────────────
// GM-driven (all init-* ops are GM-only). Players see the same panel READ-ONLY.
// Reads from activeState().table.initiative (GM: viewed board's table; player:
// LOCAL_VIEW.table — both projected so the tracker rides the view).
let initiativeOpen = true;
function renderInitiative() {
  const s = activeState(); if (!s || !s.table) return null;
  const ini = s.table.initiative || { active:0, round:1, entries:[] };
  const isGM = ROLE === 'gm';
  const panel = el('details', { id:'initiativePanel' });
  if (initiativeOpen) panel.setAttribute('open', '');
  panel.addEventListener('toggle', () => { initiativeOpen = panel.open; });

  const summary = el('summary', {},
    el('span', { class:'init-title' }, '⚔ Initiative'),
    el('span', { class:'init-round' }, 'Round ' + (ini.round || 1)));
  panel.appendChild(summary);

  const body = el('div', { class:'init-body' });

  // GM turn controls
  if (isGM) {
    const ctrls = el('div', { class:'init-controls' });
    ctrls.appendChild(el('button', { class:'mini', title:'Previous turn', onclick: () => sendOp({ type:'init-prev' }) }, '◀ Prev'));
    ctrls.appendChild(el('button', { class:'mini', title:'Next turn', onclick: () => sendOp({ type:'init-advance' }) }, 'Next ▶'));
    ctrls.appendChild(el('button', { class:'mini', title:'Sort by value (desc)', onclick: () => sendOp({ type:'init-sort' }) }, '⇅ Sort'));
    ctrls.appendChild(el('button', { class:'mini', title:'Clear the tracker', onclick: () => { if (confirm('Clear the initiative tracker?')) sendOp({ type:'init-reset' }); } }, '✕ Reset'));
    body.appendChild(ctrls);
  }

  // Entry list
  const list = el('div', { class:'init-list' });
  if (!ini.entries.length) {
    list.appendChild(el('div', { class:'init-empty' }, isGM ? 'No combatants. Add rows or right-click a token → Add to initiative.' : 'No combatants yet.'));
  }
  ini.entries.forEach((e, i) => {
    const row = el('div', { class:'init-row' + (i === ini.active ? ' active' : '') + (e.dead ? ' dead' : '') });
    // Value: editable number for GM, static badge for players.
    if (isGM) {
      const valI = el('input', { class:'init-val', type:'number', value: String(e.value) });
      valI.addEventListener('change', () => sendOp({ type:'init-set-value', id: e.id, value: parseInt(valI.value, 10) || 0 }));
      row.appendChild(valI);
    } else {
      row.appendChild(el('div', { class:'init-val-static' }, String(e.value)));
    }
    const nameWrap = el('div', { class:'init-name' }, (e.dead ? '💀 ' : '') + (e.name || 'Combatant'));
    if (e.instId) nameWrap.classList.add('linked');
    row.appendChild(nameWrap);
    if (isGM) {
      const actions = el('div', { class:'init-actions' });
      actions.appendChild(el('button', { class:'mini', title: e.dead ? 'Revive' : 'Mark downed', onclick: () => sendOp({ type:'init-toggle-dead', id: e.id }) }, e.dead ? '✚' : '💀'));
      actions.appendChild(el('button', { class:'mini', title:'Remove', onclick: () => sendOp({ type:'init-remove', id: e.id }) }, '×'));
      row.appendChild(actions);
    }
    list.appendChild(row);
  });
  body.appendChild(list);

  // GM: add an ad-hoc combatant row.
  if (isGM) {
    const add = el('button', { class:'init-add-btn', onclick: () => {
      const name = prompt('Combatant name:'); if (name == null || !name.trim()) return;
      const v = prompt('Initiative value:', '0');
      if (v == null) return;
      sendOp({ type:'init-add', name: name.trim(), value: parseInt(v, 10) || 0 });
    } }, '+ Add row');
    body.appendChild(add);
  }

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

// ── Snap-to-grid ──────────────────────────────────────────────────────────────
// Active-board grid config, regardless of role (snapping applies to everyone's drags
// when the board has snap enabled). Mirrors currentGrid()'s GM/player split.
function snapGrid() {
  if (ROLE === 'gm') return (STATE && STATE.boards) ? (boardById(gmViewBoardId).grid || null) : null;
  return LOCAL_VIEW ? (LOCAL_VIEW.grid || null) : null;
}
// Snap a token (top-left x,y of size w,h) so its CENTER lands on the nearest cell/hex
// center, then back-solve the top-left. Returns { x, y } (rounded). Oversized things
// (e.g. a battle map ≥ ~3 cells in BOTH dims) are left free so they don't jitter.
function snapXY(x, y, w, h) {
  const g = snapGrid();
  if (!g || !g.enabled || !g.snap) return { x: Math.round(x), y: Math.round(y) };
  const cell = Math.max(20, g.cellSize || 50);
  if (w >= cell * 3 && h >= cell * 3) return { x: Math.round(x), y: Math.round(y) };  // size-aware: skip maps
  const offX = g.offsetX || 0, offY = g.offsetY || 0;
  const cx = x + w / 2, cy = y + h / 2;          // token center (table coords)
  let sx, sy;                                     // snapped center
  if (g.type === 'hex') {
    // Flat-top hex centers: nearest center via axial rounding on the hex lattice.
    const r = cell / 2;
    const hStep = r * 1.5, vStep = r * Math.sqrt(3);
    const lx = cx - offX, ly = cy - offY;
    const col = Math.round(lx / hStep);            // which staggered column
    const yShift = (((col % 2) + 2) % 2) ? vStep / 2 : 0;
    const row = Math.round((ly - yShift) / vStep);
    sx = offX + col * hStep;
    sy = offY + yShift + row * vStep;
  } else {
    // Square: nearest cell center.
    sx = offX + (Math.round((cx - offX) / cell - 0.5) + 0.5) * cell;
    sy = offY + (Math.round((cy - offY) / cell - 0.5) + 0.5) * cell;
  }
  return { x: Math.round(sx - w / 2), y: Math.round(sy - h / 2) };
}
// Look up a draggable's size by instId (figurine or table card) for snap math.
function sizeOf(instId) {
  const s = activeState(); if (!s) return null;
  const f = s.table.figurines.find(x => x.instId === instId);
  if (f) return { w: f.w, h: f.h };
  const c = s.table.cards.find(x => x.instId === instId);
  if (c) return { w: c.w || 140, h: c.h || 200 };   // table cards have no explicit w/h — use the rendered size
  return null;
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
    // GM-only: drop this token onto the initiative tracker (linked by instId).
    ...(ROLE === 'gm' ? [{
      label:'⚔ Add to initiative', action: () => {
        const s = activeState();
        const nm = f.label || (f.kind === 'character' ? (s?.hands?.[f.playerId]?.name) : '') || 'Combatant';
        const v = prompt('Initiative value for ' + nm + ':', '0');
        if (v == null) return;
        sendOp({ type:'init-add', name: nm, value: parseInt(v, 10) || 0, instId: f.instId });
      },
    }] : []),
    // GM-only on-deck staging: hide a non-character token from players (or reveal it).
    ...((ROLE === 'gm' && f.kind !== 'character') ? [{
      label: f.hidden ? '👁 Reveal to players' : '🚫 Hide from players',
      action: () => sendOp({ type:'set-figurine-hidden', instId: f.instId, hidden: !f.hidden, boardId: gmViewBoardId }),
    }] : []),
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
    { label:'◎ Aura / Range…', action: () => showAuraPopup(f, e.clientX, e.clientY) },
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

function showAuraPopup(f, x, y) {
  $$('.ctx-menu').forEach(m => m.remove());
  $$('.aura-popup').forEach(m => m.remove());
  const cur = f.aura || { radius: 120, color: '#3b82f6', opacity: 0.18, shape: 'circle' };
  const popup = el('div', { class:'ctx-menu aura-popup', style:{ left:x+'px', top:y+'px', padding:'10px', minWidth:'220px' }});

  // Title
  popup.appendChild(el('div', { style:{ fontSize:'11px', color:'#9bb1c9', marginBottom:'8px' }}, 'Aura / Range'));

  // Radius row
  const radRow = el('div', { style:{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px' }});
  radRow.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'0 0 auto' }}, 'Radius'));
  const radVal = el('span', { style:{ fontSize:'11px', minWidth:'32px', textAlign:'right', flex:'0 0 auto' }}, cur.radius + 'px');
  const radSlider = el('input', { type:'range', min:'0', max:'600', value: String(cur.radius), style:{ flex:'1' }});
  radSlider.addEventListener('input', () => { radVal.textContent = radSlider.value + 'px'; });
  radRow.appendChild(radSlider);
  radRow.appendChild(radVal);
  popup.appendChild(radRow);

  // Color row
  const colorRow = el('div', { style:{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px' }});
  colorRow.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'0 0 auto' }}, 'Color'));
  const colorI = el('input', { type:'color', value: cur.color || '#3b82f6',
    style:{ width:'32px', height:'24px', padding:'2px', cursor:'pointer', border:'1px solid var(--line)', borderRadius:'var(--radius)', background:'transparent', flex:'0 0 auto' }});
  colorRow.appendChild(colorI);
  popup.appendChild(colorRow);

  // Opacity row
  const opRow = el('div', { style:{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px' }});
  opRow.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'0 0 auto' }}, 'Fill opacity'));
  const opVal = el('span', { style:{ fontSize:'11px', minWidth:'32px', textAlign:'right', flex:'0 0 auto' }}, Math.round((cur.opacity != null ? cur.opacity : 0.18)*100) + '%');
  const opSlider = el('input', { type:'range', min:'0', max:'60', value: String(Math.round((cur.opacity != null ? cur.opacity : 0.18)*100)), style:{ flex:'1' }});
  opSlider.addEventListener('input', () => { opVal.textContent = opSlider.value + '%'; });
  opRow.appendChild(opSlider);
  opRow.appendChild(opVal);
  popup.appendChild(opRow);

  // Shape toggle
  const shapeRow = el('div', { style:{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'8px' }});
  shapeRow.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'0 0 auto' }}, 'Shape'));
  let curShape = cur.shape || 'circle';
  const shapeBtn = el('button', { style:{ fontSize:'11px', padding:'2px 8px' }}, curShape === 'circle' ? '● Circle' : '■ Square');
  shapeBtn.addEventListener('click', () => {
    curShape = curShape === 'circle' ? 'square' : 'circle';
    shapeBtn.textContent = curShape === 'circle' ? '● Circle' : '■ Square';
  });
  shapeRow.appendChild(shapeBtn);
  popup.appendChild(shapeRow);

  // Buttons row
  const btnRow = el('div', { style:{ display:'flex', gap:'6px' }});

  const applyBtn = el('button', { style:{ flex:'1', fontSize:'11px' }}, 'Apply');
  applyBtn.addEventListener('click', () => {
    const radius = parseInt(radSlider.value, 10);
    const color = colorI.value;
    const opacity = parseInt(opSlider.value, 10) / 100;
    const shape = curShape;
    figEdit(f, () => ({ aura: { radius, color, opacity, shape } }));
    popup.remove();
  });
  btnRow.appendChild(applyBtn);

  const clearBtn = el('button', { style:{ flex:'1', fontSize:'11px' }}, 'Clear');
  clearBtn.addEventListener('click', () => {
    figEdit(f, () => ({ aura: null }));
    popup.remove();
  });
  btnRow.appendChild(clearBtn);

  const closeBtn = el('button', { style:{ flex:'1', fontSize:'11px' }}, 'Close');
  closeBtn.addEventListener('click', () => popup.remove());
  btnRow.appendChild(closeBtn);

  popup.appendChild(btnRow);

  // Position in-viewport
  document.body.appendChild(popup);
  const rect = popup.getBoundingClientRect();
  if (rect.right > window.innerWidth)  popup.style.left = Math.max(0, window.innerWidth  - rect.width  - 4) + 'px';
  if (rect.bottom > window.innerHeight) popup.style.top = Math.max(0, window.innerHeight - rect.height - 4) + 'px';

  // Click-away to close
  const onAway = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', onAway, true); } };
  document.addEventListener('mousedown', onAway, true);
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
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      _isDragging = false;
      // Snap-to-grid on drop. Ctrl bypasses (free placement, à la Owlbear). We snap the
      // dragged anchor's CENTER, then carry the resulting delta to the rest of the group
      // so a formation translates as one piece instead of shearing onto separate cells.
      const noSnap = ev && ev.ctrlKey;
      let endX = lastX, endY = lastY;
      if (!noSnap && instId) {
        const sz = sizeOf(instId);
        if (sz) { const sn = snapXY(lastX, lastY, sz.w, sz.h); endX = sn.x; endY = sn.y; }
      }
      if (groupMembers.length) {
        // Move the whole group in one batch — single broadcast/render.
        const dx = endX - x0, dy = endY - y0;
        const ops = [moveOpFor(instId, endX, endY)];
        if (instId) markOptimisticMove(instId, endX, endY);
        for (const g of groupMembers) {
          const gx = Math.round(g.x0 + dx), gy = Math.round(g.y0 + dy);
          ops.push({ type: g.kind === 'figurine' ? 'move-figurine' : 'move-table-card', instId: g.instId, x: gx, y: gy });
          markOptimisticMove(g.instId, gx, gy);
        }
        sendBatch(ops);
      } else {
        onEnd(endX, endY);
        if (instId) markOptimisticMove(instId, endX, endY);
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
let templateShape = 'circle';   // shape the AoE-template placement tool will drop
// ---- Fog of war authoring state (GM-only) ----
let fogMode = 'cut';            // 'cut' (reveal) | 'hide' (re-cover) — what a fog stroke does
let fogShapeKind = 'brush';     // 'brush' | 'rect' — brush sub-mode of the fog tool
let fogBrushSize = 120;         // brush diameter in table units
let fogStroke = null;           // in-progress brush: { points:[[x,y],...] }
let fogRectAnchor = null;       // in-progress rect: { x, y } (table coords)
const PATH_TO_HASH = {};   // relativePath → hash; lets players look up received card images by path
let _chatUnread = 0;
let _chatPaneActive = false;
let _lastChatCount = 0;
// Client-local buffer of received/echoed whispers. NEVER part of state.chat / the view /
// autosave — whispers are pure targeted relay, so they live only in this module array.
// Each entry: { from, to, text, color, name, ts } (ids are slot ids: 'gm'/'playerN').
let _whispers = [];
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

  // Q = hold-to-ping (laser pointer). Works regardless of the active tool. While held,
  // it streams a ping at the live cursor on a single rAF loop, throttled to ~60ms like
  // the cursor send. Q is otherwise unbound (checked KEYBIND_HELP + all keydown handlers).
  let _pingHeld = false;
  let _pingRAF = null;
  function _pingTick() {
    if (!_pingHeld) { _pingRAF = null; return; }
    const now = Date.now();
    if (now - pingThrottle > 60) { pingThrottle = now; sendPing(); }
    _pingRAF = requestAnimationFrame(_pingTick);
  }
  window.addEventListener('keydown', e => {
    if (e.key !== 'q' && e.key !== 'Q') return;
    if (e.target.matches && e.target.matches('input,textarea,select')) return;   // don't hijack typing
    if (e.ctrlKey || e.metaKey || e.altKey) return;                              // leave Ctrl/Cmd/Alt combos alone
    e.preventDefault();
    if (_pingHeld) return;                          // ignore OS auto-repeat
    _pingHeld = true;
    pingThrottle = 0;                               // fire immediately on press
    if (!_pingRAF) _pingRAF = requestAnimationFrame(_pingTick);
  });
  window.addEventListener('keyup', e => { if (e.key === 'q' || e.key === 'Q') _pingHeld = false; });
  window.addEventListener('blur', () => { _pingHeld = false; });

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

  // Pan start — hold Space + left-drag.
  stage.addEventListener('mousedown', e => {
    if (spaceHeld && e.button === 0) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panOriginX = tablePanX; panOriginY = tablePanY;
      stage.style.cursor = 'grabbing';
    }
  });
  // Middle-mouse-button drag pans anywhere — even over tokens. Capture phase +
  // stopPropagation so it beats token-drag / lasso, and preventDefault kills the
  // browser's middle-click autoscroll.
  stage.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault(); e.stopPropagation();
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panOriginX = tablePanX; panOriginY = tablePanY;
    stage.style.cursor = 'grabbing';
  }, true);

  // Token stamper — capture-phase so a click always stamps (never starts a drag/lasso).
  // Only stamp on the actual table surface, never on toolbar / floating panels
  // (which live inside #tableStage but outside #tableContent).
  stage.addEventListener('mousedown', e => {
    if (!stampMode || e.button !== 0 || spaceHeld) return;
    const onTable = e.target === stage || (e.target.closest && e.target.closest('#tableContent'));
    if (!onTable) return;
    e.preventDefault(); e.stopPropagation();
    stampAt(e.clientX, e.clientY, e.ctrlKey);
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

  // AoE-template placement tool — capture-phase click-drag: down-point = origin, drag
  // distance = size. A live SVG preview tracks the drag; on release we add-template.
  stage.addEventListener('mousedown', e => {
    if (currentTool !== 'template' || e.button !== 0 || spaceHeld) return;
    const onTable = e.target === stage || (e.target.closest && e.target.closest('#tableContent'));
    if (!onTable) return;
    e.preventDefault(); e.stopPropagation();
    const tc = $('#tableContent'); const cr = tc.getBoundingClientRect();
    const ox = (e.clientX - cr.left) / tableZoom, oy = (e.clientY - cr.top) / tableZoom;
    const layer = $('#templateLayer');
    const pxPerCell = tplPxPerCell();
    const preview = svgEl('g', { id:'tplDraft' });
    layer.appendChild(preview);
    let rot = 0, size = 1;
    const update = (mx, my) => {
      const dx = mx - ox, dy = my - oy;
      const distPx = Math.hypot(dx, dy);
      size = Math.max(0.5, Math.round((distPx / pxPerCell) * 2) / 2);
      rot = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
      buildTplInner(preview, { instId:'__draft__', shape: templateShape, size, width:1, color: currentColor, locked:true }, pxPerCell);
      preview.setAttribute('transform', `translate(${Math.round(ox)},${Math.round(oy)}) rotate(${rot})`);
    };
    update(ox, oy);
    const onMove = ev => { update((ev.clientX - cr.left) / tableZoom, (ev.clientY - cr.top) / tableZoom); };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      preview.remove();
      sendOp({ type:'add-template', shape: templateShape, x: Math.round(ox), y: Math.round(oy),
        rot, size, width: 1, color: currentColor });
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
    } else if (currentTool === 'ping') {
      e.preventDefault();
      pingThrottle = Date.now(); sendPing();   // drop one immediately on press
    } else if (currentTool === 'ruler') {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      _rulerAnchor = { x: (e.clientX - r.left) / tableZoom, y: (e.clientY - r.top) / tableZoom };
      _rulerSend = 0;   // fire immediately so a zero-length ruler appears on press
    } else if (currentTool === 'fog' && ROLE === 'gm') {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / tableZoom, y = (e.clientY - r.top) / tableZoom;
      if (fogShapeKind === 'rect') { fogRectAnchor = { x, y }; drawFogPreview(x, y); }
      else { fogStroke = { points: [[x, y]] }; drawFogPreview(); }
    }
  });
  canvas.addEventListener('mousemove', e => {
    // Ruler tool: while LMB held, stream the A→B line, throttled like the cursor send.
    if (currentTool === 'ruler' && _rulerAnchor && (e.buttons & 1)) {
      const r = canvas.getBoundingClientRect();
      const bx = (e.clientX - r.left) / tableZoom, by = (e.clientY - r.top) / tableZoom;
      sendRuler(_rulerAnchor.x, _rulerAnchor.y, bx, by);
      return;
    }
    // Ping tool: while LMB held, stream pings at the cursor, throttled like the cursor send.
    if (currentTool === 'ping' && (e.buttons & 1)) {
      const now = Date.now();
      if (now - pingThrottle > 60) { pingThrottle = now; sendPing(); }
      return;
    }
    // Fog tool: while LMB held, extend the brush polyline or rubber-band the rect; the
    // preview repaints live (the committed cut is sent on release).
    if (currentTool === 'fog' && ROLE === 'gm' && (e.buttons & 1)) {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / tableZoom, y = (e.clientY - r.top) / tableZoom;
      if (fogShapeKind === 'rect' && fogRectAnchor) drawFogPreview(x, y);
      else if (fogStroke) { fogStroke.points.push([x, y]); drawFogPreview(); }
      return;
    }
    // Continuous-erase: while LMB held in eraser mode, erase strokes under the cursor.
    if (currentTool !== 'eraser' || !(e.buttons & 1)) return;
    const r = canvas.getBoundingClientRect();
    eraseAt((e.clientX - r.left) / tableZoom, (e.clientY - r.top) / tableZoom);
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) finishStroke();
    if (e.button === 0) finishFogStroke();   // commit a fog cut/hide on release
    if (e.button === 0 && _rulerAnchor) clearRuler();   // release the ruler → clear locally + tell peers
    if ((e.button === 0 || e.button === 1) && isPanning) {   // end Space-drag or middle-drag pan
      isPanning = false;
      stage.style.cursor = spaceHeld ? 'grab' : '';
    }
  });
  window.addEventListener('blur', () => { finishStroke(); finishFogStroke(); spaceHeld = false; isPanning = false; if (_rulerAnchor) clearRuler(); });

  // Escape = clear selection / exit stamper
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (stampMode || spawnZoneMode || currentTool === 'ping' || currentTool === 'ruler' || currentTool === 'template' || currentTool === 'fog') { setTool('pointer'); return; }
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
    if (k === 'm') return setTool(currentTool === 'ruler' ? 'pointer' : 'ruler');
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

// ---- Fog authoring (GM-only) ----
// Decimate near-duplicate brush points so the stored shape stays small (mirrors the
// drawing system's keep-state-small constraint). Keeps endpoints + samples spaced ≥min.
function decimatePoints(points, min) {
  if (points.length <= 2) return points;
  const out = [points[0]]; const m2 = min * min;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = out[out.length - 1], [x, y] = points[i];
    if ((x - px) * (x - px) + (y - py) * (y - py) >= m2) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}
// Commit the in-progress fog brush/rect as a fog-cut (reveal) or fog-hide op, targeting
// the GM's previewed board. The host echoes a fog-add patch (idempotent by id); we render
// optimistically here for instant feedback.
function finishFogStroke() {
  const type = fogMode === 'hide' ? 'fog-hide' : 'fog-cut';
  const mode = fogMode === 'hide' ? 'hide' : 'reveal';
  let shape = null;
  if (fogShapeKind === 'rect' && fogRectAnchor) {
    const a = fogRectAnchor, b = _fogLast || a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w > 2 && h > 2) shape = { kind:'rect', rect:{ x, y, w, h } };
  } else if (fogStroke && fogStroke.points.length) {
    shape = { kind:'brush', points: decimatePoints(fogStroke.points, 6), width: fogBrushSize };
  }
  fogStroke = null; fogRectAnchor = null; _fogLast = null;
  if (!shape) { renderFog(); return; }   // tiny/empty gesture — just clear any preview
  // Optimistic local render: push onto the viewed board's fog now so the cut shows instantly.
  const tbl = tableOf();
  if (tbl) { (tbl.fog = tbl.fog || ENGINE.defaultFog()).shapes.push({ id: 'local-fog', mode, ...shape }); renderFog(); }
  sendOp({ type, boardId: ROLE === 'gm' ? gmViewBoardId : undefined, shape });
}
// Repaint the fog layer with the in-progress shape overlaid, so the GM sees the cut live.
let _fogLast = null;   // last cursor point for the rect rubber-band
function drawFogPreview(x, y) {
  if (x != null && y != null) _fogLast = { x, y };
  renderFog();   // committed fog first
  const canvas = $('#fogLayer'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  // Author preview is always visible at the GM's 0.5 layer opacity, so force the layer on.
  if (canvas.style.opacity === '0') canvas.style.opacity = ROLE === 'gm' ? '0.5' : '1';
  if (fogMode === 'hide') { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = ctx.fillStyle = FOG_COLOR; }
  else { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = ctx.fillStyle = '#000'; }
  if (fogShapeKind === 'rect' && fogRectAnchor && _fogLast) {
    const a = fogRectAnchor, b = _fogLast;
    paintFogShape(ctx, { kind:'rect', rect:{ x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), w: Math.abs(b.x-a.x), h: Math.abs(b.y-a.y) } });
  } else if (fogStroke) {
    paintFogShape(ctx, { kind:'brush', points: fogStroke.points, width: fogBrushSize });
  }
  ctx.globalCompositeOperation = 'source-over';
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
    // pen/eraser draw; ping captures left-clicks to drop markers; ruler captures a
    // measure drag; fog paints reveal/hide cuts — all of them claim the canvas.
    const grab = (t === 'pen' || t === 'eraser' || t === 'ping' || t === 'ruler' || t === 'fog');
    canvas.style.pointerEvents = grab ? 'auto' : 'none';
    // Raise above cards/figurines while active so clicks aren't swallowed by them.
    canvas.style.zIndex = grab ? '999999' : 'auto';
    canvas.style.cursor = t === 'pen' ? 'crosshair' : t === 'eraser' ? 'cell' : (t === 'ping' || t === 'ruler' || t === 'fog') ? 'crosshair' : 'default';
  }
  if (t !== 'ruler') clearRuler();   // leaving the ruler tool drops any in-progress line
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

async function stampAt(clientX, clientY, noSnap) {
  const tc = $('#tableContent'); if (!tc) return;
  const cr = tc.getBoundingClientRect();
  let x = Math.round((clientX - cr.left) / tableZoom - stampSize / 2);
  let y = Math.round((clientY - cr.top)  / tableZoom - stampSize / 2);
  if (!noSnap) { const sn = snapXY(x, y, stampSize, stampSize); x = sn.x; y = sn.y; }   // snap drop to grid (Ctrl bypasses)
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

async function uploadFigurine(file, kind='figurine', opts={}) {
  if (!file) return;
  // Keep shared images small — they travel over the GM's uplink. PNG keeps token transparency.
  const dataUrl = await compressImage(file, kind === 'map' ? 1280 : 640, kind === 'map' ? 0.72 : 0.9, kind === 'map' ? 'image/jpeg' : 'image/png');
  const hash = await hashBlob(dataUrl);
  ASSETS[hash] = dataUrl;
  await cacheAssetPut(hash, { kind, dataUrl });
  sendAsset(hash, dataUrl, kind);                  // share via host
  const op = { type:'add-figurine', hash, w: kind==='map'?600:120, h: kind==='map'?400:120 };
  if (opts.x != null) op.x = Math.round(opts.x);
  if (opts.y != null) op.y = Math.round(opts.y);
  sendOp(op);
}

// =================== Drop / paste image import ===================

// Show a small glassmorphism picker so the user can choose Map vs Token.
// clientX/clientY: screen position for the popover anchor.
// tableX/tableY: table-space coords for figurine placement.
function showImageImportPicker(file, clientX, clientY, tableX, tableY) {
  // Remove any existing picker.
  document.getElementById('imgImportPicker')?.remove();

  const picker = el('div', { id:'imgImportPicker', class:'img-import-picker' });

  const label = el('div', { class:'img-import-label' }, 'Place as…');
  picker.appendChild(label);

  const btnRow = el('div', { class:'img-import-btns' });

  const mapBtn = el('button', { class:'tool-btn' }, 'Map');
  mapBtn.addEventListener('click', () => {
    picker.remove();
    uploadFigurine(file, 'map', { x: tableX - 300, y: tableY - 200 });
  });
  btnRow.appendChild(mapBtn);

  const tokBtn = el('button', { class:'tool-btn' }, 'Token');
  tokBtn.addEventListener('click', () => {
    picker.remove();
    uploadFigurine(file, 'figurine', { x: tableX - 60, y: tableY - 60 });
  });
  btnRow.appendChild(tokBtn);

  picker.appendChild(btnRow);
  picker.style.left = clientX + 'px';
  picker.style.top  = clientY + 'px';
  document.body.appendChild(picker);

  // Reposition to stay fully in-viewport (same pattern as ctx-menu).
  const r = picker.getBoundingClientRect();
  if (r.bottom > window.innerHeight) picker.style.top  = Math.max(0, clientY - r.height) + 'px';
  if (r.right  > window.innerWidth)  picker.style.left = Math.max(0, clientX - r.width)  + 'px';

  // Dismiss on click-outside or Escape.
  const onDocDown = ev => { if (!picker.contains(ev.target)) dismiss(); };
  const onKey     = ev => { if (ev.key === 'Escape') dismiss(); };
  function dismiss() {
    picker.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

// Convert a clientX/clientY screen point to table-space coords (mirrors stampAt approach).
function clientToTable(clientX, clientY) {
  const tc = $('#tableContent'); if (!tc) return { x:0, y:0 };
  const cr = tc.getBoundingClientRect();
  return { x: (clientX - cr.left) / tableZoom, y: (clientY - cr.top) / tableZoom };
}

// Register drop/paste handlers once the stage element is available.
// Called from within initTable() after #tableStage is in the DOM.
function initImageImport() {
  const stage = $('#tableStage'); if (!stage) return;

  // ── Drop hint overlay (injected into stage, shown during drag-over) ──
  const hint = el('div', { id:'dropImageHint' }, 'Drop image here');
  stage.appendChild(hint);

  // ── dragover on #stage: allow drop + show hint ──
  stage.addEventListener('dragover', e => {
    // Only care about file drags that include an image.
    const hasImage = e.dataTransfer && [...(e.dataTransfer.items || [])].some(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (!hasImage) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    hint.classList.add('active');
  });

  stage.addEventListener('dragleave', e => {
    // Only hide when leaving the stage entirely (not entering a child element).
    if (!stage.contains(e.relatedTarget)) hint.classList.remove('active');
  });

  // ── drop on #stage ──
  stage.addEventListener('drop', e => {
    hint.classList.remove('active');
    e.preventDefault();
    e.stopPropagation();
    const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) { console.warn('[Deck Quest] Drop ignored: no image files.'); return; }
    const tPos = clientToTable(e.clientX, e.clientY);
    showImageImportPicker(files[0], e.clientX, e.clientY, tPos.x, tPos.y);
  });

  // ── Window-level guard: prevent the browser from navigating on an off-stage drop ──
  window.addEventListener('dragover', e => {
    // Always prevent the browser default so it never navigates.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  });
  window.addEventListener('drop', e => {
    // If the drop landed on the stage (handled above), do nothing here.
    if (stage.contains(e.target) || e.target === stage) return;
    e.preventDefault();   // block navigation for off-stage drops
  });

  // ── Paste handler on document ──
  document.addEventListener('paste', e => {
    // Let text inputs / contenteditables handle their own paste.
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

    // Scan for an image blob in the clipboard.
    const items = e.clipboardData ? [...e.clipboardData.items] : [];
    const imgItem = items.find(it => it.type.startsWith('image/'));
    if (!imgItem) return;   // no image — let Ctrl+V figurine paste run normally

    e.preventDefault();
    const blob = imgItem.getAsFile();
    if (!blob) return;

    // Open the picker at the current cursor position in table space.
    // Convert lastMouseTableX/Y (already table coords) back to screen for the popover anchor.
    const tc = $('#tableContent');
    let px = window.innerWidth / 2, py = window.innerHeight / 2;   // fallback: centre of viewport
    if (tc) {
      const cr = tc.getBoundingClientRect();
      px = cr.left + lastMouseTableX * tableZoom;
      py = cr.top  + lastMouseTableY * tableZoom;
    }
    showImageImportPicker(blob, px, py, lastMouseTableX, lastMouseTableY);
  });
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
  // Let the GM name a STABLE room so the group returns to the same persistent table
  // week to week. Connecting to an existing name makes the DO adopt its saved game.
  promptRoomName(STATE.roomCode, room => {
    STATE.roomCode = room;                              // stable name BEFORE the WS connects
    renderAllGM();
    setupPeer(STATE.roomCode);                          // existing name → host sends saved 'state'; new name → 'need-init' → we upload STATE
  });
}

// GM "Name your room" dialog. `suggested` pre-fills a random slug the GM can accept
// or replace; recent campaigns offer one-click rejoin. Calls cb(slug) when confirmed.
function promptRoomName(suggested, cb) {
  const fromUrl = roomFromUrl();
  const overlay = el('div', { class:'join-overlay' });
  const box = el('div', { class:'join-box' });
  box.appendChild(el('h2', {}, 'Name your room'));
  box.appendChild(el('p', { style:{ color:'var(--muted)', fontSize:'13px', margin:'4px 0 12px' } },
    'Pick a stable name so your group returns to the same table next time. Reusing a name restores its saved game.'));
  const roomI = el('input', { type:'text', placeholder:'room-name', value: fromUrl || suggested || '' });
  const wrap = (label, child) => { const w=el('div',{class:'jrow'}); w.appendChild(el('label',{},label)); w.appendChild(child); return w; };
  box.appendChild(wrap('Room name', roomI));
  const hint = el('div', { style:{ font:'500 11px/1 var(--font-mono)', color:'var(--muted)', minHeight:'12px' } }, '');
  box.appendChild(hint);
  const sync = () => { const s = slugifyRoom(roomI.value); hint.textContent = s ? '→ ' + s : 'Enter at least one letter or digit'; };
  roomI.addEventListener('input', sync); sync();
  const go = () => {
    const slug = slugifyRoom(roomI.value) || slugifyRoom(suggested) || randomRoom();
    addRecentCampaign(slug);
    overlay.remove();
    cb(slug);
  };
  const btn = el('button', { class:'primary', onclick: go }, 'Create / Join');
  roomI.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  box.appendChild(btn);
  // Recent campaigns — per-browser quick-rejoin buttons.
  const recents = loadRecentCampaigns();
  if (recents.length) {
    box.appendChild(el('div', { style:{ font:'500 10px/1 var(--font-mono)', color:'var(--parchment)', letterSpacing:'.12em', textTransform:'uppercase', margin:'14px 0 2px' } }, 'Recent campaigns'));
    for (const r of recents) {
      const b = el('button', { style:{ marginTop:'6px', background:'transparent', border:'1px solid var(--line)', textAlign:'left' },
        onclick: () => { roomI.value = r.room; sync(); } }, r.room);
      box.appendChild(b);
    }
  }
  overlay.appendChild(box); document.body.appendChild(overlay);
  setTimeout(() => { roomI.focus(); roomI.select(); }, 0);
}

// ── Recent campaigns (per-browser quick-rejoin list) ──────────────────────────
const RECENTS_KEY = 'deckquest-recent-campaigns';
function loadRecentCampaigns() { try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; } }
function addRecentCampaign(room) {
  if (!room) return;
  try {
    let list = loadRecentCampaigns().filter(r => r.room !== room);
    list.unshift({ room, lastPlayed: Date.now() });
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {}
}

function playerJoinFlow(saved) {
  const urlRoom = roomFromUrl();   // invite link prefills (and lets us hide) the room field
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
  const roomRow = wrap('Room code', roomI);
  box.appendChild(roomRow);
  box.appendChild(wrap('Your name', nameI));
  box.appendChild(wrap('Profile pic (optional)', pfpI));
  box.appendChild(btn);
  if (saved) {   // prefill from the last session so the player can one-click rejoin
    roomI.value = saved.room || '';
    nameI.value = saved.name || '';
    btn.textContent = 'Rejoin';
  }
  if (urlRoom) {   // invite link — prefill the room and hide the field so players only enter name + pfp
    roomI.value = urlRoom;
    roomRow.style.display = 'none';
    box.insertBefore(el('p', { style:{ color:'var(--muted)', fontSize:'13px', margin:'4px 0 8px' } }, `Joining room "${urlRoom}".`), roomRow);
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
  initImageImport();
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
  initImageImport();
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
  const target  = $('#chatTarget');
  const doSend  = () => {
    const text = input?.value?.trim(); if (!text) return;
    const to = target?.value || 'all';
    if (to === 'all') {                                   // public broadcast (unchanged path)
      const who   = (ROLE === 'gm') ? (STATE?.hands?.gm?.name || 'GM') : MY_NAME;
      const color = (ROLE === 'gm') ? (STATE?.hands?.gm?.color || '#f2ca50') : MY_COLOR;
      sendOp({ type:'send-chat', who, text, color, ts: Date.now() });
    } else {                                              // private whisper (targeted relay)
      sendOp({ type:'whisper', to, text, ts: Date.now() });
    }
    if (input) input.value = '';
  };
  if (input)   input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
  if (sendBtn) sendBtn.addEventListener('click', doSend);
}

// Rebuild the whisper target selector from the live roster: 'All' (public) plus every
// OTHER connected participant. The GM sees connected players; a player sees GM + other
// connected players. Options are keyed by SLOT ID (value), labelled by name.
function renderChatTarget() {
  const sel = $('#chatTarget'); if (!sel) return;
  const s = activeState(); const hands = s?.hands || {};
  const prev = sel.value;
  const opts = [{ id: 'all', label: 'All' }];
  if (ROLE !== 'gm') {                                    // players can whisper the GM
    const gm = hands.gm;
    if (!gm || gm.connected !== false) opts.push({ id: 'gm', label: (gm?.name || 'GM') });
  }
  for (const [id, p] of Object.entries(hands)) {         // other connected players
    if (id === 'gm' || id === ROLE) continue;
    if (p.connected === false) continue;
    opts.push({ id, label: p.name || id });
  }
  sel.innerHTML = '';
  for (const o of opts) sel.appendChild(el('option', { value: o.id }, o.label));
  // Preserve the prior selection if its target is still present, else fall back to 'All'.
  sel.value = opts.some(o => o.id === prev) ? prev : 'all';
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

// GM-only Grid Controls popover. Reads the previewed board's current grid, lets the GM
// tune the overlay + snap, and fires a `set-board-grid` op (targeting gmViewBoardId) on
// every change. Players have no controls — they just render whatever the active board carries.
function openGridControls(anchor) {
  if (ROLE !== 'gm') return;
  $$('.grid-popup').forEach(m => m.remove());
  $$('.ctx-menu').forEach(m => m.remove());
  const base = (ENGINE.defaultGrid ? ENGINE.defaultGrid() : { enabled:false, type:'square', cellSize:50, color:'#ffffff', opacity:0.25, lineStyle:'solid', snap:false, offsetX:0, offsetY:0 });
  const g = { ...base, ...(boardById(gmViewBoardId).grid || {}) };
  const send = () => sendOp({ type:'set-board-grid', boardId: gmViewBoardId, grid: { ...g } });

  const popup = el('div', { class:'ctx-menu grid-popup', style:{ padding:'12px', minWidth:'230px' }});
  popup.appendChild(el('div', { style:{ fontSize:'12px', fontWeight:'600', color:'#9bb1c9', marginBottom:'10px' }}, 'Grid — this board'));
  const row = (label, child) => { const r = el('div', { style:{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}); r.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'1' }}, label)); r.appendChild(child); return r; };

  // Enabled
  const enabledI = el('input', { type:'checkbox' }); enabledI.checked = !!g.enabled;
  enabledI.addEventListener('change', () => { g.enabled = enabledI.checked; send(); });
  popup.appendChild(row('Show grid', enabledI));

  // Type (square / hex)
  const typeSel = el('select', { style:{ fontSize:'11px' }});
  typeSel.appendChild(el('option', { value:'square' }, 'Square'));
  typeSel.appendChild(el('option', { value:'hex' }, 'Hex'));
  typeSel.value = g.type === 'hex' ? 'hex' : 'square';
  typeSel.addEventListener('change', () => { g.type = typeSel.value; send(); });
  popup.appendChild(row('Type', typeSel));

  // Cell size (min 20)
  const cellI = el('input', { type:'number', min:'20', max:'600', step:'5', value: String(g.cellSize), style:{ width:'64px', fontSize:'11px' }});
  cellI.addEventListener('change', () => { g.cellSize = Math.max(20, parseInt(cellI.value, 10) || 50); cellI.value = String(g.cellSize); send(); });
  popup.appendChild(row('Cell size', cellI));

  // Color (reuse the pen color-picker pattern)
  const colorI = el('input', { type:'color', value: g.color || '#ffffff',
    style:{ width:'32px', height:'24px', padding:'2px', cursor:'pointer', border:'1px solid var(--line)', borderRadius:'var(--radius)', background:'transparent' }});
  colorI.addEventListener('change', () => { g.color = colorI.value; send(); });
  popup.appendChild(row('Color', colorI));

  // Opacity (reuse the figurine-opacity slider pattern)
  const opVal = el('span', { style:{ fontSize:'11px', minWidth:'32px', textAlign:'right' }}, Math.round((g.opacity != null ? g.opacity : 0.25)*100) + '%');
  const opSlider = el('input', { type:'range', min:'5', max:'100', value: String(Math.round((g.opacity != null ? g.opacity : 0.25)*100)), style:{ flex:'1' }});
  opSlider.addEventListener('input', () => { opVal.textContent = opSlider.value + '%'; });
  opSlider.addEventListener('change', () => { g.opacity = parseInt(opSlider.value, 10)/100; send(); });
  const opRow = el('div', { style:{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }});
  opRow.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'0 0 auto' }}, 'Opacity'));
  opRow.appendChild(opSlider); opRow.appendChild(opVal);
  popup.appendChild(opRow);

  // Line style
  const styleSel = el('select', { style:{ fontSize:'11px' }});
  styleSel.appendChild(el('option', { value:'solid' }, 'Solid'));
  styleSel.appendChild(el('option', { value:'dashed' }, 'Dashed'));
  styleSel.value = g.lineStyle === 'dashed' ? 'dashed' : 'solid';
  styleSel.addEventListener('change', () => { g.lineStyle = styleSel.value; send(); });
  popup.appendChild(row('Line style', styleSel));

  // Snap
  const snapI = el('input', { type:'checkbox' }); snapI.checked = !!g.snap;
  snapI.addEventListener('change', () => { g.snap = snapI.checked; send(); });
  popup.appendChild(row('Snap on drop', snapI));
  popup.appendChild(el('div', { style:{ fontSize:'10px', color:'var(--muted)', marginTop:'2px' }}, 'Hold Ctrl while dragging for free placement.'));

  const closeBtn = el('button', { style:{ marginTop:'8px', width:'100%', fontSize:'11px' }, onclick:() => { popup.remove(); document.removeEventListener('mousedown', onAway, true); }}, 'Close');
  popup.appendChild(closeBtn);

  // Position above/near the toolbar button, kept in-viewport.
  document.body.appendChild(popup);
  const ar = anchor ? anchor.getBoundingClientRect() : { left: 100, top: 100, bottom: 120 };
  let left = ar.left, top = ar.bottom + 6;
  const pr = popup.getBoundingClientRect();
  if (top + pr.height > window.innerHeight) top = Math.max(4, ar.top - pr.height - 6);
  if (left + pr.width > window.innerWidth) left = Math.max(4, window.innerWidth - pr.width - 4);
  popup.style.left = left + 'px'; popup.style.top = top + 'px';

  const onAway = e => { if (!popup.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', onAway, true); } };
  document.addEventListener('mousedown', onAway, true);
}

// Fog-of-war controls popup (GM-only). Picks the paint mode (Cut/Hide), shape
// (brush/rect) and brush size, plus the one-click Fill/Undo/Clear ops. Targets the GM's
// previewed board (gmViewBoardId). Mirrors openGridControls' popup style.
function openFogControls(anchor) {
  if (ROLE !== 'gm') return;
  $$('.fog-popup').forEach(m => m.remove());
  $$('.grid-popup').forEach(m => m.remove());
  $$('.ctx-menu').forEach(m => m.remove());
  const popup = el('div', { class:'ctx-menu fog-popup', style:{ padding:'12px', minWidth:'230px' }});
  popup.appendChild(el('div', { style:{ fontSize:'12px', fontWeight:'600', color:'#9bb1c9', marginBottom:'10px' }}, 'Fog of war — this board'));
  const row = (label, child) => { const r = el('div', { style:{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}); r.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'1' }}, label)); r.appendChild(child); return r; };

  // Mode: Cut (reveal) vs Hide (re-cover). A segmented pair of buttons.
  const modeWrap = el('div', { style:{ display:'flex', gap:'6px' }});
  const cutBtn  = el('button', { style:{ flex:'1', fontSize:'11px' }}, 'Cut');
  const hideBtn = el('button', { style:{ flex:'1', fontSize:'11px' }}, 'Hide');
  const syncMode = () => { cutBtn.classList.toggle('active', fogMode === 'cut'); hideBtn.classList.toggle('active', fogMode === 'hide'); };
  cutBtn.addEventListener('click',  () => { fogMode = 'cut';  syncMode(); setTool('fog'); });
  hideBtn.addEventListener('click', () => { fogMode = 'hide'; syncMode(); setTool('fog'); });
  modeWrap.appendChild(cutBtn); modeWrap.appendChild(hideBtn); syncMode();
  popup.appendChild(row('Paint', modeWrap));

  // Shape: brush vs rect.
  const shapeSel = el('select', { style:{ fontSize:'11px' }});
  shapeSel.appendChild(el('option', { value:'brush' }, 'Brush'));
  shapeSel.appendChild(el('option', { value:'rect' }, 'Rectangle'));
  shapeSel.value = fogShapeKind;
  shapeSel.addEventListener('change', () => { fogShapeKind = shapeSel.value; setTool('fog'); });
  popup.appendChild(row('Shape', shapeSel));

  // Brush size slider.
  const sizeVal = el('span', { style:{ fontSize:'11px', minWidth:'40px', textAlign:'right' }}, String(fogBrushSize));
  const sizeSlider = el('input', { type:'range', min:'20', max:'400', step:'10', value: String(fogBrushSize), style:{ flex:'1' }});
  sizeSlider.addEventListener('input',  () => { sizeVal.textContent = sizeSlider.value; });
  sizeSlider.addEventListener('change', () => { fogBrushSize = parseInt(sizeSlider.value, 10) || 120; });
  const sizeRow = el('div', { style:{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }});
  sizeRow.appendChild(el('span', { style:{ fontSize:'11px', color:'var(--text)', flex:'0 0 auto' }}, 'Brush size'));
  sizeRow.appendChild(sizeSlider); sizeRow.appendChild(sizeVal);
  popup.appendChild(sizeRow);

  // Action buttons: Fill / Undo / Clear (all target the previewed board).
  const actWrap = el('div', { style:{ display:'flex', gap:'6px', marginTop:'4px' }});
  const fillBtn  = el('button', { style:{ flex:'1', fontSize:'11px' }, title:'Cover the whole board with fog' }, 'Fill');
  const undoBtn  = el('button', { style:{ flex:'1', fontSize:'11px' }, title:'Undo the last cut/hide' }, 'Undo');
  const clearBtn = el('button', { style:{ flex:'1', fontSize:'11px' }, title:'Remove all fog' }, 'Clear');
  fillBtn.addEventListener('click',  () => sendOp({ type:'fog-fill',  boardId: gmViewBoardId }));
  undoBtn.addEventListener('click',  () => sendOp({ type:'fog-undo',  boardId: gmViewBoardId }));
  clearBtn.addEventListener('click', () => sendOp({ type:'fog-clear', boardId: gmViewBoardId }));
  actWrap.appendChild(fillBtn); actWrap.appendChild(undoBtn); actWrap.appendChild(clearBtn);
  popup.appendChild(actWrap);
  popup.appendChild(el('div', { style:{ fontSize:'10px', color:'var(--muted)', marginTop:'8px' }}, 'Fill, then Cut to reveal as the party explores. You see fog at 50%; players see it opaque.'));

  const closeBtn = el('button', { style:{ marginTop:'8px', width:'100%', fontSize:'11px' }, onclick:() => { popup.remove(); document.removeEventListener('mousedown', onAway, true); }}, 'Close');
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  const ar = anchor ? anchor.getBoundingClientRect() : { left: 100, top: 100, bottom: 120 };
  let left = ar.left, top = ar.bottom + 6;
  const pr = popup.getBoundingClientRect();
  if (top + pr.height > window.innerHeight) top = Math.max(4, ar.top - pr.height - 6);
  if (left + pr.width > window.innerWidth) left = Math.max(4, window.innerWidth - pr.width - 4);
  popup.style.left = left + 'px'; popup.style.top = top + 'px';

  const onAway = e => { if (!popup.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', onAway, true); } };
  document.addEventListener('mousedown', onAway, true);
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
  // Ping (laser pointer) — everyone may ping (open-control model). Click/drag to drop
  // markers; or hold Q anywhere for a quick ping without switching tools.
  const pingBtn = el('button', { class:'tool-btn', 'data-tool':'ping', title:'Ping / laser pointer — click the table to ping (or hold Q)', onclick:() => setTool(currentTool === 'ping' ? 'pointer' : 'ping') });
  pingBtn.appendChild(icon('ping'));
  tb.appendChild(pingBtn);
  // Ruler / measure (M) — everyone may measure (open-control). Drag on the table to draw
  // an A→B line with a live distance label; right-click cycles the metric. Pure relay.
  const METRIC_NAME = { euclid:'Euclidean', cheby:'Chebyshev', manhattan:'Manhattan' };
  const rulerBtn = el('button', { class:'tool-btn', 'data-tool':'ruler', title:'Measure / ruler (M) — drag to measure · right-click to change metric', onclick:() => setTool(currentTool === 'ruler' ? 'pointer' : 'ruler') });
  rulerBtn.appendChild(icon('ruler'));
  rulerBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    const order = ['euclid','cheby','manhattan'];
    rulerMetric = order[(order.indexOf(rulerMetric) + 1) % order.length];
    rulerBtn.title = 'Measure / ruler (M) — ' + METRIC_NAME[rulerMetric] + ' · drag to measure · right-click to change metric';
  });
  tb.appendChild(rulerBtn);
  // AoE / spell-area templates (cone, circle, line, cube) — everyone may place (open-control).
  // The button activates the placement tool; right-click cycles the shape it drops. The
  // shape also shows in the title so the current pick is visible.
  const aoeBtn = el('button', { class:'tool-btn', 'data-tool':'template', onclick:() => setTool(currentTool === 'template' ? 'pointer' : 'template') });
  aoeBtn.appendChild(icon('aoe'));
  const _aoeTitle = () => 'AoE template — ' + (TPL_SHAPES.find(([k]) => k === templateShape)?.[1] || templateShape) + ' · click-drag to place · right-click to change shape';
  aoeBtn.title = _aoeTitle();
  aoeBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    // Cycle shape, or pop a picker — a small menu is clearer than blind cycling.
    showMenu(TPL_SHAPES.map(([k, label]) => ({
      label: (templateShape === k ? '✓ ' : '  ') + label,
      action: () => { templateShape = k; aoeBtn.title = _aoeTitle(); setTool('template'); },
    })), e.clientX, e.clientY);
  });
  tb.appendChild(aoeBtn);
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
    const gridBtn = el('button', { class:'tool-btn', title:'Grid overlay & snap-to-grid for this board' });
    gridBtn.appendChild(icon('grid'));
    gridBtn.appendChild(el('span', {}, 'Grid'));
    gridBtn.addEventListener('click', () => openGridControls(gridBtn));
    tb.appendChild(gridBtn);
    // Fog of war (GM-only authoring). The button opens the fog controls popup AND arms the
    // fog paint tool; the popup picks Cut/Hide, brush/rect, brush size, and Fill/Undo/Clear.
    const fogBtn = el('button', { class:'tool-btn', 'data-tool':'fog', title:'Fog of war — hide the board from players, then reveal as they explore' });
    fogBtn.appendChild(icon('fog'));
    fogBtn.appendChild(el('span', {}, 'Fog'));
    fogBtn.addEventListener('click', () => { setTool('fog'); openFogControls(fogBtn); });
    tb.appendChild(fogBtn);
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


// Resolve a slot id ('gm' / 'playerN') to a display name via the live roster. Whisper
// identity is keyed by slot id (never by ambiguous display name) — we only map id→name
// at render time. Falls back to 'GM'/the raw id if the roster lacks the slot.
function whisperName(id) {
  if (id === 'gm') return (activeState()?.hands?.gm?.name) || 'GM';
  return (activeState()?.hands?.[id]?.name) || id;
}

// A whisper arrived from the host (delivered to recipient, echoed to sender, copied to GM).
// Append to the local buffer and re-render. The server echoes our own outgoing whispers,
// so we never optimistically add — this one path populates the panel for both directions.
function receiveWhisper(d) {
  _whispers.push({ from: d.from, to: d.to, text: d.text, color: d.color, name: d.name, ts: d.ts || Date.now() });
  if (_whispers.length > 200) _whispers.splice(0, _whispers.length - 200);
  if (!_chatPaneActive) { _chatUnread += 1; _updateChatBadge(); }
  renderChatPanel();
}

function renderChatPanel() {
  const s = activeState(); if (!s) return;
  renderChatTarget();   // keep the whisper target selector in sync with the live roster
  const container = $('#chatMessages'); if (!container) return;
  const msgs = s.chat || [];
  if (!_chatPaneActive && msgs.length > _lastChatCount) {
    _chatUnread += msgs.length - _lastChatCount;
    _updateChatBadge();
  }
  _lastChatCount = msgs.length;
  const myWho = (ROLE === 'gm') ? (s.hands?.gm?.name || 'GM') : MY_NAME;
  container.innerHTML = '';
  // Merge public messages and private whispers into one timeline, ordered by ts. Public
  // entries are tagged kind:'chat', whispers kind:'whisper' (slot-id identity preserved).
  const items = [
    ...msgs.map(m => ({ kind: 'chat', ts: m.ts || 0, msg: m })),
    ..._whispers.map(w => ({ kind: 'whisper', ts: w.ts || 0, w })),
  ].sort((a, b) => (a.ts - b.ts));
  for (const it of items) {
    if (it.kind === 'chat') {
      const msg = it.msg;
      const isMe = msg.who === myWho;
      const row = el('div', { class: 'chat-msg' + (isMe ? ' chat-msg-me' : '') });
      const who = el('span', { class: 'chat-msg-who', style: { color: msg.color || 'var(--accent)' } }, msg.who + ': ');
      const text = el('span', { class: 'chat-msg-text' }, msg.text);
      row.appendChild(who);
      row.appendChild(text);
      container.appendChild(row);
    } else {
      // Whisper: attribution is by slot id (from/to), NOT display name. We are the sender
      // when from===ROLE; otherwise we received it (or are the GM seeing a copy).
      const w = it.w;
      const outgoing = w.from === ROLE;
      const tag = outgoing
        ? '(whisper to ' + whisperName(w.to) + ')'
        : (w.to === ROLE
            ? '(whisper from ' + whisperName(w.from) + ')'
            : '(whisper ' + whisperName(w.from) + ' → ' + whisperName(w.to) + ')');  // GM moderation copy
      const row = el('div', { class: 'chat-msg chat-whisper' + (outgoing ? ' chat-msg-me' : '') });
      const who = el('span', { class: 'chat-msg-who chat-whisper-tag' }, tag + ' ');
      const text = el('span', { class: 'chat-msg-text' }, w.text);
      row.appendChild(who);
      row.appendChild(text);
      container.appendChild(row);
    }
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

// Copy a shareable invite for the current room. Over http(s) we build a player-page
// link with a #room=<name> hash (never hits the Worker as a path); otherwise we copy
// the room name with a short instruction (file:// players open their own player.html).
window._copyInvite = async () => {
  const room = MY_ROOM || STATE?.roomCode;
  if (!room) return;
  let text;
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    text = location.origin + location.pathname.replace('gm', 'player') + '#room=' + room;
  } else {
    text = `Room: ${room} — open player.html and enter this room code.`;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Invite copied');
  } catch {
    // Clipboard API unavailable (e.g. insecure context) — fall back to a prompt the GM can copy from.
    try { window.prompt('Copy this invite:', text); } catch { toast(text); }
  }
};

// Save/load wiring (called from buttons in template)
window._saveSession = downloadSession;
window._loadSession = file => loadSessionFile(file);
window._newSession = () => {
  if (!confirm("Start a new session? This clears the current room's table for everyone.")) return;
  // Clear optimistic/queued state so old strokes don't ghost onto the new board and
  // stale queued ops aren't flushed into the new room.
  pendingDrawings.length = 0;
  for (const k in pendingMoves) clearPendingMove(k);
  _pendingOps.length = 0;
  // Player slots are allocated dynamically as players join — no upfront count.
  MY_ID = 'gm';
  const room = MY_ROOM || STATE?.roomCode;   // KEEP the same room name so continuity holds
  STATE = ENGINE.newState(CARD_IDS_BY_TYPE);
  STATE.roomCode = room;       // newState() minted a random roomCode — override back to the stable name
  gmViewBoardId = STATE.activeBoardId;
  STATE.table = boardById(STATE.activeBoardId).table;
  renderAllGM();
  // Same persistent DO already holds last session's state → force a re-seed instead of reconnecting.
  if (!sendToServer({ type:'reset-room', state: STATE })) setupPeer(STATE.roomCode);
  _dirty = false;
};
