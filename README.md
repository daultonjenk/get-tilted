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

Current v0.5 flow:

1. Open `Network` tab and click `Connect`.
2. Host clicks `Create Room`, then toggles `Show QR`.
3. Joiner scans QR or opens the shown URL (`?room=ROOMCODE`) and clicks `Join`.
4. Both players can see a real-time ghost marble representation of the opponent.

Ghost smoothing notes:

1. Ghost updates remain at ~15 Hz for free-tier bandwidth safety.
2. Clients now use adaptive interpolation (roughly 55-110 ms), bounded extrapolation, and
   track-local ghost sync with world-space fallback for mixed client versions.

Dev LAN notes:

1. Run with host exposure so phone can reach the client:
   - `npm run dev -- --host`
2. Keep server reachable on LAN (`ws://<PC_IPV4>:3001/ws`).
3. In `Network` tab, set `Dev Join Host (LAN IPv4)` when host browser is on `localhost`.
   - Example: `192.168.1.42:5173`
4. QR should then encode `http://<PC_IPV4>:5173/?room=ROOMCODE`.
5. If phone shows WebSocket errors, compare:
   - `Resolved WS URL (this device)` and `Expected join WS URL` in `Network` tab.

## Deploy notes (Pages + Durable Objects)

Production deploy is planned for v0.7:

- Client deploy target: Cloudflare Pages (static `client/dist`).
- Realtime deploy target: Cloudflare Workers + Durable Objects (raw WebSocket room server).
- Keep room logic DO-hibernation-friendly (no unnecessary background timers).
