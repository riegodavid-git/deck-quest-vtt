/* Deck Quest VTT — authoritative game engine (pure, environment-agnostic).
 *
 * This module is the single source of truth for game logic. It is consumed by:
 *   - the Cloudflare Durable Object (relay-cf/src/index.js)  — the authoritative host
 *   - the browser client (inlined by build.js, ahead of shared.js)  — for DEMO mode
 *
 * RULES for everything in here:
 *   - No DOM, no WebSocket, no localStorage, no rendering. Pure data in → data out.
 *   - `applyOp(state, op, by, ctx)` MUTATES `state` and RETURNS an effects descriptor
 *     ({ rejected?, movePatch?, gmOnly? }). The caller (DO or demo) performs the I/O
 *     (persist + broadcast/fan-out) based on the descriptor.
 *   - The engine is CATALOG-FREE: card instances carry their own `type`, set at draw
 *     time, so we never need the card list to route a discard/return-to-deck.
 *   - IDs (`uid`) and the per-state z-counter live on `state._z`, so the host is the
 *     sole assigner of instId/z values.
 */

// ── Constants ────────────────────────────────────────────────────────────────
export const DECK_TYPES   = ['role', 'skill', 'item', 'location', 'adversary'];
export const DECK_LABELS  = { role: 'Roles', skill: 'Skills', item: 'Items', location: 'Locations', adversary: 'Adversaries' };
export const PLAYER_COLORS = ['#3b82f6','#ef4444','#10b981','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
export const DEFAULT_STATS = { str:20, agi:20, int:20, cha:20, sta:20 };
export const STAT_KEYS = ['str','agi','int','cha','sta'];
export const STAT_BASE = 20, STAT_MAX = 50, STAT_STEP = 5, STAT_BUDGET = 100;
export const DEFAULT_HP    = { current: 20, max: 20 };
export const DEFAULT_ARMOR = { current: 0, max: 10 };
export const ADJ  = ['aqua','crimson','emerald','golden','silver','shadow','radiant','frost','ember','mystic'];
export const NOUN = ['falcon','dragon','wolf','tiger','phoenix','kraken','griffin','viper','raven','lynx'];

// Table-scoped ops act on a board's table (cards/figurines/drawings).
export const TABLE_OPS = new Set(['draw','spawn-card','discard-send','flip-card','move-table-card',
  'lock-table-card','transfer-card','add-figurine','move-figurine','remove-figurine','duplicate-figurine',
  'clear-drawings','clear-my-drawings','undo-drawing','add-drawing','remove-drawing','set-group',
  'set-figurine-vitals','toggle-effect','set-figurine-label']);

// Ops only the GM may issue.
export const GM_ONLY_OPS = new Set(['draw','spawn-card','discard-send','shuffle-deck','lock-table-card',
  'clear-drawings','set-gm-notes','board-add','board-rename','board-duplicate','board-delete','board-activate']);
// Ops that edit a specific owner's sheet — a player may only target their own.
export const OWNER_SCOPED_OPS = new Set(['set-player-field','add-inventory','remove-inventory','set-pfp']);

// ── Helpers ──────────────────────────────────────────────────────────────────
export function uid() { return Math.random().toString(36).slice(2, 10); }
export function shuffle(a) { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
export function statMod(v) { return Math.round(((v == null ? STAT_BASE : v) - STAT_BASE) / STAT_STEP); }
export function fmtMod(m) { return (m >= 0 ? '+' : '') + m; }
export function randomRoom() {
  return ADJ[Math.floor(Math.random()*ADJ.length)] + '-' + NOUN[Math.floor(Math.random()*NOUN.length)] + '-' + Math.floor(Math.random()*100);
}
export function boardById(state, id) { return (state.boards || []).find(b => b.id === id) || state.boards[0]; }
function nextZ(state) { state._z = (state._z || 0) + 1; return state._z; }
function now() { return Date.now(); }
function pushLog(state, who, text, kind = 'info', color) {
  if (!state.log) state.log = [];
  state.log.push({ ts: now(), who, text, kind, color });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

// ── State construction ───────────────────────────────────────────────────────
// `cardsByType` is { role:[id,...], skill:[id,...], ... } supplied by the caller
// (the browser, which owns the catalog). The engine never reads a card catalog.
export function newState(playerCount, cardsByType) {
  const decks = {}; const discards = {};
  for (const t of DECK_TYPES) { decks[t] = shuffle([...(cardsByType?.[t] || [])]); discards[t] = []; }
  const hands = { gm: { name: 'GM', color: '#3b82f6', hand: [] } };
  for (let i=1; i<=playerCount; i++) {
    hands['player'+i] = {
      name: '', pfpHash: null,
      stats: { ...DEFAULT_STATS }, hp: { ...DEFAULT_HP }, armor: { ...DEFAULT_ARMOR },
      info: { class: '', race: '', age: '', weight: '' },
      gold: 0, inventory: [], notes: '', hand: [], connected: false,
      color: PLAYER_COLORS[i-1],
    };
  }
  const mainBoard = { id: uid(), name: 'Main', table: { cards: [], figurines: [], drawings: [] } };
  return {
    roomCode: randomRoom(), playerCount,
    decks, discards,
    boards: [mainBoard], activeBoardId: mainBoard.id,
    hands, assetMeta: {}, log: [], chat: [], gmNotes: '',
    _z: 1,
  };
}

// Structural migration of older/loaded states. `typeOf(cardId)->type` (optional)
// backfills `type` onto card instances created before instances carried it.
export function migrateState(state, typeOf) {
  if (!state || !state.hands) return state;
  if (Array.isArray(state.hands.gm)) state.hands.gm = { name:'GM', color:'#3b82f6', hand: state.hands.gm };
  else if (state.hands.gm && !state.hands.gm.hand) state.hands.gm.hand = [];
  if (!state.chat) state.chat = [];
  if (state.gmNotes === undefined) state.gmNotes = '';
  if (!state.boards) {
    const table = state.table || { cards: [], figurines: [], drawings: [] };
    state.boards = [{ id: uid(), name: 'Main', table }];
  }
  if (!state.activeBoardId) state.activeBoardId = state.boards[0].id;
  delete state.table;            // the live-pointer convenience is browser-only now
  if (state._z == null) normalizeZ(state);
  if (typeOf) {                  // backfill instance.type on any pre-v1 card instances
    const fix = c => { if (c && typeof c === 'object' && c.cardId != null && c.type == null) c.type = typeOf(c.cardId); };
    for (const b of state.boards) for (const c of b.table.cards) fix(c);
    for (const pid of Object.keys(state.hands)) for (const c of (state.hands[pid].hand || [])) fix(c);
  }
  return state;
}

export function normalizeZ(state) {
  if (!state) return;
  let max = 0;
  for (const b of (state.boards || [])) {
    const items = [...b.table.cards, ...b.table.figurines].sort((a,b) => (a.z||0) - (b.z||0));
    let z = 0; for (const obj of items) obj.z = ++z;
    max = Math.max(max, items.length);
  }
  state._z = max;
}

// ── Spawning ─────────────────────────────────────────────────────────────────
// Board center = center of the largest figurine (usually the map), else a default.
function boardCenter(board) {
  let anchor = null, area = -1;
  for (const f of board.table.figurines) { const a = (f.w||0)*(f.h||0); if (a > area) { area = a; anchor = f; } }
  if (anchor) return { x: anchor.x + anchor.w/2, y: anchor.y + anchor.h/2 };
  return { x: 760, y: 480 };
}
export function pickSpawnPoint(board, placed) {
  const size = 80;
  const farEnough = (x, y) => placed.every(p => Math.hypot((x + size/2) - (p.x + p.w/2), (y + size/2) - (p.y + p.h/2)) > size * 0.9);
  const zone = board.spawnZone;
  if (zone && zone.w > size && zone.h > size) {
    for (let i = 0; i < 30; i++) {
      const x = zone.x + Math.random() * (zone.w - size);
      const y = zone.y + Math.random() * (zone.h - size);
      if (farEnough(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: Math.round(zone.x + Math.random() * (zone.w - size)), y: Math.round(zone.y + Math.random() * (zone.h - size)) };
  }
  const c = boardCenter(board);
  for (let i = 0; i < 30; i++) {
    const x = c.x - 120 + Math.random() * 240, y = c.y - 120 + Math.random() * 240;
    if (farEnough(x, y)) return { x: Math.round(x - size/2), y: Math.round(y - size/2) };
  }
  return { x: Math.round(c.x), y: Math.round(c.y) };
}
export function ensureCharacterToken(state, playerId) {
  const board = boardById(state, state.activeBoardId); const tbl = board.table;
  if (tbl.figurines.some(f => f.kind === 'character' && f.playerId === playerId)) return;
  const placed = tbl.figurines.filter(f => f.kind === 'character');
  const pt = pickSpawnPoint(board, placed);
  tbl.figurines.push({
    instId: uid(), kind:'character', playerId, x: pt.x, y: pt.y, w: 80, h: 80,
    rot: 0, z: nextZ(state), opacity: 1, locked: false, flipH:false, flipV:false,
    label: state.hands[playerId]?.name || playerId, effects: {},
  });
}
// Ensure every currently-connected player has a character token on `boardId`.
export function ensureCharactersOnBoard(state, boardId, connected) {
  const board = boardById(state, boardId); const tbl = board.table;
  const placed = tbl.figurines.filter(f => f.kind === 'character');
  for (const pid of (connected || [])) {
    if (pid === 'gm') continue;
    let ch = tbl.figurines.find(f => f.kind === 'character' && f.playerId === pid);
    if (!ch) {
      const pt = pickSpawnPoint(board, placed);
      ch = { instId: uid(), kind:'character', playerId: pid, x: pt.x, y: pt.y, w: 80, h: 80,
        rot: 0, z: nextZ(state), opacity: 1, locked: false, flipH:false, flipV:false,
        label: state.hands[pid]?.name || pid, effects: {} };
      tbl.figurines.push(ch); placed.push(ch);
    }
    ch.z = nextZ(state);
  }
}

// ── Authorization ────────────────────────────────────────────────────────────
// GM may do anything. Players are limited to non-GM ops on shared table objects
// and edits to their OWN sheet/hand.
export function canApply(op, by) {
  if (by === 'gm') return true;
  if (GM_ONLY_OPS.has(op.type)) return false;
  if (OWNER_SCOPED_OPS.has(op.type) && op.owner !== by) return false;
  if (op.type === 'flip-card' && op.where === 'hand' && op.owner !== by) return false;
  if (op.type === 'transfer-card' && op.from?.where === 'hand' && op.from.owner !== by) return false;
  if (op.type === 'transfer-card' && op.to?.where === 'hand' && op.to.owner !== by) return false;
  return true;
}

// Which board a table-scoped op targets: the GM may edit any board it names
// (op.boardId); a player op is always forced onto the live (active) board.
function tableForOp(state, op, by) {
  const id = (by === 'gm' && op.boardId) ? op.boardId : state.activeBoardId;
  return boardById(state, id).table;
}

// ── The op applier ───────────────────────────────────────────────────────────
// Returns: { rejected? } | { movePatch:{...} } | { gmOnly:true } | {}
export function applyOp(state, op, by, ctx = {}) {
  if (!canApply(op, by)) return { rejected: true };

  if (op.type === 'batch') {
    for (const sub of (op.ops || [])) { if (canApply(sub, by)) applyOp(state, sub, by, ctx); }
    return {};
  }

  const tbl = TABLE_OPS.has(op.type) ? tableForOp(state, op, by) : null;

  switch (op.type) {
    case 'draw': {
      const deck = state.decks[op.deck]; if (!deck || !deck.length) return { rejected: true };
      const cardId = deck.shift();
      const target = op.to || 'gm';
      const inst = { instId: uid(), cardId, type: op.deck, faceUp: target === 'gm' || target === by };
      const dest = tableForOp(state, op, by);
      if (target === 'table') dest.cards.push({ ...inst, x: 400, y: 300, rot:0, z:nextZ(state) });
      else state.hands[target].hand.push(inst);
      const targetName = target === 'gm' ? 'GM' : state.hands[target]?.name || target;
      pushLog(state, by==='gm'?'GM':(state.hands[by]?.name||by), `drew ${op.deck} → ${targetName}`, 'sys');
      return {};
    }
    case 'shuffle-deck': { shuffle(state.decks[op.deck] || []); pushLog(state, 'GM', `shuffled ${op.deck}`, 'sys'); return {}; }

    case 'spawn-card': {   // GM: move a specific card out of its deck to a hand or the table
      const deck = state.decks[op.deck]; if (!deck) return { rejected: true };
      const i = deck.indexOf(op.cardId); if (i >= 0) deck.splice(i, 1);
      const inst = { instId: uid(), cardId: op.cardId, type: op.deck, faceUp: op.to === 'gm' || op.to === 'table' };
      if (op.to === 'table') tbl.cards.push({ ...inst, x:400, y:300, rot:0, z:nextZ(state) });
      else if (state.hands[op.to]) state.hands[op.to].hand.push(inst);
      return {};
    }
    case 'discard-send': { // GM: move a card from a discard pile to table/deck/hand
      const pile = state.discards[op.deck]; if (!pile) return { rejected: true };
      const cardId = pile.splice(op.idx, 1)[0]; if (cardId == null) return { rejected: true };
      if (op.to.where === 'table') tbl.cards.push({ instId: uid(), cardId, type: op.deck, faceUp: true, x:400, y:300, rot:0, z:nextZ(state) });
      else if (op.to.where === 'deck') state.decks[op.deck].push(cardId);
      else if (op.to.where === 'hand' && state.hands[op.to.owner]) state.hands[op.to.owner].hand.push({ instId: uid(), cardId, type: op.deck, faceUp: true });
      pushLog(state, 'GM', `moved a ${op.deck} from discard`, 'sys');
      return {};
    }

    case 'flip-card': {
      const c = op.where === 'table' ? tbl.cards.find(c => c.instId === op.instId)
                                     : state.hands[op.owner]?.hand.find(c => c.instId === op.instId);
      if (!c) return { rejected: true };
      if (op.where === 'table' && c.locked) return { rejected: true };
      c.faceUp = !c.faceUp; return {};
    }
    case 'move-table-card': {
      const c = tbl.cards.find(c => c.instId === op.instId); if (!c) return { rejected: true };
      if (c.locked) return { rejected: true };
      c.x = op.x; c.y = op.y; c.z = nextZ(state);
      return { movePatch: { kind:'card', instId:op.instId, x:c.x, y:c.y, z:c.z } };
    }
    case 'lock-table-card': { const c = tbl.cards.find(c => c.instId === op.instId); if (!c) return { rejected: true }; c.locked = !c.locked; return {}; }

    case 'transfer-card': {
      let card = null;
      if (op.from.where === 'table') {
        const i = tbl.cards.findIndex(c => c.instId === op.from.instId); if (i<0) return { rejected: true };
        if (tbl.cards[i].locked && by !== 'gm') return { rejected: true };
        card = tbl.cards.splice(i,1)[0];
      } else {
        const arr = state.hands[op.from.owner]?.hand; if (!arr) return { rejected: true };
        const i = arr.findIndex(c => c.instId === op.from.instId); if (i<0) return { rejected: true };
        card = arr.splice(i,1)[0];
      }
      const type = card.type || op.cardType;
      if (op.to.where === 'discard') { if (type) (state.discards[type] = state.discards[type] || []).push(card.cardId); }
      else if (op.to.where === 'deck') { if (type) (state.decks[type] = state.decks[type] || []).push(card.cardId); }
      else if (op.to.where === 'table') tbl.cards.push({ ...card, x: op.to.x || 400, y: op.to.y || 300, rot: 0, z: nextZ(state) });
      else if (op.to.where === 'hand') state.hands[op.to.owner].hand.push({ instId: card.instId, cardId: card.cardId, type: card.type, faceUp: op.to.faceUp ?? card.faceUp });
      return {};
    }

    case 'set-player-field': {
      const p = state.hands[op.owner]; if (!p) return { rejected: true };
      const parts = op.path.split('.');
      let o = p; for (let i=0;i<parts.length-1;i++) o = o[parts[i]];
      o[parts[parts.length-1]] = op.value; return {};
    }
    case 'set-pfp': { const p = state.hands[op.owner]; if (!p) return { rejected: true }; p.pfpHash = op.hash; ensureCharacterToken(state, op.owner); return {}; }
    case 'add-inventory': { const p = state.hands[op.owner]; if (!p) return { rejected: true }; (p.inventory = p.inventory || []).push({ id: uid(), name: op.name }); return {}; }
    case 'remove-inventory': { const p = state.hands[op.owner]; if (!p) return { rejected: true }; p.inventory = (p.inventory||[]).filter(i => i.id !== op.id); return {}; }

    case 'add-figurine': {
      tbl.figurines.push({ instId: uid(), assetHash: op.hash, x: op.x||300, y: op.y||300, w: op.w||200, h: op.h||200,
        rot: op.rot||0, z: nextZ(state), label: op.label || '',
        opacity: op.opacity!=null?op.opacity:1, flipH: !!op.flipH, flipV: !!op.flipV, showName: !!op.showName });
      return {};
    }
    case 'move-figurine': {
      const f = tbl.figurines.find(f => f.instId === op.instId); if (!f) return { rejected: true };
      if (f.locked) { if (op.locked != null) f.locked = op.locked; return {}; }
      if (op.x != null) f.x = op.x; if (op.y != null) f.y = op.y;
      if (op.w != null) f.w = op.w; if (op.h != null) f.h = op.h;
      if (op.rot != null) f.rot = op.rot;
      if (op.locked != null) f.locked = op.locked;
      if (op.opacity != null) f.opacity = op.opacity;
      if (op.flipH != null) f.flipH = op.flipH;
      if (op.flipV != null) f.flipV = op.flipV;
      if (op.label != null) f.label = op.label;
      if (op.showName != null) f.showName = op.showName;
      if (op.bringToFront) f.z = nextZ(state);
      else if (op.sendToBack) f.z = Math.min(...tbl.figurines.map(g => g.z||1)) - 1;
      const isDrag = op.x != null && op.y != null && op.w == null && op.h == null && op.rot == null &&
        op.locked == null && op.opacity == null && op.flipH == null && op.flipV == null &&
        op.label == null && op.showName == null && !op.bringToFront && !op.sendToBack;
      if (isDrag) return { movePatch: { kind:'figurine', instId:op.instId, x:f.x, y:f.y, z:f.z } };
      return {};
    }
    case 'remove-figurine': { tbl.figurines = tbl.figurines.filter(f => f.instId !== op.instId); return {}; }
    case 'duplicate-figurine': { const f = tbl.figurines.find(f => f.instId === op.instId); if (!f) return { rejected: true }; tbl.figurines.push({ ...f, instId: uid(), x: f.x + 30, y: f.y + 30, z: nextZ(state) }); return {}; }

    case 'clear-drawings': { tbl.drawings = []; pushLog(state, 'GM', 'cleared drawings', 'sys'); return {}; }
    case 'clear-my-drawings': { tbl.drawings = tbl.drawings.filter(d => d.by !== op.by); return {}; }
    case 'undo-drawing': { for (let i=tbl.drawings.length-1;i>=0;i--){ if (tbl.drawings[i].by === op.by){ tbl.drawings.splice(i,1); break; } } return {}; }
    case 'add-drawing': { tbl.drawings.push({ id: uid(), by: op.by, ...op.stroke }); return {}; }
    case 'remove-drawing': { tbl.drawings = tbl.drawings.filter(d => d.id !== op.id); return {}; }

    case 'set-group': {
      const gid = op.groupId || null;
      for (const id of (op.instIds || [])) {
        const f = tbl.figurines.find(x => x.instId === id); if (f) { if (gid) f.groupId = gid; else delete f.groupId; }
        const c = tbl.cards.find(x => x.instId === id);     if (c) { if (gid) c.groupId = gid; else delete c.groupId; }
      }
      return {};
    }
    case 'toggle-effect': { const f = tbl.figurines.find(f => f.instId === op.instId); if (!f || f.locked) return { rejected: true }; f.effects = f.effects || {}; f.effects[op.effect] = !f.effects[op.effect]; return {}; }
    case 'set-figurine-label': { const f = tbl.figurines.find(f => f.instId === op.instId); if (!f || f.locked) return { rejected: true }; f.label = op.label; return {}; }
    case 'set-figurine-vitals': { const f = tbl.figurines.find(x => x.instId === op.instId); if (!f || f.locked) return { rejected: true }; if (op.hp !== undefined) f.hp = op.hp; if (op.armor !== undefined) f.armor = op.armor; return {}; }

    case 'send-chat': {
      if (!state.chat) state.chat = [];
      state.chat.push({ who: op.who, text: op.text, color: op.color || 'var(--text)', ts: op.ts || now() });
      if (state.chat.length > 200) state.chat.splice(0, state.chat.length - 200);
      return {};
    }
    case 'log': { pushLog(state, op.who, op.text, op.kind || 'info', op.color); return {}; }
    case 'set-gm-notes': { state.gmNotes = op.text || ''; return { gmOnly: true }; }

    // ── Board management (GM-only; the GM supplies board ids) ──────────────────
    case 'board-add': { state.boards.push({ id: op.id || uid(), name: op.name || ('Board ' + (state.boards.length + 1)), table: { cards: [], figurines: [], drawings: [] } }); return {}; }
    case 'board-rename': { const b = boardById(state, op.id); if (b && op.name) b.name = op.name; return {}; }
    case 'board-duplicate': {
      const src = boardById(state, op.id);
      const table = JSON.parse(JSON.stringify(src.table));
      for (const f of table.figurines) f.instId = uid();
      for (const c of table.cards) c.instId = uid();
      for (const d of table.drawings) d.id = uid();
      state.boards.push({ id: op.newId || uid(), name: src.name + ' copy', table });
      return {};
    }
    case 'board-delete': {
      if (state.boards.length <= 1 || op.id === state.activeBoardId) return { rejected: true };
      state.boards = state.boards.filter(b => b.id !== op.id); return {};
    }
    case 'board-activate': {
      state.activeBoardId = op.id;
      ensureCharactersOnBoard(state, op.id, ctx.connected);
      pushLog(state, 'GM', 'activated board: ' + boardById(state, op.id).name, 'sys');
      return {};
    }
  }
  return { rejected: true };  // unknown op
}

// ── View projection (what each client receives) ──────────────────────────────
// Players get a filtered view (GM hand hidden, decks→counts, live board only).
// The GM gets the full picture (all boards/hands/decks-counts/gmNotes).
export function viewFor(state, clientId) {
  if (clientId === 'gm') {                 // GM sees everything (full decks, all boards/hands, notes)
    return JSON.parse(JSON.stringify({
      roomCode: state.roomCode, playerCount: state.playerCount,
      decks: state.decks, discards: state.discards,
      boards: state.boards, activeBoardId: state.activeBoardId,
      hands: state.hands, assetMeta: state.assetMeta,
      log: state.log, chat: state.chat || [], gmNotes: state.gmNotes,
    }));
  }
  const decks = Object.fromEntries(Object.entries(state.decks).map(([k,v]) => [k, v.length]));
  const hands = {};
  for (const [pid, p] of Object.entries(state.hands)) { if (pid === 'gm') continue; hands[pid] = p; }
  return JSON.parse(JSON.stringify({
    roomCode: state.roomCode, playerCount: state.playerCount,
    decks, discards: state.discards,
    table: boardById(state, state.activeBoardId).table,
    hands, assetMeta: state.assetMeta,
    log: state.log, chat: state.chat || [],
  }));
}
