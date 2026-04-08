# AGENTS.md — Get Tilted Project Guide

This file is a lightweight project guide for humans and coding agents working in this repository.
It is intentionally simple. Use normal engineering judgment, normal branching workflows, and normal
code review habits.

## Project Summary

Get Tilted is a mobile-first marble racing game.

Core stack:
- Client: Vite + React + TypeScript + Three.js + cannon-es
- Local multiplayer backend: Node + raw WebSockets
- Production backend: Cloudflare Workers + Durable Objects
- Shared protocol: `shared/src/protocol.ts`

## Important Technical Constraints

Keep these unless there is an explicit decision to change them:

1. Use raw WebSockets for multiplayer.
   - Do not introduce Socket.IO.
   - Keep the shared protocol module as the source of truth for wire messages.

2. Preserve the current production direction.
   - Static client on Cloudflare Pages.
   - Realtime room handling on Cloudflare Workers Durable Objects.
   - Avoid Durable Object patterns that prevent hibernation unless there is a strong reason.

3. Keep networking separated from gameplay systems.
   - Game and physics code should not create sockets directly.
   - Route networking through `client/src/net/wsClient.ts` and related client networking modules.

4. Treat multiplayer as arcade sync, not deterministic rollback.
   - Favor stability, interpolation, and simplicity over perfect simulation matching.

5. Keep mobile as a first-class target.
   - iOS motion permission must be requested from a user gesture.
   - Always provide fallback controls for devices without tilt support.

6. Any procedural or randomized track behavior must stay deterministic.
   - The same seed should produce the same result across clients.
   - Shared multiplayer-relevant randomness should come from an agreed seed.

## Repository Layout

```text
get-tilted/
  client/
  server/
  shared/
  worker/
  android/
  README.md
  SPEC.md
  AGENTS.md
  package.json
```

Important files:
- `client/src/game/HelloMarble.tsx`: current main gameplay shell
- `client/src/game/track/createTrack.ts`: track construction/runtime geometry
- `client/src/net/wsClient.ts`: browser WebSocket wrapper
- `client/src/net/raceClient.ts`: higher-level multiplayer client logic
- `server/src/ws/wsRouter.ts`: local dev WebSocket routing
- `worker/src/roomDO.ts`: Durable Object room implementation
- `shared/src/protocol.ts`: shared message types and validation

## Development Workflow

Use a standard Git workflow:

1. Create a branch for meaningful work.
2. Make focused changes.
3. Run the relevant checks before opening or merging a PR.
4. Prefer PRs over pushing directly to `main`.

Recommended branch naming examples:
- `fix/tilt-permission-flow`
- `feat/playwright-smoke-tests`
- `refactor/split-hello-marble-state`

## Verification Expectations

Choose checks based on the scope of the change.

Common repo checks:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`

For gameplay, networking, and UI work, also do at least one manual smoke pass when practical:
- desktop browser
- mobile browser when the change affects controls, layout, or motion features

For multiplayer changes, try to validate both:
- local Node WebSocket flow
- Worker/Durable Object path when relevant

## Versioning

The visible app/build version matters for testing because it helps distinguish real changes from a
cached client build.

For any commit that changes the project in a meaningful way, bump the app version by at least a
small increment.

The main version lives in:
- `client/src/buildInfo.ts`

Keep these version fields in sync whenever the app version changes:
- `android/twa-manifest.json`
- `android/app/build.gradle`

In practice, the following files should agree:
- `client/src/buildInfo.ts` → `APP_VERSION`
- `android/twa-manifest.json` → `appVersion` and `appVersionCode`
- `android/app/build.gradle` → `versionName` and `versionCode`

For throwaway local experiments that will never become a commit, a version bump is optional.

## Android Release Note

A new Android `.aab` is typically needed when changes affect the Android wrapper itself, including:
- files under `android/`
- TWA manifest/version metadata
- Android resources, permissions, icons, splash, or manifest behavior

Pure web gameplay and backend changes usually do not require a new Android bundle by themselves.

## Practical Guidance For Agents

- Prefer small, readable changes over broad rewrites unless a larger refactor is clearly justified.
- Preserve existing architecture where possible, but do not keep brittle process rules just because
  they existed before.
- If documentation and code disagree, trust the code first and update the docs.
- If a workflow instruction in this repo feels overly ceremonial, default back to standard software
  engineering practice.
