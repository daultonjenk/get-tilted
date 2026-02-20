import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PACKAGE_ID = "dev.gettilted.app";
const PLACEHOLDER_FINGERPRINT = "REPLACE_WITH_SHA256_CERT_FINGERPRINT";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "client", "public", ".well-known", "assetlinks.json");

function printUsage() {
  console.error(
    [
      "Usage:",
      "  ANDROID_SHA256_CERT_FINGERPRINT=<fingerprint> npm run android:assetlinks",
      "  ANDROID_PACKAGE_ID=<package-id> ANDROID_SHA256_CERT_FINGERPRINT=<fingerprint> npm run android:assetlinks",
      "",
      "Fingerprint format must be colon-delimited SHA-256 hex pairs.",
      "Example: AA:BB:CC:... (32 pairs total)",
    ].join("\n"),
  );
}

function normalizeFingerprint(value) {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  const valid = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
  if (!valid.test(compact)) return null;
  return compact;
}

async function main() {
  const packageId = process.env.ANDROID_PACKAGE_ID?.trim() || DEFAULT_PACKAGE_ID;
  const rawFingerprint = process.env.ANDROID_SHA256_CERT_FINGERPRINT?.trim() || PLACEHOLDER_FINGERPRINT;

  let fingerprint = rawFingerprint;
  if (rawFingerprint !== PLACEHOLDER_FINGERPRINT) {
    const normalized = normalizeFingerprint(rawFingerprint);
    if (!normalized) {
      console.error("Invalid fingerprint format.");
      printUsage();
      process.exit(1);
    }
    fingerprint = normalized;
  }

  const payload = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageId,
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ];

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  if (fingerprint === PLACEHOLDER_FINGERPRINT) {
    console.warn(
      `Wrote placeholder asset links at ${outputPath}. Re-run with ANDROID_SHA256_CERT_FINGERPRINT before publishing.`,
    );
    return;
  }

  console.info(`Wrote ${outputPath} for ${packageId}.`);
}

main().catch((error) => {
  console.error("Failed to generate assetlinks.json", error);
  process.exit(1);
});
