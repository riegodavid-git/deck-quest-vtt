/**
 * Deck Quest VTT — WebSocket relay server
 *
 * Topology:
 *   - GM connects and registers as role='gm' with a roomCode.
 *   - Players connect and register as role='player' with a roomCode + slot ('player1'…).
 *   - All game messages route through this server:
 *       GM  → specific player : { to: 'player1', msg: {...} }
 *       GM  → all players     : { msg: {...} }          (no 'to' field = broadcast)
 *       Player → GM           : { to: 'gm',     msg: {...} }
 *   - The server wraps player→GM messages as { from: slot, msg: {...} } so the GM
 *     knows who sent them.
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;

// ── HTTP server (needed by Render; also serves a health-check endpoint) ──────
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Deck Quest relay OK\n');
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => console.log(`Deck Quest relay on port ${PORT}`));

// ── Keep Render free tier alive (pings itself every 5 min) ────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  const https = require('https');
  setInterval(() => {
    https.get(SELF_URL).on('error', () => {});
  }, 5 * 60 * 1000);
}

// ── Room registry ─────────────────────────────────────────────────────────────
// rooms[code] = { gm: WebSocket|null, players: { slot: WebSocket } }
const rooms = {};
function getRoom(code) {
  if (!rooms[code]) rooms[code] = { gm: null, players: {} };
  return rooms[code];
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Connection handling ───────────────────────────────────────────────────────
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws._room = null;
  ws._role = null;
  ws._slot = null;

  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // ── Registration ──────────────────────────────────────────────────────────
    if (data.type === 'register') {
      ws._room = data.room;
      ws._role = data.role;
      ws._slot = data.slot || 'gm';
      const room = getRoom(data.room);

      if (data.role === 'gm') {
        room.gm = ws;
      } else {
        room.players[data.slot] = ws;
        // Tell the GM a player WebSocket has connected
        safeSend(room.gm, { type: '_ws-connected', slot: data.slot });
      }
      return;
    }

    // ── App-level ping — echo directly back for latency measurement ──────────
    if (data.type === 'ping') {
      safeSend(ws, { type: 'pong', ts: data.ts });
      return;
    }

    if (!ws._room) return;
    const room = rooms[ws._room];
    if (!room) return;

    // ── GM → player(s) ────────────────────────────────────────────────────────
    if (ws._role === 'gm') {
      if (data.to) {
        // Targeted: to a specific player
        safeSend(room.players[data.to], data.msg);
      } else {
        // Broadcast: to all players
        const str = JSON.stringify(data.msg);
        for (const p of Object.values(room.players)) {
          if (p.readyState === WebSocket.OPEN) p.send(str);
        }
      }
      return;
    }

    // ── Player → GM ───────────────────────────────────────────────────────────
    if (ws._role === 'player') {
      safeSend(room.gm, { from: ws._slot, msg: data.msg });
    }
  });

  ws.on('close', () => {
    if (!ws._room) return;
    const room = rooms[ws._room];
    if (!room) return;
    if (ws._role === 'gm') {
      room.gm = null;
    } else if (ws._slot) {
      delete room.players[ws._slot];
      safeSend(room.gm, { type: '_ws-disconnected', slot: ws._slot });
    }
  });
});

// ── Heartbeat: drop dead connections every 30 s ───────────────────────────────
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
