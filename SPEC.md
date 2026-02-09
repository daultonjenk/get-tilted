# SPEC.md — Get Tilted (Working Title)

## 0) One-sentence pitch
**Get Tilted** is a mobile-first marble racing game: tilt your phone to roll a marble down a 3D track, and race a friend by hosting a room that generates a **QR code** to join instantly.

---

## 1) Goals, constraints, and success criteria

### 1.1 Primary goals (MVP)
1. **Great-feeling tilt controls** on Android + iOS (with an on-screen fallback).
2. **Single-player time trial**: start → checkpoints → finish → best time.
3. **2-player race via QR/link**: Host creates room, Joiner scans, both play the same track.
4. **Always-available**: the game works 24/7 without manually “starting” anything.

### 1.2 Hard constraints
- Target dev time: **2–3 days**, ~**10–15 hours** total for the MVP demo.
- Players install nothing beyond opening a link (optional PWA install later).
- Production must be **always-on** and **free or extremely low cost**.
- Avoid architectures that require a personal machine to host or a manual “on switch”.
- Multiplayer transport must be **raw WebSockets** (not Socket.IO) to port cleanly to Durable Objects.

### 1.3 Non-goals (out of scope for MVP)
- App Store / Play Store shipping, native wrappers, payments.
- Deterministic rollback netcode / lockstep physics.
- Track editor, large content library, cosmetics/progression.
- Accounts/matchmaking/anti-cheat/reconnect guarantees.

### 1.4 “Demo Done” checklist (minimum bar)
- A brand-new player can:
  - open the link on phone
  - press **Enable Tilt Controls** (iOS prompt may appear)
  - complete a race
  - host a room and show QR
  - a second phone scans and joins with no extra installs
- No crashes on iOS Safari or Android Chrome during a 2–3 minute session.

### 1.5 Replayability intent (post-demo)
We want eventual “random” tracks, but **not full maze generation during the MVP**.

Planned approach: **seeded, modular track generation**
- Track assembled from a library of pre-authored “pieces” (straight, slope, left/right turn, S-curve, bump gate, etc.).
- Deterministic generator assembles a valid course from a **seed**.
- Same seed => same track (required for multiplayer fairness and reproducible debugging).
- Implementation scheduled post-demo (see v0.8).

---

## 2) Platform + production architecture (locked)

### 2.1 Platforms
- **Mobile browsers**: iOS Safari, Android Chrome.
- Desktop Chrome supported for dev/testing (keyboard fallback).

### 2.2 Production hosting target (locked)
#### Client (website)
- **Cloudflare Pages (Free)** for static hosting.  
  https://pages.cloudflare.com/

#### Multiplayer backend (rooms + realtime)
- **Cloudflare Workers + Durable Objects** where each room is a Durable Object that acts as the WebSocket server.
- Prefer WebSocket hibernation patterns (avoid timers/alarms that prevent sleep):
  - https://developers.cloudflare.com/durable-objects/best-practices/websockets/
  - https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/

#### Cost reality (important)
- Pages static traffic is separate from Workers request limits.
- Workers Free plan includes a **daily request limit**:  
  https://developers.cloudflare.com/workers/platform/limits/

MVP goal: keep realtime messages small + low-frequency (≈15 Hz state) and leverage DO hibernation so casual play remains within free limits.

### 2.3 Local development architecture (mirrors production)
- Node-based dev backend is allowed, but the protocol/transport must remain **raw WebSockets** with the same message envelope as production.

---

## 3) Tech stack (single path)

### 3.1 Client
- **Vite + React + TypeScript**
- Rendering: **Three.js**
- Physics: **cannon-es**
- QR generation: lightweight library (e.g., `qrcode`)
- Optional PWA: manifest + service worker (later milestone)

### 3.2 Backend
- Local dev: Node + TypeScript (raw WS endpoint).
- Production: Cloudflare Worker + Durable Object (raw WS endpoint).

### 3.3 Shared protocol
- Shared TypeScript protocol module with runtime guards.
- Message envelope: `{ type: string, payload: unknown }`.

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

### 4.2 Track plan (fixed now, seeded later)
**MVP (v0.2–v1.0):** one authored track (code-defined), designed for stable physics:
- Start platform → downhill run → a few turns → finish area
- Static colliders: floor segments + wall rails
- 2–4 sequential checkpoints (invisible triggers)

**Design requirement now:**
- Track builder API accepts an optional seed:
  - `createTrack(opts?: { seed?: string })`
- For MVP milestones, seed is accepted but layout stays fixed.

### 4.3 Physics feel targets
- Controllable, weighty motion.
- Tuning knobs:
  - gravity strength
  - friction / rolling resistance
  - linear + angular damping
  - tilt accel clamp
- Safety rails:
  - soft speed cap if needed
  - auto-respawn when out of bounds

---

## 5) Controls and permissions

### 5.1 Tilt controls
- Use DeviceMotion/DeviceOrientation where available.
- iOS may require a user gesture to request motion permission:
  - provide explicit **Enable Tilt Controls** button
- Apply smoothing (EMA) and provide **Calibrate** button.

### 5.2 Fallback controls (required)
- On-screen thumb joystick (or equivalent).
- Desktop fallback: WASD / arrow keys.

---

## 6) Multiplayer design (2-player “arcade sync”)

### 6.1 Room flow
- Host creates room → gets `roomCode` + join URL → shows QR.
- Joiner scans QR → opens join URL → joins room.

### 6.2 Start synchronization
- Host presses Start → backend broadcasts `startAt`.
- Both clients align countdown to `startAt`.
- Later: include `seed` in the start payload.

### 6.3 State sync (not deterministic)
- Each client simulates its own marble locally.
- At ~15 Hz, client sends:
  - timestamp
  - pos (x,y,z), quat (x,y,z,w), vel (x,y,z)
- Receiver renders opponent using interpolation.

### 6.4 Win condition
- Each client reports finish time.
- Backend announces winner once both finish.

### 6.5 Abuse/stability limits
- Rate limit incoming state packets.
- Validate payload shapes.
- Room max 2 players.

---

## 7) Repository layout

```
get-tilted/
  client/
  server/
  shared/
  worker/
  README.md
  SPEC.md
  AGENTS.md
  package.json
```

---

## 8) Roadmap (versions)

- v0.1 — Scaffold + Hello Marble (complete)
- v0.1.1 — Protocol + WS abstraction + DO skeleton (complete)
- v0.2 — Track + Respawn (next)
- v0.3 — Tilt + Fallback Controls
- v0.4 — Solo Time Trial
- v0.5 — Multiplayer Rooms + QR Join
- v0.6 — Race Result + Rematch
- v0.7 — Cloudflare Deploy
- v0.8 — Seeded Modular Tracks
- v1.0 — Demo Release Candidate

---

## 9) Acceptance criteria for “Major Planning Complete”
- MVP scope is explicit.
- Production target is locked.
- Multiplayer protocol mirrors production.
- Roadmap is linear and testable.
