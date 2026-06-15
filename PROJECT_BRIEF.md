# Deck Quest VTT — Project Brief

> **Last updated:** 2026-06-14  
> **Latest release:** v1.3.1  
> **GitHub repo:** https://github.com/riegodavid-git/deck-quest-vtt  
> **Live host:** Cloudflare Worker + Durable Object — `wss://deck-quest-vtt.david-riego-01.workers.dev` (`relay-cf/`)  
> **Official game page:** https://www.garagesofagames.com/games/deck-quest

> ⚠️ **Historical note:** parts of this brief are a pre-**v1.0** snapshot — they predate the migration from a Render WebSocket relay to **Cloudflare Workers + Durable Objects**. The relay/deployment details have been corrected to Cloudflare; the legacy Render relay (`relay/`) and the Render service have been removed. For the authoritative current architecture see **`README.md`**, and **`CHANGELOG.md`** for version history.

---

## 1. What This Project Is

A self-contained virtual tabletop (VTT) for **Deck Quest**, an open-ended card-based TTRPG. Two standalone HTML files (`gm.html` and `player.html`) that players open locally — no install, no account, no setup beyond downloading the file. (Card/token art loads at runtime — deck art from Cloudflare KV, tokens/maps from the GM's local assets folder — rather than being base64-embedded, so the files stay small.)

Real-time sync runs through an **authoritative Cloudflare Worker + Durable Object** (`relay-cf/`): one Durable Object per room validates and applies every op server-side, then broadcasts a filtered view to each client. Data routes through the edge (not peer-to-peer), so it works on all home networks regardless of NAT/firewall.

---

## 2. Repository Layout

```
deck-quest-vtt/
├── build.js                          # Node build script — scans PNGs, compresses tokens, emits dist/
├── package.json                      # { "dependencies": { "sharp": "^0.33.0" } }
├── templates/
│   ├── shared.js                     # Core engine (~2200 lines) — shared between GM and Player
│   ├── gm.template.html              # GM client markup + CSS
│   └── player.template.html          # Player client markup + CSS
├── relay-cf/                         # Cloudflare Worker + Durable Object host (the live relay)
│   ├── src/index.js                  # Worker router + Room DO — applies ops, broadcasts viewFor, persists
│   └── wrangler.toml                 # deploy config — `cd relay-cf && npx wrangler deploy`
├── Deck Quest Open Source PNGs/      # Card art (gitignored from dist, committed as source)
│   ├── Roles/PNGs/                   # 75 cards
│   ├── Skills/PNGs/                  # 25 cards
│   ├── Items/PNGs/                   # 76 cards
│   ├── Location/PNGs/                # 76 cards
│   ├── Adversaries/PNGS/             # 75 cards
│   ├── Info/PNGs/                    # 10 cards
│   ├── Backs/PNGs/                   # Card back images
│   └── 1st D&D Token  Collection/   # 1924 tokens in 90+ category folders
├── dist/                             # Built output — gitignored, published as GitHub Release assets
│   ├── gm.html                       # ~145 MB (cards + tokens embedded)
│   └── player.html                   # ~145 MB
├── PROJECT_BRIEF.md                  # This file
├── About Deck Quest.md               # Game overview
└── README.md                         # Public-facing docs
```

---

## 3. How to Build

```bash
# One-time install (only needed after cloning)
npm install

# Build both dist files
node build.js
```

`build.js`:
1. Reads all card PNGs as raw base64
2. Walks `1st D&D Token Collection/` recursively, compresses every PNG to **128×128** via `sharp` (preserves transparency), batches in groups of 40
3. Injects `CARDS` and `TOKENS` arrays into both templates via `%%CARDS_JSON%%` and `%%TOKENS_JSON%%` placeholders
4. Inlines `shared.js` via `%%SHARED_JS%%`
5. Writes `dist/gm.html` and `dist/player.html`

**Rebuild time:** ~2–3 minutes (dominated by sharp compression of 1924 tokens).

---

## 4. How to Release

```bash
node build.js
git add templates/ build.js   # (or whatever changed)
git commit -m "vX.Y.Z: description"
git push
gh release create vX.Y.Z dist/gm.html dist/player.html --title "..." --notes "..." --latest
```

GitHub release assets are the two HTML files. Players download `player.html` from the Releases page.

---

## 5. Architecture

### Networking — authoritative Cloudflare Durable Object

```
GM (gm.html)  ←→  wss://deck-quest-vtt.david-riego-01.workers.dev  ←→  Players (player.html)
                  (Cloudflare Worker → one Room Durable Object per room)
```

- **The Durable Object is the authoritative host.** Every op is validated (`canApply`) and applied server-side via the shared engine (`engine.mjs`), then a filtered view (`viewFor`) is broadcast per client. No player's connection — not even the GM's — is in the critical path.
- **Worker/DO** (`relay-cf/src/index.js`) routes WebSocket messages and owns game state. Ephemeral signals (cursor, drag, ping→`ping-show`, ruler, whisper) are relayed without persisting; structural ops persist to DO storage.
- **Deck card art** is served from **Cloudflare KV** (immutable-cached) and never travels over the GM's connection. **Tokens/maps** load from the GM's local assets folder.
- **Uploaded assets** (player profile pics, GM-imported maps/figurines) are transferred as chunked base64 over WebSocket and cached in IndexedDB.
- **Persistence:** the DO persists each room's state to storage and survives hibernation, so a named room's table is restored on reconnect.

### State model

```js
STATE = {
  roomCode: 'adjective-noun-NN',
  playerCount: 1–10,
  decks:    { role:[], skill:[], item:[], location:[], adversary:[] },   // arrays of cardIds
  discards: { role:[], ... },
  table: {
    cards:     [{ instId, cardId, faceUp, x, y, rot, z, locked }],
    figurines: [{ instId, kind:'character'|'map'|'figurine', assetHash,
                  playerId?,          // character tokens only
                  x, y, w, h, rot, z, opacity, locked, flipH, flipV, label, effects:{} }],
    drawings:  [{ id, by, color, width, points:[[x,y],...] }],
  },
  hands: {
    gm:      { name:'GM', color:'#3b82f6', hand:[] },
    player1: { name, pfpHash, stats:{str,agi,int,cha,sta}, hp:{current,max},
               armor:{current,max}, info:{class,race,age,weight},
               gold, inventory:[], notes:'', hand:[], connected, color },
    ...
  },
  assetMeta: { hash: { kind:'pfp'|'map'|'figurine', size } },
  log: [{ ts, who, text, kind:'info'|'roll'|'sys'|'warn', color }],
}
```

`viewFor(playerId)` strips the GM hand entirely before broadcasting to players.

### Z-order

All card and figurine z-values use a monotonic `nextZ()` counter (not `Date.now()`). This keeps values well below browser's int32 clamp (~2.1B), leaving room for overlays:

| Layer | z-index |
|---|---|
| Figurines / cards | 1 – ~2000 (counter) |
| Cursor layer | 1000 |
| Drawing layer (pen mode) | 999999 |
| Toolbar | 2000000 |
| Alt-preview | 2147483646 |
| Context menus | 2147483647 |

Z-order only changes on explicit **Bring to front / Send to back** — dragging does NOT raise items.

### Pan / zoom

Local-only (not synced). Stored in `tableZoom`, `tablePanX`, `tablePanY`. Applied as `transform: translate(panX, panY) scale(zoom)` on `#tableContent`. Scroll wheel zooms toward cursor. Space+drag pans.

All drag and drawing coordinates are converted to table space: `tableX = (screenX - panX) / zoom`.

### Multi-select

`selectionSet` (global `Set` of instIds). Ctrl+click toggles items; drag on empty table lasso-selects. Dragging a selected item moves the whole group — deltas applied to each member's stored position. Escape clears selection.

---

## 6. Key Files — What Lives Where

### `templates/shared.js` — the entire game engine

| Section | What it does |
|---|---|
| Constants / card lookup | `CARDS_BY_ID`, `CARDS_BY_TYPE`, `TOKENS_BY_ID`, `selectionSet` |
| Pan/zoom state | `tableZoom`, `tablePanX/Y`, `spaceHeld`, `applyTableTransform()` |
| IndexedDB | `openAssetDB()`, `cacheAssetGet/Put()` |
| State | `newState()`, `viewFor()`, `activeState()`, `migrateState()`, `normalizeZ()` |
| Logging + dice | `logEntry()`, `renderLog()`, `rollAndLog()` |
| Networking | `setupPeerGM()`, `setupPeerPlayer()`, `makeConn()`, `sendAsset()`, `handleFromPlayer()`, `handleFromGM()`, `sendOp()`, `broadcast()` |
| State ops | `applyOp()` — single switch handling all mutations |
| Save / load | `autosave()`, `downloadSession()`, `loadSessionFile()`, `tryRestoreLast()` |
| Rendering | `renderTable()`, `renderFigurines()`, `renderTableCards()`, `renderDrawings()`, `renderRightRail()`, `renderLog()` |
| Context menus | `showMenu()`, `showFigurineContextMenu()`, `showCardContextMenu()`, `showDeckContextMenu()` |
| Drag helpers | `makeDraggable(elm, onEnd, instId)` — supports Ctrl+click selection + group drag |
| Drawing tools | `setupTableInteraction()`, `setTool()`, `eraseAt()`, `strokeHit()` |
| Token panel | `openTokenPanel()`, `buildTree()`, `tokenThumb()` |
| Panels | `setupFloatingPanels()`, `makePanelDraggable()` |
| Setup wizards | `gmSetupFlow()`, `playerJoinFlow()` |
| Boot | `boot()` — called on DOMContentLoaded |

### `relay-cf/src/index.js`

The Cloudflare Worker + Room Durable Object. Routes by `env.ROOMS.idFromName(room)` (one DO per room). Handles `register` / `init-state` / `reset-room`, applies ops via `engine.mjs`, broadcasts `viewFor` per client, relays ephemeral signals (cursor, drag, ping→`ping-show`, ruler, whisper), and persists state to DO storage. The `ping`/`pong` heartbeat is reserved at the top of `webSocketMessage` — new ephemeral message types must not reuse `ping` (that collision broke the laser pointer in v1.3.0, fixed in v1.3.1).

---

## 7. Feature List (Implemented)

### Table
- [x] 5 deck types (Roles, Skills, Items, Locations, Adversaries) + Info
- [x] Shuffleable decks, discard piles, clickable discard viewer (return cards to deck/table/hand)
- [x] Cards on table: drag, rotate, flip face-up/down, lock, discard, return to deck
- [x] Figurine/token import: drag, resize, rotate, flip H/V, transparency, lock, z-order, label, duplicate, delete
- [x] PNG transparency preserved for tokens
- [x] Character tokens: auto-spawned per player, circular ring, nametag, status effects (8 types)
- [x] D&D token panel: 1924 tokens, 90+ categories, search, click to drop on table
- [x] Shared drawing layer: pen tool, object-eraser (click stroke to remove), color picker, clear (GM), undo my last (players)
- [x] Named cursors with player pfp icons, throttled to ~17fps
- [x] Alt+hover any card for full-size preview
- [x] Card search overlay (`Search cards` button) — spawn to table or player hand
- [x] Pan: Space+drag; Zoom: scroll wheel (cursor-centered) + slider; Reset button
- [x] Multi-select: Ctrl+click or drag-lasso; group drag; group delete/lock via right-click; Escape to clear

### Players
- [x] Join screen: room code, name, slot picker, optional profile pic
- [x] Slot collision detection (can't steal occupied slot)
- [x] Per-player stats sheet: Name, Class/Race/Age/Weight, HP/Armor (with bars), STR/AGI/INT/CHA/STA, Gold, Inventory, Notes
- [x] HP/Armor visible in collapsed panel header
- [x] Player hands fully visible to all players (GM hand is private)
- [x] Profile pic → auto-creates character token; synced via WebSocket chunks + IndexedDB cache
- [x] Players can manipulate any unlocked figurine/card

### GM
- [x] Draw deck → GM hand / table / any player
- [x] Edit all player stats
- [x] Add Map / Add Token (GM and players can both upload)
- [x] Clear drawings
- [x] Save session (JSON download includes all uploaded assets)
- [x] Load session (restores table, hands, assets)
- [x] Autosave to localStorage on every state change
- [x] New Session button

### UI / UX
- [x] Gold/parchment/charcoal design system (Stitch-inspired)
- [x] Glassmorphism floating panels (`backdrop-filter: blur`)
- [x] Base64-embedded fonts: Libre Caslon Text, Hanken Grotesk, JetBrains Mono
- [x] Inline SVG icon set (no emoji, no CDN dependency)
- [x] Panel expansion state preserved across rerenders
- [x] Inputs commit on Enter or blur only (no typing-while-syncing wipe)
- [x] Focus preserved during state rerenders (`withPreservedFocus`)
- [x] Right-click menus reposition to stay inside viewport
- [x] Deck / Discard panels: slide-toggle (GM only), tabs re-open them
- [x] Log overlay: collapsible header toggle
- [x] Chat panel: real-time text chat for all clients
- [x] Dice roller: d4/d6/d8/d10/d12/d20/d100, custom `NdM+K`, results broadcast to log
- [x] GM notes: private collapsible notepad in right rail
- [x] Token HP/armor bars above figurines (below for character tokens)
- [x] Skull overlay when token HP reaches 0
- [x] Token detail popup (right-click → edit HP/armor current/max)
- [x] Resize handle hidden until hover; no lock icon clutter
- [x] Number inputs have no browser spinner arrows

---

## 8. Known Issues / Bugs

| Issue | Severity | Notes |
|---|---|---|
| ~~Render free-tier cold start~~ (resolved at v1.0) | — | No longer applies — the live host is a Cloudflare Worker + Durable Object (no spin-down) |
| Drawing coords off when zoomed + canvas resized | Low | Canvas size is 4000×3000 virtual; at extreme zoom levels strokes may appear offset |
| Group drag doesn't move items visually during drag when they are on different layers (cards vs figurines) | Low | Positions update correctly on mouseup via ops |
| No undo for table ops (card moves, figurine ops) | Medium | Would need op history stack |
| Session save can fail if localStorage is full (~5MB limit) | Low | Error caught silently; manual Save to JSON always works |
| ~~Render free-tier CPU at 10 players~~ (resolved at v1.0) | — | No longer applies — Cloudflare Workers; cursor throttle is still tunable in `setupTableInteraction` |

---

## 9. Configuration / Constants to Know

### `templates/shared.js`

```js
const RELAY_URL = 'wss://deck-quest-vtt.david-riego-01.workers.dev';  // ← the Cloudflare Worker; update if redeployed elsewhere
```

After changing `RELAY_URL`, run `node build.js` to rebuild.

### Cursor throttle (performance tuning)
```js
// In setupTableInteraction():
if (now - cursorThrottle > 60) {   // ← increase to 100 for 10-player sessions
```

### Token thumbnail size (file size tuning)
```js
// In build.js scanTokens():
.resize(128, 128, ...)   // ← reduce to 96 or 80 to shrink file size
```

---

## 10. Deployment

### Relay host (Cloudflare Workers + Durable Objects)
- **Service:** `deck-quest-vtt` Worker at https://deck-quest-vtt.david-riego-01.workers.dev
- **Source:** `relay-cf/` (`src/index.js` + `wrangler.toml`)
- **Deploy:** `cd relay-cf && npx wrangler deploy` — **NOT automatic.** Redeploy whenever `engine.mjs` or `relay-cf/src/index.js` changes (the DO bundles the engine, so new ops won't work until redeployed).
- **Bindings:** a `ROOMS` Durable Object namespace (one DO per room) + an `ART` KV namespace (deck card art).
- **Tier:** Cloudflare free Workers plan, pinned to the APAC region.
- **Note:** the old Render service was retired at v1.0 and has since been deleted.

### GitHub releases
- Only `dist/gm.html` and `dist/player.html` are published as release assets
- `dist/` is gitignored and published only as release assets (~0.5–0.8 MB each, since art is no longer embedded)
- Use `gh release create vX.Y.Z dist/gm.html dist/player.html --latest` to publish

---

## 11. Possible Next Steps

These were discussed or naturally follow from current state:

| Feature | Complexity | Notes |
|---|---|---|
| **Undo / redo** for table ops | High | Needs op history stack on GM; could be limited to last N ops |
| **Map grid overlay** | Medium | Toggle-able grid (hex or square) over the table; configurable size/color |
| **Fog of war** | High | GM-controlled reveal zones; complex to sync |
| **Initiative tracker** | Medium | Ordered list of combatants with HP visible; sortable |
| **Ping / marker tool** | Low | Click to drop a temporary animated marker visible to all |
| **GM notes panel** | Low | A private GM notepad (not synced to players) |
| **Player-to-player private chat** | Medium | Currently log is shared; private DMs would need routing changes |
| **Card back customization** | Low | Allow GM to set custom card back per deck |
| **Animated status effect badges** | Low | CSS pulse/glow on active effects |
| **Session password** | Low | Simple room-code password to prevent uninvited joins |
| **Token panel in-session search persists** | Low | Currently resets search when reopened |
| **Reduce file size** | Low | Drop token thumbnail size from 128px to 96px saves ~20MB per file |
| **Snap-to-grid for figurine movement** | Medium | Hold Shift while dragging to snap to configurable grid |
| **Sound effects** | Low | Optional click/dice/card sounds (base64 audio) |

---

## 12. How to Continue in a New Session

1. Read this file first for context.
2. **Branches:**
   - `main` — stable navy-and-blue UI (v0.2.3)
   - `ui-redesign` — Stitch-inspired gold/parchment redesign (v0.3.0-ui). Uses base64-embedded fonts from `fonts/`, an `ICONS` SVG set in `shared.js`, and `.stat-medallion` circular HP/AC chips in the player panel header. Same engine, same element IDs, same op routing.
3. Open the repo: https://github.com/riegodavid-git/deck-quest-vtt
4. Key files to read before making changes:
   - `templates/shared.js` — the entire game engine
   - `templates/gm.template.html` — GM client CSS and HTML structure
   - `templates/player.template.html` — Player client CSS and HTML structure
   - `fonts/` (ui-redesign branch only) — base64-embedded woff2 fonts injected via `%%FONTS_CSS%%`
5. After any code change: `node build.js` → test `dist/gm.html` locally → commit → push → `gh release create`
6. Relay/engine changes (`relay-cf/src/index.js`, `engine.mjs`) need a manual `cd relay-cf && npx wrangler deploy` — they do **not** auto-deploy.

### Quick syntax check before building
```bash
node -e "const fs=require('fs'); try{new Function(fs.readFileSync('templates/shared.js','utf8')); console.log('OK')}catch(e){console.error(e.message)}"
```

---

## 13. Version History

| Version | Date | Summary |
|---|---|---|
| v0.3.5 | 2026-06-01 | Resize handle hidden until hover; lock icon removed to reduce clutter |
| v0.3.4 | 2026-06-01 | Remove music player (incomplete); player template strips deck/discard panels; number input spinners hidden |
| v0.3.3 | 2026-06-01 | Music panel repositioned |
| v0.3.2 | 2026-06-01 | Fix chat sync to players (viewFor missing chat/music); fix music YT player init; discard panel overlap fixed; 2-column deck grid, no scroll |
| v0.3.1 | 2026-06-01 | Loading time fix (JSON.parse vs JS literal); chat panel; HP/armor bars on tokens; skull at HP 0; token detail popup; GM notes; token 1:1 resize |
| v0.3.0 | 2026-06-01 | Stitch-inspired UI redesign merged to main: gold/parchment palette, glassmorphism panels, base64-embedded fonts (Libre Caslon + Hanken Grotesk + JetBrains Mono), inline SVG icons, stat medallions, grouped-item copper rings |
| v0.2.3 | 2026-06-01 | Hotfix: syntax error in context menu broke page load |
| v0.2.2 | 2026-06-01 | Multi-select (Ctrl+click / lasso), movable panels, token panel position fix |
| v0.2.1 | 2026-06-01 | D&D token panel: 1924 tokens, 90+ categories, search, click to drop |
| v0.2.0 | 2026-05-31 | Replace PeerJS/WebRTC with WebSocket relay (fixes all NAT connectivity issues) |
| v0.1.6 | 2026-05-31 | Added STUN/TURN servers (partial connectivity fix, superseded by v0.2.0) |
| v0.1.5 | 2026-05-31 | Right-click menus reposition to stay inside viewport |
| v0.1.4 | 2026-05-31 | Pan (Space+drag), zoom (scroll/slider), z-order fix on figurine drag |
| v0.1.3 | 2026-05-31 | Fix player table interaction (pointer-events bug) |
| v0.1.2 | 2026-05-31 | Notes field, shared card control, open hands, focus-safe typing |
| v0.1.1 | 2026-05-31 | Slot locking, scrollable right rail, player figurines, character tokens |
| v0.1.0 | 2026-05-31 | Initial release: full VTT with all cards, dice, drawing, cursors, save/load |
