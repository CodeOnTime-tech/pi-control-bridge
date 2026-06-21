import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { IPC_COMMAND_WAIT_TIMEOUT_MS, PACKAGE_VERSION } from "../shared/constants.ts";
import { shouldProbeTelegramLink } from "../shared/device_state.ts";
import type { Logger } from "../shared/logger.ts";
import { buildAlreadyLinkedTelegramResponse } from "../shared/telegram.ts";
import type {
  BridgeStatus,
  ControlStatus,
  DeviceState,
  RegisterSessionRequest,
  SessionEventPayload,
} from "../shared/types.ts";
import { BackendAuthError, type BackendClient } from "./backend_client.ts";
import type { CommandDispatcher } from "./command_dispatcher.ts";
import type { BridgeDiagnostics } from "./diagnostics.ts";
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
  activateHubSession?: (hubSessionId: string) => Promise<void>;
  pruneDeadSessions?: () => void;
  onEmptyRegistry?: () => void;
  onSessionRegistered?: () => void;
  scheduleShutdownIfIdle?: () => boolean;
  markTelegramBindPending?: () => void;
  markTelegramLinked?: (linked: boolean) => void;
  onShutdown?: () => void;
  commandDispatcher?: CommandDispatcher;
  diagnostics?: BridgeDiagnostics;
}

function buildBridgeDiagnostics(deps: IpcServerDeps): Partial<BridgeStatus> {
  return {
    hubPendingSessions: deps.registry.listPendingHubSync().length,
    heldCommands: deps.commandDispatcher?.heldCommandsCount() ?? 0,
    lastPollAt: deps.diagnostics?.lastPollAt,
    lastCommandReceivedAt: deps.diagnostics?.lastCommandReceivedAt,
    lastPollError: deps.diagnostics?.lastPollError,
    sessionMappings: deps.registry.getSessionMappings(),
  };
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
      ...buildBridgeDiagnostics(deps),
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
      ...buildBridgeDiagnostics(deps),
    };

    if (!state) {
      return c.json(base);
    }

    if (state.telegramLinked) {
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
        if (error instanceof BackendAuthError) {
          return c.json({
            ...base,
            deviceId: state.deviceId ?? base.deviceId,
            telegram: { linked: true },
            bot: {},
            degraded: true,
          } satisfies ControlStatus);
        }
        deps.logger.warn("Connection status request failed", { error: String(error) });
        return c.json({ ...base, degraded: true }, 502);
      }
    }

    if (!shouldProbeTelegramLink(state)) {
      return c.json({
        ...base,
        deviceId: state.deviceId ?? base.deviceId,
        telegram: { linked: false },
        bot: {},
      } satisfies ControlStatus);
    }

    try {
      const linked = await deps.backend.isTelegramLinked(state.deviceToken, 0);
      if (!linked) {
        return c.json({
          ...base,
          deviceId: state.deviceId ?? base.deviceId,
          telegram: { linked: false },
          bot: {},
        } satisfies ControlStatus);
      }

      void deps.syncPendingSessions();
      const connection = await deps.backend.getConnectionInfo(state.deviceToken);
      return c.json({
        ...base,
        deviceId: connection.deviceId ?? base.deviceId,
        telegram: connection.telegram,
        bot: connection.bot,
      } satisfies ControlStatus);
    } catch (error) {
      if (error instanceof BackendAuthError) {
        return c.json({
          ...base,
          deviceId: state.deviceId ?? base.deviceId,
          telegram: { linked: false },
          bot: {},
          degraded: true,
        } satisfies ControlStatus);
      }
      deps.logger.warn("Connection status request failed", { error: String(error) });
      return c.json({ ...base, degraded: true }, 502);
    }
  });

  app.post("/telegram/link-token", async (c) => {
    try {
      const state = await deps.ensureHubDeviceRegistered();
      try {
        const connection = await deps.backend.getConnectionInfo(state.deviceToken);
        if (connection.telegram.linked) {
          deps.markTelegramLinked?.(true);
          return c.json(buildAlreadyLinkedTelegramResponse(connection));
        }
      } catch (error) {
        if (error instanceof BackendAuthError) {
          deps.logger.error("Telegram link token request failed", { error: String(error) });
          return c.json({ error: String(error) }, 502);
        }
        throw error;
      }

      deps.markTelegramBindPending?.();
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
    deps.pruneDeadSessions?.();
    const state = deps.getDeviceState();
    let linked = state?.telegramLinked === true;
    if (!linked && state && shouldProbeTelegramLink(state)) {
      try {
        linked = await deps.backend.isTelegramLinked(state.deviceToken, 0);
        if (linked) {
          deps.markTelegramLinked?.(true);
        }
      } catch (error) {
        if (error instanceof BackendAuthError) {
          linked = false;
        } else {
          throw error;
        }
      }
    }

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
      status: body.status ?? "running",
    };
    deps.registry.register(record);
    deps.onSessionRegistered?.();
    const synced = deps.registry.getByLocalId(body.localId);
    if (synced && !synced.hubPending) {
      void deps.activateHubSession?.(synced.hubSessionId);
    }
    if (state && (linked || shouldProbeTelegramLink(state))) {
      void deps.syncPendingSessions();
    }
    deps.logger.info("Session registered locally", {
      externalSessionId: body.externalSessionId,
      hubSyncDeferred: true,
    });
    return c.json({ hubSessionId: record.localId, status: record.status });
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
    if (event.status) {
      deps.registry.updateStatus(localId, event.status);
    }
    if (session.hubPending || session.hubSessionId === session.localId) {
      await deps.eventSender.enqueue(session.externalSessionId, event);
      return c.json({ ok: true });
    }
    await deps.eventSender.send(session.externalSessionId, event);
    return c.json({ ok: true });
  });

  app.get("/sessions/:localId/commands/wait", async (c) => {
    const localId = c.req.param("localId");
    if (!deps.registry.getByLocalId(localId)) {
      return c.json({ error: "Session not found" }, 404);
    }
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
