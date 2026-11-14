// Read and update the repo-root .env for setup scripts. Values are written to the file and never
// printed, so secrets don't end up in terminal history or logs.

import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(__dirname, "..", "..", "..");
export const ENV_PATH = join(ROOT, ".env");

/** Load the repo-root .env into process.env (creating it from .env.example if missing). */
export function loadEnv(): void {
  if (!existsSync(ENV_PATH) && existsSync(join(ROOT, ".env.example"))) {
    copyFileSync(join(ROOT, ".env.example"), ENV_PATH);
    chmodSync(ENV_PATH, 0o600);
  }
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {
    // No .env: rely on the environment.
  }
}

/** Set KEY=value in .env (replacing an existing line, empty or not) and in process.env. */
export function setEnv(key: string, value: string): void {
  if (!/^[A-Z0-9_]+$/.test(key) || /[\r\n]/.test(value)) throw new Error(`Bad env entry ${key}`);
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(text) ? text.replace(pattern, line) : `${text}${text.endsWith("\n") || !text ? "" : "\n"}${line}\n`;
  writeFileSync(ENV_PATH, next, { mode: 0o600 });
  process.env[key] = value;
}
