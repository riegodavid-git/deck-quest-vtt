#!/usr/bin/env node
// Unit test for engine.mjs — pure game logic, run with: node scripts/test-engine.mjs
import { newState, applyOp, viewFor, migrateState } from '../engine.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const CATALOG = { role:['r1','r2'], skill:['s1','s2','s3'], item:['i1','i2'], location:['l1'], adversary:['a1','a2'] };

// ── newState ──────────────────────────────────────────────────────────────
let s = newState(3, CATALOG);
ok(s.hands.gm && s.hands.player1 && s.hands.player3 && !s.hands.player4, 'newState: 3 players + gm');
eq(s.decks.role.length, 2, 'newState: role deck size');
eq(s.hands.player1.stats.str, 20, 'newState: baseline stat 20');
eq(s.activeBoardId, s.boards[0].id, 'newState: active board = main');

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

// ── figurines: add + drag returns a movePatch ───────────────────────────────
applyOp(s, { type:'add-figurine', hash:'h1', x:100, y:100 }, 'player1');
const figId = s.boards[0].table.figurines[0].instId;
r = applyOp(s, { type:'move-figurine', instId:figId, x:250, y:260 }, 'player1');
ok(r.movePatch && r.movePatch.x === 250 && r.movePatch.y === 260, 'move-figurine drag: returns movePatch');
eq(s.boards[0].table.figurines[0].x, 250, 'move-figurine: x updated');
// resize is NOT a drag → no movePatch
r = applyOp(s, { type:'move-figurine', instId:figId, w:300, h:300 }, 'player1');
ok(!r.movePatch, 'move-figurine resize: no movePatch (full broadcast)');

// locked figurine ignores edits except unlock
applyOp(s, { type:'move-figurine', instId:figId, locked:true }, 'gm');
applyOp(s, { type:'move-figurine', instId:figId, x:999, y:999 }, 'player1');
ok(s.boards[0].table.figurines[0].x !== 999, 'locked figurine: drag ignored');

// ── sheet ownership ─────────────────────────────────────────────────────────
r = applyOp(s, { type:'set-player-field', owner:'player1', path:'stats.str', value:35 }, 'player1');
ok(!r.rejected && s.hands.player1.stats.str === 35, 'set-player-field: own sheet ok');
r = applyOp(s, { type:'set-player-field', owner:'player2', path:'gold', value:999 }, 'player1');
ok(r.rejected, 'set-player-field: cannot edit another player');
r = applyOp(s, { type:'set-player-field', owner:'player2', path:'gold', value:999 }, 'gm');
ok(!r.rejected && s.hands.player2.gold === 999, 'set-player-field: GM can edit anyone');

// ── boards ──────────────────────────────────────────────────────────────────
applyOp(s, { type:'board-add', id:'board2', name:'Cave' }, 'gm');
eq(s.boards.length, 2, 'board-add: 2 boards');
r = applyOp(s, { type:'board-add', id:'boardX' }, 'player1');
ok(r.rejected && s.boards.length === 2, 'board-add: player rejected');
applyOp(s, { type:'board-activate', id:'board2' }, 'gm', { connected:['player1','player2'] });
eq(s.activeBoardId, 'board2', 'board-activate: active board switched');
const chars = s.boards[1].table.figurines.filter(f => f.kind === 'character');
eq(chars.length, 2, 'board-activate: character tokens spawned for connected players');

// GM editing a non-active board via op.boardId
applyOp(s, { type:'add-figurine', hash:'mapA', x:0, y:0, boardId: s.boards[0].id }, 'gm');
ok(s.boards[0].table.figurines.some(f => f.assetHash === 'mapA'), 'boardId targeting: GM edited board 1 while board 2 is live');

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
ok(gmView.boards && gmView.boards.length === 2, 'viewFor(gm): includes all boards');
ok(Array.isArray(gmView.decks.role), 'viewFor(gm): decks are full arrays');
ok(!pView.hands.gm, 'viewFor(player): GM hand hidden');
ok(pView.gmNotes === undefined && pView.boards === undefined, 'viewFor(player): no gmNotes/boards');
ok(pView.table && pView.table.figurines, 'viewFor(player): has live table');
ok(typeof pView.decks.skill === 'number', 'viewFor(player): decks are counts');

// ── migrateState backfills instance.type ────────────────────────────────────
const legacy = { hands:{ gm:[{ instId:'g', cardId:'r2' }], player1:{ hand:[{ instId:'z', cardId:'i2' }] } }, boards:[{ id:'b', table:{ cards:[{ instId:'tc', cardId:'l1' }], figurines:[], drawings:[] } }], activeBoardId:'b' };
migrateState(legacy, (id) => id && id[0] === 'i' ? 'item' : id && id[0] === 'l' ? 'location' : 'role');
eq(legacy.hands.player1.hand[0].type, 'item', 'migrate: backfilled hand card type');
eq(legacy.boards[0].table.cards[0].type, 'location', 'migrate: backfilled table card type');
ok(legacy.hands.gm.hand && Array.isArray(legacy.hands.gm.hand), 'migrate: legacy gm array → object');

console.log(`\nengine.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
