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

function resolveBridgeBin(): { bin: string; built: boolean } {
  const built = join(packageRoot, "dist", "bridge", "main.js");
  if (existsSync(built)) return { bin: built, built: true };
  return { bin: join(packageRoot, "bridge", "main.ts"), built: false };
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

  const { bin, built } = resolveBridgeBin();
  if (!built) {
    console.error(
      JSON.stringify({
        level: "ERROR",
        message:
          "pi-control-bridge: dist/bridge/main.js missing. Reinstall the package (npm:pi-control-bridge).",
        packageRoot,
      }),
    );
    return false;
  }

  const child = spawn(process.execPath, [bin, "start"], {
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
