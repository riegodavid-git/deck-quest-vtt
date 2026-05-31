# Deck Quest VTT

A virtual tabletop for [Deck Quest](About%20Deck%20Quest.md), an open-ended card-based tabletop RPG. Two standalone HTML files (one for the GM, one for players) sync over peer-to-peer WebRTC so a group can play remotely without any server.

## Download & Play

Grab the latest `gm.html` and `player.html` from the [Releases page](../../releases/latest).

- **GM:** open `gm.html`, choose player count, share the room code shown in the top bar.
- **Players:** open `player.html`, enter the room code, pick a slot, enter a name, optionally upload a profile pic, click Join.

Both files are fully self-contained (~56 MB each — all 337 cards are embedded as base64). Only requirement is internet, since PeerJS uses a public broker to handshake the WebRTC connection. After handshake, data flows peer-to-peer.

## Features

- **All Deck Quest cards embedded** — Roles, Skills, Items, Locations, Adversaries, and Info cards.
- **Decks + discards** — click a deck to draw to GM hand / table / any player. Click a discard pile to view it and send cards back.
- **Hands** — face-down cards stay private to their owner (and the GM); flip to reveal to others.
- **Stats sheet per player** — Name, Class/Race/Age/Weight, HP, Armor, STR/AGI/INT/CHA/STA, Gold, Inventory. HP and Armor show in the panel header.
- **Dice roller** — d4/d6/d8/d10/d12/d20/d100 + custom `NdM+K`. Rolls broadcast to the shared log.
- **Drawing layer** — pen and object-eraser tools, shared with everyone. GM can clear.
- **Cursors** — every connected player has a named, colored cursor (with their profile pic as the icon).
- **Map / token import** — GM can import any image as a movable figurine. Right-click for lock, rotate, flip, resize, transparency, z-order, duplicate, label, delete.
- **Alt-zoom** — hold Alt while hovering any card to see it full-size.
- **Save / Load / Autosave** — GM can download the session as JSON (including uploaded assets) and reload it next time.

## Development

```bash
node build.js
```

Scans `Deck Quest Open Source PNGs/`, base64-embeds every card, and outputs `dist/gm.html` and `dist/player.html`.

### File layout
```
build.js                          # one-shot generator
templates/
  shared.js                       # core engine (sync, state, rendering, dice, drawing)
  gm.template.html                # GM client markup + CSS
  player.template.html            # Player client markup + CSS
Deck Quest Open Source PNGs/      # card art
```

To ship a new version: edit a template, run `node build.js`, attach the two `dist/*.html` files to a new GitHub Release.

## Tech

- **PeerJS** (free public broker) for WebRTC signaling
- **WebRTC data channels** for state sync + chunked asset transfer
- **IndexedDB** caches uploaded assets so reconnects don't re-transfer
- **localStorage** autosaves the GM's session every state change
- No build step beyond `node build.js`. No framework dependencies in the HTML.

## License

Card art and game content © Deck Quest authors (see [About Deck Quest.md](About%20Deck%20Quest.md)). VTT code is MIT.
