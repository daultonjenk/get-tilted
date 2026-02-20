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

## Custom marble skins

Final placement (required):

- Put completed skin files in `client/src/assets/skins/`.
- Example: `client/src/assets/skins/my-team-skin.png`

Supported formats:

- `.png` (recommended)
- `.jpg`
- `.jpeg`
- `.webp`

Texture sizing and quality:

- Use an exact `2:1` aspect ratio (equirectangular sphere map).
- Valid examples: `1024x512`, `2048x1024`, `4096x2048`.
- Invalid examples: `500x400`, `600x200` (not `2:1`).
- Recommended: `2048x1024` for crisp details on high-density screens.
- Minimum recommended: `1024x512`.
- DPI/PPI metadata does not control WebGL sharpness; pixel dimensions do.
- If your art tool asks for DPI, use `300 DPI` for print/editor consistency, but runtime quality still depends on pixel size.
- Export in sRGB color space.
- Prefer lossless PNG, or high-quality lossy export (`JPEG/WebP` quality `90+`).
- File size target: keep each skin at or below `2 MB` for fast loads on phones.
- Soft upper bound: avoid files above `8 MB` (not blocked by code, but bad for load time/memory).

Authoring guidance:

- Left and right edges of the image meet at a seam on the sphere, so make them tile cleanly.
- Place important logos/text near the center band (around 25%-75% image height).
- Avoid critical detail near top/bottom edges because poles compress/stretch there.

How to use in game:

1. Add the image file to `client/src/assets/skins/`.
2. Restart `npm run dev` (or rebuild) so Vite re-indexes new files.
3. Open the main title screen and use the `Marble Skin` dropdown.
4. Skin choice is saved locally and synced to other players in multiplayer.

Default skin reference PNG:

- `output/skins/default-marble-reference-512x256.png`
- This is the built-in marble pattern exported at `512x256` (exact `2:1` map).
- Use it as a starting template, then save your edited version into `client/src/assets/skins/`.

Template preview PDF:

- `output/pdf/marble-skin-template.pdf`
- Page 1 shows paint guides.
- Page 2 shows a sphere wrap preview.

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

## Play Store Internal Testing (TWA)

Use the dedicated checklist in:

- `docs/playstore-internal-testing.md`

Quick starter:

1. Generate `/.well-known/assetlinks.json` with your signing fingerprint:
   - `npm run android:assetlinks`
2. Initialize TWA wrapper:
   - `bubblewrap init --manifest https://get-tilted.pages.dev/manifest.webmanifest`
3. Build Android app bundle:
   - `bubblewrap build`
