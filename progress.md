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

v0.8.5.4 update:
- Disabled automatic modular obstacle generation by default for blueprint tracks:
  - obstacle authoring pass in `createTrackFromBlueprint` is now opt-in (`enableAutomaticObstacles`),
  - default runtime behavior now spawns only non-obstacle straight and non-obstacle 90-degree bend pieces.
- Removed the Test Track-specific automatic obstacle override so Test Track no longer injects obstacle pieces automatically.
- Left obstacle plumbing in place for future manual/explicit obstacle-piece work, but no automatic obstacle placement runs at this time.
- Bumped version to `0.8.5.4` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80504`)
  - `android/app/build.gradle` (`versionCode` `80504`)

Verification:
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

v0.8.5.5 update:
- Refined Test Track composition to deterministic manual-piece sequencing:
  - Test Track now builds exactly: one blank straight spawn piece, followed by the newest manual test piece(s), followed by one blank straight finish piece.
  - No extra generated pieces are included in Test Track.
- Added the first manual obstacle test piece (`triangle_chicane_v1`) using the provided sketch direction:
  - lower wall-jut pair,
  - large centered solid triangle obstacle (tip toward spawn),
  - upper wall-jut pair,
  - top centered blocker.
- Added manual test-piece obstacle plumbing in blueprint track creation:
  - per-placement manual obstacle piece list support (`manualTestPieces`),
  - manual obstacle rendering + matching collider generation (including solid triangle prism collider).
- Kept automatic obstacle generation disabled by default globally (manual-only obstacle iteration mode).
- Bumped version to `0.8.5.5` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80505`)
  - `android/app/build.gradle` (`versionCode` `80505`)

v0.8.5.6 update:
- Tuned `triangle_chicane_v1` obstacle pacing to reduce density and increase per-row travel distance:
  - obstacle rows are now spread much farther apart across the test piece,
  - row spacing is paired with a longer test-piece straight segment for clearer run-up speed.
- Tightened the two wall-jut gate openings to target about `1.5x` marble diameter.
- Increased the center triangle footprint and elongated it forward:
  - triangle base now expands based on lane width while preserving about `1.5x` marble-diameter side clearance to walls,
  - triangle depth increased to make it substantially longer and more obtrusive.
- Narrowed the final top blocker slightly to avoid over-constraining late-piece navigation while preserving challenge.
- Updated Test Track forced piece templates so manual obstacle test pieces run on elongated straight segments:
  - spawn and finish pieces stay short/blank,
  - the middle test piece(s) now use longer straight geometry for obstacle spacing tests.
- Bumped version to `0.8.5.6` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80506`)
  - `android/app/build.gradle` (`versionCode` `80506`)

v0.8.5.7 update:
- Registered the approved triangle straight obstacle piece under the manual obstacle piece name `straight-obstacle-1`.
  - Test Track manual-piece list now references `straight-obstacle-1`.
  - Manual obstacle placement dispatch now keys off `straight-obstacle-1`.
- Removed the rendered center guide line from blueprint tracks to prevent obstacle clipping and visual overlap.
  - deleted center-guide geometry generation and guide material wiring.
- Bumped version to `0.8.5.7` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80507`)
  - `android/app/build.gradle` (`versionCode` `80507`)

v0.8.5.8 update:
- Added a new manually-authored obstacle piece shape from the latest sketch as `straight-obstacle-2`.
  - Implemented alternating wall-attached triangle wedges along a straight piece to create a left-right slalom channel.
  - Kept the prior approved `straight-obstacle-1` piece unchanged and still available.
- Fixed Test Track piece count behavior so it can render exact short test layouts:
  - when starter sequence is disabled (Test Track mode), blueprint generation now honors small piece counts instead of clamping to the normal minimum,
  - this prevents extra random pieces (including bends) from being appended.
- Test Track now targets the new piece for this iteration:
  - layout is exactly: straight spawn, `straight-obstacle-2`, straight finish.
- Bumped version to `0.8.5.8` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80508`)
  - `android/app/build.gradle` (`versionCode` `80508`)

v0.8.5.9 update:
- Reworked `straight-obstacle-2` to match the updated zig-zag sketch with stricter symmetry:
  - exact alternating side order: left, right, left, right,
  - equal row spacing across the piece,
  - equal triangle length/shape for all four obstacles,
  - centered triangle tips (removed per-obstacle tip skew) for consistent alignment.
- Tuned the zig-zag channel gap against marble scale:
  - tip-to-tip corridor target set from marble diameter so openings feel intentional and repeatable,
  - triangles are longer and more visually obtrusive than the previous `straight-obstacle-2` draft.
- Bumped version to `0.8.5.9` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80509`)
  - `android/app/build.gradle` (`versionCode` `80509`)

v0.8.5.10 update:
- Tuned `straight-obstacle-2` to increase triangle reach and tighten the zig-zag lane:
  - triangle tip reach now targets roughly 75% of traversable track width,
  - implemented via ~2 marble-diameter clearance from each tip to the opposite wall,
  - slightly tighter, more consistent spacing across the sequence.
- Extended `straight-obstacle-2` pattern length by adding 3 more triangles:
  - obstacle count increased from 4 to 7,
  - kept strict left-right alternation and symmetric alignment.
- Increased Test Track manual-piece straight length to keep the expanded 7-triangle pattern readable and less cramped while still tighter than before.
- Bumped version to `0.8.5.10` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80510`)
  - `android/app/build.gradle` (`versionCode` `80510`)

v0.8.5.11 update:
- Saved the current dense zig-zag triangle set piece as `straight-tight-triangles`.
  - Preserves the tighter 7-triangle alternating pattern and current clearances.
- Added a second variant `straight-wide-triangles` with about 2x spacing between triangles:
  - uses 4 alternating wall triangles over the same span,
  - keeps the same triangle size/reach profile for apples-to-apples feel comparison.
- Updated Test Track to load the new wider-spaced variant for immediate testing:
  - layout remains exactly: straight spawn, `straight-wide-triangles`, straight finish.
- Bumped version to `0.8.5.11` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80511`)
  - `android/app/build.gradle` (`versionCode` `80511`)

v0.8.5.12 update:
- Extended `straight-wide-triangles` by adding 3 more triangles:
  - obstacle count increased from 4 to 7,
  - preserved alternating left-right symmetry and the same triangle size/reach profile.
- Increased the manual test-piece straight length so the expanded wide-triangle pattern remains readable and not overly compressed.
- Bumped version to `0.8.5.12` and synced Android wrapper versions:
  - `client/src/buildInfo.ts`
  - `android/twa-manifest.json` (`appVersionCode` `80512`)
  - `android/app/build.gradle` (`versionCode` `80512`)

v0.8.5.12 process update (mode policy refinement):
- Added explicit dual-mode workflow definitions to agent instruction docs (`AGENTS.md`, `CLAUDE.md`):
  - `Full Publish Test Mode` (default): full checks + commit/push workflow unchanged.
  - `Local Iteration Mode`: rapid-change workflow with lint/typecheck/build skipped by default and no commit/push unless requested.
- Refined Local Iteration versioning rules:
  - version bump is optional for same-issue/same-theme polishing,
  - version bump is required when work shifts into materially different feature areas or is otherwise a significant scope change.
- Refined Android sync policy:
  - required in Full Publish/publish-ready commits when app version changes,
  - may be deferred during Local Iteration unless explicitly requested.
- Locked in `progress.md` as always-required in both modes for detailed change logging.

v0.8.5.12 process update (mode policy refinement 2):
- Refined Local Iteration Mode to be even faster:
  - skip lint/typecheck/build by default,
  - skip manual smoke/runtime checks by default,
  - run checks only when explicitly requested.
- Locked version sync policy across modes:
  - whenever `APP_VERSION` changes, Android wrapper versions must be updated in the same change,
  - no multiple active working version numbers are allowed across `client/src/buildInfo.ts`, `android/twa-manifest.json`, and `android/app/build.gradle`.
- Kept Full Publish Test Mode behavior unchanged from prior workflow.

v0.8.5.12 local iteration update (test track sequencing):
- Confirmed Test Track was configured to use `straight-wide-triangles` as its single manual obstacle piece.
- Updated Test Track to an explicit fixed sequence to remove ambiguity and include all requested set pieces in one run:
  - `StraightBlank` -> `StraightWideTriangles` -> `StraightBlank` -> `StraightTightTriangles` -> `StraightBlank` -> `StraightObstacle1` -> `StraightFinish`
- Implemented sequence-driven manual obstacle placement indices so obstacle pieces are placed at exact intended slots (1, 3, and 5 in the user-facing sequence).
- Kept all pieces as straight geometry and retained automatic obstacle generation disabled in test mode.

v0.8.5.12 local iteration update (track length diagnosis/fix):
- Diagnosed compressed Test Track obstacle pieces:
  - `StraightObstacle1` was unintentionally using short transition length while wide/tight pieces used the long test length,
  - forced test-piece lengths were being clamped to `28` by `sanitizeTrackPieceTemplate`, so configured long lengths (for example `52`) were not fully applied.
- Fixed Test Track length assignment so `StraightObstacle1` also uses the long manual set-piece length.
- Added mode-aware forced-piece length override in blueprint generation:
  - when starter sequence is disabled (Test Track mode), forced main pieces can use longer lengths (up to `120`) instead of the default `28` cap.
  - non-test/default sanitization behavior remains unchanged.

v0.8.5.12 local iteration update (fixed set-piece length policy):
- Converted Test Track obstacle-piece length handling from a single shared value to fixed authored lengths per set piece:
  - `straight-obstacle-1` => `28`
  - `straight-tight-triangles` => `34`
  - `straight-wide-triangles` => `52`
- Ensured `StraightObstacle1` now uses its authored long-form set-piece length in Test Track (it was previously inheriting transition length in one path).
- Added manual set-piece authored-length enforcement in obstacle placement:
  - obstacle layouts now use authored piece length windows and centered offsets,
  - avoids pattern stretch/compression when piece lengths differ,
  - skips placement if a piece is shorter than its authored length to avoid distorted/unfair geometry.

v0.8.5.12 local iteration update (Track Tester debug tuning menu):
- Added a new Test Track tuning section to the debug drawer (Tuning tab) when in `testTrack` mode.
- Added persistent Track Tester controls for rapid on-PC iteration:
  - `Track Width`
  - `Set Piece Length Scale`
  - per-obstacle sliders `Obstacle 1 Scale` through `Obstacle 8 Scale`
- Added explicit action buttons:
  - `Apply Test Track Tuning` (rebuilds/restarts Test Track with new values)
  - `Reset Piece Tuning` (restores defaults)
- Wired Test Track tuning into generation/runtime:
  - track width now feeds blueprint generation in test mode,
  - set-piece length scale now scales authored test set-piece lengths,
  - per-obstacle scale array now affects manual obstacle geometry for `straight-obstacle-1`, `straight-tight-triangles`, and `straight-wide-triangles`.
- Added new local storage persistence for test tuning profile:
  - key: `get-tilted:v0.8.5.12:test-track-debug-settings`.
- Updated debug drawer visibility behavior for iteration ergonomics:
  - the debug drawer now always shows in `testTrack` mode even if the global debug-menu toggle is disabled, so Track Tester tuning controls are immediately accessible.

v0.8.5.12 local iteration update (piece-scoped tester controls + obstacle labels):
- Reworked Test Track obstacle tuning from one global slider bank to piece-scoped controls:
  - added derived tunable piece metadata for the current test sequence (`TRACK 1/2/3`) based on non-blank/non-finish test pieces,
  - added per-piece obstacle scale arrays with persistence and sanitization (including legacy migration from the previous flat `obstacleScales` format).
- Updated Test Track tuning UI to use collapsible submenus:
  - each `TRACK N` section is collapsible and contains obstacle scale sliders for that piece only.
- Expanded `straight-obstacle-1` tuning slots to true per-obstacle control (6 slots):
  - lower gate left/right, center triangle, upper gate left/right, top bar.
- Added optional obstacle ID overlay support in manual test-piece generation:
  - obstacles can render white labels in `track-obstacle` format (for example `1-1`, `3-2`) when enabled by Test Track tuning config.
- Enabled these obstacle ID overlays for Test Track generation (builder/test iteration flow only).
- Added sprite texture disposal in track cleanup to avoid leaking label textures during repeated rebuilds.

v0.8.5.12 local iteration fix (Test Track freeze on countdown):
- Fixed runtime freeze/hang when entering Test Track after adding obstacle ID label sprites.
- Root cause:
  - contact-shadow assistance raycasting traverses the full track hierarchy,
  - visual label sprites were included and `THREE.Sprite` raycasting requires a camera, triggering a runtime exception and stopping the frame loop.
- Fix:
  - marked obstacle label sprites as visual-only by overriding sprite raycast handling (`sprite.raycast = () => {}`), keeping labels out of gameplay raycasts.
- Verified with automated browser run:
  - no `pageerror` after entering Test Track,
  - no Sprite/matrixWorld raycast exceptions,
  - countdown continues and gameplay proceeds.

v0.8.5.12 local iteration fix (obstacle scale disappearance + broadcast visibility):
- Fixed a boundary-case disappearance when scaling certain centered obstacles in Test Track:
  - center-placement logic previously skipped placement when `maxCenter === minCenter`,
  - now only skips when `maxCenter < minCenter`, allowing exact-center placement at tight bounds.
- Increased broadcast camera base height by ~18% to improve down-track visibility at high board tilt:
  - broadcast base Y changed from `12` to `14.2`,
  - preserves existing zoom/height-bias controls while reducing obstacle occlusion of the marble.
- Sanity-checked with automated Test Track interaction:
  - set `TRACK 3 -> Obstacle 6 Scale` to max and applied tuning,
  - no runtime errors or hangs observed.

v0.8.5.12 local iteration update (camera visibility + global obstacle transparency controls):
- Increased broadcast camera base height again for high-tilt visibility:
  - base Y raised from `14.2` to `15.6` (roughly +10% from prior setting).
- Updated default max tilt tuning to `13.5` degrees for clearer obstacle/marble visibility while preserving challenge.
- Added new global tuning controls:
  - `Object Transparency (%)` slider (0-85),
  - `Wireframes Match Transparency` toggle (on/off).
- Wired these controls into track generation for both blueprint and legacy obstacle paths:
  - obstacle mesh opacity now derives from global object transparency,
  - obstacle edge/wireframe line opacity follows the same transparency when toggle is enabled, or remains fully opaque when disabled.
- Increased default obstacle transparency by setting default object transparency to `32%` (roughly ~20%+ more transparent than recent opaque obstacle defaults).
- Added live application path for solo/test tracks:
  - changing transparency controls rebuilds the active solo/test track with updated visual settings.
- Verification:
  - client typecheck/build pass,
  - automated browser run toggling transparency and wireframe option in Test Track showed no runtime errors.

v0.8.5.12 local iteration update (wireframe flicker cleanup + global wireframe toggle):
- Removed bottom-contact obstacle wireframe edges to eliminate floor-contact flicker:
  - added filtered edge-generation that strips line segments lying on obstacle bottom planes,
  - applied this filtering across blueprint/manual obstacle meshes and legacy obstacle walls/blocks.
- Added global object wireframe visibility control:
  - new tuning toggle: `Show Wireframes` (on/off),
  - when off, obstacle wireframe overlays are fully hidden.
- Kept existing transparency behavior and expanded controls:
  - `Wireframes Match Transparency` continues to control whether wireframes follow object transparency when wireframes are visible.
- Added tuning/state plumbing for the new wireframe visibility flag and live rebuild application in solo/test modes.
- Verification:
  - client typecheck/build pass,
  - automated Test Track UI interaction toggling wireframe controls showed no runtime errors.

v0.8.5.12 local iteration update (arc90 obstacle test piece + test track route):
- Updated Test Track manual sequence to only:
  - `Straight Spawn` (blank),
  - `arc90-obstacle-1`,
  - `Straight Finish`.
- Added new manual test-piece kind `arc90-obstacle-1` with authored length and per-obstacle tuning slots.
- Implemented `arc90-obstacle-1` placement in manual obstacle generation for `arc90` pieces:
  - two alternating wall-jutting bars on the entry section,
  - one inner-wall triangle near the turn corner,
  - one circular blocker on the exit section.
- Extended manual obstacle generator typing and placement matching so test-piece kinds can target either `straight` or `arc90` placements.

v0.8.5.12 local iteration fix (arc test-piece obstacles + finish trigger on curved layouts):
- Fixed manual obstacle placement skipping when `Set Piece Length Scale` exceeded authored length:
  - manual obstacle generation now clamps to available piece sweep length instead of skipping the piece entirely.
- Fixed race start/finish detection for non-Z-aligned tracks (including `Straight -> Arc90 -> Straight`):
  - added trial gate-plane metadata to blueprint track builds,
  - updated runtime crossing checks to use signed distance across start/finish gate planes,
  - retained Z-threshold fallback for legacy/non-blueprint track builds.

v0.8.5.12 local iteration update (arc90-obstacle-1 layout aligned to sketch intent):
- Reworked obstacle anchoring for `arc90-obstacle-1` to match the drawn pattern semantics:
  - first two bar obstacles now anchor on the incoming straight segment (pre-turn),
  - corner triangle now anchors near the start of the outgoing straight (post-turn edge/corner region),
  - circular blocker now anchors in the outgoing straight lane center.
- Increased the corner triangle footprint and increased center-circle occupancy target to roughly 70% of lane width (before per-obstacle scale tuning).
- Corrected inner/outer wall side mapping for signed arc turn direction in this manual arc template.

v0.8.5.12 local iteration update (arc90-obstacle-1 continuous 3-piece placement pass):
- Updated `arc90-obstacle-1` obstacle placement to sample one continuous sweep across the full `incoming straight + arc90 + outgoing straight` span instead of treating each segment independently.
- Increased spacing between the first two pre-turn bars and kept them in the pre-turn region.
- Repositioned the triangle to the turn-exit region and adjusted orientation controls so the tip projects correctly from the inner wall.
- Kept the circle centered on the outgoing straight with large lane occupancy and tuned distance ratios to reduce crowding near the triangle.

v0.8.5.12 local iteration update (arc90-obstacle-1 pattern adjustment per sketch):
- Moved the circular blocker from the outgoing straight into the middle of the turn arc so the player must route around it while cornering.
- Replaced the single post-turn triangle with a staggered mirrored pair on the second straight:
  - first triangle on the outside wall,
  - second triangle mirrored on the opposite wall, offset down-track to create a pass-through channel.
- Preserved the first two pre-turn wall-jut bars and widened their spacing.

v0.8.5.12 local iteration tweak (triangle stagger mirror direction):
- Flipped the post-turn triangle wall order in `arc90-obstacle-1` so the diagonal pass-through slant is mirrored (`\` orientation instead of `/` in top-down view).

v0.8.5.12 local iteration update (distinct shufflable `arc90-obstacle-1` set-piece):
- Added authored set-piece templates to the runtime piece catalog:
  - `Arc 90 Obstacle 1 (Left Set)`
  - `Arc 90 Obstacle 1 (Right Set)`
- Implemented composite expansion in blueprint generation:
  - when either set-piece is selected, it expands into a grouped `straight + arc90 + straight` placement trio as one logical selection.
- Tagged composite trio placements with a dedicated set-piece group prefix so obstacle synthesis can target them deterministically.
- Disabled hard-arc auto pair compensation for this authored set-piece so its 3-piece layout stays intact.
- Added authored set-piece obstacle detection in track construction:
  - normal generated tracks now auto-apply `arc90-obstacle-1` obstacle geometry for grouped set-piece arcs even when Test Track manual specs are not supplied.

v0.8.5.12 local iteration update (singleplayer camera-friendly 10-piece generation policy):
- Added a new blueprint generation policy mode: `singleplayer_camera_friendly_10`.
- Policy behavior:
  - enforces a 10 logical-piece track,
  - enforces fixed start and finish straights,
  - enforces middle-slot 70/30 obstacle mix (6 obstacle + 2 non-obstacle across 8 middle slots),
  - enforces immediate turn-correction sequencing: any turn must be followed by the next logical piece with equal/opposite turn angle.
- Implemented deterministic policy sequence construction using seeded weighted candidate ordering and constrained recursion, so the same seed yields the same valid layout.
- Wired the policy to Singleplayer default generation path only; Test Track and Multiplayer generation behavior remain unchanged.
- Added runtime config plumbing for generation policy propagation from `HelloMarble` into `buildTrackBlueprint`.

v0.8.5.12 local iteration tweak (solo seed refresh + straighter camera-friendly mixes):
- Added Singleplayer race seed refresh behavior:
  - entering `Singleplayer` now generates and applies a fresh random solo seed before countdown,
  - restarting a solo race now also generates and applies a fresh random solo seed before countdown.
- Added a dedicated helper in `HelloMarble` to rebuild solo tracks with randomized seed and re-apply the solo generation policy.
- Reduced curve-heavy sequences in `singleplayer_camera_friendly_10` generation:
  - non-obstacle picks now prefer straight pieces over non-obstacle turn pieces,
  - added turn-streak guardrails to avoid long consecutive turn runs beyond corrective pairs,
  - kept the hard immediate opposite-turn correction rule intact.

v0.8.6.0 full publish update (trim piece catalog + split/merge branch test track):
- Removed these built-in track pieces from the runtime catalog in `modularTrack.ts`:
  - `S-Curve Left`
  - `S-Curve Right`
  - `Ramp`
  - `Bridge`
  - `Tunnel`
- Updated Test Track authored sequence to explicitly exercise branch behavior:
  - `blank -> split-y -> blank -> merge-y -> finish`
- Updated Test Track forced-piece construction in `HelloMarble.tsx`:
  - maps `split-y` to forced `splitY` piece,
  - maps `merge-y` to forced `mergeY` piece,
  - keeps transition/finish entries as straights,
  - keeps set-piece length scaling applied to authored test-track layout lengths.
- Enabled branch piece generation for Test Track builds only:
  - `enableBranchPieces: isTestTrack`
- Bumped app/build identity to `0.8.6.0` and synchronized Android wrapper versions in the same change:
  - `client/src/buildInfo.ts` -> `APP_VERSION = 0.8.6.0`
  - `android/twa-manifest.json` -> `appVersion = 0.8.6.0`, `appVersionCode = 80600`
  - `android/app/build.gradle` -> `versionName = 0.8.6.0`, `versionCode = 80600`
- Reset Test Track debug storage namespace to the new version key:
  - `get-tilted:v0.8.6.0:test-track-debug-settings`
- Full Publish Test Mode verification:
  - `npm run lint` passed,
  - `npm run typecheck` passed,
  - `npm run build` passed.

v0.8.6.1 full publish update (remove split/merge and restore stable test track):
- Removed non-functional branch pieces from built-in runtime catalog:
  - `Split Y`
  - `Merge Y`
- Kept branch-generation infrastructure code in place but removed these pieces from active selection/catalog so they are no longer used in generated tracks.
- Reverted Test Track authored sequence back to the stable arc set-piece flow:
  - `blank -> arc90-obstacle-1 -> finish`
- Reverted Test Track forced-piece mapping from split/merge routing back to arc-obstacle routing:
  - middle piece is now forced `arc90` for `arc90-obstacle-1`, with turn/bank settings restored.
- Disabled branch generation for Test Track builds (`enableBranchPieces: false`).
- Bumped app/build identity to `0.8.6.1` and synchronized Android wrapper versions in the same change:
  - `client/src/buildInfo.ts` -> `APP_VERSION = 0.8.6.1`
  - `android/twa-manifest.json` -> `appVersion = 0.8.6.1`, `appVersionCode = 80601`
  - `android/app/build.gradle` -> `versionName = 0.8.6.1`, `versionCode = 80601`
- Rotated Test Track debug storage namespace to match new version:
  - `get-tilted:v0.8.6.1:test-track-debug-settings`
- Full Publish Test Mode verification:
  - `npm run lint` passed,
  - `npm run typecheck` passed,
  - `npm run build` passed.

v0.8.7.0 full publish update (lightweight 2D Editor v1: menu + template + shape draw/drag):
- Added a new `EDITOR` entry point to the main menu and a dedicated `editor` menu screen flow in `HelloMarble`.
- Implemented a new lightweight 2D editor model module:
  - `client/src/game/editor2d.ts`
  - includes template geometry math, path sampling, world/view transforms, point projection, obstacle clamping, and layout sanitization.
- Added Editor v1 layout/shape data model:
  - templates: `straight`, `arc90_left`, `arc90_right`, `s_curve`
  - shapes: `rectangle`, `triangle`, `circle`
  - obstacle fields: name, x, z, width, length, depth, yaw.
- Implemented editor screen UI + interactions in `HelloMarble.tsx`:
  - template selection dropdown,
  - `Add New Shape` modal with shape + dimensions + position inputs,
  - top-down SVG track renderer for literal template visualization,
  - shape list panel,
  - selected-shape inspector with editable numeric fields,
  - pointer drag to reposition obstacles in X/Z plane,
  - delete selected + clear all actions,
  - JSON export/import text area controls.
- Added editor persistence:
  - local storage key `get-tilted:v0.8.7.0:editor-layout`.
- Added dedicated editor styling in a new stylesheet:
  - `client/src/game/editor2d.css`
  - includes desktop + mobile layout rules, modal styling, and obstacle visuals/highlights.
- Version discipline updates:
  - `client/src/buildInfo.ts` -> `APP_VERSION = 0.8.7.0`
  - `android/twa-manifest.json` -> `appVersion = 0.8.7.0`, `appVersionCode = 80700`
  - `android/app/build.gradle` -> `versionName = 0.8.7.0`, `versionCode = 80700`
- Full Publish Test Mode verification:
  - `npm run lint` passed,
  - `npm run typecheck` passed,
  - `npm run build` passed.
- Smoke testing:
  - started local client dev server,
  - ran Playwright client smoke navigation into `EDITOR`,
  - verified screenshot output at `output/editor-smoke/shot-0.png` (editor card rendered with template selector, canvas, and JSON panel),
  - no Playwright error log generated for the smoke run.
- Notes for next iteration:
  - current v1 is editor-surface focused; runtime obstacle injection from editor layout into active race track is intentionally deferred to the next iteration.

v0.8.7.1 full publish update (user-requested commit of all pending workspace changes):
- User requested committing and pushing all current local changes, including pre-existing edits not authored in this turn.
- Included all pending tracked modifications and all untracked output artifacts currently present in the workspace.
- Applied required version discipline bump and synchronized version triplet:
  - `client/src/buildInfo.ts` -> `APP_VERSION = 0.8.7.1`
  - `android/twa-manifest.json` -> `appVersion = 0.8.7.1`, `appVersionCode = 80701`
  - `android/app/build.gradle` -> `versionName = 0.8.7.1`, `versionCode = 80701`
- Full Publish Test Mode verification:
  - `npm run lint` passed,
  - `npm run typecheck` passed,
  - `npm run build` passed.
- Smoke validation:
  - launched dev stack and captured Playwright smoke screenshot,
  - verified main menu render at `output/full-commit-smoke/shot-0.png` with `Version 0.8.7.1` visible.

v0.8.7.2 full publish update (editor reference marble guide tool):
- Added a non-scalable, non-resizable `Reference Marble` helper to the 2D editor for clearance checks against gaps/holes.
- Extended editor layout model in `client/src/game/editor2d.ts` with optional `referenceMarble` position and clamping logic:
  - new radius constant `EDITOR_REFERENCE_MARBLE_RADIUS = 0.5` (diameter `1.0`, matching in-game marble scale),
  - new `clampEditorReferenceMarble(...)` helper,
  - persisted in local editor storage but isolated from shape obstacle sizing controls.
- Updated editor interactions in `client/src/game/HelloMarble.tsx`:
  - new toolbar button: `Add Ref Marble` / `Select Ref Marble`,
  - draggable reference marble marker rendered on the SVG canvas,
  - selectable from canvas and shape list (`R. Reference Marble · fixed`),
  - `Delete Selected` now removes selected reference marble,
  - template switching rescales/clamps reference marble Z position consistently,
  - canvas deselection and drag status text now handle reference marble state.
- Export behavior safety:
  - `Export JSON` now emits `{ version, template, trackWidth, obstacles }` only,
  - reference marble remains excluded from exported obstacle payload.
- Added dedicated styling in `client/src/game/editor2d.css` for reference marble marker and adjusted toolbar column layout for the added control.
- Version discipline updates:
  - `client/src/buildInfo.ts` -> `APP_VERSION = 0.8.7.2`
  - `android/twa-manifest.json` -> `appVersion = 0.8.7.2`, `appVersionCode = 80702`
  - `android/app/build.gradle` -> `versionName = 0.8.7.2`, `versionCode = 80702`
- Full Publish Test Mode verification:
  - `npm run lint` passed,
  - `npm run typecheck` passed,
  - `npm run build` passed.
- Smoke testing:
  - launched dev stack,
  - navigated to Editor with Playwright skill script and clicked `Add Ref Marble`,
  - visually confirmed reference marble marker appears and is selected in `output/editor-ref-smoke/shot-0.png`.

v0.8.7.2 local iteration update (hole set-piece prototype):
- Mode: Local Iteration Mode (rapid testing, no commit/push).
- Implemented a new standard test-track set piece focused on hole behavior:
  - `client/src/game/HelloMarble.tsx`
    - Replaced test-track manual sequence middle piece with `straight-center-hole-respawn`.
    - Updated test-track piece metadata/labels to `Straight Hole Respawn` with zero obstacle tuning slots.
    - Kept test-track forced piece wiring aligned so the piece is authored as a straight segment and forwarded via manual test piece specs.
  - `client/src/game/track/createTrack.ts`
    - Added new manual set-piece kind: `straight-center-hole-respawn`.
    - Added floor cutout support for blueprint tracks via manual floor cutout collection + floor slice builders.
    - Carved center floor void in both render geometry and physics colliders (primitive path and trimesh fallback path) by splitting floor into left/right strips only inside the cutout zone.
    - Cutout sizing set to ~2x marble diameter (`TEST_TRACK_CENTER_HOLE_DIAMETER = MARBLE_RADIUS * 4`) with side-width clamping safety.
- Verification performed (targeted for local iteration):
  - Ran `npm run -w client typecheck` (pass).
  - Ran develop-web-game Playwright script against live local Vite server and inspected generated screenshot:
    - `output/web-game/shot-0.png` shows the new center hole on the test track.
  - Note: the game does not currently expose deterministic `window.advanceTime`, so the scripted action burst cannot reliably step gameplay to conclusively assert fall/respawn in automation; manual in-browser drive-through is still recommended for final behavior confirmation.
- Build/version discipline for this local pass:
  - Version bump intentionally deferred (same issue/theme rapid iteration; no significant cross-feature scope jump).
  - No Android wrapper version sync required because `APP_VERSION` was not changed.
- Follow-up TODO:
  - Manually play Test Track and confirm marble drop-through and respawn feel around the hole center; if needed, tune hole diameter or cutout longitudinal span for reliability.

v0.8.7.2 local iteration follow-up (fix H-shaped hole seams):
- Addressed visual artifact where the center hole looked like an "H" due to full-width seam gaps at hole entry/exit.
- Root cause: floor was split into separate swept meshes (full + left strip + right strip) with no overlap band, so transition samples produced thin cross-track slits.
- Implemented overlap-blend transitions in `client/src/game/track/createTrack.ts`:
  - Added render/collider edge blend constants:
    - `TEST_TRACK_CENTER_HOLE_EDGE_BLEND_RENDER`
    - `TEST_TRACK_CENTER_HOLE_EDGE_BLEND_COLLIDER`
  - Updated floor-cutout resolver to classify a smaller `hole core` (actual opening) while keeping full floor overlapped near hole edges.
  - Applied same core logic to primitive collider path so collision hole stays aligned with visuals.
  - Updated floor-slice builders to accept explicit edge blend values for render vs collider sampling density.
- Result: test-track hole now renders as a clean center cutout (no full-width connector slits).
- Verification:
  - `npm run -w client typecheck` passed.
  - Playwright screenshot after entering Test Track confirms visual fix: `output/web-game/shot-0.png`.
- Notes:
  - This was a Local Iteration follow-up on same feature theme; version bump intentionally deferred.
  - Manual gameplay pass is still recommended to reconfirm drop-through + respawn feel after transition blending.

v0.8.7.2 local iteration follow-up (hole collision pass-through fix):
- Issue: after seam-visual fix, center hole looked correct but marble no longer fell through.
- Root cause: collider-side hole core became too narrow from aggressive edge blending (`holeCoreHalfLength` almost collapsed), so center floor collision remained effectively continuous.
- Fixes in `client/src/game/track/createTrack.ts`:
  - Reduced collider edge blend to preserve a real hole core:
    - `TEST_TRACK_CENTER_HOLE_EDGE_BLEND_COLLIDER = BLUEPRINT_COLLIDER_SAMPLE_STEP * 0.1`.
  - Updated primitive collider cutout detection to remove any span overlapping the hole core (not only spans whose center lies strictly inside it):
    - changed condition to `activeCutout.longitudinalDistance - spanHalfLength <= holeCoreHalfLength`.
- Verification:
  - `npm run -w client typecheck` passed.
  - Automated screenshot checks still show clean center-hole visuals.
  - Headless keyboard-drive automation could not conclusively validate movement/fall in this environment (marble remained at spawn in captures), so manual in-browser run remains required to confirm drop-through/respawn behavior end-to-end.
- Version discipline:
  - Local iteration continuation on same issue/theme; version bump intentionally deferred.

v0.8.7.2 local iteration follow-up (visual/collider hole alignment):
- Issue: marble could fall, but fell slightly before the visible hole start (collider hole leading the render hole).
- Root cause: primitive floor collider approximates the channel with long span boxes; cutout removal at span granularity can begin earlier than rendered cutout boundaries.
- Alignment fix in `client/src/game/track/createTrack.ts`:
  - For manual floor cutouts (`straight-center-hole-respawn`), switched primitive mode floor collision to an exact trimesh built from the same `floorGeometries` used for rendering.
  - Kept primitive wall colliders unchanged for performance; only floor collision path is upgraded for hole alignment precision.
  - Added `includeFloor` option to `addBlueprintPrimitiveColliders(...)` so floor boxes are skipped when exact floor trimesh is active.
- Result: hole collision boundaries are now derived from the same geometry as the visible hole, aligning visual and physical cutout extents.
- Verification:
  - `npm run -w client typecheck` passed.
  - Test-track screenshot remains visually correct (`output/web-game/shot-0.png`).
  - Manual drive-through is recommended to confirm subjective feel in-browser on your machine.
- Version discipline:
  - Local iteration continuation on same issue/theme; version bump intentionally deferred.

v0.8.7.2 local iteration follow-up (side-by-side decagon + circle holes):
- Implemented side-by-side comparison holes in the `straight-center-hole-respawn` test set piece:
  - left hole: decagon
  - right hole: circle
  - both centered longitudinally in the same straight set piece with lateral offsets to avoid overlap/clipping.
- Track floor hole model refactor in `client/src/game/track/createTrack.ts`:
  - replaced single center cutout model with generalized floor-hole descriptors (`BlueprintManualFloorHole`) supporting shape kind (`circle` | `decagon`) and radius.
  - added hole interval evaluation pipeline:
    - regular polygon sampling helper for decagon cross-sections,
    - circle/decagon longitudinal slice span resolver,
    - interval merge/complement builder per sweep sample,
    - multi-slice floor geometry generation for arbitrary disjoint hole spans.
  - manual test piece hole collector now emits two holes (left decagon, right circle) for `straight-center-hole-respawn`.
- Collision alignment preservation:
  - kept exact floor trimesh-from-render-geometry path in primitive collider mode when manual holes are active, so visual/collider boundaries remain matched.
  - simplified primitive floor-box path for no-hole cases; wall primitives unchanged.
- UI label update:
  - `client/src/game/HelloMarble.tsx`: test-piece label changed to `Decagon + Circle Holes` for clarity in the tuning panel.
- Verification:
  - `npm run -w client typecheck` passed.
  - Playwright screenshot confirms both holes render side-by-side without overlap: `output/web-game/shot-0.png`.
- Notes:
  - Manual in-browser feel pass is recommended to compare how marble interaction differs between decagon vs circle edges during real rolling input.
- Version discipline:
  - Local iteration continuation on same issue/theme; version bump intentionally deferred.

v0.8.7.2 local iteration follow-up (hole shape/seam correction attempt):
- Investigated user report: side-by-side holes looked oblong and appeared wall-connected via seam lines.
- Applied targeted floor-hole rendering/collision adjustments in `client/src/game/track/createTrack.ts`:
  - removed manual hole longitudinal shrink (`TEST_TRACK_HOLE_EDGE_BLEND_RENDER/COLLIDER` set to `0`) so hole footprint is not artificially squashed.
  - extended `buildSweptRectGeometry(...)` with `capEnds` option and disabled end caps for hole-slice floor generation to avoid cap-induced connector artifacts.
  - added a dedicated manual-hole patch path (`buildFloorHolePatchGeometries`) that builds a rectangular extruded floor patch with explicit decagon/circle shape holes, plus outside swept floor coverage.
  - added robust fallback behavior when merged floor geometry is unavailable:
    - render from individual floor slices,
    - collider adds each floor slice trimesh when merged trimesh is not available.
- Important fix during iteration:
  - temporary full-floor disappearance was caused by merged floor geometry incompatibility; fallback render/collider path restored visible floor immediately.
- Verification:
  - `npm run -w client typecheck` passed.
  - Playwright screenshot after entering Test Track (`output/web-game/shot-0.png`) confirms floor is present and both holes render in the expected side-by-side location.
- Notes:
  - This is still local-iteration tuning; manual in-browser feel/visual pass is recommended for final acceptance of hole silhouette quality at gameplay camera distance.
- Version discipline:
  - Local iteration continuation on same issue/theme; version bump intentionally deferred.

v0.8.7.2 local iteration follow-up (explicit hole-patch geometry + fallback stability):
- Reworked manual hole floor generation to avoid interval-slice artifacts:
  - Added `buildFloorHolePatchGeometries(...)` that builds a dedicated rectangular floor patch with explicit shape holes (left decagon + right circle) using `THREE.Shape` + `ExtrudeGeometry`.
  - Outside the patch window, floor is still generated by the swept floor path with no end-caps in the excluded patch zone.
- Added `buildSweptRectGeometry(..., { capEnds })` option and used cap suppression in hole-related floor paths to avoid cap-driven connector slits.
- Set hole edge blend to `0` for both render/collider hole sampling constants to prevent shape shrink/squash bias.
- Added robust render/collider fallback when merged floor geometry is unavailable:
  - render from individual floor slices when merge fails,
  - collider adds per-slice trimesh shapes if merged trimesh is missing.
- Verification:
  - `npm run -w client typecheck` passed.
  - Test-track screenshot generated (`output/web-game/shot-0.png`) with floor restored and side-by-side holes rendered.
- Version discipline:
  - Local iteration continuation on same issue/theme; version bump intentionally deferred.

v0.8.7.2 local iteration follow-up (remove hole seam connectors with single floor patch):
- Reworked manual-hole floor generation in `client/src/game/track/createTrack.ts` to eliminate seam lines that visually looked like hole-to-wall connectors:
  - Replaced the split `outside floor + local hole patch` composition with one continuous extruded floor patch whenever manual floor holes are active.
  - The patch now spans projected track bounds (from sweep samples) and embeds both hole cutouts directly, so there is no cross-track seam near the holes.
  - Patch basis now derives primarily from averaged manual-hole `tangent/right` vectors to keep cutout orientation aligned with the authored set-piece frame.
  - Increased patch curve resolution (`curveSegments: 32`) for smoother circle silhouette while keeping the decagon explicit.
- Collision alignment impact:
  - Primitive-mode exact floor collider path continues to use the same hole floor geometry, so visual/collider cutouts stay aligned.
- Verification (Local Iteration, develop-web-game loop):
  - `npm run -w client typecheck` passed.
  - Captured fresh Test Track screenshot after entering game: `output/web-game/shot-0.png`.
  - No fresh `errors-0.json` generated in this run (no new captured console errors in the scripted pass).
- Version discipline:
  - Version bump intentionally deferred (same local-iteration issue/theme).

v0.8.8.0 local iteration milestone (stacked Test Track drop lane):
- Implemented a two-level Test Track progression in `client/src/game/track/createTrack.ts` for the `straight-center-hole-respawn` manual set piece:
  - Replaced side-by-side decagon/circle manual floor holes with a single centered circular hole (same 2x marble diameter target sizing).
  - Added a dedicated second lower lane generated beneath the hole on the same board kinematic bodies (floor on `boardBody`, walls on `boardWallBody`) so both levels tilt in perfect sync.
  - Added top-lane forward blocker wall after the hole so progression is forced through the drop.
  - Added lower-lane side rails and a lower-lane entry cap wall so the dropped lane is bounded and playable.
  - Extended computed track bounds/lowest-floor handling to include lower-level geometry, which moves `respawnY` below the second level so falling through the top hole no longer triggers immediate reset.
  - Shifted finish marker/gate vertically to align with lower-level completion flow when stacked-drop mode is active.
- Added `addOrientedPart(...)` helper for robust basis-aligned box visuals + collider shapes (reused for stacked-lane and blocker additions).
- Updated Test Track presentation in `client/src/game/HelloMarble.tsx`:
  - Test sequence now starts directly on the drop set piece (`straight-center-hole-respawn`, then `finish`) for focused stacked-lane testing.
  - Tuning drawer label updated to `Two-Level Circular Drop`.
- Version discipline (required for this significant local scope jump):
  - Bumped app version to `0.8.8.0` in:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion`, `appVersionCode=80800`)
    - `android/app/build.gradle` (`versionName`, `versionCode=80800`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
  - Playwright Test Track screenshot refreshed (`output/web-game/shot-0.png`), showing new top circular hole + blocker and updated label/version.
  - No fresh `errors-0.json` produced during automated screenshot runs.
- Notes:
  - Automated headless input in this environment did not conclusively demonstrate live drop-to-lower-lane traversal; manual in-browser roll-through is still needed to confirm final feel and finish crossing behavior end-to-end.

v0.8.9.0 local iteration milestone (deeper level-2 drop + broadcast-only camera):
- Raised stacked Test Track lower-lane separation in `client/src/game/track/createTrack.ts`:
  - `TEST_TRACK_SECOND_LEVEL_DROP_Y` increased from `4.2` to `14` so the second track sits much farther below the top deck.
- Locked camera model to broadcast-only across runtime/types/constants:
  - `client/src/game/gameTypes.ts`: `CameraPresetId` narrowed to only `"broadcast"`.
  - `client/src/game/gameConstants.ts`: `CAMERA_PRESETS` reduced to `["broadcast"]`.
  - `client/src/game/gameUtils.ts`: simplified `getCameraLabel(...)` to broadcast-only behavior.
- Updated runtime camera motion in `client/src/game/HelloMarble.tsx`:
  - Removed multi-preset camera switch logic and kept only broadcast framing path.
  - Broadcast camera now follows marble Y (`camera.position.y` and look target Y are marble-relative), so lower-lane play remains visible after the deeper drop.
- Removed camera preset switching UI while keeping camera tuning controls:
  - Removed options submenu preset dropdown.
  - Removed debug camera-tab preset dropdown.
  - Removed mobile in-race camera-cycle button.
  - Kept zoom/FOV/height sliders and camera reset behavior.
- Version discipline update (significant local scope jump):
  - Bumped app version to `0.8.9.0` and synchronized Android wrapper versions:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.9.0`, `appVersionCode=80900`)
    - `android/app/build.gradle` (`versionName=0.8.9.0`, `versionCode=80900`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
  - Refreshed Test Track screenshot: `output/web-game/shot-0.png` (shows Version `0.8.9.0` and visibly deeper lower lane).
  - No fresh `output/web-game/errors-0.json` generated in screenshot run.
- Notes:
  - Automated headless screenshot flow confirms build/UI/geometry wiring; a manual play pass is still recommended to validate that level-1 is fully out-of-frame during lower-lane rolling in your preferred broadcast tuning.

v0.8.9.0 local iteration follow-up (verification refresh for deeper level-2 separation):
- Revalidated the current `Two-Level Circular Drop` state after implementing deeper level separation and broadcast-only camera behavior.
- Verification refresh (Local Iteration):
  - `npm run -w client typecheck` passed.
  - Ran `develop-web-game` Playwright client against local Vite dev server and captured updated screenshot artifact `output/web-game/shot-0.png` (Version `0.8.9.0`, deeper lower lane visible beneath top deck).
- Additional test note:
  - Attempted a longer automated input burst to capture post-drop framing; this environment’s headless timing made long frame bursts unreliable, so that run was aborted after timeout and did not produce a usable screenshot.
  - Manual in-browser roll-through remains recommended to confirm preferred camera framing while actively traveling on the lower lane.
- Version discipline:
  - No further version bump in this follow-up; retained `0.8.9.0`.

v0.8.9.0 local iteration follow-up (deeper level-2 drop + level-aware tilt pivot stability):
- Increased stacked Test Track lower-lane separation another 50% in `client/src/game/track/createTrack.ts`:
  - `TEST_TRACK_SECOND_LEVEL_DROP_Y` changed from `14` to `21`.
- Added track-provided tilt pivot layer metadata for the two-level drop setup:
  - Extended `TrackBuildResult` with optional `tiltPivotLayersLocalY` (`upperY`, `lowerY`, `switchDownY`, `switchUpY`).
  - Populated this metadata in the `straight-center-hole-respawn` stacked-drop branch.
  - Added hysteresis thresholds derived from drop distance (`switchDown=40%`, `switchUp=28%`) to prevent layer-chatter near transitions.
- Updated runtime tilt controller in `client/src/game/HelloMarble.tsx` with minimal churn:
  - Added `activeTiltPivotLayer` runtime state (`upper`/`lower`).
  - Added local-Y hysteresis layer switching each control update (auto detection, threshold switching).
  - Replaced fixed pivot Y (`0`) with layer-aware pivot Y from `track.tiltPivotLayersLocalY`.
  - Reset layer to `upper` on respawn and re-seeded `pivotSmoothed` to the top-layer pivot to avoid post-respawn pivot carry-over.
- Goal of fix:
  - Preserve existing tilt feel while preventing violent flick/throw behavior when marble is on lower lane.
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Version discipline:
  - Version bump intentionally deferred; retained `0.8.9.0` as same local-iteration issue/theme follow-up.

v0.8.10.0 full publish milestone (temporary Flat Plane mode):
- Added a new temporary main-menu mode in `client/src/game/HelloMarble.tsx`:
  - Added `Flat Plane` button to the main menu grid.
  - Wired mode selection through existing `switchGameMode(...)` flow using `switchGameMode("flatPlane")`.
  - Reused the existing solo countdown/start sequence for minimal churn and consistent control-lock behavior.
- Extended mode/layout typing for the new test mode:
  - `client/src/game/gameTypes.ts`: `GameMode` now includes `"flatPlane"`.
  - `client/src/game/HelloMarble.tsx`: `TrackLayoutPreset` now includes `"flatPlane"`.
- Added dedicated flat-plane track preset routing:
  - `client/src/game/HelloMarble.tsx`: `createTrackOptionsFromConfig(...)` now returns `{ preset: "flatPlane" }` when layout preset is flat-plane.
  - `client/src/game/track/createTrack.ts`: `CreateTrackOptions` now accepts `preset?: "default" | "flatPlane"`.
- Implemented massive empty flat test surface in `client/src/game/track/createTrack.ts`:
  - Added `createFlatPlaneTrack()` and routed `createTrack(...)` to it when `opts.preset === "flatPlane"`.
  - Surface size set to `6000 x 6000` world units.
  - No obstacles, no walls, no rail clamping (containment samples mark `railLeft=false` / `railRight=false`).
  - Spawn moved near the back edge to maximize forward straight-line run distance.
  - Off-course bounds expanded to plane extents so respawn only occurs after leaving the giant surface.
- Solo-like runtime behavior updated for the new mode in `client/src/game/HelloMarble.tsx`:
  - Included `flatPlane` in freeze/unfreeze solo guards and countdown GO unfreeze logic.
  - Included `flatPlane` in solo-result eligibility logic.
  - Included `flatPlane` in debug drawer visibility gating where solo/test track already participate.
- Version discipline (required for Full Publish mode):
  - Bumped to `0.8.10.0` in:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.10.0`, `appVersionCode=81000`)
    - `android/app/build.gradle` (`versionName=0.8.10.0`, `versionCode=81000`)
- Verification (Full Publish mode):
  - `npm run lint` passed.
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - Playwright smoke (develop-web-game client) on local Vite dev server passed:
    - Menu screenshot confirms new `Flat Plane` button: `output/web-game-flat-menu/shot-0.png`.
    - In-mode screenshot confirms giant obstacle-free plane load: `output/web-game-flat-plane/shot-0.png`.
    - No `errors-*.json` generated in either smoke output folder.

v0.8.10.0 full publish follow-up (commit remaining workspace changes):
- Captured and committed remaining workspace deltas that were left uncommitted after the Flat Plane milestone.
- Included camera preset cleanup files:
  - `client/src/game/gameConstants.ts` (camera preset list now broadcast-only)
  - `client/src/game/gameUtils.ts` (camera label resolver simplified for broadcast-only)
- Included latest smoke screenshot artifacts for reproducibility/debug review:
  - `output/web-game-flat-menu/shot-0.png`
  - `output/web-game-flat-plane/shot-0.png`
  - `output/web-game/shot-0.png`
  - `output/web-game/shot-fall-check.png`
  - `output/web-game/shot-fall-check-2.png`
- Verification context:
  - No additional code changes beyond those already verified in the previous full publish run (`lint`, `typecheck`, `build` were already green on this working tree state).

v0.8.11.0 local iteration milestone (track quarantine + temporary 3-straight generation baseline):
- Quarantined legacy/current track definition content into `client/src/game/track/temporary/legacyTrackDefinitions.ts` with an explicit deletion-intent note:
  - Archived prior runtime built-in track piece catalog (straight + arc + arc setpiece entries).
  - Archived prior test-track authored sequence/constants.
  - Archived prior authored static fallback `SEGMENTS` course definitions.
  - File header now explicitly states these are temporary and likely should be deleted after the new generation pipeline lands.
- Added active temporary generation module `client/src/game/track/temporary/temporaryThreeStraightTrack.ts`:
  - New fixed temporary baseline helpers for exactly three straight pieces (`spawn`, `middle`, `finish`).
  - New `TEMPORARY_ACTIVE_TRACK_PIECE_COUNT = 3` and `TEMPORARY_THREE_STRAIGHT_SEGMENTS` exports.
- Rewired active modular catalog in `client/src/game/track/modularTrack.ts`:
  - `BUILTIN_TRACK_PIECES` now sourced from `buildTemporaryThreeStraightForcedPieces()`.
  - Legacy built-in track templates are no longer active in runtime generation.
- Rewired runtime track option builder in `client/src/game/HelloMarble.tsx`:
  - `createTrackOptionsFromConfig(...)` now forces non-flat generation to a temporary fixed 3-straight blueprint.
  - Disabled active use of legacy test-track authored piece sequence for generation.
  - Added explicit inline note indicating temporary quarantine mode behavior.
- Updated `client/src/game/track/createTrack.ts` fallback authored loop:
  - Removed direct use of legacy `SEGMENTS` constant.
  - Replaced with `TEMPORARY_THREE_STRAIGHT_SEGMENTS` from the temporary active module.
- Version discipline (significant local-iteration scope jump into track-generation architecture):
  - Bumped to `0.8.11.0` and synchronized Android wrapper versions in the same change:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.11.0`, `appVersionCode=81100`)
    - `android/app/build.gradle` (`versionName=0.8.11.0`, `versionCode=81100`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Mode/commit context:
  - Local Iteration Mode followed.
  - No commit/push performed.

v0.8.11.0 local iteration follow-up (finish marker width parity):
- Updated finish marker width to match the active track width profile in `client/src/game/track/createTrack.ts`.
  - Blueprint path (`createTrackFromBlueprint`):
    - Added `markerWidth = maxSegmentWidth + 0.8`.
    - Start marker and finish marker now both use `markerWidth`.
    - This removes the previous hardcoded wider finish marker (`FINISH_WIDTH + 1.2`).
  - Legacy fallback path:
    - Finish marker width now matches the start marker width (`TRACK_W + 0.8`) instead of using wider `FINISH_WIDTH + 1.2`.
- Result:
  - The final finish line marker no longer appears wider than the rest of the track in the current temporary 3-straight generation path.
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Version discipline:
  - Version bump intentionally deferred; retained `0.8.11.0` (same local-iteration issue/theme).

v0.8.11.0 local iteration follow-up (undo marker rollback issue + constant active straight width):
- Fully undid the previous finish-marker patch in `client/src/game/track/createTrack.ts`:
  - Removed blueprint `markerWidth` usage that had changed start/finish marker sizing.
  - Restored start marker size to `TRACK_W + 0.8`.
  - Restored finish marker size to `FINISH_WIDTH + 1.2`.
  - This reverts the change that caused the start line to extend past the beginning walls.
- Applied the actual active-path width-consistency fix (blueprint path only):
  - In `buildBlueprintSweepPath(...)`, appended finish sweep samples now use `width: lastPlayable.width` instead of `FINISH_WIDTH`.
  - In `createTrackFromBlueprint(...)`, `containmentLocal.finishHalfX` now uses `computeContainmentHalfX(maxSegmentWidth)` instead of `Math.max(FINISH_WIDTH, maxSegmentWidth)`.
- Result:
  - Active generated track remains constant-width through the final straight/finish extension.
  - Start marker behavior is returned to pre-regression sizing.
- Scope decision applied:
  - Active path only; legacy fallback branch width model remains unchanged.
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Version discipline:
  - Version bump intentionally deferred; retained `0.8.11.0` (same local-iteration issue/theme).

v0.8.12.0 local iteration milestone (global runtime track width doubled to 18 + wall-touch start/finish lines):
- Introduced a new runtime width source of truth in `client/src/game/track/temporary/temporaryThreeStraightTrack.ts`:
  - `GLOBAL_RUNTIME_TRACK_WIDTH = 18`.
- Enforced doubled global runtime width in generation pipeline:
  - `client/src/game/track/modularTrack.ts`:
    - `FALLBACK_TRACK_WIDTH` now uses `GLOBAL_RUNTIME_TRACK_WIDTH` (18).
  - `client/src/game/HelloMarble.tsx`:
    - Runtime blueprint generation now always uses `trackWidth: GLOBAL_RUNTIME_TRACK_WIDTH`.
    - Test-track width clamp min/max are both now `GLOBAL_RUNTIME_TRACK_WIDTH` (18), and default test-track width is 18.
- Enforced doubled global runtime width in track construction:
  - `client/src/game/track/createTrack.ts`:
    - `TRACK_W` now uses `GLOBAL_RUNTIME_TRACK_WIDTH`.
    - `FINISH_WIDTH` now equals `GLOBAL_RUNTIME_TRACK_WIDTH` (removes finish-width divergence).
- Updated start/finish line sizing to touch both walls (inner-wall span) instead of oversizing past wall bounds:
  - Added `computeLineSpanWidth(trackWidth)` using wall interior span formula:
    - `trackWidth - (RAIL_INSET * 2 + RAIL_THICK)`.
  - Blueprint path markers:
    - Start marker width uses first sample width interior span.
    - Finish marker width uses last sample width interior span.
  - Fallback path markers:
    - Start and finish marker widths both use `computeLineSpanWidth(TRACK_W)`.
- Width continuity safeguard retained:
  - Blueprint finish sweep extension continues to inherit `lastPlayable.width`, so end straight does not widen.
- Version discipline (significant local-iteration runtime behavior change):
  - Bumped to `0.8.12.0` and synchronized Android wrapper versions:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.12.0`, `appVersionCode=81200`)
    - `android/app/build.gradle` (`versionName=0.8.12.0`, `versionCode=81200`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Mode/commit context:
  - Local Iteration Mode followed.
  - No commit/push performed.

v0.8.13.0 local iteration milestone (very long middle + gentle 15°/−15° S-bend across non-flat runtime):
- Updated temporary forced runtime pattern in `client/src/game/track/temporary/temporaryThreeStraightTrack.ts` from 3 pieces to 5 pieces:
  - `TEMPORARY_ACTIVE_TRACK_PIECE_COUNT` changed from `3` to `5`.
  - New forced-piece sequence (applies to all non-flat runtime modes through existing wiring):
    1) spawn straight (`length: 12`)
    2) very long middle straight (`length: 700`)
    3) gentle left curve (`kind: straight`, `length: 180`, `turnDeg: 15`, `turnDirection: left`)
    4) matching gentle right curve (`kind: straight`, `length: 180`, `turnDeg: 15`, `turnDirection: right`)
    5) finish straight (`length: 12`)
  - All pieces keep `widthScale: 1`, rails on both sides, no tunnel roof, no extra banking/grade.
- Updated fallback segment pattern in the same file to match new long profile:
  - lengths: `12`, `700`, `180`, `180`, `12`
  - yaw sequence: `0`, `0`, `+15`, `-15`, `0`.
- Kept scope as requested for active non-flat runtime flow:
  - Existing `HelloMarble` non-flat forced-piece generation path remains in place and now consumes the new 5-piece pattern.
  - Updated inline comment in `client/src/game/HelloMarble.tsx` to reflect fixed forced-layout behavior (no longer “3 straight pieces”).
- Version discipline (significant local-iteration behavior change):
  - Bumped to `0.8.13.0` and synchronized Android wrapper versions:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.13.0`, `appVersionCode=81300`)
    - `android/app/build.gradle` (`versionName=0.8.13.0`, `versionCode=81300`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Mode/commit context:
  - Local Iteration Mode followed.
  - No commit/push performed.

v0.8.14.0 local iteration milestone (full-track render + late fade + dual width architecture reset):
- Implemented full-track visibility past prior hard cutoff in `client/src/game/HelloMarble.tsx`:
  - Increased gameplay camera far plane from `240` to `2200` via `CAMERA_FAR_PLANE`.
- Replaced hard-cut perception with late/subtle distance fade on gameplay geometry:
  - Added scene fog with background-matching color:
    - `DISTANCE_FADE_START = 350`
    - `DISTANCE_FADE_END = 1200`
  - Applied at scene creation so distant track, obstacles, and marbles/ghosts fade together visually.
- Reset default runtime track width back to original narrow width and introduced explicit dual-width architecture:
  - `client/src/game/track/temporary/temporaryThreeStraightTrack.ts`:
    - Added `DEFAULT_RUNTIME_TRACK_WIDTH = 9` (active runtime default)
    - Added `SETPIECE_WIDE_TRACK_WIDTH = 18` (reserved for future obstacle/set-piece sections)
- Rewired runtime width usage to narrow default:
  - `client/src/game/track/modularTrack.ts`:
    - `FALLBACK_TRACK_WIDTH` now uses `DEFAULT_RUNTIME_TRACK_WIDTH`.
  - `client/src/game/HelloMarble.tsx`:
    - Runtime blueprint generation now uses `trackWidth: DEFAULT_RUNTIME_TRACK_WIDTH`.
    - Test-track width min/max/default now pinned to `DEFAULT_RUNTIME_TRACK_WIDTH`.
  - `client/src/game/track/createTrack.ts`:
    - `TRACK_W` and `FINISH_WIDTH` now use `DEFAULT_RUNTIME_TRACK_WIDTH`.
- Marker/wall alignment behavior preserved after width rollback:
  - Existing wall-touch marker span logic (`computeLineSpanWidth`) remains active for both start and finish lines.
- Existing long middle + gentle S-bend pattern retained (only width architecture changed in this milestone).
- Version discipline (significant local-iteration rendering + width architecture update):
  - Bumped to `0.8.14.0` and synchronized Android wrapper versions:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.14.0`, `appVersionCode=81400`)
    - `android/app/build.gradle` (`versionName=0.8.14.0`, `versionCode=81400`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Mode/commit context:
  - Local Iteration Mode followed.
  - No commit/push performed.

v0.8.15.0 local iteration milestone (sharper S-bend retune for more careful driving):
- Retuned temporary forced runtime pattern in `client/src/game/track/temporary/temporaryThreeStraightTrack.ts` to increase driving precision requirements while preserving the same 5-piece flow.
- Updated piece tuning values:
  - Long setup straight reduced:
    - `temporary-middle-straight-long` length: `700 -> 350`
  - Opposite turn pair sharpened and tightened:
    - Left curve piece:
      - id: `temporary-curve-left-15 -> temporary-curve-left-35`
      - label: `Temporary Curve Left 35`
      - length: `180 -> 90`
      - turnDeg: `15 -> 35`
    - Right curve piece:
      - id: `temporary-curve-right-15 -> temporary-curve-right-35`
      - label: `Temporary Curve Right 35`
      - length: `180 -> 90`
      - turnDeg: `15 -> 35`
  - Exit/finish straight left unchanged at length `12`.
- Updated fallback segment mirror pattern in same file to match runtime retune:
  - lengths: `12, 350, 90, 90, 12`
  - yaw profile: `0, 0, +35, -35, 0`
- Behavioral intent/result:
  - Curves now require more active steering and line control.
  - Opposite-turn pairing still restores near-straight heading after the second bend.
- Version discipline (significant runtime behavior retune):
  - Bumped to `0.8.15.0` and synchronized Android wrapper versions:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.15.0`, `appVersionCode=81500`)
    - `android/app/build.gradle` (`versionName=0.8.15.0`, `versionCode=81500`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Mode/commit context:
  - Local Iteration Mode followed.
  - No commit/push performed.

v0.8.16.0 local iteration milestone (compressed S-curve retune to 25° over 50):
- Retuned the temporary opposite-curve pair in `client/src/game/track/temporary/temporaryThreeStraightTrack.ts` to a compressed, sharper-feel profile while lowering absolute angle:
  - Left curve:
    - id: `temporary-curve-left-35 -> temporary-curve-left-25`
    - label: `Temporary Curve Left 25`
    - length: `90 -> 50`
    - turnDeg: `35 -> 25`
  - Right curve:
    - id: `temporary-curve-right-35 -> temporary-curve-right-25`
    - label: `Temporary Curve Right 25`
    - length: `90 -> 50`
    - turnDeg: `35 -> 25`
- Preserved rest of active 5-piece pattern:
  - spawn `12`
  - setup straight `350`
  - finish straight `12`
- Updated fallback segment mirror profile in same file:
  - curve segments changed from `90 @ ±35` to `50 @ ±25`.
- Expected handling impact:
  - Less highway-smooth arc shape due to compression, while avoiding over-harshness from high turn angle.
  - Still restores heading quickly via opposite-turn pairing.
- Version discipline (significant runtime behavior retune):
  - Bumped to `0.8.16.0` and synchronized Android wrapper versions:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.16.0`, `appVersionCode=81600`)
    - `android/app/build.gradle` (`versionName=0.8.16.0`, `versionCode=81600`)
- Verification (Local Iteration):
  - `npm run -w client typecheck` passed.
- Mode/commit context:
  - Local Iteration Mode followed.
  - No commit/push performed.

v0.8.16.0 full publish task (commit + push pending workspace changes):
- Prepared a publish-ready commit for all current tracked and untracked workspace changes, including:
  - temporary modular track tuning files
  - track generation wiring updates
  - HelloMarble runtime integration updates
  - versioned Android wrapper sync files
  - local notes/temporary artifacts currently present in workspace
- Verification (Full Publish Test Mode):
  - `npm run lint` passed.
  - `npm run typecheck` passed.
  - `npm run build` passed.
- Version discipline:
  - No additional bump applied in this task.
  - Existing synchronized version `0.8.16.0` retained across:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json`
    - `android/app/build.gradle`
- Commit/push context:
  - Commit and push executed in this task.

v0.8.17.0 full publish milestone (singleplayer-first track workflow + debug tuning expansion):
- Removed active Test Track mode entry and runtime wiring in `client/src/game/HelloMarble.tsx`:
  - Removed `Test Track` button from the main menu.
  - Removed `testTrack` mode handling from game mode switching and race gating checks.
  - Removed test-track-specific debug state, storage, and tuning handlers from active UI/runtime paths.
  - Debug drawer now appears for enabled debug mode in solo/flat-plane/network contexts without a forced test-track override.
- Preserved test-track/two-layer generation code for later reuse:
  - Left legacy hole/drop track generation logic intact in `client/src/game/track/createTrack.ts`.
  - Added explicit archive intent comment near test-track constants to clarify active vs parked paths.
- Expanded tuning model and sanitization for higher-value local iteration:
  - `maxSpeed` sanitize clamp increased from `20` to `60` in `client/src/game/gameUtils.ts`.
  - Added directional light offset tuning fields to `TuningState` in `client/src/game/gameTypes.ts`:
    - `shadowLightOffsetX`
    - `shadowLightOffsetY`
    - `shadowLightOffsetZ`
  - Added default values in `client/src/game/gameConstants.ts`:
    - `shadowLightOffsetX: 10`
    - `shadowLightOffsetY: 14`
    - `shadowLightOffsetZ: 8`
  - Added sanitize bounds in `client/src/game/gameUtils.ts`:
    - X/Z: `[-30, 30]`
    - Y: `[2, 40]`
- Upgraded scalar control UX for fine tuning past slider limits:
  - `client/src/ui/DebugScalarControl.tsx` now supports optional numeric override input with independent clamp bounds.
  - `Max Speed` control remains slider-capped for quick scrub (`4..20`) while numeric entry allows up to `60`.
- Added directional light placement controls in debug tuning UI:
  - `Light Offset X/Y/Z` sliders added in `client/src/game/HelloMarble.tsx`.
  - Dynamic shadow framing now reads live tuning offsets each frame instead of fixed static offset.
- Version discipline (Full Publish, behavior/UI changes):
  - Bumped to `0.8.17.0` and synchronized Android wrapper versions in the same change:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.8.17.0`, `appVersionCode=81700`)
    - `android/app/build.gradle` (`versionName=0.8.17.0`, `versionCode=81700`)
- Verification (Full Publish Test Mode):
  - `npm run lint` passed.
  - `npm run typecheck` passed.
  - `npm run build` passed.
- Commit/push context:
  - Commit and push executed in this task.

v0.9.0.0 update:
- Implemented Phase A (banking) and Phase B (moving obstacles) from Track Mechanics Brainstorm plan.
- Phase A — Banking (createTrack.ts):
  - Added `bankDeg: number` field to `BlueprintSweepSample` type; populated from `placement.bankDeg` in `buildBlueprintSweepSamples`.
  - Added Rodrigues-style bank rotation in `buildBlueprintSweepFrames`: after Frenet right/up computation, rotate both vectors around tangent by `bankDeg` degrees.
  - Grade (`gradeDeg`) was already functional via `tracePiecePoints` in `modularTrack.ts` — no change needed.
- Phase B — New obstacle types (createTrack.ts):
  - Added `ObstacleMotionKind = "sweepX" | "sweepY" | "spin"` type.
  - Extended `ObstacleActor` with `motionKind`, `minY`, `maxY`, `trackUp` fields.
  - Added module-level `stepObstacleActors` helper to drive all three motion kinds and sync to world space.
  - Added `addBlueprintMovingObstacleSet` function placing vertical gates (sweepY), spinning bars (spin), and pinch gates (sweepX pair) on eligible blueprint straight pieces via seeded random selection.
  - Wired into `createTrackFromBlueprint`: actor arrays created, obstacles built when `enableMovingObstacles: true`, real `updateMovingObstacles`/`setMovingObstacleMaterial` closures returned, `movingObstacleBodies` populated.
  - Removed unused legacy-path `addVerticalGate`, `addSpinningBar`, `addPinchGate` functions.
  - Enabled `enableMovingObstacles: true` in `createTrackOptionsFromConfig` in `HelloMarble.tsx`.
- Version discipline (Full Publish, major feature scope jump):
  - Bumped to `0.9.0.0` and synchronized Android wrapper versions:
    - `client/src/buildInfo.ts`
    - `android/twa-manifest.json` (`appVersion=0.9.0.0`, `appVersionCode=90000`)
    - `android/app/build.gradle` (`versionName=0.9.0.0`, `versionCode=90000`)
- Verification (Full Publish Test Mode):
  - `npm run lint` passed.
  - `npm run typecheck` passed.
  - `npm run build` passed.
- Commit/push context:
  - Commit and push executed in this task.
