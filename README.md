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

Host/join via QR is planned for v0.5 and is not implemented in v0.1.

Expected v0.5 flow:

1. Host creates a room and sees a share URL + QR code.
2. Joiner opens/scans the URL.
3. Both players enter the same room and receive synchronized race start messages.

## Deploy notes (Pages + Durable Objects)

Production deploy is planned for v0.7:

- Client deploy target: Cloudflare Pages (static `client/dist`).
- Realtime deploy target: Cloudflare Workers + Durable Objects (raw WebSocket room server).
- Keep room logic DO-hibernation-friendly (no unnecessary background timers).
