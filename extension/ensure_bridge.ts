import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { ipcBaseUrl, loadBridgeConfig } from "../shared/config.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let configCwd: string | undefined;

/** Pin project cwd for config resolution while a Pi session is active. */
export function setBridgeConfigCwd(cwd: string | undefined): void {
  configCwd = cwd;
}

function configOptions() {
  return { cwd: configCwd };
}

export function getBridgeConfig() {
  return loadBridgeConfig(configOptions());
}

function resolveBridgeBin(): string {
  const built = join(packageRoot, "dist", "bridge", "main.js");
  if (existsSync(built)) return built;
  return join(packageRoot, "bridge", "main.ts");
}

export async function isBridgeRunning(): Promise<boolean> {
  const config = getBridgeConfig();
  try {
    const response = await fetch(`${ipcBaseUrl(config.ipcPort)}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureBridge(): Promise<boolean> {
  if (await isBridgeRunning()) return true;

  const config = getBridgeConfig();
  if (!config.autoStartBridge) return false;

  const bin = resolveBridgeBin();
  const isTs = bin.endsWith(".ts");
  const args = isTs
    ? ["--experimental-strip-types", bin, "start"]
    : [bin, "start"];

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await isBridgeRunning()) return true;
  }
  return false;
}

export function getIpcBaseUrl(): string {
  return ipcBaseUrl(getBridgeConfig().ipcPort);
}
