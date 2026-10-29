# SLOPSTRIKE

A browser-native tactical FPS with an authoritative Node game server, five gamemodes,
an economy/shop, and a 3D map creator. No assets to download — all geometry, textures
and audio are generated procedurally.

```bash
npm install
npm start          # http://localhost:3000
```

Open two browser tabs to test real multiplayer. Both clients connect over WebSocket to
the same authoritative server; bots fill the room until humans arrive.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Space | Jump |
| Shift | Walk (quiet) |
| Ctrl / C | Crouch |
| LMB | Fire |
| RMB | Scope (LR-50) |
| R | Reload |
| E | Plant / defuse (hold) |
| G | Throw frag grenade |
| 1 / 2 / 3 | Primary / sidearm / knife |
| B | Buy menu (freeze time / spawn) |
| Tab | Scoreboard |
| T / Enter | Chat |
| Esc | Pause menu |
| M | Mute |

## What's implemented

### Netcode
- Authoritative 60 Hz server tick, 20 Hz compact snapshots.
- Client-side prediction with **replayed unacknowledged inputs** against the same shared
  physics module the server runs (`shared/physics.js`).
- Server reconciliation with a decaying positional correction, so corrections never snap
  the camera.
- Snapshot interpolation for remote players with a 90 ms jitter buffer and a clock offset
  estimated from packet timestamps.
- **Lag compensation**: each player keeps a 40 Hz position history; hitscan shots rewind
  targets by `ping/2 + interp`, clamped to 240 ms.
- Ping/jitter measurement, RTT fed back into the hit-registration window.
- Rate limiting on inputs, chat and messages; server-side hit validation, spread, ammo,
  fire-rate and buy validation.

### Gamemodes
- **Team Deathmatch**, **Free For All**, **Bomb Defusal** (rounds, plant/defuse, halftime
  side swap, economy, buy phase), **Gun Game** (weapon ladder, knife final), **King of the
  Hill** (rotating zones, contested logic).
- Custom rules: score/time limits, speed, gravity, jump power, damage scale, health,
  starting armour, headshots-only, friendly fire, infinite ammo/grenades, bot count.

### Rooms
- Public server browser, private rooms with passwords, 5-character join codes.
- Bots with four difficulty tiers: aim error, reaction delay, burst discipline, objective
  play (plant/defuse/hill) and obstacle recovery.
- Live room state, host controls (restart, kick, rules, bots), roster sync.

### Shop & progression
- Credits/XP awarded per match; levels; persistent profiles keyed by a local token.
- Weapon finishes, operator skins and tracer colours; equip slots for primary, sidearm,
  knife, body and tracer. Cosmetics only — no gameplay advantage.

### Map creator (MapLAB)
- 3D grid-snapped box editor with 12 materials, orbit/pan/zoom camera.
- Place/erase blocks, set spawns for both teams, bombsites and KOTH hills.
- Playtest instantly in a private room, save locally, export/import JSON, publish to the
  community map list (server-validated and sanitised).

### Rendering & performance
- Three.js, per-material merged static geometry (single draw call per material).
- Procedural canvas textures; fake-AO vertex tinting; emissive neon materials.
- Frustum culling, pooled tracers/impacts/decals/explosions, no per-frame allocations in
  hot paths, capped decals and snapshot buffers.
- **Adaptive upscaler** with Quality/Balanced/Performance/Ultra presets: renders at
  88%/78%/66%/53% internal resolution, then runs an edge-aware FXAA-lite + CAS sharpen
  composite. Dynamic mode retargets resolution to hold ~62 FPS.

> **On DLSS:** NVIDIA DLSS is a native driver feature (it needs a native swapchain, depth
> and motion vectors, and an NGX runtime). A WebGL page cannot invoke it. The upscaler here
> is the closest browser equivalent — a spatial, sharpening, adaptive-resolution upscale —
> and the UI labels it honestly instead of claiming DLSS support.

## Architecture

```
server/            authoritative game server
  index.js         HTTP static host + WebSocket protocol
  room.js          simulation, rounds, hit reg, snapshots
  rooms.js         lobby/room manager, fixed-timestep loop
  bots.js          bot brains
  profiles.js      profile persistence (data/profiles.json)
shared/            code used by BOTH server and client
  physics.js       movement, collision, raycasts, grenades
  constants.js     weapons, modes, economy, tuning
  maps.js          built-in maps + map sanitisation
  shop.js          cosmetic catalog, XP curve
public/js/         browser client (Three.js)
  game.js          renderer, input, effects, viewmodels
  net.js           prediction, reconciliation, interpolation
  hud.js           HUD, radar, killfeed, buy menu, scoreboard
  editor.js        MapLAB
  main.js          menus, shop, loadout, match flow
  world.js         procedural materials + merged map meshes
  upscaler.js      adaptive resolution + CAS
  audio.js         procedural WebAudio
```

## Notes / limitations

- Profiles and published maps persist to `data/*.json` on the server host.
- Bots are intentionally server-side, so they use the exact same physics and weapon rules.
- The managed static hosting used for previews cannot run a persistent WebSocket game
  server; run `npm start` on a Node host (or locally) for multiplayer.
- In-browser DLSS is impossible; see above.
