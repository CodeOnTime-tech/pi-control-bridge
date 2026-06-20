import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadBridgeConfig } from "../../shared/config.ts";
import { SessionRegistry } from "../../bridge/registry.ts";
import {
  DEFAULT_HUB_URL,
  DEFAULT_HEARTBEAT_INTERVAL_SEC,
  DEFAULT_IPC_PORT,
  DEFAULT_POLL_INTERVAL_SEC,
} from "../../shared/constants.ts";

describe("loadBridgeConfig", () => {
  it("uses defaults when no config files exist", () => {
    const config = loadBridgeConfig({
      projectConfigPath: null,
      userConfigPath: null,
    });
    expect(config.hubUrl).toBe(DEFAULT_HUB_URL);
    expect(config.pollIntervalSec).toBe(DEFAULT_POLL_INTERVAL_SEC);
    expect(config.heartbeatIntervalSec).toBe(DEFAULT_HEARTBEAT_INTERVAL_SEC);
    expect(config.ipcPort).toBe(DEFAULT_IPC_PORT);
  });

  it("merges user config over defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-bridge-user-"));
    const userPath = join(dir, "config.json");
    writeFileSync(
      userPath,
      JSON.stringify({ hub_url: "http://user:8000", ipc_port: 1111 }),
    );

    const config = loadBridgeConfig({
      projectConfigPath: null,
      userConfigPath: userPath,
    });
    expect(config.hubUrl).toBe("http://user:8000");
    expect(config.ipcPort).toBe(1111);
    expect(config.pollIntervalSec).toBe(DEFAULT_POLL_INTERVAL_SEC);
    rmSync(dir, { recursive: true, force: true });
  });

  it("merges project config over user config", () => {
    const userDir = mkdtempSync(join(tmpdir(), "pi-bridge-user-"));
    const userPath = join(userDir, "config.json");
    writeFileSync(
      userPath,
      JSON.stringify({ hub_url: "http://user:8000", ipc_port: 1111 }),
    );

    const projectDir = mkdtempSync(join(tmpdir(), "pi-bridge-project-"));
    const projectPath = join(projectDir, "bridge.json");
    writeFileSync(
      projectPath,
      JSON.stringify({ hub_url: "http://project:9000" }),
    );

    const config = loadBridgeConfig({
      userConfigPath: userPath,
      projectConfigPath: projectPath,
    });
    expect(config.hubUrl).toBe("http://project:9000");
    expect(config.ipcPort).toBe(1111);
    rmSync(userDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("finds project config by walking up from cwd", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-bridge-walk-"));
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(
      join(root, ".pi", "bridge.json"),
      JSON.stringify({ hub_url: "http://walk:7000" }),
    );
    const nested = join(root, "apps", "service");
    mkdirSync(nested, { recursive: true });

    const config = loadBridgeConfig({
      cwd: nested,
      userConfigPath: null,
    });
    expect(config.hubUrl).toBe("http://walk:7000");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("SessionRegistry", () => {
  it("routes commands to the registered session queue", async () => {
    const registry = new SessionRegistry();
    registry.register({
      localId: "local-1",
      externalSessionId: "ext-1",
      hubSessionId: "hub-1",
      cwd: "/tmp",
      pid: 1,
      mode: "tui",
      registeredAt: new Date().toISOString(),
    });

    const pending = {
      commandId: "cmd-1",
      hubSessionId: "hub-1",
      kind: "prompt",
      payload: { text: "hello" },
      queuedAt: new Date().toISOString(),
    };

    expect(registry.enqueueCommand("local-1", pending)).toBe(true);
    const command = await registry.waitForCommand("local-1", 100);
    expect(command?.commandId).toBe("cmd-1");
  });

  it("maps hub session id to local id", () => {
    const registry = new SessionRegistry();
    registry.register({
      localId: "local-2",
      externalSessionId: "ext-2",
      hubSessionId: "hub-2",
      cwd: "/tmp",
      pid: 2,
      mode: "tui",
      registeredAt: new Date().toISOString(),
    });
    expect(registry.getLocalIdByHubSessionId("hub-2")).toBe("local-2");
  });
});
