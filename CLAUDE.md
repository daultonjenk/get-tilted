# CLAUDE.md — Get Tilted (Claude Code Instructions)

This file governs how Claude Code should execute work on **Get Tilted**.
See `AGENTS.md` for the full project playbook (stack rules, transport rules, repo structure, etc.).
The rules here are Claude Code-specific and supplement — not replace — `AGENTS.md`.

---

## Build version discipline (required on every change)

After **every** implemented change that affects behavior, UI, config, assets, networking, physics, or build output:

1. **Bump `APP_VERSION`** in `client/src/buildInfo.ts` (the single source of truth for the displayed build version).
2. **Use the correct version segment** based on scope:
   - `major_release.major_feature.minor_feature.bugfix`
   - Increment only the rightmost segment that matches the scope of the change.
   - No version string may be reused across commits.
3. **Keep Android wrapper files in sync** whenever `APP_VERSION` changes:
   - `android/twa-manifest.json` → `appVersion` and `appVersionCode`
   - `android/app/build.gradle` → `versionName` and `versionCode`
4. **Commit message format** (required):
   - `type(v#.#.#.#): short description`
   - Example: `fix(v0.8.3.6): fix marble sticking to floor/walls from zero-velocity board`
   - The version token in the commit message must exactly match `APP_VERSION` in `client/src/buildInfo.ts` for that commit.
5. **Commit and push** all changes to the active remote branch in the same session (unless the user explicitly says not to push).

---

## After completing any implementation task

- Bump the version (see above).
- Stage only the relevant files (do not use `git add -A`).
- Commit with the `type(vX.X.X.X): description` format.
- Push to `origin master` (or the active branch).
- Briefly confirm the version bump and push in your response.
