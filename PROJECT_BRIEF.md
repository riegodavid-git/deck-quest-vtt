# Deck Quest VTT — Project Brief

> **Last updated:** 2026-06-01  
> **Latest release:** v0.2.3  
> **GitHub repo:** https://github.com/riegodavid-git/deck-quest-vtt  
> **Live relay server:** https://deck-quest-vtt.onrender.com  
> **Official game page:** https://www.garagesofagames.com/games/deck-quest

---

## 1. What This Project Is

A self-contained virtual tabletop (VTT) for **Deck Quest**, an open-ended card-based TTRPG. Two standalone HTML files (`gm.html` and `player.html`) that players open locally — no install, no server, no setup beyond downloading the file. All 337 card PNGs and 1924 D&D tokens are base64-embedded directly in the HTML files.

Real-time sync runs through a **WebSocket relay server** hosted on Render.com. Data routes through the server (not peer-to-peer), which means it works on all home networks regardless of NAT/firewall setup.

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
├── relay/
│   ├── server.js                     # WebSocket relay server (~124 lines)
│   └── package.json                  # { "dependencies": { "ws": "^8.16.0" } }
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

### Networking — WebSocket relay

```
GM (gm.html)  ←→  wss://deck-quest-vtt.onrender.com  ←→  Players (player.html)
```

- **GM is authoritative host.** All state lives on the GM; players send ops, GM applies + broadcasts filtered views.
- **Relay server** (`relay/server.js`) is a pure message router — no game logic. Routes: `player → GM` (wrapped as `{ from: slot, msg }`) and `GM → player` (targeted `{ to: slot, msg }`) or `GM → all` (broadcast `{ msg }`).
- **No asset transfer for built-in content.** Cards and tokens are embedded in both files, referenced only by ID.
- **Uploaded assets** (player profile pics, GM-imported maps/figurines) are transferred as chunked base64 over WebSocket and cached in IndexedDB.
- **Render free tier** spins down after ~15 min inactivity → first connection has ~30s cold start delay. Self-ping every 5 min (`RENDER_EXTERNAL_URL`) mitigates this.

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

### `relay/server.js`

Simple WebSocket relay. Rooms keyed by `roomCode`. Routes messages between GM and players. Sends `_ws-connected` / `_ws-disconnected` lifecycle events to GM. Heartbeat pings every 30s to drop dead connections.

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
- [x] Panel expansion state preserved across rerenders
- [x] Inputs commit on Enter or blur only (no typing-while-syncing wipe)
- [x] Focus preserved during state rerenders (`withPreservedFocus`)
- [x] Right-click menus reposition to stay inside viewport
- [x] Deck / Discard panels: movable (drag handle), hideable (— button), toggleable from toolbar
- [x] Log overlay: movable from header bar, collapsible
- [x] Dice roller: d4/d6/d8/d10/d12/d20/d100, custom `NdM+K`, results broadcast to log

---

## 8. Known Issues / Bugs

| Issue | Severity | Notes |
|---|---|---|
| Render free tier cold start (~30s delay) | Low | Self-ping every 5 min mitigates; upgrade to $7/mo Starter for always-on |
| Drawing coords off when zoomed + canvas resized | Low | Canvas size is 4000×3000 virtual; at extreme zoom levels strokes may appear offset |
| Group drag doesn't move items visually during drag when they are on different layers (cards vs figurines) | Low | Positions update correctly on mouseup via ops |
| No undo for table ops (card moves, figurine ops) | Medium | Would need op history stack |
| Session save can fail if localStorage is full (~5MB limit) | Low | Error caught silently; manual Save to JSON always works |
| Render free tier: 10 players with heavy cursor movement may hit CPU limits | Medium | Increase cursor throttle from 60ms → 100ms in `setupTableInteraction` if needed |

---

## 9. Configuration / Constants to Know

### `templates/shared.js`

```js
const RELAY_URL = 'wss://deck-quest-vtt.onrender.com';  // ← update if relay is redeployed
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

### Relay server (Render.com)
- **Service:** `deck-quest-vtt` at https://deck-quest-vtt.onrender.com
- **Source:** `relay/` subdirectory of this repo, `main` branch
- **Build:** `npm install` | **Start:** `npm start`
- **Tier:** Free (512MB RAM, 0.1 vCPU) — adequate for ≤10 players
- **Auto-deploy:** pushes to `main` that touch `relay/` trigger redeploy automatically
- **Keep-alive:** `RENDER_EXTERNAL_URL` env var triggers self-ping every 5 min (set automatically by Render)

### GitHub releases
- Only `dist/gm.html` and `dist/player.html` are published as release assets
- `dist/` is gitignored — files are too large (~145MB each) for normal commits
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
2. Open the repo: https://github.com/riegodavid-git/deck-quest-vtt
3. Key files to read before making changes:
   - `templates/shared.js` — the entire game engine
   - `templates/gm.template.html` — GM client CSS and HTML structure
   - `templates/player.template.html` — Player client CSS and HTML structure
4. After any code change: `node build.js` → test `dist/gm.html` locally → commit → push → `gh release create`
5. Relay server changes (`relay/server.js`) auto-deploy to Render on push — no manual step needed.

### Quick syntax check before building
```bash
node -e "const fs=require('fs'); try{new Function(fs.readFileSync('templates/shared.js','utf8')); console.log('OK')}catch(e){console.error(e.message)}"
```

---

## 13. Version History

| Version | Date | Summary |
|---|---|---|
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
