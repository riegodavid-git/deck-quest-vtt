#!/usr/bin/env node
// Unit test for engine.mjs — pure game logic, run with: node scripts/test-engine.mjs
import { newState, applyOp, viewFor, migrateState, ensureSlot } from '../engine.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

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

console.log(`\nengine.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
