import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULTS = {
  appName: "Get Tilted",
  packageId: "dev.gettilted.app",
  host: "get-tilted.pages.dev",
  keyAlias: "get-tilted-upload",
  keyPath: "./keys/get-tilted-upload.jks",
  color: "#031129",
  startUrl: "/",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const buildInfoPath = path.join(rootDir, "client", "src", "buildInfo.ts");
const manifestPath = path.join(rootDir, "android", "twa-manifest.json");

function parseAppVersion(source) {
  const match = source.match(/VITE_APP_VERSION\s*\?\?\s*"(\d+\.\d+\.\d+\.\d+)"/);
  if (!match) {
    throw new Error("Unable to parse APP_VERSION from client/src/buildInfo.ts");
  }
  return match[1];
}

function appVersionToCode(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 99)) {
    throw new Error(`Invalid app version format: ${version}`);
  }
  const [majorRelease, majorFeature, minorFeature, bugfix] = parts;
  return majorRelease * 1_000_000 + majorFeature * 10_000 + minorFeature * 100 + bugfix;
}

function normalizeHost(rawHost) {
  return rawHost.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function maybeFingerprint() {
  const raw = process.env.ANDROID_SHA256_CERT_FINGERPRINT?.trim();
  if (!raw) return [];
  const normalized = raw.toUpperCase().replace(/\s+/g, "");
  const valid = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
  if (!valid.test(normalized)) {
    throw new Error("ANDROID_SHA256_CERT_FINGERPRINT must be a colon-delimited SHA-256 fingerprint.");
  }
  return [{ name: "upload", value: normalized }];
}

async function main() {
  const buildInfoText = await readFile(buildInfoPath, "utf8");
  const appVersion = parseAppVersion(buildInfoText);
  const appVersionCode = appVersionToCode(appVersion);

  const appName = process.env.ANDROID_APP_NAME?.trim() || DEFAULTS.appName;
  const launcherName = (process.env.ANDROID_LAUNCHER_NAME?.trim() || appName).slice(0, 12);
  const packageId = process.env.ANDROID_PACKAGE_ID?.trim() || DEFAULTS.packageId;
  const host = normalizeHost(process.env.ANDROID_TWA_HOST?.trim() || DEFAULTS.host);
  const origin = `https://${host}`;
  const keyAlias = process.env.ANDROID_KEY_ALIAS?.trim() || DEFAULTS.keyAlias;
  const keyPath = process.env.ANDROID_KEYSTORE_PATH?.trim() || DEFAULTS.keyPath;
  const fingerprints = maybeFingerprint();

  const manifest = {
    packageId,
    host,
    name: appName,
    launcherName,
    display: "standalone",
    orientation: "any",
    themeColor: DEFAULTS.color,
    themeColorDark: DEFAULTS.color,
    navigationColor: DEFAULTS.color,
    navigationColorDark: DEFAULTS.color,
    navigationDividerColor: DEFAULTS.color,
    navigationDividerColorDark: DEFAULTS.color,
    backgroundColor: DEFAULTS.color,
    enableNotifications: false,
    enableSiteSettingsShortcut: true,
    startUrl: DEFAULTS.startUrl,
    iconUrl: `${origin}/icons/icon-512.png`,
    maskableIconUrl: `${origin}/icons/icon-maskable-512.png`,
    monochromeIconUrl: `${origin}/icons/icon-512.png`,
    splashScreenFadeOutDuration: 300,
    signingKey: {
      path: keyPath,
      alias: keyAlias,
    },
    appVersionCode,
    appVersion,
    webManifestUrl: `${origin}/manifest.webmanifest`,
    fullScopeUrl: `${origin}/`,
    fallbackType: "customtabs",
    features: {},
    alphaDependencies: {
      enabled: false,
    },
    additionalTrustedOrigins: [],
    fingerprints,
    generatorApp: "bubblewrap-cli",
    minSdkVersion: 21,
    isChromeOSOnly: false,
    isMetaQuest: false,
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.info(`[get-tilted] wrote ${manifestPath}`);
  console.info(`[get-tilted] package=${packageId} host=${host} appVersion=${appVersion} appVersionCode=${appVersionCode}`);
}

main().catch((error) => {
  console.error("[get-tilted] failed to sync TWA manifest", error);
  process.exit(1);
});
