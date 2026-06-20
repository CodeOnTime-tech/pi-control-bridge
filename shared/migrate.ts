import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getAgentDir } from "./agent_dir.ts";

export function legacyBridgeDataDir(): string {
  return join(homedir(), ".pi", "bridge");
}

export function defaultBridgeDataDir(): string {
  return join(getAgentDir(), "bridge");
}

/** Move `~/.pi/bridge` → `~/.pi/agent/bridge` when the new location is still empty. */
export function migrateLegacyBridgePaths(): void {
  const oldDir = legacyBridgeDataDir();
  const newDir = defaultBridgeDataDir();
  if (oldDir === newDir || !existsSync(oldDir)) return;

  if (!existsSync(newDir)) {
    mkdirSync(getAgentDir(), { recursive: true });
    try {
      renameSync(oldDir, newDir);
      return;
    } catch {
      // Fall through to per-file copy if rename fails (e.g. cross-device).
    }
  }

  mkdirSync(newDir, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(oldDir)) {
    const source = join(oldDir, name);
    const target = join(newDir, name);
    if (!existsSync(target)) {
      copyFileSync(source, target);
    }
  }
}
