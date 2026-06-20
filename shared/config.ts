import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEFAULT_HUB_URL,
  DEFAULT_BRIDGE_DATA_DIR,
  DEFAULT_BRIDGE_LOG_LEVEL,
  DEFAULT_COMMAND_BATCH_SIZE,
  DEFAULT_HEARTBEAT_INTERVAL_SEC,
  DEFAULT_IPC_PORT,
  DEFAULT_POLL_INTERVAL_SEC,
  PROJECT_CONFIG_RELATIVE_PATH,
  USER_CONFIG_RELATIVE_PATH,
} from "./constants.ts";
import type { BridgeConfig, BridgeConfigFile } from "./types.ts";

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function positiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function defaultConfig(): BridgeConfig {
  return {
    hubUrl: DEFAULT_HUB_URL,
    pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
    heartbeatIntervalSec: DEFAULT_HEARTBEAT_INTERVAL_SEC,
    commandBatchSize: DEFAULT_COMMAND_BATCH_SIZE,
    bridgeLogLevel: DEFAULT_BRIDGE_LOG_LEVEL,
    bridgeDataDir: expandHome(DEFAULT_BRIDGE_DATA_DIR),
    ipcPort: DEFAULT_IPC_PORT,
    autoStartBridge: true,
  };
}

function readConfigFile(path: string): BridgeConfigFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as BridgeConfigFile;
  } catch {
    return null;
  }
}

function applyConfigFile(base: BridgeConfig, file: BridgeConfigFile): BridgeConfig {
  return {
    hubUrl:
      typeof file.hub_url === "string" && file.hub_url.trim()
        ? file.hub_url.trim()
        : base.hubUrl,
    pollIntervalSec: positiveNumber(file.poll_interval_sec, base.pollIntervalSec),
    heartbeatIntervalSec: positiveNumber(
      file.heartbeat_interval_sec,
      base.heartbeatIntervalSec,
    ),
    commandBatchSize: positiveNumber(file.command_batch_size, base.commandBatchSize),
    bridgeLogLevel:
      typeof file.bridge_log_level === "string" && file.bridge_log_level.trim()
        ? file.bridge_log_level.trim()
        : base.bridgeLogLevel,
    bridgeDataDir:
      typeof file.bridge_data_dir === "string" && file.bridge_data_dir.trim()
        ? expandHome(file.bridge_data_dir.trim())
        : base.bridgeDataDir,
    ipcPort: positiveNumber(file.ipc_port, base.ipcPort),
    autoStartBridge:
      typeof file.auto_start_bridge === "boolean"
        ? file.auto_start_bridge
        : base.autoStartBridge,
  };
}

export function userConfigPath(): string {
  return join(homedir(), USER_CONFIG_RELATIVE_PATH);
}

/** Walk up from startDir and return the nearest project bridge config path. */
export function findProjectConfigPath(startDir: string = process.cwd()): string | null {
  let current = startDir;
  while (true) {
    const candidate = join(current, PROJECT_CONFIG_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export interface LoadBridgeConfigOptions {
  /** Project directory used to locate `.pi/bridge.json` (walks up from here). */
  cwd?: string;
  /** Override project config path (tests). Pass `null` to skip project config. */
  projectConfigPath?: string | null;
  /** Override user config path (tests). Pass `null` to skip user config. */
  userConfigPath?: string | null;
}

/**
 * Load bridge config. Priority (low → high):
 * 1. defaults
 * 2. `~/.pi/bridge/config.json`
 * 3. `.pi/bridge.json` in project (nearest ancestor of cwd)
 */
export function loadBridgeConfig(options: LoadBridgeConfigOptions = {}): BridgeConfig {
  let config = defaultConfig();

  const userPath =
    options.userConfigPath === null
      ? null
      : (options.userConfigPath ?? userConfigPath());
  if (userPath) {
    const userFile = readConfigFile(userPath);
    if (userFile) config = applyConfigFile(config, userFile);
  }

  const projectPath =
    options.projectConfigPath === null
      ? null
      : (options.projectConfigPath ?? findProjectConfigPath(options.cwd));
  if (projectPath) {
    const projectFile = readConfigFile(projectPath);
    if (projectFile) config = applyConfigFile(config, projectFile);
  }

  return config;
}

export function ipcBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function stateFilePath(dataDir: string): string {
  return join(dataDir, "state.json");
}

export function eventsQueuePath(dataDir: string): string {
  return join(dataDir, "events-queue.jsonl");
}
