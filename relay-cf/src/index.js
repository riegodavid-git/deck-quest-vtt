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
import { applyOp, viewFor, migrateState, ensureCharacterToken, ensureSlot } from "../../engine.mjs";

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = null;        // authoritative state (null until init-state)
    this.loaded = false;     // whether we've read storage this instance
    this.assetKinds = {};    // hash -> kind, learned from asset-begin
    this._persistTimer = null; // trailing-debounce handle for move/patch persists
  }

  // ── storage / lifecycle ────────────────────────────────────────────────────
  async ensureLoaded() {
    if (this.loaded) return;
    this.game = (await this.ctx.storage.get("game")) ?? null;
    this.loaded = true;
  }
  async persist() { if (this.game) await this.ctx.storage.put("game", this.game); }
  // Coalesce a burst of move-patch/patch ops into one trailing storage write.
  schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(async () => {
      this._persistTimer = null;
      try { await this.persist(); } catch {}
    }, 400);
  }

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
  // Reuses a known slot (rejoin/resume) or allocates the next free 'player{N}',
  // creating the hand + character token unconditionally. Returns the resolved id.
  markPresent(a) {
    if (a.role !== "player" || !this.game) return null;
    return ensureSlot(this.game, a.slot, a.name, a.pfpHash);
  }

  async webSocketMessage(ws, raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    await this.ensureLoaded();

    if (d.type === "ping") { this.send(ws, { type: "pong", ts: d.ts }); return; }

    if (d.type === "register") {
      const a = { role: d.role, slot: d.role === "gm" ? "gm" : (d.slot || null), name: d.name, pfpHash: d.pfpHash };
      ws.serializeAttachment(a);
      if (a.role === "gm") {
        if (this.game) this.sendStateTo(ws); else this.send(ws, { type: "need-init" });
      } else if (this.game) {
        const id = this.markPresent(a);               // reuse known slot or allocate next free
        if (id) ws.serializeAttachment({ ...a, slot: id }); // so clientId() resolves to the real id
        await this.persist(); this.broadcastState();
      } else {
        this.send(ws, { type: "waiting" });           // GM hasn't created the room yet
      }
      return;
    }

    if (d.type === "init-state") {
      if (this.att(ws).role !== "gm") return;
      if (!this.game) {
        this.game = migrateState(d.state);
        for (const s of this.sockets()) {              // reconcile early joiners + persist their allocated slots
          const aa = this.att(s);
          if (aa.role === "player") { const id = this.markPresent(aa); if (id) s.serializeAttachment({ ...aa, slot: id }); }
        }
        await this.persist(); this.broadcastState();
      } else {
        this.sendStateTo(ws);                          // room already exists → GM adopts it
      }
      return;
    }

    if (d.type === "reset-room") {
      // GM-only force-overwrite (New Session / Load): unlike init-state, this clobbers
      // any persisted game so the room NAME stays stable while the table is re-seeded.
      if (this.att(ws).role !== "gm") return;
      this.game = migrateState(d.state);
      for (const s of this.sockets()) {                // re-seat currently-connected players (same loop as init-state)
        const aa = this.att(s);
        if (aa.role === "player") { const id = this.markPresent(aa); if (id) s.serializeAttachment({ ...aa, slot: id }); }
      }
      await this.persist(); this.broadcastState();
      return;
    }

    if (!this.game) return;                            // everything below needs a game

    if (d.type === "op") {
      const by = this.clientId(this.att(ws));
      let res;
      try { res = applyOp(this.game, d.op, by, { connected: this.connectedPlayerIds() }); }
      catch (err) { return; }                          // one bad op can't throw out of the handler
      if (!res || res.rejected) return;
      if (res.movePatch) { this.fanout({ type: "move-patch", ...res.movePatch }, ws); this.schedulePersist(); }
      else if (res.patch) { for (const s of this.sockets()) this.send(s, { type: "patch", patch: res.patch }); this.schedulePersist(); } // broadcast to ALL incl. actor; idempotent
      else if (res.whisper) {
        // Private whisper — targeted relay, NEVER persisted or broadcast. Delivered to
        // the recipient AND echoed back to the sender (so they see their own outgoing
        // message). The GM also gets a copy of any player↔player whisper (moderation).
        const w = res.whisper;
        const out = { type: "whisper", from: w.from, to: w.to, text: w.text, color: w.color, name: w.name, ts: w.ts };
        const sockFor = (id) => id === "gm" ? this.gmSocket() : this.socketFor(id);  // socketFor('gm') is unreliable → use gmSocket()
        const dests = new Set([ sockFor(w.to), sockFor(w.from) ]);
        if (w.from !== "gm" && w.to !== "gm") dests.add(this.gmSocket());
        for (const s of dests) if (s) this.send(s, out);
      }
      else if (res.gmOnly) { const gm = this.gmSocket(); if (gm) this.sendStateTo(gm); await this.persist(); }
      else { await this.persist(); this.broadcastState(); }
      return;
    }

    if (d.type === "drag") {                           // ephemeral live-drag preview (not persisted)
      this.fanout({ type: "move-patch", kind: d.kind, instId: d.instId, x: d.x, y: d.y, z: d.z, boardId: d.boardId }, ws);
      return;
    }

    if (d.type === "cursor") {
      const who = this.clientId(this.att(ws)); const p = this.game.hands[who] || {};
      this.fanout({ type: "cursor-update", who, x: d.x, y: d.y, color: p.color || "#fff", name: p.name || who, pfpHash: p.pfpHash }, ws);
      return;
    }

    if (d.type === "ping") {                           // ephemeral laser-pointer marker (not persisted)
      const who = this.clientId(this.att(ws)); const p = this.game.hands[who] || {};
      this.fanout({ type: "ping-show", who, x: d.x, y: d.y, color: p.color || "#fff", name: p.name || who, pfpHash: p.pfpHash, boardId: d.boardId }, ws);
      return;
    }

    if (d.type === "ruler") {                           // ephemeral measure-tool line (not persisted)
      const who = this.clientId(this.att(ws)); const p = this.game.hands[who] || {};
      this.fanout({ type: "ruler-show", who, ax: d.ax, ay: d.ay, bx: d.bx, by: d.by, metric: d.metric, color: p.color || "#fff", name: p.name || who, boardId: d.boardId }, ws);
      return;
    }
    if (d.type === "ruler-clear") {                    // peer released the ruler → hide it everywhere
      const who = this.clientId(this.att(ws));
      this.fanout({ type: "ruler-hide", who }, ws);
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
  }

  async webSocketClose(ws) {
    await this.ensureLoaded();
    // Flush any pending move/patch debounce so a clean disconnect saves latest positions.
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
    const a = this.att(ws);
    if (a.role === "player" && this.game && this.game.hands[a.slot]) {
      this.game.hands[a.slot].connected = false;
      await this.persist(); this.broadcastState();
    } else if (this.game) {
      await this.persist();                            // commit any in-flight debounced writes
    }
  }
  async webSocketError(ws) { try { await this.webSocketClose(ws); } catch {} }
}

// ── Edge-hosted art: GET /a/<path> serves from KV; PUT /a/<path> (secret) publishes ──
async function serveArt(request, env, url) {
  const key = decodeURIComponent(url.pathname.slice(3));   // strip leading "/a/"
  if (!key) return new Response("Bad request", { status: 400 });
  if (request.method === "GET") {
    if (!env.ART) return new Response("No store", { status: 503 });
    const { value, metadata } = await env.ART.getWithMetadata(key, "arrayBuffer");
    if (!value) return new Response("Not found", { status: 404 });
    return new Response(value, { headers: {
      "Content-Type": (metadata && metadata.ct) || "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    }});
  }
  if (request.method === "PUT") {
    if (request.headers.get("x-publish-secret") !== env.PUBLISH_SECRET) return new Response("Forbidden", { status: 403 });
    const buf = await request.arrayBuffer();
    await env.ART.put(key, buf, { metadata: { ct: request.headers.get("Content-Type") || "image/png" } });
    return new Response("OK");
  }
  return new Response("Method not allowed", { status: 405 });
}

// ── Worker: serve art, else route each WS upgrade by room code to its Room DO (APAC) ──
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/a/")) return serveArt(request, env, url);
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Deck Quest relay OK\n");
    const room = decodeURIComponent(url.pathname.replace(/^\/r\//, "")) || "lobby";
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room), { locationHint: "apac" });
    return stub.fetch(request);
  },
};
