# Get Tilted (v0.1)

Mobile-first marble racer prototype. This milestone ships the scaffold and a "Hello Marble" scene.

## Requirements

- Node.js 20+
- npm 10+

## Install

```bash
npm install
```

## Run in development

Run client + server together:

```bash
npm run dev
```

Run only one side:

```bash
npm run dev:client
npm run dev:server
```

## Build

```bash
npm run build
```

## Quality gates

```bash
npm run lint
npm run typecheck
```

## v0.1 manual test

1. Start dev servers with `npm run dev`.
2. Open the Vite URL shown in terminal.
3. Confirm the scene shows a ground plane and sphere.
4. Use arrow keys to push the marble.
5. Click **Reset Marble** and confirm it returns to spawn.
6. Confirm server logs show `server ready` and connection timestamps.

## Test on phone (current milestone)

v0.1 does not use tilt yet. For mobile smoke testing:

1. Ensure phone and dev machine are on the same network.
2. Start dev server and expose Vite host if needed (`npm run dev:client -- --host`).
3. Open the shown LAN URL on phone.

## iOS motion permissions note

Tilt permissions are introduced in v0.3. iOS Safari requires a user gesture before calling motion permission APIs.

## Host/join race note

Host/join via QR is available in the debug drawer `Network` tab.

Current v0.5.1 flow:

1. Open `Network` tab and click `Connect`.
2. Host clicks `Create Room`, then toggles `Show QR`.
3. Joiner scans QR or opens the shown URL (`?room=ROOMCODE`) and is auto-connected + auto-joined.
4. Both players press the in-game `READY` button.
5. Once both are ready, a synced `3 / 2 / 1 / GO!` countdown starts and controls unlock at `GO!`.
6. Both players can see a real-time ghost marble representation of the opponent.

Solo mode notes:

1. App now defaults to `Solo` mode and starts playable immediately.
2. Use the race overlay mode switch (`Solo` / `Multiplayer`) to opt into rooms and ready flow.

Ghost smoothing notes:

1. Ghost updates remain at ~15 Hz for free-tier bandwidth safety.
2. Clients now use adaptive interpolation (roughly 55-110 ms), bounded extrapolation, and
   world-space-only ghost sync.
3. `race:state` now supports optional monotonic `seq` ordering. Clients prefer `seq` for
   deterministic out-of-order drops and fall back to timestamp ordering for older peers.
4. World-space-only ghost rendering avoids per-client board-frame divergence in multiplayer.

Snapshot correctness diagnostics (Network tab):

1. `Ghost snapshot age (avg ms)` and `Latest snapshot age (ms)` track remote snapshot freshness
   against estimated server time.
2. `Dropped out-of-order seq`, `Dropped stale timestamp`, and `Dropped too-old packets` split
   stale/drop reasons for debugging.
3. `Timestamp corrections` counts cases where a newer `seq` arrives with non-increasing `t`; the
   enqueue timestamp is normalized to keep strict interpolation order.
4. `Queue order violations` counts render-loop invariant fixes when snapshot queue ordering is
   not strictly increasing by timestamp.

Dev LAN notes:

1. Run with host exposure so phone can reach the client:
   - `npm run dev -- --host`
2. Keep server reachable on LAN (`ws://<PC_IPV4>:3001/ws`).
3. In `Network` tab, set `Dev Join Host (LAN IPv4)` when host browser is on `localhost`.
   - Example: `192.168.1.42:5173`
4. QR should then encode `http://<PC_IPV4>:5173/?room=ROOMCODE`.
5. If phone shows WebSocket errors, compare:
   - `Resolved WS URL (this device)` and `Expected join WS URL` in `Network` tab.

## Cloudflare Deploy (v0.7)

Deploy targets:

- Client: Cloudflare Pages project `get-tilted`
- Realtime backend: Worker `get-tilted-backend` + Durable Objects (`RoomDO`, binding `ROOMS`)

### 1) Authenticate Wrangler once

```bash
npx wrangler login
npx wrangler whoami
```

### 2) Deploy Worker + Durable Objects

```bash
npm run deploy:worker
```

Optional logs:

```bash
npm run tail:worker
```

### 3) Configure Cloudflare Pages (`get-tilted`)

Use Git integration and set:

- Build command: `npm run pages:build`
- Output directory: `client/dist`

Set this environment variable in Pages project settings:

- `VITE_WS_URL=wss://get-tilted-backend.<your-subdomain>.workers.dev/ws`

After setting env vars, redeploy Pages.

### 4) Production smoke test

1. Open the Pages URL on two phones.
2. Host creates a room and shows QR.
3. Joiner scans QR or opens the room link.
4. Both players press `READY`.
5. Confirm synced countdown starts and controls unlock at `GO!`.
6. Confirm ghost updates and race result appear for both players.
