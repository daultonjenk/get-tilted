# CLAUDE.md — Get Tilted (Claude Code Instructions)

This file governs how Claude Code should execute work on **Get Tilted**.
See `AGENTS.md` for the full project playbook (stack rules, transport rules, repo structure, etc.).
The rules here are Claude Code-specific and supplement — not replace — `AGENTS.md`.

---

## Execution modes (required)

Claude Code must follow one of these two modes for each task:

### A) Full Publish Test Mode (default)
- Standard workflow (unchanged from prior process).
- Run:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- Perform normal quality checks/smoke testing.
- Commit and push in the same session (unless user explicitly says not to push).

### B) Local Iteration Mode
- Optimize for rapid local testing and quick iteration.
- Skip full verification by default:
  - do not run `npm run lint`
  - do not run `npm run typecheck`
  - do not run `npm run build`
- Skip manual smoke/runtime checks by default.
- Minimize non-essential checks and process overhead.
- Do not commit or push unless user explicitly requests it.
- Always update `progress.md` with detailed notes for each task.

Mode selection:
- If user explicitly names a mode, follow it.
- If user asks for no commit/push or quick local iteration, use Local Iteration Mode.
- Otherwise use Full Publish Test Mode.

---

## Build version discipline (mode-aware, required)

After every implemented change, update `progress.md` with detailed notes.  
Version handling is mode-dependent:

1. **`APP_VERSION` update policy**
   - Full Publish Test Mode: bump `APP_VERSION` for implemented changes affecting behavior/UI/config/assets/networking/physics/build output.
   - Local Iteration Mode: skip version bump for quick follow-up polish on the same issue/theme.
   - Local Iteration Mode: bump version when work makes a significant scope jump into a different feature area (for example tilt/physics, then graphics, then GUI) or otherwise constitutes a significant change.
2. **Use the correct version segment** when bumping:
   - `major_release.major_feature.minor_feature.bugfix`
   - Increment only the rightmost segment that matches the scope of the change.
   - No version string may be reused across publish commits.
3. **Android wrapper sync policy**
   - In both modes, keep Android wrapper files in sync whenever `APP_VERSION` changes:
     - `android/twa-manifest.json` → `appVersion` and `appVersionCode`
     - `android/app/build.gradle` → `versionName` and `versionCode`
   - There must never be multiple active working version numbers across these files.
4. **Commit message format** (required when committing):
   - `type(v#.#.#.#): short description`
   - Example: `fix(v0.8.3.6): fix marble sticking to floor/walls from zero-velocity board`
   - The version token in the commit message must exactly match `APP_VERSION` in `client/src/buildInfo.ts` for that commit.
5. **Commit/push behavior is mode-dependent**:
   - Full Publish Test Mode: commit and push all changes in the same session (unless user explicitly says otherwise).
   - Local Iteration Mode: do not commit or push unless explicitly requested.

---

## After completing any implementation task

- Update `progress.md` with detailed notes for the completed work.
- Stage only the relevant files (do not use `git add -A`).
- Full Publish Test Mode:
  - Bump version and sync Android version files in the same commit.
  - Commit with the `type(vX.X.X.X): description` format.
  - Push to `origin master` (or the active branch).
  - Briefly confirm the version bump and push in your response.
- Local Iteration Mode:
  - Skip lint/typecheck/build/manual smoke/runtime checks unless explicitly requested.
  - No commit/push unless explicitly requested by the user.
  - Version bump is optional for same-issue polishing; required for significant scope shifts.
