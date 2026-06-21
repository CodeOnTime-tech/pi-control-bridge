import { describe, expect, it, vi } from "vitest";

import { CommandDispatcher } from "../../bridge/command_dispatcher.ts";
import { createIpcApp } from "../../bridge/ipc_server.ts";
import { BridgeDiagnostics } from "../../bridge/diagnostics.ts";
import { SessionRegistry } from "../../bridge/registry.ts";
import type { EventSender } from "../../bridge/event_sender.ts";
import type { BackendClient } from "../../bridge/backend_client.ts";
import { Logger } from "../../shared/logger.ts";

function createDeps(
  registry: SessionRegistry,
  eventSender: EventSender,
  extras?: {
    commandDispatcher?: CommandDispatcher;
    diagnostics?: BridgeDiagnostics;
  },
) {
  const logger = new Logger("ERROR");

  return {
    registry,
    backend: {
      isDegraded: () => false,
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient,
    eventSender,
    logger,
    ipcPort: 9473,
    getDeviceState: () => null as import("../../shared/types.ts").DeviceState | null,
    ensureHubDeviceRegistered: vi.fn(),
    syncPendingSessions: vi.fn(),
    markTelegramLinked: vi.fn(),
    commandDispatcher: extras?.commandDispatcher,
    diagnostics: extras?.diagnostics,
  };
}

describe("createIpcApp", () => {
  it("notifies backend on session unregister", async () => {
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

    const send = vi.fn().mockResolvedValue(undefined);
    const eventSender = { send, pendingEventsCount: () => 0 } as unknown as EventSender;
    const app = createIpcApp(createDeps(registry, eventSender));

    const response = await app.request("http://127.0.0.1/sessions/local-1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      "ext-1",
      expect.objectContaining({
        eventType: "session_shutdown",
        status: "offline",
      }),
    );
    expect(registry.size()).toBe(0);
  });

  it("registers session locally when telegram is not linked", async () => {
    const registry = new SessionRegistry();
    const eventSender = { send: vi.fn(), enqueue: vi.fn(), pendingEventsCount: () => 0 } as unknown as EventSender;
    const deps = createDeps(registry, eventSender);
    deps.backend.isTelegramLinked = vi.fn().mockResolvedValue(false);
    const app = createIpcApp(deps);

    const response = await app.request("http://127.0.0.1/sessions/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localId: "local-1",
        externalSessionId: "ext-1",
        cwd: "/tmp",
        pid: 1,
        mode: "tui",
        status: "waiting_user",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { hubSessionId: string; status: string };
    expect(body.status).toBe("waiting_user");
    const pending = registry.listPendingHubSync();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe("waiting_user");
    expect(deps.ensureHubDeviceRegistered).not.toHaveBeenCalled();
    expect(deps.syncPendingSessions).not.toHaveBeenCalled();
  });

  it("registers session locally when telegram is linked and syncs in background", async () => {
    const registry = new SessionRegistry();
    const eventSender = { send: vi.fn(), enqueue: vi.fn(), pendingEventsCount: () => 0 } as unknown as EventSender;
    const syncPendingSessions = vi.fn(async () => undefined);
    const ensureHubDeviceRegistered = vi.fn();
    const deps = createDeps(registry, eventSender);
    deps.getDeviceState = () => ({
      deviceId: "device-1",
      deviceToken: "token-1",
      fingerprint: "fp-1",
      hubUrl: "http://127.0.0.1:8000",
      telegramLinked: true,
    });
    deps.syncPendingSessions = syncPendingSessions;
    deps.ensureHubDeviceRegistered = ensureHubDeviceRegistered;
    const app = createIpcApp(deps);

    const response = await app.request("http://127.0.0.1/sessions/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localId: "local-2",
        externalSessionId: "ext-2",
        cwd: "/tmp",
        pid: 1,
        mode: "tui",
        status: "running",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { hubSessionId: string; status: string };
    expect(body.status).toBe("running");
    expect(registry.listPendingHubSync()).toHaveLength(1);
    expect(ensureHubDeviceRegistered).not.toHaveBeenCalled();
    expect(syncPendingSessions).toHaveBeenCalledOnce();
  });

  it("returns bot link without new token when telegram is already linked", async () => {
    const registry = new SessionRegistry();
    const eventSender = { send: vi.fn(), enqueue: vi.fn(), pendingEventsCount: () => 0 } as unknown as EventSender;
    const markTelegramLinked = vi.fn();
    const createLinkToken = vi.fn();
    const deps = createDeps(registry, eventSender);
    deps.getDeviceState = () => ({
      deviceId: "device-1",
      deviceToken: "token-1",
      fingerprint: "fp-1",
      hubUrl: "http://127.0.0.1:8000",
      telegramLinked: true,
    });
    deps.backend.getConnectionInfo = vi.fn().mockResolvedValue({
      deviceId: "device-1",
      telegram: { linked: true, username: "@alice" },
      bot: { username: "PiControlBot", link: "https://t.me/PiControlBot" },
    });
    deps.backend.createLinkToken = createLinkToken;
    deps.ensureHubDeviceRegistered = vi.fn().mockResolvedValue({
      deviceId: "device-1",
      deviceToken: "token-1",
      fingerprint: "fp-1",
      hubUrl: "http://127.0.0.1:8000",
    });
    deps.markTelegramLinked = markTelegramLinked;
    const app = createIpcApp(deps);

    const response = await app.request("http://127.0.0.1/telegram/link-token", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      alreadyLinked: boolean;
      botLink?: string;
      telegramUsername?: string;
    };
    expect(body.alreadyLinked).toBe(true);
    expect(body.botLink).toBe("https://t.me/PiControlBot");
    expect(body.telegramUsername).toBe("@alice");
    expect(createLinkToken).not.toHaveBeenCalled();
    expect(markTelegramLinked).toHaveBeenCalledWith(true);
  });

  it("returns 404 for command wait on unknown session", async () => {
    const registry = new SessionRegistry();
    const eventSender = { send: vi.fn(), enqueue: vi.fn(), pendingEventsCount: () => 0 } as unknown as EventSender;
    const app = createIpcApp(createDeps(registry, eventSender));

    const response = await app.request("http://127.0.0.1/sessions/missing/commands/wait");

    expect(response.status).toBe(404);
  });

  it("includes command diagnostics in health response", async () => {
    const registry = new SessionRegistry();
    registry.register({
      localId: "local-1",
      externalSessionId: "ext-1",
      hubSessionId: "local-1",
      cwd: "/tmp",
      pid: 1,
      mode: "tui",
      registeredAt: new Date().toISOString(),
      hubPending: true,
    });
    const ackCommand = vi.fn().mockResolvedValue(undefined);
    const backend = {
      ackCommand,
      getLastCorrelationId: () => "corr-1",
    } as unknown as BackendClient;
    const dispatcher = new CommandDispatcher(registry, backend, new Logger("ERROR"), () => "token");
    const diagnostics = new BridgeDiagnostics();
    diagnostics.markPollStarted();
    diagnostics.markCommandReceived();

    const eventSender = { send: vi.fn(), enqueue: vi.fn(), pendingEventsCount: () => 2 } as unknown as EventSender;
    const app = createIpcApp(createDeps(registry, eventSender, { commandDispatcher: dispatcher, diagnostics }));

    const response = await app.request("http://127.0.0.1/health");
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.hubPendingSessions).toBe(1);
    expect(body.heldCommands).toBe(0);
    expect(body.lastPollAt).toBeTypeOf("string");
    expect(body.lastCommandReceivedAt).toBeTypeOf("string");
    expect(body.sessionMappings).toEqual([
      { localId: "local-1", hubSessionId: "local-1", hubPending: true },
    ]);
  });
});
