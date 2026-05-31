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
function migrateState(state) {
  if (!state || !state.hands) return;
  // Old shape: s.hands.gm = []. New shape: { name, color, hand: [] }.
  if (Array.isArray(state.hands.gm)) {
    state.hands.gm = { name:'GM', color:'#3b82f6', hand: state.hands.gm };
  } else if (state.hands.gm && !state.hands.gm.hand) {
    state.hands.gm.hand = [];
  }
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
    assetMeta: {},   // hash -> { kind, size }
    log: [],
  };
}

function viewFor(playerId) {
  // Strip GM hand; players see other players' face-down cards as just {faceUp:false}.
  const s = STATE;
  const view = JSON.parse(JSON.stringify({
    roomCode: s.roomCode, playerCount: s.playerCount,
    decks: Object.fromEntries(Object.entries(s.decks).map(([k,v])=>[k,v.length])), // counts only
    discards: s.discards,
    table: s.table,
    hands: {},
    assetMeta: s.assetMeta,
    log: s.log,
  }));
  for (const [pid, p] of Object.entries(s.hands)) {
    if (pid === 'gm') continue; // never send GM hand to players
    view.hands[pid] = { ...p };
    // Show card backs only for OTHER players' face-down cards (not your own).
    if (pid !== playerId) {
      view.hands[pid].hand = p.hand.map(c => c.faceUp ? c : { instId: c.instId, cardId: null, faceUp: false });
    }
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

// =================== PeerJS networking ===================
let peer = null;
let connections = {};    // GM: playerId -> DataConnection. Player: { gm: DataConnection }
let cursorThrottle = 0;

function setupPeerGM(roomCode) {
  peer = new Peer(roomCode, { debug: 1 });
  peer.on('open', id => {
    $('#connStatus').textContent = 'Hosting as ' + id;
    $('#roomCode').textContent = id;
  });
  peer.on('error', err => {
    console.error(err);
    $('#connStatus').textContent = 'Peer error: ' + err.type;
    if (err.type === 'unavailable-id') {
      // room code taken — pick a new one
      STATE.roomCode = randomRoom();
      setupPeerGM(STATE.roomCode);
    }
  });
  peer.on('connection', conn => {
    conn.on('open', () => {
      conn.on('data', data => handleFromPlayer(conn, data));
      conn.on('close', () => onPlayerDisconnect(conn));
    });
  });
}

function setupPeerPlayer(roomCode) {
  peer = new Peer({ debug: 1 });
  peer.on('open', () => {
    $('#connStatus').textContent = 'Connecting to ' + roomCode + '...';
    const conn = peer.connect(roomCode, { reliable: true });
    connections.gm = conn;
    conn.on('open', () => {
      $('#connStatus').textContent = 'Connected to ' + roomCode;
      conn.send({ type: 'join', slot: MY_ID, name: MY_NAME, pfpHash: window._pendingPfpHash || null });
      if (window._pendingPfp) {
        // send the pfp asset to GM
        sendAsset(conn, window._pendingPfpHash, window._pendingPfp, 'pfp');
        delete window._pendingPfp;
      }
    });
    conn.on('data', data => handleFromGM(data));
    conn.on('close', () => { $('#connStatus').textContent = 'GM offline'; });
  });
  peer.on('error', err => { $('#connStatus').textContent = 'Peer error: ' + err.type; });
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
    if (ASSETS[hash]) continue;
    cacheAssetGet(hash).then(cached => {
      if (cached) { ASSETS[hash] = cached.dataUrl; rerenderAll(); }
      else { connections.gm?.send({ type:'asset-request', hash }); }
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
    if (!STATE.hands[slot]) return;
    connections[slot] = conn;
    conn._playerId = slot;
    STATE.hands[slot].name = data.name || ('Player ' + slot.slice(6));
    STATE.hands[slot].pfpHash = data.pfpHash || STATE.hands[slot].pfpHash;
    STATE.hands[slot].connected = true;
    logEntry(STATE.hands[slot].name, 'joined', 'sys');
    // send any missing assets to the new player
    conn.send({ type:'state', view: viewFor(slot), myId: slot });
    setTimeout(() => {
      // The player will ask for what they need based on assetMeta.
    }, 50);
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
  if (['asset-begin','asset-chunk','asset-end'].includes(data.type)) return handleAssetMessage(data, connections.gm);
  if (data.type === 'state') {
    LOCAL_VIEW = data.view;
    if (data.myId) MY_ID = data.myId;
    rerenderAll();
    requestMissingAssets(LOCAL_VIEW.assetMeta);
    return;
  }
  if (data.type === 'cursor-update') {
    drawCursor(data.who, data.x, data.y, data.color, data.name, data.pfpHash);
    return;
  }
}

function onPlayerDisconnect(conn) {
  const pid = conn._playerId; if (!pid) return;
  delete connections[pid];
  if (STATE.hands[pid]) { STATE.hands[pid].connected = false; logEntry(STATE.hands[pid].name || pid, 'disconnected', 'sys'); }
  broadcast({ type:'state' });
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
      if (c) c.faceUp = !c.faceUp;
      break;
    }
    case 'move-table-card': {
      const c = s.table.cards.find(c => c.instId === op.instId); if (!c) return;
      c.x = op.x; c.y = op.y; c.z = nextZ();
      break;
    }
    case 'transfer-card': {
      // from {where:'hand'|'table', owner?, instId} → to {where, owner?}
      let card = null;
      if (op.from.where === 'table') {
        const i = s.table.cards.findIndex(c => c.instId === op.from.instId);
        if (i<0) return; card = s.table.cards.splice(i,1)[0];
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
      else if (op.x != null || op.y != null) f.z = nextZ();
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
    case 'undo-drawing': {
      // remove latest drawing by `by`
      for (let i=s.table.drawings.length-1; i>=0; i--) {
        if (s.table.drawings[i].by === op.by) { s.table.drawings.splice(i,1); break; }
      } break;
    }
    case 'remove-drawing': {
      s.table.drawings = s.table.drawings.filter(d => d.id !== op.id);
      break;
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
  if (ROLE === 'gm') renderAllGM();
  else renderAllPlayer();
}
function renderAllGM() {
  renderTopbar(); renderTable(); renderRightRail(); renderLog();
}
function renderAllPlayer() {
  renderTopbarPlayer(); renderTable(); renderRightRailPlayer(); renderLog();
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
    const stack = el('div', { class:'deck-stack', title: `${DECK_LABELS[t]} (${count})` });
    const backCard = CARDS_BY_TYPE[t][0];
    if (count > 0 && backCard) {
      stack.appendChild(el('img', { class:'card-img', src: backCard.back, draggable:'false' }));
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
      const stack = el('div', { class:'deck-stack discard' });
      if (top) stack.appendChild(el('img', { class:'card-img', src: CARDS_BY_ID[top].image }));
      else stack.appendChild(el('div', { class:'card-empty' }, 'Discard'));
      stack.appendChild(el('div', { class:'deck-label' }, `${DECK_LABELS[t]} discard · ${arr.length}`));
      stack.style.cursor = 'pointer';
      stack.addEventListener('click', () => showDiscardPanel(t));
      dc.appendChild(stack);
    }
  }
}

function renderTableCards() {
  const s = activeState();
  const layer = $('#cardLayer'); if (!layer) return;
  layer.innerHTML = '';
  for (const c of s.table.cards) {
    const card = CARDS_BY_ID[c.cardId];
    const div = el('div', { class:'placed-card', style:{ left:c.x+'px', top:c.y+'px', transform:`rotate(${c.rot||0}deg)`, zIndex:c.z||1 } });
    div.appendChild(el('img', { class:'card-img', src: c.faceUp ? card.image : card.back, draggable:'false' }));
    if (ROLE === 'gm') {
      makeDraggable(div, (x,y) => sendOp({ type:'move-table-card', instId:c.instId, x, y }));
      div.addEventListener('contextmenu', e => { e.preventDefault(); showCardContextMenu({ where:'table', instId:c.instId, cardId:c.cardId, faceUp:c.faceUp }, e); });
    }
    layer.appendChild(div);
  }
}

function renderFigurines() {
  const s = activeState();
  const layer = $('#figurineLayer'); if (!layer) return;
  layer.innerHTML = '';
  for (const f of s.table.figurines) {
    const url = ASSETS[f.assetHash];
    const opacity = f.opacity != null ? f.opacity : 1;
    const sx = f.flipH ? -1 : 1, sy = f.flipV ? -1 : 1;
    const tf = `rotate(${f.rot||0}deg) scale(${sx},${sy})`;
    const div = el('div', { class:'figurine' + (f.locked ? ' locked' : ''), style:{ left:f.x+'px', top:f.y+'px', width:f.w+'px', height:f.h+'px', transform:tf, zIndex:f.z||1, opacity } });
    if (url) div.appendChild(el('img', { class:'figurine-img', src:url, draggable:'false' }));
    else div.appendChild(el('div', { class:'figurine-loading' }, 'Loading...'));
    if (f.label) div.appendChild(el('div', { class:'figurine-label' }, f.label));
    if (f.locked) div.appendChild(el('div', { class:'figurine-lock-icon', title:'Locked' }, '🔒'));
    if (ROLE === 'gm' && !f.locked) {
      makeDraggable(div, (x,y) => sendOp({ type:'move-figurine', instId:f.instId, x, y }));
      // resize handle
      const handle = el('div', { class:'figurine-resize' });
      handle.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        const startX = e.clientX, startY = e.clientY, w0 = f.w, h0 = f.h;
        const onMove = ev => {
          const nw = Math.max(40, w0 + (ev.clientX - startX));
          const nh = Math.max(40, h0 + (ev.clientY - startY));
          div.style.width = nw+'px'; div.style.height = nh+'px';
        };
        const onUp = ev => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const nw = parseInt(div.style.width,10), nh = parseInt(div.style.height,10);
          sendOp({ type:'move-figurine', instId:f.instId, w:nw, h:nh });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      div.appendChild(handle);
    }
    if (ROLE === 'gm') {
      div.addEventListener('contextmenu', e => {
        e.preventDefault();
        showFigurineContextMenu(f, e);
      });
    }
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
  const header = el('div', { class:'player-header', style:{ borderColor: p.color || '#3b82f6' }});
  const pfp = el('div', { class:'pfp' });
  if (p.pfpHash && ASSETS[p.pfpHash]) pfp.style.backgroundImage = 'url('+ASSETS[p.pfpHash]+')';
  header.appendChild(pfp);
  header.appendChild(el('div', { class:'player-name' }, p.name || (pid==='gm'?'GM':pid)));
  if (pid !== 'gm' && p.hp && p.armor) {
    const vitals = el('div', { class:'header-vitals' });
    vitals.appendChild(el('span', { class:'mini-hp', title:'HP' }, `♥ ${p.hp.current}/${p.hp.max}`));
    vitals.appendChild(el('span', { class:'mini-armor', title:'Armor' }, `🛡 ${p.armor.current}/${p.armor.max}`));
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
  body.appendChild(field('Name', p.name, editable, v => sendOp({ type:'set-player-field', owner:pid, path:'name', value:v })));
  const infoRow = el('div', { class:'row' });
  for (const k of ['class','race','age','weight']) {
    infoRow.appendChild(field(k[0].toUpperCase()+k.slice(1), p.info[k], editable, v => sendOp({ type:'set-player-field', owner:pid, path:'info.'+k, value:v })));
  }
  body.appendChild(infoRow);
  // HP / Armor
  const vitalRow = el('div', { class:'row' });
  vitalRow.appendChild(vitalBar('HP', p.hp, 'hp', '#ef4444', editable, pid));
  vitalRow.appendChild(vitalBar('Armor', p.armor, 'armor', '#3b82f6', editable, pid));
  body.appendChild(vitalRow);
  // Stats
  const statRow = el('div', { class:'stat-grid' });
  for (const k of ['str','agi','int','cha','sta']) {
    statRow.appendChild(field(k.toUpperCase(), p.stats[k], editable, v => sendOp({ type:'set-player-field', owner:pid, path:'stats.'+k, value:parseInt(v,10)||0 }), 'number'));
  }
  body.appendChild(statRow);
  // Gold
  body.appendChild(field('Gold', p.gold, editable, v => sendOp({ type:'set-player-field', owner:pid, path:'gold', value:parseInt(v,10)||0 }), 'number'));
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
    const input = el('input', { type:'text', placeholder:'Add item...' });
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

function field(label, val, editable, onChange, type='text') {
  const wrap = el('div', { class:'field' });
  wrap.appendChild(el('label', {}, label));
  if (editable) {
    const inp = el('input', { type, value: val==null?'':val });
    inp.addEventListener('change', e => onChange(e.target.value));
    wrap.appendChild(inp);
  } else {
    wrap.appendChild(el('div', { class:'val' }, String(val==null?'':val)));
  }
  return wrap;
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
    const cur = el('input', { type:'number', value:obj.current, style:{width:'50px'}});
    cur.addEventListener('change', e => sendOp({ type:'set-player-field', owner:pid, path:key+'.current', value:parseInt(e.target.value,10)||0 }));
    const max = el('input', { type:'number', value:obj.max, style:{width:'50px'}});
    max.addEventListener('change', e => sendOp({ type:'set-player-field', owner:pid, path:key+'.max', value:parseInt(e.target.value,10)||0 }));
    num.appendChild(cur); num.appendChild(document.createTextNode(' / ')); num.appendChild(max);
  } else {
    num.textContent = obj.current + ' / ' + obj.max;
  }
  wrap.appendChild(num);
  return wrap;
}

function handCardEl(c, owner, editable) {
  const card = c.cardId ? CARDS_BY_ID[c.cardId] : null;
  // Visibility model:
  //   - cardId null   → other player's face-down card; show back only.
  //   - cardId known  → owner sees the face (always); GM sees the face (always).
  //     The faceUp flag controls whether OTHER players see it (handled in viewFor).
  const isOwnerOrGM = ROLE === 'gm' || owner === MY_ID;
  const showFace = !!card && isOwnerOrGM;
  const back = card?.back || CARDS_BY_TYPE.role[0].back;
  const div = el('div', { class:'hand-card' + (c.faceUp ? ' revealed' : ''), title: showFace ? card.name + (c.faceUp ? ' (revealed)' : ' (private)') : '' });
  div.appendChild(el('img', { class:'card-img', src: showFace ? card.image : back }));
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
  const items = [
    { label: info.faceUp ? 'Flip face-down' : 'Flip face-up', action: () => sendOp({ type:'flip-card', where:info.where, owner:info.owner, instId:info.instId }) },
  ];
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
function showFigurineContextMenu(f, e) {
  const items = [
    { label: f.locked ? '🔓 Unlock' : '🔒 Lock', action: () => sendOp({ type:'move-figurine', instId:f.instId, locked: !f.locked }) },
    { label:'Rename / Label...', action: () => {
        const v = prompt('Label (blank to clear):', f.label || '');
        if (v != null) sendOp({ type:'move-figurine', instId:f.instId, label: v });
      } },
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
  ];
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

// =================== Drag helper ===================
function makeDraggable(elm, onEnd) {
  elm.style.cursor = 'move';
  elm.addEventListener('mousedown', e => {
    if (e.target.classList.contains('figurine-resize')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const parent = elm.parentElement.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const x0 = parseInt(elm.style.left, 10) || 0, y0 = parseInt(elm.style.top, 10) || 0;
    let lastX=x0, lastY=y0;
    const onMove = ev => {
      lastX = x0 + (ev.clientX - startX); lastY = y0 + (ev.clientY - startY);
      elm.style.left = lastX+'px'; elm.style.top = lastY+'px';
    };
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onEnd(lastX, lastY);
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
      r.appendChild(el('img', { src:c.image }));
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

function setupTableInteraction() {
  const canvas = $('#drawLayer'); const stage = $('#tableStage');
  if (!stage) return;
  stage.addEventListener('mousemove', e => {
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    // throttle cursor broadcast
    const now = Date.now();
    if (now - cursorThrottle > 60) {
      cursorThrottle = now;
      if (ROLE === 'gm') broadcastCursor('gm', x, y);
      else sendToGM({ type:'cursor', x, y });
    }
    // Only extend the stroke while the left mouse button is still held.
    if (activeStroke && (e.buttons & 1)) {
      activeStroke.points.push([x,y]);
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
      activeStroke = { color: currentColor, width: currentWidth, points: [[e.clientX-r.left, e.clientY-r.top]] };
    } else if (currentTool === 'eraser') {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      eraseAt(e.clientX - r.left, e.clientY - r.top);
    }
  });
  canvas.addEventListener('mousemove', e => {
    // Continuous-erase: while LMB held in eraser mode, erase strokes under the cursor.
    if (currentTool !== 'eraser' || !(e.buttons & 1)) return;
    const r = canvas.getBoundingClientRect();
    eraseAt(e.clientX - r.left, e.clientY - r.top);
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) finishStroke(); });
  window.addEventListener('mouseleave', finishStroke);
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
}

// =================== Asset upload ===================
async function compressImage(file, maxDim, quality) {
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
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);
  return canvas.toDataURL('image/jpeg', quality);
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
  if (!file || ROLE !== 'gm') return;
  const dataUrl = await compressImage(file, 2048, 0.85);
  const hash = await hashBlob(dataUrl);
  ASSETS[hash] = dataUrl;
  await cacheAssetPut(hash, { kind, dataUrl });
  STATE.assetMeta[hash] = { kind, size: dataUrl.length };
  for (const c of Object.values(connections)) sendAsset(c, hash, dataUrl, kind);
  sendOp({ type:'add-figurine', hash, w: kind==='map'?600:120, h: kind==='map'?400:120 });
}

// =================== Setup wizards ===================
function gmSetupFlow() {
  // restore previous session?
  if (tryRestoreLast()) {
    if (confirm('Restore previous session ' + STATE.roomCode + '?')) {
      setupPeerGM(STATE.roomCode);
      renderAllGM();
      return;
    }
  }
  const pc = parseInt(prompt('Number of players (1-10)?', '4'), 10);
  STATE = newState(Math.max(1, Math.min(10, pc || 4)));
  setupPeerGM(STATE.roomCode);
  renderAllGM();
  autosave();
}

function playerJoinFlow() {
  const overlay = el('div', { class:'join-overlay' });
  const box = el('div', { class:'join-box' });
  box.appendChild(el('h2', {}, 'Join Deck Quest'));
  const roomI = el('input', { type:'text', placeholder:'Room code (from GM)' });
  const nameI = el('input', { type:'text', placeholder:'Your name' });
  const slotSel = el('select', {});
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
  // re-hydrate in-memory ASSETS from cache lazily as needed; for now load all known keys
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
  setupAltPreview();
  setupLogToggle();
  if (ROLE === 'gm') gmSetupFlow();
  else playerJoinFlow();
}

// =================== Alt-hover card preview ===================
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

// =================== Log toggle ===================
function setupLogToggle() {
  const overlay = $('#logOverlay'); if (!overlay) return;
  const header = el('div', { id:'logHeader' });
  header.appendChild(el('span', {}, 'Log & Dice'));
  const btn = el('button', { class:'log-toggle', title:'Toggle log' }, '▾');
  header.appendChild(btn);
  overlay.insertBefore(header, overlay.firstChild);
  let collapsed = false;
  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    overlay.classList.toggle('collapsed', collapsed);
    btn.textContent = collapsed ? '▴' : '▾';
  });
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
    item.appendChild(el('img', { class:'card-img', src: card.image, title: card.name }));
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

function setupToolbarUI() {
  const tb = $('#toolbar'); if (!tb) return;
  for (const t of ['pointer','pen','eraser']) {
    tb.appendChild(el('button', { class:'tool-btn'+(t==='pointer'?' active':''), 'data-tool':t, onclick: () => setTool(t) }, t));
  }
  const colorI = el('input', { type:'color', value: currentColor });
  colorI.addEventListener('change', e => currentColor = e.target.value);
  tb.appendChild(colorI);
  if (ROLE === 'gm') {
    tb.appendChild(el('button', { onclick: () => sendOp({ type:'clear-drawings' }) }, 'Clear drawings'));
    const mapBtn = el('label', { class:'tool-btn' }, '+ Add Map');
    const mapI = el('input', { type:'file', accept:'image/*', style:{display:'none'}});
    mapI.addEventListener('change', e => uploadFigurine(e.target.files[0], 'map'));
    mapBtn.appendChild(mapI); tb.appendChild(mapBtn);
    const tokenBtn = el('label', { class:'tool-btn' }, '+ Add Token');
    const tokenI = el('input', { type:'file', accept:'image/*', style:{display:'none'}});
    tokenI.addEventListener('change', e => uploadFigurine(e.target.files[0], 'figurine'));
    tokenBtn.appendChild(tokenI); tb.appendChild(tokenBtn);
    const searchBtn = el('button', { onclick: () => openSearch() }, 'Search cards');
    tb.appendChild(searchBtn);
  } else {
    tb.appendChild(el('button', { onclick: () => sendOp({ type:'undo-drawing', by: MY_ID }) }, 'Undo my last'));
  }
}

window.addEventListener('DOMContentLoaded', boot);

// Save/load wiring (called from buttons in template)
window._saveSession = downloadSession;
window._loadSession = file => loadSessionFile(file);
window._newSession = () => {
  if (!confirm('Start a new session? Current session will be discarded from autosave.')) return;
  const pc = parseInt(prompt('Number of players (1-10)?', String(STATE.playerCount)), 10);
  STATE = newState(Math.max(1, Math.min(10, pc || 4)));
  if (peer) peer.destroy();
  setupPeerGM(STATE.roomCode);
  renderAllGM();
  autosave();
};
