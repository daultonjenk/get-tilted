# AGENTS.md — Get Tilted (Codex Execution Playbook)

This file defines how Codex (and any assistant agent) should execute work on **Get Tilted** with minimal churn and maximum alignment to production constraints.

---

## 1) Non-negotiable project rules

1. **Single-path stack (locked)**
   - Client: Vite + React + TypeScript + Three.js + cannon-es
   - Transport: **raw WebSockets**
   - Production: **Cloudflare Pages (client) + Cloudflare Workers Durable Objects (rooms)**

2. **Always-on requirement**
   - The end state must be playable 24/7 via a link with no manual server “on switch”.
   - Durable Objects must be hibernation-friendly (avoid timers/intervals that prevent sleep).

3. **Networking separation**
   - Game/physics modules must not directly create sockets.
   - All networking must go through `client/src/net/wsClient.ts` and the shared protocol.

4. **Minimal churn**
   - Prefer small, incremental changes.
   - Do not introduce alternative engines/frameworks unless explicitly requested.

5. **Mobile-first reality**
   - iOS motion permission requires an explicit user gesture path.
   - Always keep a fallback control scheme (touch joystick + keyboard for desktop).

6. **Multiplayer scope**
   - Multiplayer is **arcade sync**, not deterministic lockstep or rollback netcode.
   - Prioritize stability, interpolation, and simplicity over “perfect” sync.

7. **Procedural content rule**
   - Any “random” track generation must be **seeded and deterministic**:
     - same seed => same track across devices
     - seed is communicated via race start payloads when implemented
   - MVP milestones (v0.2–v1.0) do **not** implement procedural generation unless explicitly scheduled.

---

## 2) Expected response format for Codex work

When implementing a milestone, respond with:
- **Plan:** ON/OFF (default ON for non-trivial work)
- **Reasoning strength:** Low/Medium/High (default Medium)
- **Steps:** numbered, single optimal path (no alternatives unless asked)
- **Commands:** exact commands to run
- **Diff summary:** files created/changed
- **Verification:** lint/typecheck/build + smoke steps
- **Commit plan:** one commit per milestone minimum
- After completion: **brief commit/push changelog** (required)

---

## 3) Repo structure (authoritative)

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

### Client (authoritative files)
- `client/src/game/HelloMarble.tsx` — physics/render loop (single-player baseline)
- `client/src/net/wsClient.ts` — raw WS client wrapper (protocol-driven)
- `client/src/ui/NetDebugPanel.tsx` — dev-only network debug UI
- `client/src/App.tsx` — wires viewport + panels

### Server (authoritative files)
- `server/src/index.ts` — HTTP health + WS endpoint (`/ws`)
- `server/src/ws/wsRouter.ts` — message routing
- `server/src/ws/roomStore.ts` — room lifecycle (dev)
- `server/src/ws/roomCode.ts` — room code generator

### Worker/DO (authoritative files)
- `worker/src/index.ts` — Worker entry
- `worker/src/roomDO.ts` — Durable Object WS room skeleton
- `worker/src/env.ts` — env bindings/types

### Shared protocol
- `shared/src/protocol.ts` — message envelope, typing, runtime guards, safe parsing

---

## 4) Version order (locked)

Work in this order unless the user explicitly changes it:
- v0.2 Track + Respawn
- v0.3 Tilt + Fallback Controls
- v0.4 Solo Time Trial
- v0.5 Multiplayer Rooms + QR Join
- v0.6 Race Result + Rematch
- v0.7 Cloudflare Deploy (Pages + DO)
- v0.8 Seeded Modular Tracks
- v1.0 Demo Release Candidate

Do not start a later version until the current version’s acceptance checklist passes.

---

## 5) Transport/protocol rules

1. **No Socket.IO for production**
   - Raw WebSockets only.
   - Shared protocol module must be the single source of truth.

2. **Message frequency**
   - `race:state` target: ~15 Hz
   - Ignore/drop packets above 30 Hz

3. **Validation**
   - Validate payload shape and numeric finiteness server-side and DO-side.
   - On invalid input: drop packet; optionally send `error`.

4. **Opponent smoothing**
   - Interpolate buffered states (100–150ms buffer).
   - Avoid snapping unless error is extreme.

---

## 6) Mobile motion control requirements (v0.3+)

- UI must include **Enable Tilt Controls** button.
- If `DeviceMotionEvent.requestPermission` exists, call only within a click/tap handler.
- If denied/unavailable: switch to joystick fallback with a clear message.
- Provide **Calibrate**.

---

## 7) Definition of done per milestone

A milestone is complete only if:
- App runs without runtime errors.
- `npm run lint`, `npm run typecheck`, `npm run build` all pass.
- Manual smoke tests pass (desktop + mobile assumptions respected).
- One commit is created and a brief changelog is provided.

---

## 8) Build version discipline (required)

Purpose: ensure the visible top-left in-game/menu version always identifies the exact build and avoids cache confusion.

Rules:
- Every implemented change by Codex that affects behavior, UI, config, assets, networking, physics, or build output must bump the displayed build version.
- Every commit must have a unique build version string. No reuse.
- When Codex finishes implementing a plan/milestone, the final state must include a new version bump (even if changes were small).
- The version shown in the top-left menu/screen is authoritative for build identity and must match the value committed in source.

Allowed version formats (examples):
- `0.5.3a`, `0.5.3b`
- `0.5.3.1`, `0.5.3.2`
- `0.5.3+20260215.1`

Implementation expectation:
- Keep the version in a single source of truth (currently `client/src/buildInfo.ts`).
- Any change task should include this version update in the same commit.
- Codex responses must explicitly mention the version bump in the diff summary/changelog.

---
