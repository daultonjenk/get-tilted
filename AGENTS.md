# AGENTS.md — Get Tilted (Codex Execution Playbook)

This file instructs Codex (and any assistant agent) exactly how to plan, implement, and ship **Get Tilted** with minimal thrash.

---

## 1) Operating rules (non-negotiable)

1. **Single-path stack (locked)**
   - Client: Vite + React + TypeScript + Three.js + cannon-es
   - Multiplayer transport: **RAW WebSockets**
   - Production: **Cloudflare Pages + Cloudflare Workers Durable Objects**
   - Do not introduce alternate engines/frameworks unless explicitly asked.

2. **Always-on requirement**
   - The end state must be playable 24/7 via a link with no manual server “on switch”.
   - Design the backend to fit the free/low-cost envelope:
     - Cloudflare Pages static hosting for the client.
     - Durable Object WebSocket rooms for multiplayer.
   - Prefer WebSocket hibernation patterns for idle rooms. :contentReference[oaicite:4]{index=4}

3. **No big rewrites**
   - If refactor needed, do the smallest change that unblocks.

4. **Mobile-first realities**
   - iOS motion permission requires a user gesture path; must exist from v0.3 onward.
   - Always maintain a fallback control scheme.

5. **Multiplayer is arcade-sync**
   - Do **not** implement deterministic lockstep or rollback netcode.

---

## 2) Response format for Codex planning prompts
When asked to execute work, respond with:
- **Plan:** ON/OFF (default ON for non-trivial work)
- **Reasoning strength:** Low/Medium/High (default Medium-High)
- **Steps:** concise numbered steps (no alternatives)
- **Commands:** exact commands to run
- **Diff summary:** files created/changed
- **Verification:** lint/typecheck/dev smoke test
- **Commit plan:** commit messages
- After completion: **brief commit/push changelog** (required)

---

## 3) Repo standards

### 3.1 TypeScript + tooling
- TypeScript everywhere (client/server/worker).
- Strict TS (reasonable defaults).
- Scripts must exist and pass: `lint`, `typecheck`, `build`.

### 3.2 Folder structure
- `client/` — Vite React app
- `server/` — local dev WebSocket server (mirrors protocol)
- `worker/` — Cloudflare Worker + Durable Object

### 3.3 Naming conventions
- TS modules: `camelCase.ts`
- React components: `PascalCase.tsx`
- Network messages: `namespace:action` (e.g., `race:state`)

---

## 4) Implementation sequence (versions)
Work strictly in this order:
- v0.1 Scaffold + Hello Marble
- v0.2 Track + Respawn
- v0.3 Tilt + Fallback Controls
- v0.4 Solo Time Trial
- v0.5 Multiplayer Rooms + QR Join (**RAW WS**)
- v0.6 Race Result + Rematch
- v0.7 Cloudflare Deploy (Pages + Durable Objects)
- v1.0 Demo RC (stability)

Do not start a later version until the current version’s acceptance checklist passes.

---

## 5) Command discipline
- Batch commands sensibly:
  - install once, then run dev server
  - combine checks: `npm run lint && npm run typecheck`
- Avoid destructive commands unless necessary.

---

## 6) Multiplayer transport rules (updated)

### 6.1 DO NOT use Socket.IO for production
- Socket.IO is not the target production transport.
- Use raw WebSockets end-to-end.
- Build a tiny typed protocol layer so client/dev-server/DO share the same message shapes.

### 6.2 Message rate
- Send `race:state` at **~15 Hz**.
- Ignore/limit clients that exceed **30 Hz**.

### 6.3 Payload validation
- Validate on receive (dev server + DO):
  - `pos` length 3, `quat` length 4, `vel` length 3
  - all numbers finite
- Drop invalid packets; optionally send `error`.

### 6.4 Interpolation
- Client buffers opponent states with ~100–150ms delay.
- Interpolate position and slerp rotation.
- Gentle correction; avoid snapping unless error is extreme.

---

## 7) Cloudflare Durable Objects guidance (production behavior)
- Durable Object should act as the WebSocket server for rooms.
- Prefer the WebSocket Hibernation API patterns:
  - Avoid `setInterval` / `setTimeout` loops that prevent hibernation.
  - Keep the DO idle-friendly: no unnecessary scheduled work.
  - Treat each room as a DO instance keyed by roomCode. :contentReference[oaicite:5]{index=5}

---

## 8) Motion controls (iOS requirements)
- Provide explicit UI button: **Enable Tilt Controls**
- If `DeviceMotionEvent.requestPermission` exists:
  - call only inside click/tap handler
- If permission denied/unavailable:
  - auto-switch to joystick fallback and show a clear message
- Include **Calibrate** button.

---

## 9) Definition of done per milestone
A milestone is complete only if:
- App runs without runtime errors
- `lint` + `typecheck` pass
- Manual smoke tests pass (desktop + mobile assumptions respected)

---

## 10) Git discipline
- Commit at the end of each milestone minimum.
- Conventional Commits:
  - `feat: ...`, `fix: ...`, `chore: ...`, `refactor: ...`
- After pushing, produce a **brief changelog**:
  - user-visible changes + key technical notes

---

## 11) Milestone checklists (quick reference)

### v0.3 tilt checklist
- iOS permission path exists (button triggers prompt if needed)
- tilt affects marble motion
- joystick fallback works and is discoverable
- calibration works

### v0.5 multiplayer checklist
- Host creates room + QR appears
- Join via URL works
- both clients see opponent marble moving smoothly
- race starts in sync via `startAt`
- transport is raw WebSockets (client + dev server), not Socket.IO

### v0.7 deploy checklist
- Client deployed on Cloudflare Pages (static)
- Durable Object room server deployed
- Idle rooms can hibernate (no runaway timers)
- README includes “share link” and QR flow

---

## 12) Deliverables
- `SPEC.md` and `AGENTS.md` must stay current.
- `README.md` must include:
  - install
  - dev run
  - phone testing steps
  - iOS motion permission note
  - host/join via QR/link flow
  - deploy notes for Pages + DO
