import { rmSync } from "node:fs";

for (const file of ["package-lock.json", "yarn.lock"]) {
  rmSync(file, { force: true });
}

const userAgent = process.env.npm_config_user_agent ?? "";
const execPath = process.env.npm_execpath ?? "";
const packageManager = process.env.npm_config_user_agent ?? "";

const looksLikePnpm =
  userAgent.startsWith("pnpm/") ||
  packageManager.includes(" pnpm/") ||
  execPath.toLowerCase().includes("pnpm");

if (!looksLikePnpm) {
  console.error("Use pnpm instead");
  process.exit(1);
}
