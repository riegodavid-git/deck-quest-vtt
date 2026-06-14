#!/usr/bin/env node
// Integration test for the Room Durable Object. Requires a local dev server:
//   (cd relay-cf && npx wrangler dev --port 8787)   # in another terminal
// then:  node relay-cf/test/local-test.mjs
import { newState } from '../../engine.mjs';

const URL = process.env.RELAY || ('ws://127.0.0.1:8787/r/TEST-' + Date.now());  // fresh room each run
const CATALOG = { role:['r1','r2'], skill:['s1','s2'], item:['i1'], location:['l1'], adversary:['a1'] };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

function open(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws._msgs = []; ws._wake = null;
    ws.addEventListener('message', e => { ws._msgs.push(JSON.parse(e.data)); if (ws._wake) { const w = ws._wake; ws._wake = null; w(); } });
    ws.addEventListener('open', () => res(ws));
    ws.addEventListener('error', rej);
  });
}
const sj = (ws, o) => ws.send(JSON.stringify(o));
async function waitFor(ws, type, pred = null, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const i = ws._msgs.findIndex(m => m.type === type && (!pred || pred(m)));
    if (i >= 0) return ws._msgs.splice(i, 1)[0];
    await new Promise(r => { ws._wake = r; setTimeout(r, 40); });
  }
  throw new Error('timeout waiting for ' + type);
}

async function main() {
  // GM creates the room
  const gm = await open(URL);
  sj(gm, { type: 'register', role: 'gm' });
  await waitFor(gm, 'need-init');
  const state = newState(CATALOG);   // dynamic slots: players are allocated on join, not seeded here
  const boardId = state.boards[0].id;
  sj(gm, { type: 'init-state', state });
  const gm0 = await waitFor(gm, 'state');
  ok(gm0.myId === 'gm' && gm0.view.boards && gm0.view.gmNotes !== undefined, 'GM gets full view (boards + gmNotes)');

  // Player 1 joins
  const p1 = await open(URL);
  sj(p1, { type: 'register', role: 'player', slot: 'player1', name: 'Aria' });
  const p1s = await waitFor(p1, 'state');
  ok(p1s.myId === 'player1', 'player1 receives myId');
  ok(!p1s.view.hands.gm && p1s.view.hands.player1, 'player view hides GM hand, shows own');
  ok(typeof p1s.view.decks.role === 'number' && p1s.view.boards === undefined, 'player view: deck counts, no boards');

  // GM adds a figurine on the live board
  sj(gm, { type: 'op', op: { type: 'add-figurine', hash: 'h1', x: 100, y: 100, boardId } });
  const gm1 = await waitFor(gm, 'state', m => m.view.boards[0].table.figurines.length > 0);
  const figId = gm1.view.boards[0].table.figurines[0].instId;
  ok(!!figId, 'GM add-figurine applied');

  // Player drags it via an op → GM receives a move-patch (not a full state)
  sj(p1, { type: 'op', op: { type: 'move-figurine', instId: figId, x: 300, y: 300 } });
  const mp = await waitFor(gm, 'move-patch');
  ok(mp.x === 300 && mp.y === 300, 'move-figurine op → move-patch fan-out');

  // Ephemeral live-drag preview → fanned out, not persisted
  sj(p1, { type: 'drag', kind: 'figurine', instId: figId, x: 315, y: 325 });
  const mp2 = await waitFor(gm, 'move-patch');
  ok(mp2.x === 315, 'drag message → ephemeral move-patch');

  // Player tries a GM-only op (draw) → rejected (no state arrives); verify by a follow-up
  sj(p1, { type: 'op', op: { type: 'draw', deck: 'role', to: 'player1' } });
  // GM deals to player1 (authoritative) → player1 sees a hand card
  sj(gm, { type: 'op', op: { type: 'draw', deck: 'role', to: 'player1' } });
  const p1draw = await waitFor(p1, 'state', m => m.view.hands.player1.hand.length > 0);
  ok(p1draw.view.hands.player1.hand.length === 1, 'GM draw dealt to player1 (player draw was rejected)');

  // Ping / pong latency
  sj(p1, { type: 'ping', ts: 4242 });
  const pong = await waitFor(p1, 'pong');
  ok(pong.ts === 4242, 'ping → pong echoes ts');

  // Cursor fan-out (player → others, with identity)
  sj(p1, { type: 'cursor', x: 50, y: 60 });
  const cur = await waitFor(gm, 'cursor-update');
  ok(cur.who === 'player1' && cur.x === 50 && cur.name === 'Aria', 'cursor fan-out carries identity');

  // Player 2 joins → GM sees presence
  const p2 = await open(URL);
  sj(p2, { type: 'register', role: 'player', slot: 'player2', name: 'Bo' });
  await waitFor(p2, 'state');
  const gmP2 = await waitFor(gm, 'state', m => m.view.hands.player2 && m.view.hands.player2.connected === true);
  ok(gmP2.view.hands.player2.connected === true, 'player2 join → GM sees connected=true');

  // Player 1 disconnects → GM sees connected=false
  p1.close();
  const gmDc = await waitFor(gm, 'state', m => m.view.hands.player1.connected === false);
  ok(gmDc.view.hands.player1.connected === false, 'player1 disconnect → GM sees connected=false');

  gm.close(); p2.close();
  console.log(`\nRoom DO: ${pass} passed, ${fail} failed`);
  // Let WebSocket handles finish closing before exit (avoids a libuv teardown crash on Windows).
  setTimeout(() => process.exit(fail ? 1 : 0), 250);
}
main().catch(e => { console.error('FATAL', e.message); setTimeout(() => process.exit(1), 250); });
