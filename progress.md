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

v0.8.1.0 update:
- Replaced seeded modular blueprint model with branch-aware placements for a CUBORO-style core piece catalog:
  - piece set now includes `straight`, `arc90`, `sCurve`, `ramp`, `bridge`, `tunnel`, `splitY`, and `mergeY`.
  - added deterministic branch node metadata and exported `resolveBranchLane(marbleId, nodeId, seed)`.
  - kept sanitizer backward-compatibility for old stored fields (`slopeDeg`, `turnStrengthDeg`, legacy kinds).
- Rebuilt modular track rendering/physics path (`createTrackFromBlueprint`) to use smooth swept channel geometry:
  - floor/rails/tunnel roof are extruded along sampled curves instead of stitched box segments.
  - collider now derives from merged rendered geometry (`Trimesh`) for close visual-hitbox alignment.
  - finish extension is generated as part of the same swept modular surface.
- Updated Track Lab editor UI to the new schema:
  - updated piece options to the 8-piece catalog.
  - replaced slope/turn-strength with grade/turn and added bank + tunnel-roof controls.
- Extended protocol countdown payload with optional `trackBlueprintVersion` and broadcast `trackBlueprintVersion: 2` from both Node WS and Durable Object backends.
- Updated protocol tests for countdown blueprint version validation.
- Bumped build version to `0.8.1.0` and moved Track Lab local-storage keys to `v0.8.1.0` namespace.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- `develop-web-game` Playwright smoke script is still blocked in this environment:
  - `ERR_MODULE_NOT_FOUND: Cannot find package 'playwright' imported from ~/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js`

v0.8.1.1 update:
- Stabilized modular track generation/rendering after v0.8.1.0 regression report:
  - replaced per-piece `ExtrudeGeometry(extrudePath)` usage with a custom stable-frame sweep pipeline sampled along a continuous centerline.
  - floor/rails/tunnel roof are now generated from deterministic transported frames (`tangent/right/up`) to avoid sideways roll artifacts.
  - collider is rebuilt from the same generated swept geometry set and merged to a single Trimesh shape for visual/physics alignment.
- Added `wallContainmentMode` to `TrackBuildResult` and disabled legacy linear wall-squeeze containment logic for modular tracks in `HelloMarble`.
- Added temporary branch stabilization guard:
  - `buildTrackBlueprint` now accepts `enableBranchPieces` (default `false`).
  - Track Lab runtime generation passes `enableBranchPieces: false`, so `splitY`/`mergeY` pieces are currently excluded from random generation while path stability is finalized.
  - UI now includes a non-blocking stabilization notice in Track Lab.
- Bumped build/version to `0.8.1.1` and advanced Track Lab local storage keys to `v0.8.1.1` namespace.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- Playwright skill smoke remains blocked in this environment (`ERR_MODULE_NOT_FOUND: playwright` in the skill runner path).

v0.8.1.2 update:
- Addressed modular-track post-curve wall collision instability and camera-flow discomfort.
- Blueprint generation updates (`client/src/game/track/modularTrack.ts`):
  - added generation options `maxHeadingDriftDeg` and `enforceBendPairs`.
  - added placement metadata `groupId` and `isCompensatingTurn`.
  - enabled hard-arc pairing logic: each 90-degree arc on main lane now emits an immediate compensating arc in the opposite direction.
  - normal main-lane turns are now constrained by heading drift (`maxHeadingDriftDeg`, default 18°) to preserve primarily down-track travel.
- Track Lab runtime config now explicitly requests:
  - `enableBranchPieces: false`
  - `maxHeadingDriftDeg: 18`
  - `enforceBendPairs: true`
- Track Lab messaging updated to explain automatic 90° bend pairing.
- Swept modular collider robustness updates (`client/src/game/track/createTrack.ts`):
  - `geometryToTrimesh(...)` now filters non-finite/degenerate triangles.
  - blueprint mesh collider is now built as double-sided Trimesh indices to preserve wall collision even if winding varies across tight curvature.
- Bumped app version to `0.8.1.2` and advanced Track Lab storage keys to `v0.8.1.2` namespace.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- Playwright skill smoke remains blocked in this environment (`ERR_MODULE_NOT_FOUND: playwright` in the skill runner path).

v0.8.2.0 update:
- Reworked modular track containment and collision behavior to prevent wall escapes:
  - Added curved-path containment metadata (`containmentPathLocal`) to `TrackBuildResult` and introduced `wallContainmentMode: "curvedPathClamp"` for blueprint tracks.
  - Implemented curved-path side-wall clamping in `HelloMarble` using nearest sweep sample frames (`center/right/up/tangent`) with rail-aware per-side enforcement.
  - Preserved legacy wall-squeeze logic for authored legacy tracks (`legacyLinear`) only.
- Replaced fixed floor-height penetration correction with contact-driven correction:
  - Removed constant `TRACK_FLOOR_TOP_Y` penetration nudging path.
  - Added marble-vs-board contact penetration measurement from live contact equations and apply correction along deepest board-to-marble contact normal only.
- Reduced modular physics collider cost:
  - Added separate modular collider sweep sampling step (`0.55`) while retaining render sweep detail (`0.25`).
  - Removed double-sided Trimesh duplication on modular colliders and now build from dedicated lower-density collider geometries.
- Improved modular track readability:
  - Added floor height-based vertex color gradient to improve elevation readability.
  - Added a high-contrast center guide strip along the sweep path to improve turn/path legibility.
  - Increased rail visual contrast/opacity for clearer boundaries.
- Performance baseline tuning changes:
  - Updated default `physicsMaxSubSteps` from `12` to `6`.
  - Updated default `physicsSolverIterations` from `24` to `16`.
- Bumped app version to `0.8.2.0` in `client/src/buildInfo.ts`.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- Manual desktop/mobile interactive smoke is still pending in this non-interactive environment.

v0.8.3.0 update:
- Performed a modular track physics hotfix overhaul to recover severe frame drops and wall clipping while preserving board-tilt marble feel.
- Replaced default modular collider strategy with primitive segment colliders:
  - Added a primitive collider chain builder in `client/src/game/track/createTrack.ts` that emits overlapping oriented box colliders for floor, rails, and tunnel roofs along the sampled path.
  - Increased modular collider sampling step to `1.2` (`BLUEPRINT_COLLIDER_SAMPLE_STEP`) to reduce narrowphase workload.
  - Kept a fallback Trimesh collider branch for future exotic pieces (`BLUEPRINT_COLLIDER_MODE: "trimesh"`), but default mode is now `"primitive"`.
- Added physics diagnostics metadata to track build output:
  - `TrackBuildResult.physicsDebug` with `colliderPieceCount`, `primitiveShapeCount`, and `exoticTrimeshPieceCount`.
  - Wired this data into runtime diagnostics display.
- Optimized containment and runtime diagnostics in `HelloMarble`:
  - Removed expensive full-scan nearest-sample fallback in curved containment lookup.
  - Added runtime counters for marble-board contacts and rail clamp corrections/sec.
  - Added diagnostics lines for collider/shape/contact/clamp rates.
- Removed the contact-penetration correction pass introduced in v0.8.2.0 from the fixed-step path to avoid extra per-step contact processing overhead; diagnostics `penetrationDepth` now remains `0` unless a later correction path is reintroduced.
- Hardened anti-death-spiral tuning constraints:
  - Runtime max catch-up steps now hard-capped at `6`.
  - Tuning sanitize clamp now enforces `physicsMaxSubSteps <= 6` and `physicsSolverIterations <= 24`.
  - Debug sliders updated to match (`substeps max 6`, `solver max 24`).
  - Bumped tuning storage namespace to `get-tilted:v0.8.3.0:tuning` to avoid stale high-cost persisted values.
- Bumped app version to `0.8.3.0` in `client/src/buildInfo.ts`.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- Attempted `develop-web-game` Playwright workflow client invocation, but it remains blocked in this environment (`ERR_MODULE_NOT_FOUND: Cannot find package 'playwright' imported from ~/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js`).

v0.8.3.1 update:
- Locked Android/TWA orientation to portrait to prevent device rotation from disrupting tilt gameplay in Play Store internal testing.
- Updated web app manifest orientation to `portrait-primary` in `client/public/manifest.webmanifest`.
- Updated Android TWA orientation source-of-truth to `portrait` in `android/twa-manifest.json` and `scripts/sync_twa_manifest.mjs`.
- Updated Android wrapper orientation/version values:
  - `android/app/build.gradle`: `orientation` set to `portrait`, version updated to `0.8.3.1` (`versionCode 80301`).
  - `android/app/src/main/java/dev/gettilted/app/LauncherActivity.java`: uses `SCREEN_ORIENTATION_USER_PORTRAIT` on Android versions above Oreo for launch behavior alignment.
  - `android/app/src/main/res/raw/web_app_manifest.json`: orientation updated to `portrait-primary`.
- Bumped app version to `0.8.3.1` in `client/src/buildInfo.ts`.

Verification:
- `npm run android:twa:sync` passes.
- `npm run android:twa:update` passes.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.3.2 update:
- Hardened gameplay portrait locking in `client/src/game/HelloMarble.tsx`:
  - removed the one-shot lock gate so failed orientation lock attempts can retry.
  - removed viewport-width `isMobile` gating for lock effect so landscape rotation cannot disable the lock listener path.
  - added retry triggers on `pointerdown`, `focus`, `visibilitychange` (when visible), and `orientationchange`.
  - kept graceful no-op behavior when `screen.orientation.lock` is unavailable.
- Added explicit Android activity lock in `android/app/src/main/AndroidManifest.xml`:
  - `LauncherActivity` now declares `android:screenOrientation="portrait"` for additional wrapper-level enforcement.
- Bumped app version to `0.8.3.2` in `client/src/buildInfo.ts`.
- Synced Android wrapper version metadata to `0.8.3.2` (`versionCode 80302`) in:
  - `android/twa-manifest.json`
  - `android/app/build.gradle`

Verification:
- `npm run android:twa:sync` passes.
- `npm run android:twa:update` passes.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.3.3 update:
- Added a new required section in `AGENTS.md` documenting when Play Store redeploy with a new Android `.aab` is required.
- Added a concise decision checklist separating wrapper-level Android changes (AAB required) from web-only changes (AAB not required).
- Added an explicit release reminder to complete Play internal rollout and tester install when AAB changes are required.
- Bumped app version to `0.8.3.3` in `client/src/buildInfo.ts`.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.3.16 update:
- Retuned default handling in `client/src/game/gameConstants.ts` for faster counter-tilt response while preserving control:
  - `maxTiltDeg`: `16`
  - `maxBoardAngVel`: `7.5`
  - `linearDamping`: `0.12`
  - `angularDamping`: `0.18`
  - `tiltFilterTau`: `0.2`
  - `contactFriction`: `0.84` (restored to historical high-grip range used in earlier versions)
- Reworked debug numeric tuning controls in `client/src/game/HelloMarble.tsx` to remove keyboard-heavy `type="number"` inputs and use slider + stepper interactions.
- Added reusable `client/src/ui/DebugScalarControl.tsx` with:
  - range slider
  - large `- / +` buttons
  - clamped step snapping
  - compact value readout chip
- Updated debug control styling in `client/src/index.css` for mobile-safe touch targets and clearer scalar rows.
- Bumped app version to `0.8.3.16` in `client/src/buildInfo.ts`.
- Synced Android wrapper versions to `0.8.3.16` (`versionCode 80316`) in:
  - `android/twa-manifest.json`
  - `android/app/build.gradle`

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.3.4 update:
- Synced Android wrapper version metadata with the app version to avoid Play upload rejection on `versionCode`.
- Bumped app version to `0.8.3.4` in `client/src/buildInfo.ts`.
- Ran `npm run android:twa:sync` to update `android/twa-manifest.json` (`appVersion: 0.8.3.4`, `appVersionCode: 80304`).
- Updated `android/app/build.gradle` to `versionName "0.8.3.4"` and `versionCode 80304`.
- Updated `AGENTS.md` build-version discipline with a required sync rule:
  - every `APP_VERSION` change must also update Android wrapper version fields in `android/twa-manifest.json` and `android/app/build.gradle`.
  - added a pre-Play-upload check list to verify version parity across all three files.

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.3.13 update:
- Added collision filtering in `client/src/game/HelloMarble.tsx` so `boardBody` (floor), `boardWallBody` (walls/roof), and obstacle bodies only collide with the marble body, preventing board-vs-wall kinematic narrowphase work.
- Kept per-surface contact materials unchanged (`board` friction tuning on floor, `board-wall` friction `0`) to preserve rolling/gliding behavior while removing redundant body-pair checks.
- Added diagnostics metrics for collision cost visibility:
  - `floorShapeCount`
  - `wallShapeCount`
  - `estimatedBoardWallShapeTestsPerStep`
  - `boardWallCollisionFiltered`
- Wired new metrics through `createTrack` physics debug output, debug store state, and the diagnostics panel in `HelloMarble`.
- Bumped app version to `0.8.3.13` in `client/src/buildInfo.ts`.
- Synced Android wrapper versions to `0.8.3.13` (`versionCode 80313`) in:
  - `android/twa-manifest.json`
  - `android/app/build.gradle`

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.3.14 update:
- Added a hybrid shadow system in `client/src/game/HelloMarble.tsx` with two manual debug-selectable modes:
  - `dynamic`: Three.js shadow maps (marble casts real-time shadows on the tilting track).
  - `projected`: blob-shadow projection mode as fallback.
- Enabled dynamic shadow defaults and runtime tuning controls:
  - `shadowMode` (`dynamic` | `projected`)
  - `shadowMapSize` (`512` | `1024`)
- Configured directional light shadow camera/bias settings and dynamic light framing around the marble for better local shadow stability while racing.
- Reworked projected blob behavior so it no longer follows the marble upward:
  - added downward raycast projection against `track.group`
  - aligned blob orientation to hit-surface normal
  - scaled/faded blob by marble-to-surface distance.
- Added diagnostics to validate active shadow path at runtime:
  - `shadowMode`
  - `shadowMapSize`
  - `dynamicShadowEnabled`
- Added new tuning fields to shared tuning model and sanitation pipeline:
  - `client/src/game/gameTypes.ts`
  - `client/src/game/gameConstants.ts`
  - `client/src/game/gameUtils.ts`
- Bumped app version to `0.8.3.14` in `client/src/buildInfo.ts`.
- Synced Android wrapper versions to `0.8.3.14` (`versionCode 80314`) in:
  - `android/twa-manifest.json`
  - `android/app/build.gradle`

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.3.15 update:
- Removed shadow mode switching and made dynamic shadow maps the only shadow rendering path in `client/src/game/HelloMarble.tsx`.
- Kept manual quality control via `shadowMapSize` and removed `shadowMode` from tuning/state surface.
- Tuned directional-light shadow parameters to reduce center-hole/peter-panning artifacts:
  - `shadow.bias` tightened to `-0.00025`
  - `shadow.normalBias` reduced to `0.012`
  - `shadow.radius` adjusted to `1.5`
- Added a subtle dynamic contact-shadow assist (surface-raycast anchored) to fill residual center-hole artifacts without reverting to projected-only shadow mode:
  - anchored to nearest track surface normal
  - fades out quickly with clearance when airborne
  - remains below the marble on the track surface.
- Updated debug diagnostics by removing shadow-mode state and retaining shadow map size visibility.
- Updated tuning typing/sanitization by removing `shadowMode` while keeping `shadowMapSize`:
  - `client/src/game/gameTypes.ts`
  - `client/src/game/gameConstants.ts`
  - `client/src/game/gameUtils.ts`
  - `client/src/game/debugStore.ts`
- Bumped app version to `0.8.3.15` in `client/src/buildInfo.ts`.
- Synced Android wrapper versions to `0.8.3.15` (`versionCode 80315`) in:
  - `android/twa-manifest.json`
  - `android/app/build.gradle`

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.4.0 update:
- Restricted active modular generation/runtime catalog to `straight` + `arc90` only, and filtered all other piece kinds out of blueprint picks.
- Added a deterministic starter sequence for each generated blueprint (`straight -> arc left -> straight -> arc right -> straight`) to establish an early S-curve flow.
- Added a new modular-track obstacle authoring pass that places thick static blockers directly onto the curved path:
  - entrance/exit paired gates with center gap target ~1.35x marble diameter (bounded by 1.15x minimum and 1.5x max),
  - alternating side-jut and center blockers,
  - one offset gate + one offset center block to introduce non-repetitive variation.
- Updated Track Lab piece-type UI to only expose `Straight` and `Arc 90` options so editor choices match runtime-enabled pieces.
- Bumped version to `0.8.4.0` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json`
  - `android/app/build.gradle`

v0.8.5.0 update:
- Replaced the single whole-path S-set-piece obstacle pass with per-piece obstacle generation in `client/src/game/track/createTrack.ts`.
- Added deterministic piece selection at a 75% obstacle / 25% non-obstacle rate for eligible modular pieces (`straight` and `arc90`, excluding compensating turn pairs), seeded from blueprint seed.
- Added two piece-local obstacle layouts:
  - straight pieces: alternating centered gates, wall-jut blockers, and off-center middle blockers,
  - 90-degree arc pieces: curvature-aware alternating inner/outer wall juts, offset center blockers, and shifted gates.
- Implemented rounded obstacle geometry/collision for set-piece blockers using extruded rounded-rectangle trimeshes, so marble collision matches visuals.
- Added wall-contact-aware corner behavior so obstacle sides touching a rail remain flush (no rounding on the touching side).
- Bumped version to `0.8.5.0` and synced Android wrapper versions to match:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80500`)
  - `android/app/build.gradle` (`versionCode` `80500`)

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.
- Browser smoke capture from local run saved at `output/web-game/shot-0.png` confirms obstacle fields render with mixed wall-jut and center blockers on modular pieces and app boots without runtime crash.

v0.8.5.1 update:
- Reduced obstacle density and spacing pressure in modular piece obstacles in `client/src/game/track/createTrack.ts`:
  - removed fixed 8-point obstacle rhythm and switched to wider-spaced 4-event templates that yield 5 or 6 obstacles per enabled piece (`gate + blocker + optional random + gate`),
  - increased edge padding and enforced larger minimum gap between obstacle events.
- Added deterministic spawn safety for early progression:
  - first 2 eligible main-lane pieces are excluded from obstacle selection.
- Lowered set-piece obstacle height to improve down-track visibility:
  - obstacle height now `1.15x` marble diameter (`1.15` world units) instead of rail height.
- Increased straight/arc pattern variety while preserving a rough common template:
  - per-piece deterministic RNG now varies gate offsets, blocker offsets, and random-step obstacle type,
  - arc pieces bias variations by inner/outer turn side.
- Kept rounded obstacle corners and wall-flush edge behavior from `v0.8.5.0`.
- Bumped version to `0.8.5.1` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80501`)
  - `android/app/build.gradle` (`versionCode` `80501`)

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.5.2 update:
- Simplified modular obstacle piece behavior so only one obstacle style is used again:
  - restored the single `custom-obstacle-S` placement pattern for obstacle-enabled pieces,
  - removed the newer per-piece obstacle variant logic that created obstacle straight and obstacle arc variants.
- Restricted obstacle-piece selection pool to straight placements only:
  - 90-degree bends now remain non-obstacle pieces by default,
  - track still uses non-obstacle straight and non-obstacle arc90 geometry pieces.
- Kept deterministic selection and spawn-safety behavior:
  - first 2 eligible main-lane straight pieces remain obstacle-free.
- Updated default camera zoom baseline:
  - `DEFAULT_TUNING.cameraZoom` now starts at `0.7` (previously `1.0`), matching the old fully zoomed-out baseline.
- Expanded camera zoom range so players can zoom both in and out from the new default:
  - camera zoom clamp updated to `0.5..1.4`,
  - options and in-race zoom sliders updated to min `0.5`.
- Bumped version to `0.8.5.2` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80502`)
  - `android/app/build.gradle` (`versionCode` `80502`)

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.5.3 update:
- Added a dedicated Test Track flow from the main menu:
  - replaced the `Track Lab` menu button with a new `Test Track` button that launches directly into a deterministic test layout.
- Added a new solo-like game mode (`testTrack`) in gameplay state handling so countdown/start/unfreeze/result/debug behavior matches solo races.
- Implemented deterministic test layout generation support:
  - extended modular blueprint generation to accept forced piece kinds and optional starter-sequence disable,
  - Test Track now forces a two-piece straight sequence.
- Added per-blueprint obstacle spawn-safety override:
  - normal tracks keep safe-start protection at 2 pieces,
  - Test Track uses 1 safe straight piece, then the next straight piece is the obstacle set piece.
- Kept the obstacle piece style locked to the single `custom-obstacle-S` pattern and straight-only obstacle selection, so bends stay non-obstacle.
- Kept the zoomed-out camera baseline from `v0.8.5.2` (default zoom `0.7`) and the expanded zoom range (`0.5..1.4`).
- Bumped version to `0.8.5.3` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80503`)
  - `android/app/build.gradle` (`versionCode` `80503`)

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.
