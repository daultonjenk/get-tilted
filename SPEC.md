# SPEC.md — Get Tilted (Working Title)

## 0) One-sentence pitch
**Get Tilted** is a mobile-first marble racing game: tilt your phone to roll a marble down a 3D track, and race a friend by hosting a room that generates a **QR code** to join instantly.

---

## 1) Goals, constraints, and success criteria

### 1.1 Primary goals (MVP)
1. **Great-feeling tilt controls** on Android + iOS (with an on-screen fallback).
2. **Single-player time trial**: start → checkpoints → finish → best time.
3. **2-player race via QR/link**: Host creates room, Joiner scans, both play the same track.
4. **Always-available**: the game link works 24/7 without manually “starting” anything.

### 1.2 Hard constraints (updated)
- Target dev time: **2–3 days**, ~**10–15 hours** total.
- Players install nothing beyond opening a link (optional PWA install later).
- Production must be **always-on** and **free or extremely low cost**.
- Avoid architectures that require a personal machine to host or a manual “on switch”.

### 1.3 Non-goals (explicitly out of scope for this phase)
- App Store / Play Store shipping, native wrappers, payments.
- Deterministic rollback netcode.
- Track editor and large content library.
- Matchmaking, accounts, anti-cheat, reconnection guarantees.

### 1.4 “Demo Done” checklist
- A brand-new player can:
  - open link on phone
  - press **Enable Tilt Controls** (iOS motion prompt may appear)
  - complete a race
  - host a room and show QR
  - a second phone scans and joins with no extra installs
- No crashes on iOS Safari or Android Chrome during a 2–3 minute session.

---

## 2) Platform + production architecture (updated)

### 2.1 Platforms
- **Mobile browsers**: iOS Safari, Android Chrome.
- Desktop Chrome supported for development/testing (keyboard fallback).

### 2.2 Production hosting target (locked)
#### Client (website)
- **Cloudflare Pages (Free)** for static hosting.
- Rationale: Pages Free advertises **Unlimited static requests** and **Unlimited bandwidth**, plus unlimited sites (within platform limits). :contentReference[oaicite:1]{index=1}

#### Multiplayer backend (rooms + realtime)
- **Cloudflare Workers + Durable Objects** (WebSocket server inside a Durable Object).
- Rationale: Durable Objects are designed for coordination/state with WebSockets. For cost efficiency, prefer the **WebSocket Hibernation API** so idle rooms can sleep. :contentReference[oaicite:2]{index=2}

#### Cost reality (important)
- Static asset requests on Pages are free/unmetered as described above.
- Any dynamic requests (Workers / Pages Functions / DO messages) count toward Workers usage; the Workers Free plan has a **daily request limit** (100,000/day) and resets daily. :contentReference[oaicite:3]{index=3}
- MVP goal: keep realtime messages small and low-frequency (≈15 Hz state) and rely on hibernation so casual play remains within free limits.

### 2.3 Local development architecture (mirrors production)
- Dev server can be Node-based, but the **network protocol must be raw WebSockets** (not Socket.IO) so it ports cleanly to Durable Objects.
- Production will not depend on Socket.IO. Socket.IO may be used only if explicitly approved later (not expected).

---

## 3) Client tech stack
- **Vite + React + TypeScript**
- 3D rendering: **Three.js**
- Physics: **cannon-es**
- QR code generation: a lightweight QR library (e.g., `qrcode`)
- PWA: minimal manifest/service worker (later milestone)

---

## 4) Game design (MVP)

### 4.1 Core loop
1. Lobby: **Play Solo** / **Host Race** / **Join Race**
2. Countdown (3…2…1…GO)
3. Race run:
   - Tilt changes acceleration
   - Checkpoints validate progress
   - Out-of-bounds triggers respawn
4. Finish:
   - time shown
   - best time stored locally
   - rematch

### 4.2 Track (MVP)
- 1 authored track in code:
  - start platform → downhill run → a few turns → finish gate
- Static colliders: floor segments + wall rails
- 2–4 sequential checkpoints (invisible triggers)

### 4.3 Physics feel targets
- Controllable, weighty motion.
- Tuning knobs:
  - gravity strength
  - friction / rolling resistance
  - linear + angular damping
  - tilt accel clamp
- Safety rails:
  - soft speed cap
  - auto-respawn if falling too long

---

## 5) Controls and permissions

### 5.1 Tilt controls
- Use DeviceMotion/DeviceOrientation as available.
- iOS may require a user gesture to request motion permission:
  - show an explicit **Enable Motion Controls** button
- Apply smoothing (EMA) and include **Calibrate** button.

### 5.2 Fallback controls (required)
- On-screen thumb joystick (or left/right controls).
- Desktop fallback: WASD / arrows.

---

## 6) Multiplayer design (2-player “arcade sync”, updated transport)

### 6.1 Room flow
- Host creates room → gets `roomCode` + join URL → shows QR.
- Joiner scans QR → opens join URL → joins room.

### 6.2 Start synchronization
- Host presses Start → backend broadcasts `startAt` (server time + offset).
- Both clients align countdown to `startAt`.

### 6.3 State sync (not deterministic)
- Each client simulates locally.
- At ~15 Hz, client sends:
  - timestamp
  - pos (x,y,z), quat (x,y,z,w), vel (x,y,z)
- Receiver renders opponent using interpolation buffer and gentle correction.

### 6.4 Win condition
- Each client reports finish time.
- Backend announces winner once both finish.

### 6.5 Abuse/stability limits
- Rate limit incoming state packets (ignore > 30 Hz).
- Validate payload shapes and numeric finiteness.
- Room max 2 players.

---

## 7) Architecture + data model (updated)

### 7.1 Repo layout (monorepo)
get-tilted/
  client/
  server/                  # local dev WS server + (optional) build scripts
  worker/                  # Cloudflare Worker + Durable Object implementation
  package.json
  README.md
  SPEC.md
  AGENTS.md

### 7.2 Client modules
- engine/
  - physicsWorld.ts
  - track.ts
  - marble.ts
  - input/tilt.ts
  - input/joystick.ts
- net/
  - wsClient.ts            # raw WebSocket client
  - protocol.ts            # message types + runtime guards
  - interp.ts              # opponent smoothing
- ui/
  - lobby, host/join, HUD, results, permissions

### 7.3 Backend modules
- server/ (local dev)
  - wsDevServer.ts         # dev-only websocket server
  - rooms.ts               # room lifecycle (dev)
- worker/ (production)
  - index.ts               # Worker entry
  - roomDO.ts              # Durable Object WebSocket room
  - protocol.ts            # shared protocol (ideally same as client)

---

## 8) Network protocol (raw WebSocket messages)

### 8.1 Message format (MVP)
- JSON messages with `type` and `payload`
- Example:
  { "type": "room:create", "payload": {} }

### 8.2 Messages (MVP)
Client → Backend
- room:create
- room:join { roomCode, name }
- race:ready
- race:start
- race:state { t, pos[3], quat[4], vel[3] }
- race:finish { timeMs, checkpointsHit }

Backend → Client
- room:state { roomCode, players[] }
- race:countdown { startAt }
- race:opponentState { playerId, t, pos, quat, vel }
- race:result { winnerId, times[] }
- error { code, message }

---

## 9) Roadmap with versions (updated to reflect production target)

### v0.1 — Scaffold + “Hello Marble”
- Monorepo + client renders sphere + plane, physics stepping, reset, keyboard fallback.
- Backend boots locally (can be minimal).

### v0.2 — Track + Respawn
- Playable downhill track + stable respawn.

### v0.3 — Tilt + Fallback Controls
- iOS permission flow + smoothing + joystick fallback + calibrate.

### v0.4 — Solo Time Trial
- Checkpoints, finish gate, timer + local best time.

### v0.5 — Multiplayer Rooms + QR Join (RAW WS)
- Replace any Socket.IO assumptions with raw WebSockets.
- Room codes, QR join URL, start sync via `startAt`.
- Opponent interpolation.

### v0.6 — Race Result + Rematch
- Winner display, stable rematch.

### v0.7 — Cloudflare Deploy (Pages + DO)
- Deploy client to Cloudflare Pages.
- Deploy Worker + Durable Object WebSocket rooms.
- Ensure DO uses WebSocket hibernation patterns (no timers/intervals preventing sleep).

### v1.0 — Demo Release Candidate
- Performance pass + bugfixes from device testing.
- Final packaging + README “share this link” steps.

---

## 10) Acceptance criteria for “Major Planning Complete”
This SPEC is complete when:
- MVP scope is explicit (single track, 2 players, arcade sync).
- Production target is locked (Cloudflare Pages + Workers/DO).
- Multiplayer protocol is raw WebSockets and mirrors production.
- Version roadmap is linear and testable.