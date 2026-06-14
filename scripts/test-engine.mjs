#!/usr/bin/env node
// Unit test for engine.mjs — pure game logic, run with: node scripts/test-engine.mjs
import { newState, applyOp, viewFor, migrateState, ensureSlot, canApply } from '../engine.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
// Active-board table for a full state OR a GM view (both carry boards[]+activeBoardId).
const boardById_test = (st) => st.boards.find(b => b.id === st.activeBoardId).table;

const CATALOG = { role:['r1','r2'], skill:['s1','s2','s3'], item:['i1','i2'], location:['l1'], adversary:['a1','a2'] };

// ── newState: GM only, zero players ─────────────────────────────────────────
let s = newState(CATALOG);
ok(s.hands.gm && !s.hands.player1 && s.playerCount === 0, 'newState: gm only, zero players');
eq(s.decks.role.length, 2, 'newState: role deck size');
eq(s.activeBoardId, s.boards[0].id, 'newState: active board = main');

// ── dynamic slot allocation via ensureSlot ──────────────────────────────────
const id1 = ensureSlot(s, null, 'Aria');
const id2 = ensureSlot(s, null, 'Bryn');
const id3 = ensureSlot(s, null, 'Cael');
eq(id1, 'player1', 'ensureSlot: first allocates player1');
eq(id2, 'player2', 'ensureSlot: second allocates player2');
eq(id3, 'player3', 'ensureSlot: third allocates player3');
ok(s.hands.player3 && s.playerCount === 3, 'ensureSlot: player3 exists, playerCount 3');
eq(s.hands.player1.stats.str, 20, 'ensureSlot: baseline stat 20');
eq(s.hands.player1.name, 'Aria', 'ensureSlot: name carried onto hand');
ok(s.hands.player1.connected === true, 'ensureSlot: marks connected');
// character token created unconditionally (no pfp) on the active board
ok(s.boards[0].table.figurines.some(f => f.kind === 'character' && f.playerId === 'player1'),
   'ensureSlot: character token created (placeholder, no pfp)');
eq(s.boards[0].table.figurines.filter(f => f.kind === 'character').length, 3, 'ensureSlot: 3 character tokens');

// ensureSlot reuse — returning player keeps slot, updates name, no new slot
const reuse = ensureSlot(s, 'player2', 'NewName');
eq(reuse, 'player2', 'ensureSlot reuse: returns same slot');
ok(!s.hands.player4 && s.playerCount === 3, 'ensureSlot reuse: no new slot allocated');
eq(s.hands.player2.name, 'NewName', 'ensureSlot reuse: name updated');

// ── draw (GM-only) ──────────────────────────────────────────────────────────
let r = applyOp(s, { type:'draw', deck:'role', to:'player1' }, 'gm');
ok(!r.rejected, 'draw: GM allowed');
eq(s.decks.role.length, 1, 'draw: deck shrank');
eq(s.hands.player1.hand.length, 1, 'draw: card in player1 hand');
eq(s.hands.player1.hand[0].type, 'role', 'draw: instance carries type');
eq(s.hands.player1.hand[0].faceUp, false, 'draw: GM deals to a player face-down (player flips to reveal)');

r = applyOp(s, { type:'draw', deck:'role', to:'gm' }, 'player1');
ok(r.rejected, 'draw: player rejected (GM-only)');
eq(s.decks.role.length, 1, 'draw: deck unchanged after rejected draw');

// draw to a non-existent slot rejected, deck untouched
r = applyOp(s, { type:'draw', deck:'skill', to:'player9' }, 'gm');
ok(r.rejected, 'draw: non-existent slot rejected');
eq(s.decks.skill.length, 3, 'draw: deck unchanged after rejected slot draw');

// ── transfer-card: hand → discard (type routing, catalog-free) ──────────────
const instId = s.hands.player1.hand[0].instId;
r = applyOp(s, { type:'transfer-card', from:{ where:'hand', owner:'player1', instId }, to:{ where:'discard' } }, 'player1');
ok(!r.rejected, 'transfer: own hand → discard allowed');
eq(s.hands.player1.hand.length, 0, 'transfer: card left hand');
eq(s.discards.role.length, 1, 'transfer: cardId in role discard (routed by instance.type)');

// player cannot transfer from ANOTHER player's hand
applyOp(s, { type:'draw', deck:'skill', to:'player2' }, 'gm');
const p2card = s.hands.player2.hand[0].instId;
r = applyOp(s, { type:'transfer-card', from:{ where:'hand', owner:'player2', instId:p2card }, to:{ where:'discard' } }, 'player1');
ok(r.rejected, 'transfer: player1 cannot touch player2 hand');

// ── figurines: add + drag returns a movePatch (with boardId) ────────────────
applyOp(s, { type:'add-figurine', hash:'h1', x:100, y:100 }, 'player1');
const figId = s.boards[0].table.figurines.find(f => f.assetHash === 'h1').instId;
r = applyOp(s, { type:'move-figurine', instId:figId, x:250, y:260 }, 'player1');
ok(r.movePatch && r.movePatch.x === 250 && r.movePatch.y === 260, 'move-figurine drag: returns movePatch');
eq(r.movePatch.boardId, s.activeBoardId, 'move-figurine drag: movePatch carries active boardId');
eq(s.boards[0].table.figurines.find(f => f.instId === figId).x, 250, 'move-figurine: x updated');
// resize is NOT a drag → no movePatch
r = applyOp(s, { type:'move-figurine', instId:figId, w:300, h:300 }, 'player1');
ok(!r.movePatch, 'move-figurine resize: no movePatch (full broadcast)');

// GM move with op.boardId targets that board; movePatch.boardId matches
applyOp(s, { type:'board-add', id:'boardZ', name:'Zone' }, 'gm');
applyOp(s, { type:'add-figurine', hash:'hz', x:10, y:10, boardId:'boardZ' }, 'gm');
const zFig = s.boards.find(b => b.id === 'boardZ').table.figurines[0].instId;
r = applyOp(s, { type:'move-figurine', instId:zFig, x:55, y:66, boardId:'boardZ' }, 'gm');
ok(r.movePatch && r.movePatch.boardId === 'boardZ', 'move-figurine: GM op.boardId targets that board in movePatch');

// locked figurine ignores edits except unlock
applyOp(s, { type:'move-figurine', instId:figId, locked:true }, 'gm');
applyOp(s, { type:'move-figurine', instId:figId, x:999, y:999 }, 'player1');
ok(s.boards[0].table.figurines.find(f => f.instId === figId).x !== 999, 'locked figurine: drag ignored');

// ── targeted patch returns (decision 7) ─────────────────────────────────────
applyOp(s, { type:'add-figurine', hash:'hp1', x:400, y:400 }, 'gm');
const pFig = s.boards[0].table.figurines.find(f => f.assetHash === 'hp1').instId;
r = applyOp(s, { type:'set-figurine-label', instId:pFig, label:'Goblin' }, 'gm');
ok(r.patch && r.patch.kind === 'set-figurine-label' && r.patch.label === 'Goblin', 'patch: set-figurine-label returns patch');
eq(r.patch.boardId, s.activeBoardId, 'patch: set-figurine-label carries active boardId');
r = applyOp(s, { type:'set-figurine-vitals', instId:pFig, hp:{ current:5, max:10 } }, 'gm');
ok(r.patch && r.patch.kind === 'set-figurine-vitals' && r.patch.hp && r.patch.armor === undefined, 'patch: set-figurine-vitals only-changed fields');
r = applyOp(s, { type:'toggle-effect', instId:pFig, effect:'poison' }, 'gm');
ok(r.patch && r.patch.kind === 'toggle-effect' && r.patch.value === true, 'patch: toggle-effect returns patch with value');
r = applyOp(s, { type:'add-drawing', by:'gm', stroke:{ pts:[[1,2]], color:'#fff' } }, 'gm');
ok(r.patch && r.patch.kind === 'add-drawing' && r.patch.drawing && r.patch.drawing.id, 'patch: add-drawing returns drawing with id');

// flip-card: table card returns a patch, hand card returns {} (no patch)
applyOp(s, { type:'draw', deck:'item', to:'table' }, 'gm');
const tCard = s.boards[0].table.cards[0].instId;
r = applyOp(s, { type:'flip-card', where:'table', instId:tCard }, 'gm');
ok(r.patch && r.patch.kind === 'flip-card' && r.patch.where === 'table', 'patch: table flip-card returns patch');
applyOp(s, { type:'draw', deck:'item', to:'gm' }, 'gm');
const hCard = s.hands.gm.hand[0].instId;
r = applyOp(s, { type:'flip-card', where:'hand', owner:'gm', instId:hCard }, 'gm');
ok(!r.patch && !r.rejected, 'patch: hand flip-card returns no patch (full broadcast)');

// ── sheet ownership + allow-list ────────────────────────────────────────────
r = applyOp(s, { type:'set-player-field', owner:'player1', path:'stats.str', value:35 }, 'player1');
ok(!r.rejected && s.hands.player1.stats.str === 35, 'set-player-field: own sheet ok');
r = applyOp(s, { type:'set-player-field', owner:'player2', path:'gold', value:999 }, 'player1');
ok(r.rejected, 'set-player-field: cannot edit another player');
r = applyOp(s, { type:'set-player-field', owner:'player2', path:'gold', value:999 }, 'gm');
ok(!r.rejected && s.hands.player2.gold === 999, 'set-player-field: GM can edit anyone');
// allow-list: an unknown path is rejected
r = applyOp(s, { type:'set-player-field', owner:'player1', path:'hacked.x', value:1 }, 'gm');
ok(r.rejected, 'set-player-field: disallowed path rejected');
// intermediate must exist
r = applyOp(s, { type:'set-player-field', owner:'player1', path:'stats.nope.deep', value:1 }, 'gm');
ok(r.rejected, 'set-player-field: missing intermediate rejected');

// ── discard-send guards ─────────────────────────────────────────────────────
r = applyOp(s, { type:'discard-send', deck:'role', idx:99, to:{ where:'table' } }, 'gm');
ok(r.rejected, 'discard-send: idx out of range rejected');
r = applyOp(s, { type:'discard-send', deck:'role', idx:-1, to:{ where:'table' } }, 'gm');
ok(r.rejected, 'discard-send: negative idx rejected');
r = applyOp(s, { type:'discard-send', deck:'role', idx:0, to:{ where:'table' } }, 'gm');
ok(!r.rejected, 'discard-send: valid idx accepted');

// ── set-group skips locked items ────────────────────────────────────────────
applyOp(s, { type:'add-figurine', hash:'glock', x:1, y:1 }, 'gm');
const lockFig = s.boards[0].table.figurines.find(f => f.assetHash === 'glock').instId;
applyOp(s, { type:'move-figurine', instId:lockFig, locked:true }, 'gm');
applyOp(s, { type:'set-group', groupId:'g1', instIds:[lockFig] }, 'gm');
ok(s.boards[0].table.figurines.find(f => f.instId === lockFig).groupId === undefined, 'set-group: locked figurine skipped');

// ── boards ──────────────────────────────────────────────────────────────────
applyOp(s, { type:'board-add', id:'board2', name:'Cave' }, 'gm');
ok(s.boards.some(b => b.id === 'board2'), 'board-add: board2 created');
r = applyOp(s, { type:'board-add', id:'boardX' }, 'player1');
ok(r.rejected && !s.boards.some(b => b.id === 'boardX'), 'board-add: player rejected');
applyOp(s, { type:'board-activate', id:'board2' }, 'gm', { connected:['player1','player2'] });
eq(s.activeBoardId, 'board2', 'board-activate: active board switched');
const chars = s.boards.find(b => b.id === 'board2').table.figurines.filter(f => f.kind === 'character');
eq(chars.length, 2, 'board-activate: character tokens spawned for connected players');
// unknown board id rejected
r = applyOp(s, { type:'board-activate', id:'nope' }, 'gm');
ok(r.rejected && s.activeBoardId === 'board2', 'board-activate: unknown id rejected');
r = applyOp(s, { type:'board-rename', id:'nope', name:'X' }, 'gm');
ok(r.rejected, 'board-rename: unknown id rejected');
r = applyOp(s, { type:'board-duplicate', id:'nope' }, 'gm');
ok(r.rejected, 'board-duplicate: unknown id rejected');

// GM editing a non-active board via op.boardId
applyOp(s, { type:'add-figurine', hash:'mapA', x:0, y:0, boardId: s.boards[0].id }, 'gm');
ok(s.boards[0].table.figurines.some(f => f.assetHash === 'mapA'), 'boardId targeting: GM edited board 1 while board 2 is live');

// ── remove-slot ─────────────────────────────────────────────────────────────
r = applyOp(s, { type:'remove-slot', slot:'player2' }, 'player1');
ok(r.rejected, 'remove-slot: player rejected (GM-only)');
ok(s.hands.player2, 'remove-slot: player2 still present after rejected op');
r = applyOp(s, { type:'remove-slot', slot:'player2' }, 'gm');
ok(!r.rejected && !s.hands.player2, 'remove-slot: GM deletes the hand');
ok(!s.boards.some(b => b.table.figurines.some(f => f.kind === 'character' && f.playerId === 'player2')),
   'remove-slot: character token removed from every board');
eq(s.playerCount, 2, 'remove-slot: playerCount recomputed');
r = applyOp(s, { type:'remove-slot', slot:'gm' }, 'gm');
ok(r.rejected, 'remove-slot: cannot remove gm');
r = applyOp(s, { type:'remove-slot', slot:'player9' }, 'gm');
ok(r.rejected, 'remove-slot: unknown slot rejected');

// ── set-gm-notes ────────────────────────────────────────────────────────────
r = applyOp(s, { type:'set-gm-notes', text:'secret' }, 'gm');
ok(r.gmOnly === true && s.gmNotes === 'secret', 'set-gm-notes: gmOnly effect');
r = applyOp(s, { type:'set-gm-notes', text:'hack' }, 'player1');
ok(r.rejected, 'set-gm-notes: player rejected');

// ── viewFor filtering ───────────────────────────────────────────────────────
applyOp(s, { type:'draw', deck:'item', to:'gm' }, 'gm');  // give GM a hand card
const gmView = viewFor(s, 'gm');
const pView  = viewFor(s, 'player1');
ok(gmView.hands.gm && gmView.gmNotes === 'secret', 'viewFor(gm): includes GM hand + notes');
ok(gmView.boards && gmView.boards.length >= 2, 'viewFor(gm): includes all boards');
ok(Array.isArray(gmView.decks.role), 'viewFor(gm): decks are full arrays');
ok(!pView.hands.gm, 'viewFor(player): GM hand hidden');
ok(pView.gmNotes === undefined && pView.boards === undefined, 'viewFor(player): no gmNotes/boards');
ok(pView.table && pView.table.figurines, 'viewFor(player): has live table');
ok(typeof pView.decks.skill === 'number', 'viewFor(player): decks are counts');

// ── migrateState backfills instance.type + derives playerCount ──────────────
const legacy = { hands:{ gm:[{ instId:'g', cardId:'r2' }], player1:{ hand:[{ instId:'z', cardId:'i2' }] } }, boards:[{ id:'b', table:{ cards:[{ instId:'tc', cardId:'l1' }], figurines:[], drawings:[] } }], activeBoardId:'b' };
migrateState(legacy, (id) => id && id[0] === 'i' ? 'item' : id && id[0] === 'l' ? 'location' : 'role');
eq(legacy.hands.player1.hand[0].type, 'item', 'migrate: backfilled hand card type');
eq(legacy.boards[0].table.cards[0].type, 'location', 'migrate: backfilled table card type');
ok(legacy.hands.gm.hand && Array.isArray(legacy.hands.gm.hand), 'migrate: legacy gm array → object');
ok(legacy.hands.player1.hand && Array.isArray(legacy.hands.player1.hand), 'migrate: legacy player hand intact');
eq(legacy.playerCount, 1, 'migrate: derives playerCount from existing fixed slots');

// migrate must coexist with ensureSlot next-free scan (skips existing player1)
const newId = ensureSlot(legacy, null, 'Late');
eq(newId, 'player2', 'migrate + ensureSlot: next free skips existing player1');

// ── set-figurine-hidden: GM-only staging, omitted from player view ──────────
// (a) authorization: GM-only
ok(canApply({ type:'set-figurine-hidden', instId:'x', hidden:true }, 'gm') === true, 'set-figurine-hidden: GM allowed');
ok(canApply({ type:'set-figurine-hidden', instId:'x', hidden:true }, 'player1') === false, 'set-figurine-hidden: player rejected (GM-only)');
// place a token on the active board, then hide it
applyOp(s, { type:'add-figurine', hash:'ambush', x:500, y:500 }, 'gm');
const hideId = boardById_test(s).figurines.find(f => f.assetHash === 'ambush').instId;
r = applyOp(s, { type:'set-figurine-hidden', instId:hideId, hidden:true }, 'gm');
ok(!r.rejected && r.patch === undefined && r.movePatch === undefined && r.gmOnly === undefined,
   'set-figurine-hidden: returns {} (full rebroadcast, never a patch that would leak to players)');
ok(boardById_test(s).figurines.find(f => f.instId === hideId).hidden === true, 'set-figurine-hidden: flag set on figurine');
// (b) hidden token absent from player view, present for GM
ok(!viewFor(s, 'player1').table.figurines.some(f => f.instId === hideId), 'viewFor(player): hidden figurine omitted');
ok(boardById_test(viewFor(s, 'gm')).figurines.some(f => f.instId === hideId), 'viewFor(gm): hidden figurine still present');
// player rejected even if it tries to hide directly
r = applyOp(s, { type:'set-figurine-hidden', instId:hideId, hidden:false }, 'player1');
ok(r.rejected, 'set-figurine-hidden: player op rejected by applyOp');
// (c) revealing brings it back into the player view
r = applyOp(s, { type:'set-figurine-hidden', instId:hideId, hidden:false }, 'gm');
ok(!r.rejected, 'set-figurine-hidden: GM reveal accepted');
ok(viewFor(s, 'player1').table.figurines.some(f => f.instId === hideId), 'viewFor(player): revealed figurine returns');

// ── aura field on figurines ──────────────────────────────────────────────────
applyOp(s, { type:'add-figurine', hash:'auratest', x:10, y:10 }, 'gm');
const auraFigId = boardById_test(s).figurines.find(f => f.assetHash === 'auratest').instId;
// set aura
r = applyOp(s, { type:'move-figurine', instId:auraFigId, aura:{ radius:120, color:'#3b82f6', opacity:0.18, shape:'circle' } }, 'gm');
ok(!r.rejected && !r.movePatch, 'aura: setting aura is not a drag (full broadcast)');
const auraFig = boardById_test(s).figurines.find(f => f.instId === auraFigId);
ok(auraFig.aura && auraFig.aura.radius === 120, 'aura: radius set on figurine');
ok(auraFig.aura.color === '#3b82f6', 'aura: color set on figurine');
ok(auraFig.aura.shape === 'circle', 'aura: shape set on figurine');
// clear aura
r = applyOp(s, { type:'move-figurine', instId:auraFigId, aura:null }, 'gm');
ok(!r.rejected, 'aura: clearing aura accepted');
ok(boardById_test(s).figurines.find(f => f.instId === auraFigId).aura === null, 'aura: cleared to null');
// pure drag does not clear an existing aura
applyOp(s, { type:'move-figurine', instId:auraFigId, aura:{ radius:60, color:'#f00', opacity:0.2, shape:'square' } }, 'gm');
r = applyOp(s, { type:'move-figurine', instId:auraFigId, x:20, y:20 }, 'gm');
ok(r.movePatch, 'aura: pure drag still returns movePatch');
ok(boardById_test(s).figurines.find(f => f.instId === auraFigId).aura && boardById_test(s).figurines.find(f => f.instId === auraFigId).aura.radius === 60, 'aura: drag does not clear aura');

// ── grid overlay + snap (per-board, GM-authored) ─────────────────────────────
// (a) authorization: set-board-grid is GM-only
ok(canApply({ type:'set-board-grid', boardId:'x', grid:{ enabled:true } }, 'gm') === true, 'set-board-grid: GM allowed');
ok(canApply({ type:'set-board-grid', boardId:'x', grid:{ enabled:true } }, 'player1') === false, 'set-board-grid: player rejected (GM-only)');
// (b) applying set-board-grid sets the named board's grid to the given config
const gridCfg = { enabled:true, type:'hex', cellSize:64, color:'#ff0000', opacity:0.5, lineStyle:'dashed', snap:true, offsetX:5, offsetY:7 };
r = applyOp(s, { type:'set-board-grid', boardId: s.activeBoardId, grid: gridCfg }, 'gm');
ok(!r.rejected && r.patch === undefined && r.movePatch === undefined, 'set-board-grid: GM accepted, full rebroadcast ({})');
const liveBoard = s.boards.find(b => b.id === s.activeBoardId);
eq(liveBoard.grid.type, 'hex', 'set-board-grid: type stored on board');
eq(liveBoard.grid.cellSize, 64, 'set-board-grid: cellSize stored on board');
ok(liveBoard.grid.enabled === true && liveBoard.grid.snap === true, 'set-board-grid: enabled+snap stored on board');
eq(liveBoard.grid.offsetX, 5, 'set-board-grid: offsetX stored on board');
// a player attempting set-board-grid is rejected by applyOp and leaves the grid unchanged
r = applyOp(s, { type:'set-board-grid', boardId: s.activeBoardId, grid:{ enabled:false } }, 'player1');
ok(r.rejected && s.boards.find(b => b.id === s.activeBoardId).grid.enabled === true, 'set-board-grid: player op rejected, grid unchanged');
// (c) viewFor(player) exposes the active board's grid so players can render it
const pGridView = viewFor(s, 'player1');
ok(pGridView.grid && pGridView.grid.enabled === true && pGridView.grid.type === 'hex', 'viewFor(player): active board grid projected');
eq(pGridView.grid.cellSize, 64, 'viewFor(player): projected grid carries cellSize');
// the GM view still carries grid on each board object
ok(viewFor(s, 'gm').boards.find(b => b.id === s.activeBoardId).grid.type === 'hex', 'viewFor(gm): grid present on board');
// (d) migrateState backfills a default grid on a board that lacks one
const noGrid = { hands:{ gm:{ name:'GM', hand:[] } }, boards:[{ id:'bg', table:{ cards:[], figurines:[], drawings:[] } }], activeBoardId:'bg' };
migrateState(noGrid);
ok(noGrid.boards[0].grid && noGrid.boards[0].grid.enabled === false, 'migrate: backfills default grid (disabled)');
eq(noGrid.boards[0].grid.type, 'square', 'migrate: default grid type square');
eq(noGrid.boards[0].grid.cellSize, 50, 'migrate: default grid cellSize 50');
// newState boards carry a default grid; board-duplicate carries the grid onto the copy
ok(newState(CATALOG).boards[0].grid && newState(CATALOG).boards[0].grid.enabled === false, 'newState: board has default grid');
applyOp(s, { type:'board-duplicate', id: s.activeBoardId, newId:'gridCopy' }, 'gm');
ok(s.boards.find(b => b.id === 'gridCopy').grid.type === 'hex', 'board-duplicate: grid carried onto the copy');

// ── AoE / spell-area templates (cone, circle, line, cube) ────────────────────
// Fresh state so template assertions don't trip over earlier mutations.
let ts = newState(CATALOG);
ensureSlot(ts, null, 'Tess');   // player1
// (a) add-template: pushes with a fresh instId + z, defaults applied, by = actor
r = applyOp(ts, { type:'add-template', shape:'cone', x:100, y:120, rot:30, size:4, color:'#ef4444' }, 'player1');
ok(!r.rejected && JSON.stringify(r) === '{}', 'add-template: player allowed, returns {}');
const tmpl = boardById_test(ts).templates[0];
ok(tmpl && tmpl.instId, 'add-template: pushed with an instId');
ok(tmpl.z > 0, 'add-template: assigned a z');
eq(tmpl.shape, 'cone', 'add-template: shape stored');
eq([tmpl.x, tmpl.y, tmpl.rot, tmpl.size], [100, 120, 30, 4], 'add-template: x/y/rot/size stored');
eq(tmpl.width, 1, 'add-template: width defaults to 1');
eq(tmpl.color, '#ef4444', 'add-template: color stored');
eq(tmpl.by, 'player1', 'add-template: by = placer id');
eq(tmpl.locked, false, 'add-template: starts unlocked');
const tId = tmpl.instId;

// (b) move-template: pure position change returns a movePatch kind:'template' + updates x/y
r = applyOp(ts, { type:'move-template', instId:tId, x:200, y:240 }, 'player1');
ok(r.movePatch && r.movePatch.kind === 'template', 'move-template drag: returns movePatch kind:template');
eq([r.movePatch.x, r.movePatch.y], [200, 240], 'move-template drag: movePatch carries x/y');
eq(r.movePatch.boardId, ts.activeBoardId, 'move-template drag: movePatch carries active boardId');
eq([boardById_test(ts).templates[0].x, boardById_test(ts).templates[0].y], [200, 240], 'move-template: x/y updated on template');
// bringToFront is NOT a pure drag → no movePatch
r = applyOp(ts, { type:'move-template', instId:tId, bringToFront:true }, 'player1');
ok(!r.movePatch, 'move-template bringToFront: no movePatch (full broadcast)');

// (c) update-template: returns a patch kind:'set-template' and changes rot/size/etc (only changed fields)
r = applyOp(ts, { type:'update-template', instId:tId, rot:90, size:6 }, 'player1');
ok(r.patch && r.patch.kind === 'set-template', 'update-template: returns patch kind:set-template');
eq([r.patch.rot, r.patch.size], [90, 6], 'update-template: patch carries changed rot/size');
ok(r.patch.color === undefined && r.patch.width === undefined, 'update-template: patch omits unchanged fields');
eq([boardById_test(ts).templates[0].rot, boardById_test(ts).templates[0].size], [90, 6], 'update-template: rot/size updated on template');
eq(r.patch.boardId, ts.activeBoardId, 'update-template: patch carries active boardId');
r = applyOp(ts, { type:'update-template', instId:tId, color:'#10b981', width:2 }, 'gm');
eq([boardById_test(ts).templates[0].color, boardById_test(ts).templates[0].width], ['#10b981', 2], 'update-template: GM can recolor/resize width');

// (d) locked template rejects move + resize (until unlocked)
applyOp(ts, { type:'update-template', instId:tId, locked:true }, 'player1');
r = applyOp(ts, { type:'move-template', instId:tId, x:9, y:9 }, 'player1');
ok(r.rejected, 'locked template: move rejected');
r = applyOp(ts, { type:'update-template', instId:tId, size:99 }, 'player1');
ok(r.rejected, 'locked template: resize rejected');
ok(boardById_test(ts).templates[0].x === 200 && boardById_test(ts).templates[0].size === 6, 'locked template: fields unchanged');
// unlock is still allowed while locked
r = applyOp(ts, { type:'update-template', instId:tId, locked:false }, 'player1');
ok(!r.rejected && boardById_test(ts).templates[0].locked === false, 'locked template: unlock allowed');

// (e) remove-template removes it
applyOp(ts, { type:'add-template', shape:'circle', x:0, y:0, size:2 }, 'player1');   // a second one
const before = boardById_test(ts).templates.length;
r = applyOp(ts, { type:'remove-template', instId:tId }, 'player1');
ok(!r.rejected, 'remove-template: player allowed');
eq(boardById_test(ts).templates.length, before - 1, 'remove-template: array shrank by one');
ok(!boardById_test(ts).templates.some(t => t.instId === tId), 'remove-template: target gone');

// (f) clear-templates is GM-only and empties the array
ok(canApply({ type:'clear-templates' }, 'gm') === true, 'clear-templates: GM allowed (canApply)');
ok(canApply({ type:'clear-templates' }, 'player1') === false, 'clear-templates: player rejected (canApply)');
r = applyOp(ts, { type:'clear-templates' }, 'player1');
ok(r.rejected, 'clear-templates: player op rejected by applyOp');
ok(boardById_test(ts).templates.length > 0, 'clear-templates: array intact after rejected player op');
r = applyOp(ts, { type:'clear-templates' }, 'gm');
ok(!r.rejected && boardById_test(ts).templates.length === 0, 'clear-templates: GM empties the array');

// (g) viewFor(player) includes table.templates (rides the ...liveTable spread)
applyOp(ts, { type:'add-template', shape:'line', x:5, y:5, size:8, width:1 }, 'player1');
const tView = viewFor(ts, 'player1');
ok(Array.isArray(tView.table.templates), 'viewFor(player): table.templates is an array (rides spread)');
ok(tView.table.templates.some(t => t.shape === 'line'), 'viewFor(player): placed template present in player view');
// GM view carries templates on each board object too
ok(viewFor(ts, 'gm').boards.find(b => b.id === ts.activeBoardId).table.templates.some(t => t.shape === 'line'), 'viewFor(gm): templates present on board table');

// (h) state plumbing: newState/board-add tables carry templates[]; migrate backfills; duplicate gets fresh instIds
ok(Array.isArray(newState(CATALOG).boards[0].table.templates), 'newState: board table carries templates[]');
applyOp(ts, { type:'board-add', id:'tBoard', name:'AoE' }, 'gm');
ok(Array.isArray(ts.boards.find(b => b.id === 'tBoard').table.templates), 'board-add: new board table carries templates[]');
const noTpl = { hands:{ gm:{ name:'GM', hand:[] } }, boards:[{ id:'bt', table:{ cards:[], figurines:[], drawings:[] }, grid:{} }], activeBoardId:'bt' };
migrateState(noTpl);
ok(Array.isArray(noTpl.boards[0].table.templates), 'migrate: backfills templates[] on a board that lacks it');
const srcTplId = boardById_test(ts).templates[0].instId;
applyOp(ts, { type:'board-duplicate', id: ts.activeBoardId, newId:'tplCopy' }, 'gm');
const copyTpl = ts.boards.find(b => b.id === 'tplCopy').table.templates;
ok(copyTpl.length >= 1 && copyTpl.every(t => t.instId !== srcTplId), 'board-duplicate: templates deep-cloned with FRESH instIds');

// ── Initiative / turn-order tracker ──────────────────────────────────────────
// Fresh state so initiative assertions don't trip over earlier mutations.
let is = newState(CATALOG);
ensureSlot(is, null, 'Ivo');   // player1

// (a) state plumbing: newState board carries an initiative tracker
const ini0 = boardById_test(is).initiative;
ok(ini0 && Array.isArray(ini0.entries) && ini0.active === 0 && ini0.round === 1, 'initiative: newState board has empty tracker (active 0, round 1)');

// (b) authorization: every init-* op is GM-only
for (const t of ['init-add','init-remove','init-set-value','init-sort','init-advance','init-prev','init-reset','init-toggle-dead']) {
  ok(canApply({ type:t }, 'gm') === true, `initiative: ${t} GM allowed`);
  ok(canApply({ type:t }, 'player1') === false, `initiative: ${t} player rejected (GM-only)`);
}
// applyOp also rejects a player init op and leaves the tracker untouched
r = applyOp(is, { type:'init-add', name:'Sneaky', value:99 }, 'player1');
ok(r.rejected && boardById_test(is).initiative.entries.length === 0, 'initiative: player init-add rejected by applyOp');

// (c) init-add appends a row with a stable id (not the array index)
r = applyOp(is, { type:'init-add', name:'Goblin', value:12 }, 'gm');
ok(!r.rejected && JSON.stringify(r) === '{}', 'init-add: returns {} (full rebroadcast)');
const e0 = boardById_test(is).initiative.entries[0];
ok(e0 && typeof e0.id === 'string' && e0.id.length > 0, 'init-add: row has a stable id');
eq([e0.name, e0.value, e0.dead, e0.instId], ['Goblin', 12, false, null], 'init-add: name/value/dead/instId defaults');

// add a couple more, OUT of value order, to exercise sort/advance
applyOp(is, { type:'init-add', name:'Hero',  value:20 }, 'gm');
applyOp(is, { type:'init-add', name:'Orc',   value:5  }, 'gm');
applyOp(is, { type:'init-add', name:'Mage',  value:18 }, 'gm');
let entries = () => boardById_test(is).initiative.entries;
let tracker = () => boardById_test(is).initiative;
eq(entries().length, 4, 'init-add: four combatants present');

// (d) init-set-value updates a single row by id
const goblinId = entries().find(e => e.name === 'Goblin').id;
applyOp(is, { type:'init-set-value', id: goblinId, value: 25 }, 'gm');
eq(entries().find(e => e.id === goblinId).value, 25, 'init-set-value: value updated by id');

// (e) init-sort orders by value DESC and KEEPS the active combatant pinned by id
// Make the Orc (lowest value) the active one, then sort — Orc must remain active.
tracker().active = entries().findIndex(e => e.name === 'Orc');
const orcId = entries()[tracker().active].id;
r = applyOp(is, { type:'init-sort' }, 'gm');
ok(!r.rejected, 'init-sort: GM allowed');
const vals = entries().map(e => e.value);
eq(vals, [25, 20, 18, 5], 'init-sort: values ordered DESC (Goblin25, Hero20, Mage18, Orc5)');
eq(entries()[tracker().active].id, orcId, 'init-sort: active combatant unchanged across sort (pinned by id)');
eq(entries()[tracker().active].name, 'Orc', 'init-sort: active is still Orc after re-sort');

// stable on ties: two equal values keep their relative (insertion) order
let ss = newState(CATALOG);
applyOp(ss, { type:'init-add', name:'A', value:10 }, 'gm');
applyOp(ss, { type:'init-add', name:'B', value:10 }, 'gm');
applyOp(ss, { type:'init-add', name:'C', value:10 }, 'gm');
applyOp(ss, { type:'init-sort' }, 'gm');
eq(boardById_test(ss).initiative.entries.map(e => e.name), ['A','B','C'], 'init-sort: stable on equal values');

// (f) init-advance wraps and increments round
// Current order: Goblin(25), Hero(20), Mage(18), Orc(5); set active to the last entry.
tracker().active = 3; tracker().round = 1;
applyOp(is, { type:'init-advance' }, 'gm');
eq([tracker().active, tracker().round], [0, 2], 'init-advance: wraps 3→0 and round 1→2');
applyOp(is, { type:'init-advance' }, 'gm');
eq([tracker().active, tracker().round], [1, 2], 'init-advance: 0→1 same round');

// init-prev wraps backward and decrements round (clamped ≥ 1)
tracker().active = 0; tracker().round = 2;
applyOp(is, { type:'init-prev' }, 'gm');
eq([tracker().active, tracker().round], [3, 1], 'init-prev: wraps 0→last and round 2→1');
tracker().active = 0; tracker().round = 1;
applyOp(is, { type:'init-prev' }, 'gm');
eq(tracker().round, 1, 'init-prev: round clamped at 1 (no underflow)');

// (g) init-remove fixes active so the highlight stays on the same combatant
// Order: Goblin(0), Hero(1), Mage(2), Orc(3). Active = Mage (idx 2); remove Hero (idx 1 < active) → active shifts to 1.
tracker().active = 2;
const mageId = entries()[2].id;
const heroId = entries().find(e => e.name === 'Hero').id;
applyOp(is, { type:'init-remove', id: heroId }, 'gm');
eq(tracker().active, 1, 'init-remove: active decremented when a row before it is removed');
eq(entries()[tracker().active].id, mageId, 'init-remove: same combatant (Mage) still active after removal');

// (h) init-toggle-dead flips the downed flag (row stays in the list)
const orcId2 = entries().find(e => e.name === 'Orc').id;
applyOp(is, { type:'init-toggle-dead', id: orcId2 }, 'gm');
ok(entries().find(e => e.id === orcId2).dead === true, 'init-toggle-dead: row marked dead');
ok(entries().some(e => e.id === orcId2), 'init-toggle-dead: dead row kept in the list (not removed)');
applyOp(is, { type:'init-toggle-dead', id: orcId2 }, 'gm');
ok(entries().find(e => e.id === orcId2).dead === false, 'init-toggle-dead: toggles back to alive');

// (i) removing a linked figurine drops its initiative row AND fixes active
let fs = newState(CATALOG);
applyOp(fs, { type:'add-figurine', hash:'mob1', x:0, y:0 }, 'gm');
applyOp(fs, { type:'add-figurine', hash:'mob2', x:0, y:0 }, 'gm');
const fig1 = boardById_test(fs).figurines.find(f => f.assetHash === 'mob1').instId;
const fig2 = boardById_test(fs).figurines.find(f => f.assetHash === 'mob2').instId;
applyOp(fs, { type:'init-add', name:'Mob1', value:10, instId: fig1 }, 'gm');   // idx 0
applyOp(fs, { type:'init-add', name:'Mob2', value:8,  instId: fig2 }, 'gm');   // idx 1
boardById_test(fs).initiative.active = 1;                                       // active = Mob2
applyOp(fs, { type:'remove-figurine', instId: fig1 }, 'gm');                    // remove fig1 (linked to idx 0)
const fIni = boardById_test(fs).initiative;
eq(fIni.entries.length, 1, 'remove-figurine hook: linked initiative row dropped');
ok(!fIni.entries.some(e => e.instId === fig1), 'remove-figurine hook: no row left for the removed token');
eq(fIni.active, 0, 'remove-figurine hook: active fixed (Mob2 stays highlighted at new index 0)');
eq(fIni.entries[0].name, 'Mob2', 'remove-figurine hook: surviving row is Mob2');

// (j) init-reset clears the tracker
applyOp(is, { type:'init-reset' }, 'gm');
const cleared = boardById_test(is).initiative;
eq([cleared.entries.length, cleared.active, cleared.round], [0, 0, 1], 'init-reset: entries=[], active=0, round=1');

// (k) viewFor(player) exposes table.initiative (rides the ...liveTable spread)
let vs = newState(CATALOG);
ensureSlot(vs, null, 'Vex');
applyOp(vs, { type:'init-add', name:'Watcher', value:14 }, 'gm');
const vView = viewFor(vs, 'player1');
ok(vView.table.initiative && Array.isArray(vView.table.initiative.entries), 'viewFor(player): table.initiative present (array)');
ok(vView.table.initiative.entries.some(e => e.name === 'Watcher'), 'viewFor(player): placed combatant visible to player');
ok(viewFor(vs, 'gm').boards.find(b => b.id === vs.activeBoardId).table.initiative.entries.some(e => e.name === 'Watcher'), 'viewFor(gm): initiative present on board table');

// (l) state plumbing: board-add carries a tracker; migrate backfills; duplicate deep-clones with fresh ids + cleared links
applyOp(vs, { type:'board-add', id:'iBoard', name:'Arena' }, 'gm');
const iBoard = vs.boards.find(b => b.id === 'iBoard');
ok(iBoard && Array.isArray(iBoard.table.initiative.entries), 'board-add: new board carries initiative tracker');
const noIni = { hands:{ gm:{ name:'GM', hand:[] } }, boards:[{ id:'bi', table:{ cards:[], figurines:[], drawings:[] }, grid:{} }], activeBoardId:'bi' };
migrateState(noIni);
ok(noIni.boards[0].table.initiative && noIni.boards[0].table.initiative.round === 1, 'migrate: backfills initiative tracker on a board that lacks it');
// duplicate: rows get fresh ids and linked instIds are cleared (cloned figurines are new objects)
let ds = newState(CATALOG);
applyOp(ds, { type:'add-figurine', hash:'dmob', x:0, y:0 }, 'gm');
const dfig = boardById_test(ds).figurines.find(f => f.assetHash === 'dmob').instId;
applyOp(ds, { type:'init-add', name:'DupMob', value:9, instId: dfig }, 'gm');
const srcRowId = boardById_test(ds).initiative.entries[0].id;
applyOp(ds, { type:'board-duplicate', id: ds.activeBoardId, newId:'iniCopy' }, 'gm');
const copyIni = ds.boards.find(b => b.id === 'iniCopy').table.initiative;
ok(copyIni.entries.length === 1 && copyIni.entries[0].id !== srcRowId, 'board-duplicate: initiative rows deep-cloned with FRESH ids');
ok(copyIni.entries[0].instId === null, 'board-duplicate: stale instId link cleared on the copy');

// ── Fog of war (GM-only authoring; rides viewFor so players render opaque fog) ──────
let fs1 = newState(CATALOG);
const fogTbl = () => boardById_test(fs1);
// newState plumbing
ok(fogTbl().fog && fogTbl().fog.filled === false && Array.isArray(fogTbl().fog.shapes) && fogTbl().fog.shapes.length === 0,
   'fog: newState board has empty fog { filled:false, shapes:[] }');
// All fog ops are GM-only: canApply false for a player, true for the GM.
for (const t of ['fog-fill','fog-cut','fog-hide','fog-undo','fog-clear']) {
  ok(canApply({ type:t }, 'gm') === true,    `fog: canApply ${t} true for GM`);
  ok(canApply({ type:t }, 'player1') === false, `fog: canApply ${t} false for player`);
}
// A player op is rejected and never mutates fog.
let rf = applyOp(fs1, { type:'fog-fill' }, 'player1');
ok(rf.rejected && fogTbl().fog.filled === false, 'fog-fill: player rejected, fog untouched');
// fog-fill: sets filled and returns a fog-set patch carrying the whole fog object.
rf = applyOp(fs1, { type:'fog-fill', boardId: fs1.activeBoardId }, 'gm');
ok(!rf.rejected && fogTbl().fog.filled === true, 'fog-fill: GM sets filled=true');
ok(rf.patch && rf.patch.kind === 'fog-set' && rf.patch.fog && rf.patch.fog.filled === true,
   'fog-fill: returns fog-set patch with the fog object');
// fog-cut: pushes a reveal shape and returns a fog-add patch with that shape.
rf = applyOp(fs1, { type:'fog-cut', boardId: fs1.activeBoardId, shape:{ kind:'rect', rect:{ x:0, y:0, w:100, h:100 } } }, 'gm');
ok(fogTbl().fog.shapes.length === 1 && fogTbl().fog.shapes[0].mode === 'reveal', 'fog-cut: pushes a reveal shape');
ok(rf.patch && rf.patch.kind === 'fog-add' && rf.patch.shape.mode === 'reveal' && rf.patch.shape.id,
   'fog-cut: returns fog-add patch with the pushed reveal shape (with id)');
ok(rf.patch.shape.kind === 'rect' && rf.patch.shape.rect.w === 100, 'fog-cut: shape payload preserved on the pushed shape');
// fog-hide: pushes a hide shape (re-cover), returns a fog-add patch.
rf = applyOp(fs1, { type:'fog-hide', boardId: fs1.activeBoardId, shape:{ kind:'brush', points:[[1,1],[2,2]], width:50 } }, 'gm');
ok(fogTbl().fog.shapes.length === 2 && fogTbl().fog.shapes[1].mode === 'hide', 'fog-hide: pushes a hide shape (order preserved after the reveal)');
ok(rf.patch && rf.patch.kind === 'fog-add' && rf.patch.shape.mode === 'hide', 'fog-hide: returns fog-add patch with the hide shape');
// fog-undo: pops the last shape only.
rf = applyOp(fs1, { type:'fog-undo', boardId: fs1.activeBoardId }, 'gm');
ok(fogTbl().fog.shapes.length === 1 && fogTbl().fog.shapes[0].mode === 'reveal', 'fog-undo: pops the most recent shape (hide removed, reveal kept)');
eq(rf, {}, 'fog-undo: returns {} (full rebroadcast)');
// fog-clear: resets to the empty fog.
rf = applyOp(fs1, { type:'fog-clear', boardId: fs1.activeBoardId }, 'gm');
ok(fogTbl().fog.filled === false && fogTbl().fog.shapes.length === 0, 'fog-clear: resets filled=false, shapes=[]');
eq(rf, {}, 'fog-clear: returns {} (full rebroadcast)');
// viewFor(player) exposes table.fog so the player client can render the opaque fog.
applyOp(fs1, { type:'fog-fill', boardId: fs1.activeBoardId }, 'gm');
applyOp(fs1, { type:'fog-cut', boardId: fs1.activeBoardId, shape:{ kind:'rect', rect:{ x:5, y:5, w:20, h:20 } } }, 'gm');
const pv = viewFor(fs1, 'player1');
ok(pv.table.fog && pv.table.fog.filled === true && pv.table.fog.shapes.length === 1,
   'viewFor(player): table.fog rides the ...liveTable spread (geometry reaches players for opaque render)');
// migrate backfills fog on a board predating the feature.
const noFog = { hands:{ gm:{ name:'GM', hand:[] } }, boards:[{ id:'bf', table:{ cards:[], figurines:[], drawings:[] }, grid:{} }], activeBoardId:'bf' };
migrateState(noFog);
ok(noFog.boards[0].table.fog && noFog.boards[0].table.fog.filled === false && Array.isArray(noFog.boards[0].table.fog.shapes),
   'migrate: backfills fog on a board that lacks it');
// board-add: new board carries an empty fog.
applyOp(fs1, { type:'board-add', id:'fBoard', name:'Foggy' }, 'gm');
const fBoard = fs1.boards.find(b => b.id === 'fBoard');
ok(fBoard && fBoard.table.fog && fBoard.table.fog.filled === false && fBoard.table.fog.shapes.length === 0,
   'board-add: new board carries empty fog');
// board-duplicate: fog deep-cloned (a mutation of the copy must not touch the source).
applyOp(fs1, { type:'board-duplicate', id: fs1.activeBoardId, newId:'fogCopy' }, 'gm');
const srcFog = boardById_test(fs1).fog;
const copyFog = fs1.boards.find(b => b.id === 'fogCopy').table.fog;
ok(copyFog && copyFog.shapes.length === srcFog.shapes.length, 'board-duplicate: fog shapes carried onto the copy');
copyFog.shapes.push({ id:'x', mode:'reveal', kind:'rect', rect:{ x:0,y:0,w:1,h:1 } });
ok(copyFog.shapes.length === srcFog.shapes.length + 1, 'board-duplicate: fog deep-cloned (mutating the copy does not affect the source)');

// ── whisper (private 1:1 message — targeted relay, never persisted) ──────────
let ws = newState(CATALOG);
ensureSlot(ws, null, 'Aria');   // player1
ensureSlot(ws, null, 'Bryn');   // player2
ws.hands.player1.color = '#abcdef';
const chatLenBefore = (ws.chat || []).length;

// player1 whispers player2 → result descriptor, NOT pushed to chat
let rw = applyOp(ws, { type:'whisper', to:'player2', text:'hey there', ts:42 }, 'player1');
ok(rw && rw.whisper, 'whisper: returns { whisper } descriptor (not a patch/{} )');
eq(rw.whisper.from, 'player1', 'whisper: from = authenticated by (server-stamped)');
eq(rw.whisper.to, 'player2', 'whisper: to carried through');
eq(rw.whisper.text, 'hey there', 'whisper: text carried through');
eq(rw.whisper.color, '#abcdef', 'whisper: color pulled from sender hand');
eq(rw.whisper.name, 'Aria', 'whisper: name pulled from sender hand');
eq(rw.whisper.ts, 42, 'whisper: ts carried through');
eq((ws.chat || []).length, chatLenBefore, 'whisper: does NOT push to state.chat');

// `from` is NEVER trusted from the client — a forged from is overwritten by `by`
let rwForge = applyOp(ws, { type:'whisper', to:'gm', text:'spoof', from:'gm', ts:7 }, 'player1');
eq(rwForge.whisper.from, 'player1', 'whisper: client-supplied from is ignored (uses authenticated by)');
eq((ws.chat || []).length, chatLenBefore, 'whisper: whisper to gm still not in state.chat');

// anyone may whisper (not GM-only)
ok(canApply({ type:'whisper', to:'gm', text:'x' }, 'player1') === true, 'whisper: canApply true for a player (anyone may whisper)');
ok(canApply({ type:'whisper', to:'player1', text:'x' }, 'gm') === true, 'whisper: canApply true for the GM');

// whisper to an unknown slot is rejected
let rwBad = applyOp(ws, { type:'whisper', to:'player9', text:'nobody' }, 'player1');
ok(rwBad && rwBad.rejected, 'whisper: unknown target slot rejected');
ok(!rwBad.whisper, 'whisper: rejected whisper has no whisper descriptor');

// whisper text is capped (defence against oversized payloads)
let rwLong = applyOp(ws, { type:'whisper', to:'gm', text:'a'.repeat(5000) }, 'player1');
ok(rwLong.whisper.text.length === 2000, 'whisper: text capped at 2000 chars');

// viewFor exposes NO whisper data (neither GM nor player view carries whispers)
const wGmView = viewFor(ws, 'gm');
const wPlView = viewFor(ws, 'player1');
ok(JSON.stringify(wGmView).indexOf('whisper') === -1 && JSON.stringify(wGmView).indexOf('hey there') === -1,
   'viewFor(gm): no whisper data leaks into the view');
ok(JSON.stringify(wPlView).indexOf('whisper') === -1 && JSON.stringify(wPlView).indexOf('hey there') === -1,
   'viewFor(player): no whisper data leaks into the view');
ok((wGmView.chat || []).length === chatLenBefore && (wPlView.chat || []).length === chatLenBefore,
   'viewFor: chat array length unchanged by whispers');

console.log(`\nengine.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
