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

v0.7.12.0 in progress:
- Implemented wider authored track geometry (1.5x width baseline) and refactored obstacles to kinematic moving bodies updated each fixed step.
- Added slow left/right oscillation for all slalom obstacles and a new larger final obstacle assembly with a bottom-center pass-through hole and side bypass paths.
- Added track API hooks (`updateMovingObstacles`, `setMovingObstacleMaterial`) and wired moving obstacles to board contact material.
- Removed synthetic "Default" skin option and set Gemini Light Marble as the default/fallback selection.
- Added Options `debug` checkbox (default off, persisted) that gates visibility of the top-right debug drawer.
- Verified quality gates and tests: `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test` all pass after the v0.7.12.0 changes.
- Manual browser smoke for moving obstacle behavior and final-hole pass-through remains pending interactive visual playtest.

v0.7.13.0 update:
- Extended authored track length to roughly 2x prior playable run by expanding straight segment progression.
- Increased moving obstacle dimensions by ~25% and reorganized obstacle flow into distinct zones:
  - Zone A (first 4): alternating left/right anchors with alternating speeds.
  - Zone B (next 6): opposite-direction neighbor patterns with intentionally unsynced phase/speed values.
  - Zone C: two static squeeze gates using 1.5x marble-width side holes (left then right).
  - Zone D: final static-position wall gate with a left-right oscillating moving hole.
- Preserved board-relative kinematic obstacle updates and collider material wiring through existing `updateMovingObstacles`/`setMovingObstacleMaterial` hooks.
- Bumped app version to `0.7.13.0`.
- Verified: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`.
- Manual playtest still recommended for final difficulty/timing tuning (especially final moving-hole gate cadence).

v0.7.14.0 update:
- Added explicit `Return to Main Menu` actions to all non-main menu/result overlays:
  - Options menu, multiplayer lobby, multiplayer race results, and solo race results.
- Updated options skin selector contrast to black text on a white background (`.menuSelect` + option styling) for readability.
- Fixed skin fallback/default resolution so unknown/missing selections resolve to preferred `gemini-light-marble`.
- Implemented client-side ghost spin synthesis during interpolation so remote marbles visibly rotate while moving.
- Added timed off-course reset logic using board-local track bounds: if the marble remains outside bounds for ~1 second, it respawns.
- Reworked obstacles/final section:
  - Reduced moving obstacle height to one-third of prior size.
  - Set obstacle material to 75% opacity.
  - Removed pre-final squeeze obstacles to create a clean full-width lineup section.
  - Replaced final moving-hole gate with a static wall containing 3 small circular floor-level holes sized to ~1.15x marble diameter.
- Bumped app version to `0.7.14.0`.
- Verified: `npm run lint`, `npm run typecheck`, `npm run build`.
- Playwright skill smoke run is still blocked in this environment (`ERR_MODULE_NOT_FOUND: playwright` for the skill runner script), so browser-automated screenshot validation remains pending.

v0.7.15.0 update:
- Added wall squeeze handling so the marble no longer gets forced out past side rails when a moving obstacle compresses it against a wall:
  - Clamp marble X within board-local rail containment bounds (main track + finish section widths).
  - Detect marble contact with moving obstacle box bodies near side walls and pop the marble around the obstacle along local Z.
  - Remove outward lateral velocity and add minimum escape-forward velocity to prevent repeated pinning.
- Increased moving obstacle variation by introducing per-obstacle width/length/speed profiles:
  - Longer obstacles move slower.
  - Shorter/smaller obstacles move faster.
  - Both obstacle zones now mix dimensions and cadence more aggressively.
- Extended track API returned by `createTrack()` with `movingObstacleBodies` and `containmentLocal` metadata used by the squeeze resolver.
- Bumped app version to `0.7.15.0`.
- Verified: `npm run lint`, `npm run typecheck`, `npm run build`.
- Playwright skill smoke remains blocked in this environment (`ERR_MODULE_NOT_FOUND: playwright` from the skill runner script), so browser screenshot automation is still pending.

Open items / next checks:
- Manual desktop and mobile feel-pass for squeeze escapes (watch for over-aggressive pop when grazing walls).
- Optional tuning pass on `WALL_SQUEEZE_MIN_ESCAPE_FORWARD_SPEED` and obstacle speed spread after hands-on playtest.

v0.8.0.0 update:
- Added seeded modular track domain model in `client/src/game/track/modularTrack.ts`:
  - built-in piece catalog (`straight`, `bend90`, `sCurve`, `narrowBridge`)
  - bounded template sanitizers for custom piece libraries
  - deterministic seeded blueprint generation (`buildTrackBlueprint`)
  - seed/piece-count sanitization and random seed helper.
- Extended `createTrack` with blueprint support and added a modular builder path:
  - builds floor + rail colliders per generated segment
  - computes dynamic off-course bounds from generated geometry extents
  - preserves existing fixed authored track path when no blueprint is provided.
- Implemented Track Lab menu flow in `HelloMarble`:
  - new main-menu `Track Lab` entry
  - seed + piece count controls
  - piece editor with type/dimensions/turn/rails/weight controls
  - save/select/update/delete custom pieces
  - local persistence for seed, piece count, and custom piece library.
- Added runtime track rebuild plumbing in `HelloMarble` so Track Lab preview and mode switches can rebuild track geometry in-place without recreating the entire app shell.
- Added host-authoritative multiplayer seed flow:
  - protocol: `race:start` includes optional `trackSeed`
  - protocol: `race:countdown:start` now includes required `trackSeed`
  - race host sends selected seed when starting match
  - clients rebuild multiplayer track from built-in catalog on countdown start.
- Updated both backend implementations to carry `trackSeed` on countdown start:
  - Node WS server path (`server/src/ws/wsRouter.ts`, `server/src/ws/roomStore.ts`)
  - Durable Object path (`worker/src/roomDO.ts`).
- Added shared protocol tests for seeded race start/countdown payloads and invalid seed rejection.
- Added new v0.8 Track Lab docs in `README.md`.
- Bumped app version to `0.8.0.0` in `client/src/buildInfo.ts`.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes (shared protocol tests).
- `npm run build` passes.
- Attempted Playwright skill smoke via:
  - `node ~/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js ...`
  - blocked in this environment with `ERR_MODULE_NOT_FOUND: Cannot find package 'playwright' imported from ~/.codex/skills/...`
  - root project checks still pass; browser automation remains pending until Playwright is available to the skill runner path.
