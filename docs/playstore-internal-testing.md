# Play Store Internal Testing (TWA)

This checklist is split into:

- `Now` (no Play Console required)
- `Play day` (requires paid Play Console account)

## Now (no Play Console required)

1. Confirm web prerequisites are deployed:
   - `https://get-tilted.pages.dev/manifest.webmanifest`
   - `https://get-tilted.pages.dev/sw.js`
   - `https://get-tilted.pages.dev/offline.html`
2. Create an Android upload keystore locally (do not commit it):

```bash
keytool -genkeypair \
  -v \
  -keystore get-tilted-upload.jks \
  -alias get-tilted-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

3. Extract SHA-256 cert fingerprint:

```bash
keytool -list -v \
  -keystore get-tilted-upload.jks \
  -alias get-tilted-upload
```

4. Generate Digital Asset Links file in repo:

```bash
ANDROID_PACKAGE_ID=dev.gettilted.app \
ANDROID_SHA256_CERT_FINGERPRINT="AA:BB:CC:...:ZZ" \
npm run android:assetlinks
```

5. Deploy Pages and verify:
   - `https://get-tilted.pages.dev/.well-known/assetlinks.json`
6. Install Bubblewrap CLI and scaffold Android wrapper:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://get-tilted.pages.dev/manifest.webmanifest
```

Use these values when prompted:

- App name: `Get Tilted`
- Package ID: `dev.gettilted.app`
- Host: `get-tilted.pages.dev`

7. Build a signed app bundle locally:

```bash
bubblewrap build
```

## Play day (requires Play Console account)

1. Create Play app with package ID `dev.gettilted.app`.
2. Upload the `.aab` from Bubblewrap to `Internal testing`.
3. Add tester emails and publish the internal track.
4. Validate:
   - Install from Play internal link
   - App opens directly into your TWA
   - URL bar is hidden on trusted domain pages

## Update model (important)

- Content/game updates ship via Cloudflare Pages deploys without re-uploading every time.
- Re-upload to Play only when wrapper-level Android metadata changes (package, icons, permissions, signing, etc.).
