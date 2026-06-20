import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { IPC_COMMAND_WAIT_TIMEOUT_MS, PACKAGE_VERSION } from "../shared/constants.ts";
import type { Logger } from "../shared/logger.ts";
import type {
  BridgeStatus,
  ControlStatus,
  DeviceState,
  RegisterSessionRequest,
  SessionEventPayload,
} from "../shared/types.ts";
import type { BackendClient } from "./backend_client.ts";
import type { EventSender } from "./event_sender.ts";
import type { SessionRegistry } from "./registry.ts";

export interface IpcServerDeps {
  registry: SessionRegistry;
  backend: BackendClient;
  eventSender: EventSender;
  logger: Logger;
  ipcPort: number;
  getDeviceState: () => DeviceState | null;
  ensureHubDeviceRegistered: () => Promise<DeviceState>;
  syncPendingSessions: () => Promise<void>;
  onEmptyRegistry?: () => void;
  onSessionRegistered?: () => void;
  scheduleShutdownIfIdle?: () => boolean;
  onShutdown?: () => void;
}

export function createIpcApp(deps: IpcServerDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const state = deps.getDeviceState();
    const status: BridgeStatus = {
      ok: true,
      deviceId: state?.deviceId,
      backendConnected: !deps.backend.isDegraded(),
      degraded: deps.backend.isDegraded(),
      activeSessions: deps.registry.size(),
      pendingEvents: deps.eventSender.pendingEventsCount(),
      ipcPort: deps.ipcPort,
    };
    return c.json({ ...status, version: PACKAGE_VERSION });
  });

  app.get("/connection-status", async (c) => {
    const state = deps.getDeviceState();
    const base: ControlStatus = {
      ok: true,
      deviceId: state?.deviceId,
      backendConnected: !deps.backend.isDegraded(),
      degraded: deps.backend.isDegraded(),
      activeSessions: deps.registry.size(),
      pendingEvents: deps.eventSender.pendingEventsCount(),
      ipcPort: deps.ipcPort,
      version: PACKAGE_VERSION,
      telegram: { linked: false },
      bot: {},
    };

    if (!state) {
      return c.json(base);
    }

    const linked = await deps.backend.isTelegramLinked(state.deviceToken);
    if (!linked) {
      return c.json({
        ...base,
        deviceId: state.deviceId ?? base.deviceId,
        telegram: { linked: false },
        bot: {},
      } satisfies ControlStatus);
    }

    void deps.syncPendingSessions();

    try {
      const connection = await deps.backend.getConnectionInfo(state.deviceToken);
      return c.json({
        ...base,
        deviceId: connection.deviceId ?? base.deviceId,
        telegram: connection.telegram,
        bot: connection.bot,
      } satisfies ControlStatus);
    } catch (error) {
      deps.logger.warn("Connection status request failed", { error: String(error) });
      return c.json({ ...base, degraded: true }, 502);
    }
  });

  app.post("/telegram/link-token", async (c) => {
    try {
      const state = await deps.ensureHubDeviceRegistered();
      const result = await deps.backend.createLinkToken(state.deviceToken);
      return c.json(result);
    } catch (error) {
      deps.logger.error("Telegram link token request failed", { error: String(error) });
      return c.json({ error: String(error) }, 502);
    }
  });

  app.get("/sessions", (c) => c.json({ items: deps.registry.list() }));

  app.post("/sessions/register", async (c) => {
    const body = (await c.req.json()) as RegisterSessionRequest;
    const state = deps.getDeviceState();
    // Fresh check: user may have just completed /start bind in Telegram.
    const linked = state ? await deps.backend.isTelegramLinked(state.deviceToken, 0) : false;

    if (!linked) {
      const record = {
        localId: body.localId,
        externalSessionId: body.externalSessionId,
        hubSessionId: body.localId,
        cwd: body.cwd,
        projectPath: body.projectPath,
        title: body.title,
        pid: body.pid,
        mode: body.mode,
        registeredAt: new Date().toISOString(),
        hubPending: true,
      };
      deps.registry.register(record);
      deps.onSessionRegistered?.();
      deps.logger.info("Session registered locally (hub sync deferred)", {
        externalSessionId: body.externalSessionId,
      });
      return c.json({ hubSessionId: record.localId, status: "pending" });
    }

    try {
      const hubState = await deps.ensureHubDeviceRegistered();
      const result = await deps.backend.registerSession(hubState.deviceToken, {
        external_session_id: body.externalSessionId,
        title: body.title,
        project_path: body.projectPath,
        cwd: body.cwd,
        status: body.status ?? "running",
      });

      const record = {
        localId: body.localId,
        externalSessionId: body.externalSessionId,
        hubSessionId: result.sessionId,
        cwd: body.cwd,
        projectPath: body.projectPath,
        title: body.title,
        pid: body.pid,
        mode: body.mode,
        registeredAt: new Date().toISOString(),
      };
      deps.registry.register(record);
      deps.onSessionRegistered?.();
      deps.logger.info("Session registered", {
        deviceId: hubState.deviceId,
        externalSessionId: body.externalSessionId,
        hubSessionId: record.hubSessionId,
      });
      return c.json({ hubSessionId: record.hubSessionId, status: result.status });
    } catch (error) {
      deps.logger.error("Session register failed", { error: String(error) });
      return c.json({ error: String(error) }, 502);
    }
  });

  app.post("/shutdown-if-idle", (c) => {
    const scheduled = deps.scheduleShutdownIfIdle?.() ?? false;
    return c.json({ scheduled, activeSessions: deps.registry.size() });
  });

  app.post("/shutdown", (c) => {
    deps.onShutdown?.();
    return c.json({ ok: true, activeSessions: deps.registry.size() });
  });

  app.delete("/sessions/:localId", async (c) => {
    const localId = c.req.param("localId");
    const session = deps.registry.getByLocalId(localId);
    if (!session) {
      return c.json({ ok: true });
    }

    await deps.eventSender.send(session.externalSessionId, {
      eventType: "session_shutdown",
      status: "offline",
      eventId: randomUUID(),
    });
    deps.registry.unregister(localId);
    deps.logger.info("Session unregistered", { externalSessionId: localId });
    if (deps.registry.size() === 0) {
      deps.onEmptyRegistry?.();
    }
    return c.json({ ok: true });
  });

  app.post("/sessions/:localId/events", async (c) => {
    const localId = c.req.param("localId");
    const session = deps.registry.getByLocalId(localId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    const event = (await c.req.json()) as SessionEventPayload;
    await deps.eventSender.send(session.externalSessionId, event);
    return c.json({ ok: true });
  });

  app.get("/sessions/:localId/commands/wait", async (c) => {
    const localId = c.req.param("localId");
    const command = await deps.registry.waitForCommand(
      localId,
      IPC_COMMAND_WAIT_TIMEOUT_MS,
    );
    if (!command) {
      return c.body(null, 204);
    }
    return c.json(command);
  });

  return app;
}

export function startIpcServer(deps: IpcServerDeps): { close: () => void } {
  const app = createIpcApp(deps);
  const listener = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: deps.ipcPort,
  });

  deps.logger.info("IPC server listening", { ipcPort: deps.ipcPort });
  return {
    close: () => listener.close(),
  };
}
