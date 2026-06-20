import { describe, expect, it, vi } from "vitest";

import type { BackendClient } from "../../bridge/backend_client.ts";
import type { EventSender } from "../../bridge/event_sender.ts";
import { createIpcApp } from "../../bridge/ipc_server.ts";
import { SessionRegistry } from "../../bridge/registry.ts";
import type { Logger } from "../../shared/logger.ts";

function createTestApp() {
  const registry = new SessionRegistry();
  let shutdownScheduled = false;
  let shutdownCancelled = false;

  const app = createIpcApp({
    registry,
    backend: {
      isDegraded: () => false,
      registerSession: vi.fn(async () => ({ sessionId: "hub-2", status: "running" })),
      getConnectionInfo: vi.fn(),
      createLinkToken: vi.fn(),
    } as unknown as BackendClient,
    eventSender: {
      pendingEventsCount: () => 0,
      send: vi.fn(),
    } as unknown as EventSender,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger,
    ipcPort: 9473,
    getDeviceState: () => ({
      deviceId: "device-1",
      deviceToken: "token-1",
      fingerprint: "fp-1",
      hubUrl: "http://127.0.0.1:8000",
    }),
    onEmptyRegistry: () => {
      shutdownScheduled = true;
    },
    onSessionRegistered: () => {
      shutdownCancelled = true;
    },
    scheduleShutdownIfIdle: () => {
      if (registry.size() > 0) return false;
      shutdownScheduled = true;
      return true;
    },
  });

  return { app, registry, getShutdownScheduled: () => shutdownScheduled, getShutdownCancelled: () => shutdownCancelled };
}

describe("IPC shutdown-if-idle", () => {
  it("schedules shutdown only when registry is empty", async () => {
    const { app, registry, getShutdownScheduled } = createTestApp();
    registry.register({
      localId: "local-1",
      externalSessionId: "ext-1",
      hubSessionId: "hub-1",
      cwd: "/tmp",
      pid: 1,
      mode: "tui",
      registeredAt: new Date().toISOString(),
    });

    const busy = await app.request("/shutdown-if-idle", { method: "POST" });
    expect(busy.status).toBe(200);
    expect(await busy.json()).toEqual({ scheduled: false, activeSessions: 1 });
    expect(getShutdownScheduled()).toBe(false);

    registry.unregister("local-1");
    const idle = await app.request("/shutdown-if-idle", { method: "POST" });
    expect(idle.status).toBe(200);
    expect(await idle.json()).toEqual({ scheduled: true, activeSessions: 0 });
    expect(getShutdownScheduled()).toBe(true);
  });

  it("cancels pending shutdown when a session registers", async () => {
    const { app, getShutdownCancelled } = createTestApp();

    await app.request("/shutdown-if-idle", { method: "POST" });

    const register = await app.request("/sessions/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localId: "local-2",
        externalSessionId: "ext-2",
        cwd: "/tmp",
        pid: 2,
        mode: "tui",
      }),
    });

    expect(register.status).toBe(200);
    expect(getShutdownCancelled()).toBe(true);
  });
});
