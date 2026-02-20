import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["-y", "@bubblewrap/cli", ...process.argv.slice(2)];

const env = {
  ...process.env,
  npm_config_cache: process.env.npm_config_cache || path.join(rootDir, ".npm-cache"),
};

const child = spawn(command, args, {
  cwd: rootDir,
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("[get-tilted] failed to launch bubblewrap CLI", error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
