Original prompt: Implement v0.1 scaffold + Hello Marble with client/server monorepo, physics marble scene, debug/reset controls, and quality gates.

Progress:
- Created npm-workspaces monorepo with `client/` and `server/`.
- Implemented Three.js + cannon-es Hello Marble scene with fixed timestep, keyboard force input, reset button, and debug HUD.
- Switched server/client transport checks to raw WebSocket alignment for current AGENTS constraints.
- Added strict TypeScript configs and passing `lint`, `typecheck`, and `build` scripts.
- Added root README setup/run/test docs, phone notes, iOS permission note, host/join flow note, and deploy note placeholders.

Open items:
- Manual browser smoke confirmation still requires local interactive check (arrow influence, reset behavior, and visual validation).
- v0.5+ work: shared typed message protocol between client/dev-server/worker.

v0.1.1 update:
- Added `shared/` workspace with `encodeMessage`, `safeParseMessage`, message unions, and runtime guards.
- Added client WS abstraction (`client/src/net/wsClient.ts`) and UI panel (`client/src/ui/NetDebugPanel.tsx`) for connect/ping/create/join.
- Refactored server into `/ws` upgrade + message router modules and in-memory room tracking with room-state broadcasts.
- Added `worker/` workspace with Cloudflare Worker + Durable Object WebSocket skeleton using shared protocol.
- Root scripts now include `shared` and `worker` in lint/typecheck/build and add `dev:worker`.
- Verified: `npm run lint`, `npm run typecheck`, `npm run build`, and short two-client WS smoke (`ws_smoke_ok`).

v0.6 update:
- Extended shared protocol with `race:finish` and `race:result` message contracts plus runtime validation.
- Added server-side race lifecycle state for finish reports, server-authoritative result resolution, rematch reset, and disconnect DNF handling.
- Added `RaceClient.sendRaceFinish(...)` and integrated one-shot finish submission from gameplay loop.
- Added race results UI for multiplayer (winner/tie + standings + rematch READY flow) and solo (time/best + restart).
- Updated overlay styles for result cards and standings rows with mobile-safe layout.

v0.6.1 update:
- Added pre-selection start state (`unselected`) that freezes the marble until mode selection.
- Normal launches now present a dedicated mode picker; `?room=ROOMCODE` still auto-enters multiplayer.
- Solo finish now freezes marble at the line and shows restart CTA for quick retry.
- Multiplayer selection now opens debug drawer directly on the `Network` tab to expose server/join options.
- Debug drawer is hidden before mode selection and shown after choosing solo or multiplayer.

v0.7.5.0 update:
- Switched board collider to kinematic motion and now feed per-frame linear/angular velocity before stepping to improve contact stability at high speed.
- Added hybrid anti-penetration safeguard that only nudges the marble outward when measurable floor penetration is detected, and removes inward normal velocity.
- Reworked startup tuning so canonical defaults auto-apply the selected physics preset values (marble preset traction/damping by default), preventing friction=0 startup gliding.
- Added angular speed diagnostics and a more asymmetric marble texture so true physics spin is visibly readable.

v0.7.5.3 update:
- Added mobile performance governor module (`client/src/game/perf/mobileGovernor.ts`) with hysteresis-based DPR adaptation targeting 60 FPS using render-only scaling.
- Instrumented `HelloMarble` frame timings (frame/physics/render/misc EMA) and surfaced diagnostics fields (render scale + perf tier + EMA timings).
- Wired mobile governor into renderer pixel ratio updates while preserving existing physics constants and control feel.
- Verified quality gates pass: `npm run lint`, `npm run typecheck`, `npm run build`.

v0.7.6.0 update:
- Switched mobile to desktop-parity render defaults: antialiasing enabled, desktop sphere segment counts, and mobile render-scale cap expanded to `2.0`.
- Added `mobileSafeFallback` tuning flag to keep the old dynamic mobile governor available as an explicit fallback path instead of default behavior.
- Corrected diagnostics to report true frame cadence (`requestAnimationFrame` interval based `Cadence Hz`) and separated CPU work timing as `CPU frame ms (EMA)` to avoid misleading 600+ FPS readings.
- Updated tuning UI with `Mobile Safe Fallback (dynamic governor)` control and raised `Mobile Render Scale` slider max to `2.0`.

v0.7.9.0 update:
- Added a drop-in marble skin pipeline via `client/src/assets/skins/` and a new title-screen skin dropdown.
- Added local persistence for skin selection and live in-scene texture switching for the local marble.
- Synced skin selection through multiplayer metadata (`room:join` and `race:hello`) and render remote ghost marbles with per-player skins.
- Added `scripts/generate_marble_skin_pdf.py` and generated `output/pdf/marble-skin-template.pdf` (template + wrap preview pages).
- Updated root `README.md` with skin file requirements (2:1 ratio, recommended dimensions, color/export guidance, and usage flow).

v0.7.9.1 update:
- Expanded `README.md` skin docs with explicit valid/invalid dimensions, DPI behavior, and concrete file-size guidance.
- Added `scripts/export_default_marble_skin_png.py` to export the built-in marble texture reference.
- Generated `output/skins/default-marble-reference-512x256.png` for user-facing reference/editing.

v0.7.10.0 update:
- Redesigned menu flow with a four-button main menu (`Singleplayer`, `Multiplayer`, `WIP`, `Options`) and moved player customization/settings into a dedicated options overlay.
- Added options persistence for gyro/music/sound toggles plus player name and marble skin selection (no debug controls in options).
- Reworked multiplayer lobby UI for 4 slots with per-slot name labels, host star marker, ready-state symbols (check/X/?), and separate `READY` + host-only `START MATCH` actions.
- Extended protocol and networking for explicit host-driven race start: added `race:start`, `hostPlayerId` in `race:hello:ack`, and server/DO validation that start requires host + 2+ players + all joined players ready.
- Bumped shared room cap to 4 players and app version to `0.7.10.0`.
- Verified: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`.
- Note: Playwright smoke client script could not run in this environment because the `playwright` package is not installed for the skill runner script.
