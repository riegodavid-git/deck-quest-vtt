/* Deck Quest VTT — authoritative relay on Cloudflare Workers + Durable Objects.
 *
 * One `Room` Durable Object per room code holds the authoritative game STATE,
 * applies every op through the shared engine, persists to DO storage, and
 * broadcasts a per-client `viewFor` to each connected socket. The GM and players
 * are all just clients — no one's home connection is in the critical path.
 *
 * Uses the WebSocket Hibernation API so idle rooms cost nothing; the in-memory
 * game is reloaded from storage after hibernation.
 */
import { DurableObject } from "cloudflare:workers";
import { applyOp, viewFor, migrateState, ensureCharacterToken } from "../../engine.mjs";

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = null;        // authoritative state (null until init-state)
    this.loaded = false;     // whether we've read storage this instance
    this.assetKinds = {};    // hash -> kind, learned from asset-begin
  }

  // ── storage / lifecycle ────────────────────────────────────────────────────
  async ensureLoaded() {
    if (this.loaded) return;
    this.game = (await this.ctx.storage.get("game")) ?? null;
    this.loaded = true;
  }
  async persist() { if (this.game) await this.ctx.storage.put("game", this.game); }

  // ── socket helpers ──────────────────────────────────────────────────────────
  att(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  clientId(a) { return a.role === "gm" ? "gm" : a.slot; }
  sockets() { return this.ctx.getWebSockets(); }
  gmSocket() { return this.sockets().find(s => this.att(s).role === "gm"); }
  socketFor(id) { return this.sockets().find(s => this.clientId(this.att(s)) === id); }
  connectedPlayerIds() { return this.sockets().map(s => this.att(s)).filter(a => a.role === "player").map(a => a.slot); }
  send(ws, obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch {} }

  sendStateTo(ws) { const id = this.clientId(this.att(ws)); this.send(ws, { type: "state", view: viewFor(this.game, id), myId: id }); }
  broadcastState() { for (const ws of this.sockets()) this.sendStateTo(ws); }
  fanout(obj, exceptWs) { for (const s of this.sockets()) if (s !== exceptWs) this.send(s, obj); }

  // ── connection ──────────────────────────────────────────────────────────────
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);                 // hibernatable
    return new Response(null, { status: 101, webSocket: client });
  }

  // Mark a player present in the game (used on register + init reconcile).
  markPresent(a) {
    if (a.role !== "player" || !this.game) return;
    const h = this.game.hands[a.slot]; if (!h) return;
    h.connected = true;
    if (a.name) h.name = a.name;
    if (a.pfpHash) { h.pfpHash = a.pfpHash; ensureCharacterToken(this.game, a.slot); }
  }

  async webSocketMessage(ws, raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    await this.ensureLoaded();

    if (d.type === "ping") { this.send(ws, { type: "pong", ts: d.ts }); return; }

    if (d.type === "register") {
      const a = { role: d.role, slot: d.slot || "gm", name: d.name, pfpHash: d.pfpHash };
      ws.serializeAttachment(a);
      if (a.role === "gm") {
        if (this.game) this.sendStateTo(ws); else this.send(ws, { type: "need-init" });
      } else if (this.game) {
        this.markPresent(a); await this.persist(); this.broadcastState();
      } else {
        this.send(ws, { type: "waiting" });           // GM hasn't created the room yet
      }
      return;
    }

    if (d.type === "init-state") {
      if (this.att(ws).role !== "gm") return;
      if (!this.game) {
        this.game = migrateState(d.state);
        for (const s of this.sockets()) this.markPresent(this.att(s)); // reconcile early joiners
        await this.persist(); this.broadcastState();
      } else {
        this.sendStateTo(ws);                          // room already exists → GM adopts it
      }
      return;
    }

    if (!this.game) return;                            // everything below needs a game

    if (d.type === "op") {
      const by = this.clientId(this.att(ws));
      const res = applyOp(this.game, d.op, by, { connected: this.connectedPlayerIds() });
      if (res.rejected) return;
      if (res.movePatch) { this.fanout({ type: "move-patch", ...res.movePatch }, ws); await this.persist(); }
      else if (res.gmOnly) { const gm = this.gmSocket(); if (gm) this.sendStateTo(gm); await this.persist(); }
      else { await this.persist(); this.broadcastState(); }
      return;
    }

    if (d.type === "drag") {                           // ephemeral live-drag preview (not persisted)
      this.fanout({ type: "move-patch", kind: d.kind, instId: d.instId, x: d.x, y: d.y, z: d.z }, ws);
      return;
    }

    if (d.type === "cursor") {
      const who = this.clientId(this.att(ws)); const p = this.game.hands[who] || {};
      this.fanout({ type: "cursor-update", who, x: d.x, y: d.y, color: p.color || "#fff", name: p.name || who, pfpHash: p.pfpHash }, ws);
      return;
    }

    if (d.type === "asset-begin" || d.type === "asset-chunk" || d.type === "asset-end") {
      if (d.type === "asset-begin" && d.kind) this.assetKinds[d.hash] = d.kind;
      const targets = d.to ? [this.socketFor(d.to)] : this.sockets().filter(s => s !== ws);
      for (const s of targets) this.send(s, d);
      if (d.type === "asset-end" && !d.to) {           // shared (broadcast) asset → track + announce
        this.game.assetMeta[d.hash] = { kind: this.assetKinds[d.hash] || d.kind || "figurine", path: d.path };
        await this.persist();
        this.broadcastState();                          // (targeted card art is pure relay — no meta, no broadcast)
      }
      return;
    }
    if (d.type === "asset-request") {                  // ask any peer that has it (GM or a player) to send it back
      this.fanout({ type: "asset-request", hash: d.hash, from: this.clientId(this.att(ws)) }, ws);
      return;
    }
    if (d.type === "card-request") {                   // a player wants one card image — ask the GM
      this.send(this.gmSocket(), { type: "card-request", path: d.path, from: this.clientId(this.att(ws)) });
      return;
    }
  }

  async webSocketClose(ws) {
    await this.ensureLoaded();
    const a = this.att(ws);
    if (a.role === "player" && this.game && this.game.hands[a.slot]) {
      this.game.hands[a.slot].connected = false;
      await this.persist(); this.broadcastState();
    }
  }
  async webSocketError(ws) { try { await this.webSocketClose(ws); } catch {} }
}

// ── Worker: route each WS upgrade by room code to its Room DO (pinned APAC) ────
export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Deck Quest relay OK\n");
    const url = new URL(request.url);
    const room = decodeURIComponent(url.pathname.replace(/^\/r\//, "")) || "lobby";
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room), { locationHint: "apac" });
    return stub.fetch(request);
  },
};
