# Changelog

All notable changes to Deck Quest VTT. Newest first. Versions are GitHub releases
(`gm.html` / `player.html` are attached to each); the Cloudflare Worker in `relay-cf/`
is redeployed whenever the host protocol changes.

## v1.3.0 — Owlbear-inspired tactical & QoL features (2026-06-14)

A large feature drop: 11 features sourced from an Owlbear Rodeo research audit, then gap-analyzed
against v1.2.0. The Cloudflare Worker was redeployed in lockstep — the host protocol gained new ops
and ephemeral message types (it stays backward-compatible with older clients).

### Added
- **Grid overlay + snap-to-grid** — optional per-board square/hex grid (cell size, color, opacity,
  line style); snap on token drop, Ctrl bypasses; GM-authored, off by default.
- **Measurement / ruler tool** (hold-free `M`) — drag to measure; reads in grid cells when a grid is
  on (Euclidean / Chebyshev / Manhattan); visible to teammates live; transient (never persisted).
- **AoE / spell-area templates** — place, aim, and resize cone / circle / line / cube overlays as
  first-class table objects (move, recolor, lock, duplicate, delete).
- **Initiative / turn-order tracker** — per-board combatant list with round counter, active-turn
  highlight (mirrored onto the table token), sort, and add-from-token; GM-driven, players read-only.
- **Fog of war** — GM paints fog (Fill) and reveals / re-hides regions (Cut / Hide brush + rectangle),
  opaque to players and semi-transparent to the GM; per board, persisted; Undo / Clear.
- **Token auras / emanations** — a colored radius ring (circle or square) that follows a token.
- **Ping / laser-pointer** (hold `Q`) — a fading colored ping tagged with who pinged, plus an
  off-screen edge arrow pointing toward pings outside your viewport.
- **Hide / reveal token from players** — GM-only staging: a token invisible to players (ghosted for
  the GM) until revealed; its existence never reaches the player view.
- **Private whispers** — direct messages alongside public chat via a target selector, routed only to
  the recipient / sender (and the GM for moderation), never broadcast or saved.
- **Persistent named rooms + invite link** — name your room for a stable URL whose table persists
  between sessions; New Session / Load keep the same room; "Copy invite" + `#room=` prefill.
- **Drag-and-drop / paste image import** — drop or paste an image onto the table; a Map/Token picker
  places it at the cursor.

### Changed
- Engine unit tests grew **80 → 247**.

### Kept by design
- The **open control model** is preserved; **fog**, **hide-token**, and **whisper** are deliberate
  GM-scoped exceptions (server-enforced, never leaking to the player view).

## v1.2.0 — Dynamic slots, faster rendering & robustness (2026-06-14)

A large reliability + performance pass driven by a full multi-agent audit of the codebase.
The Worker was redeployed in lockstep with this release because the host protocol changed.

### Added
- **Join by name.** Players no longer pick a slot, and the GM no longer sets a player count
  up front. The host allocates a `player{N}` slot the moment someone joins.
- **GM can remove a player** — a × control next to each player in the right rail deletes
  their slot, sheet, and character token for everyone (`remove-slot` op).
- **Placeholder character tokens.** A player who joins without a profile picture still gets a
  character token, rendered as a readable name/number circle (previously they got no token at all).
- **Move tokens with the arrow keys** (Shift = larger steps) and **pan with WASD**.
- **GM "Edit locked" toolbar toggle** — locked figurines are now click-through (so you can
  grab tokens beneath a locked map); toggle this on to re-acquire and unlock the map itself.

### Changed (performance)
- **Keyed / diff rendering.** The card and figurine layers reuse their DOM nodes across renders
  instead of tearing the whole layer down (`innerHTML = ''`) and rebuilding every node + reloading
  every image on each update.
- **Pen overlay canvas.** The in-progress stroke is drawn on a lightweight `#drawLayerLive`
  overlay, so the full 4000×3000 committed canvas is no longer cleared and repainted on every
  mouse-move sample.
- **Targeted patch messages.** Common actions (card flip, status effects, HP/armor, token label,
  pen strokes) send a small in-place patch to clients instead of a full per-client state
  re-broadcast. Structural changes (deals, transfers, board switches, slot changes) still do a
  full sync.
- The host **debounces position persistence** (a burst of moves collapses into one storage write),
  and selecting a token now toggles a CSS class instead of re-rendering the whole UI.

### Fixed
- **Pen strokes no longer vanish** on a flaky connection — strokes are applied optimistically and
  queued for guaranteed delivery, and reconcile cleanly with the host's copy.
- **GM Notes now persist** (they were written to local state only and silently lost on the next
  broadcast or reconnect).
- **Player resume** keeps the same slot/hand after a reload (the server-allocated slot is now saved).
- No more **snap-back** on multi-select / batch token moves; **move-patches carry a board id** so a
  GM previewing another board can't mis-apply an echo.
- The **eraser** can remove a just-drawn (not-yet-confirmed) stroke; **New Session** clears leftover
  optimistic strokes/ops; a **GM who resumes a room the host has lost** now rebuilds a fresh table
  instead of sitting on a blank screen; **missing token/map art retries** until it arrives.
- **Engine hardening** (server-authoritative): `set-player-field` is restricted to an allow-list;
  `draw` / `discard-send` / `spawn-card` validate their targets; `set-group` honors locks; board ops
  reject unknown ids; and the Durable Object wraps op handling in `try/catch` so one bad op can't
  take down the room. Engine unit tests grew 39 → 80.
- **Input consistency:** Escape, space-pan, and Ctrl+C/V/G now respect text fields and no longer
  hijack native copy/paste/find; arrow-move is throttled (one rAF loop) instead of flooding the
  socket on key-repeat; single-card discards ask for confirmation.

### Kept by design
- **Open control model** — any player may move/edit/delete any *unlocked* token or map, and all
  hands are visible at the table. (The `locked` flag is the protection mechanism.)
- Cards drawn/played to the table land at the board's default position.

## v1.1.0 — Deck cards served from the edge (2026-06-07)
All deck card art (faces + backs) is hosted on Cloudflare KV and served from the Worker with
immutable browser caching, so card images never travel over the GM's connection for the GM or
players. Tokens and battlemaps still load from the GM's local assets folder.

## v1.0.1 — Auto-reconnect & session resume (2026-06-05)
Dropped connections auto-reconnect with backoff; GM and players resume their session after a reload.
Dead-code cleanup; fixed GM tokens stuck "Loading…" after a resume.

## v1.0.0 — Server-hosted game (Cloudflare Durable Objects) (2026-06-05)
The authoritative game state moved off the GM's browser into a Cloudflare Durable Object: a shared
engine (`engine.mjs`) runs in the host, applies every op, and broadcasts per-client views. No one's
home connection is in the critical path anymore. Lazy/paced asset transfer.

## v0.13.0 — Stat point-buy + dice modifiers (2026-06-05)
Point-buy stat sliders with modifiers, a dice-roller stat picker, dynamic (un-reserved) slots,
flip-art-only tokens, and a themed dropdown.

## Earlier (0.x)
- **v0.12.x** — data-driven cards + in-app card editor + per-type layouts (later reverted to v0.11.1).
- **v0.11.x** — true locking, manual save, unsaved-changes warning, easier menu dismissal.
- **v0.10.x** — spawn zones, smoother group drags, lasso-select over locked maps.
- **v0.9.0** — multiple board states (prepare & activate).
- **v0.8.0** — mass-edit, grouping, copy/paste.
- **v0.7.0** — resize from any corner, per-token name toggle.
- **v0.6.x** — keybinds, shortcut-help panel, token stamper.
- **v0.5.0** — smoother movement via delta-patches + optimistic updates.
- **v0.4.x** — network status indicator and earlier groundwork.
