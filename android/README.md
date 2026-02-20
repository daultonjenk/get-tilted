# Android TWA Wrapper Scaffold

This directory contains the Bubblewrap scaffold for Play Store internal/closed testing.

## Files

- `twa-manifest.json`: Source-of-truth config used by Bubblewrap to generate/update the Android wrapper project.
- `keys/`: Local signing keystore location (`.jks` files are ignored by git).

## Commands (repo root)

1. Sync TWA manifest with current app version and defaults:

```bash
npm run android:twa:sync
```

2. Generate/update Android wrapper files in `android/`:

```bash
npm run android:twa:update
```

3. Build signed APK + AAB from wrapper:

```bash
npm run android:twa:build
```

## Required env vars (optional overrides)

- `ANDROID_PACKAGE_ID` (default: `dev.gettilted.app`)
- `ANDROID_TWA_HOST` (default: `get-tilted.pages.dev`)
- `ANDROID_APP_NAME` (default: `Get Tilted`)
- `ANDROID_KEYSTORE_PATH` (default: `./keys/get-tilted-upload.jks`)
- `ANDROID_KEY_ALIAS` (default: `get-tilted-upload`)
- `ANDROID_SHA256_CERT_FINGERPRINT` (optional; adds fingerprint entry to `twa-manifest.json`)

## First-time setup notes

1. Create/upload keystore locally and place it at `android/keys/get-tilted-upload.jks` (or override via env).
2. Run `npm run android:twa:update` once to generate the Android project files.
3. Run `npm run android:twa:build` to produce a signed bundle for Play internal testing.
