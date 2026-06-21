import { ipcBaseUrl, loadBridgeConfig } from "../shared/config.ts";
import { clearDeviceCredentials, shouldProbeTelegramLink } from "../shared/device_state.ts";
import { Logger } from "../shared/logger.ts";
import type { DeviceState } from "../shared/types.ts";
import { BackendAuthError, BackendClient } from "./backend_client.ts";
import { CommandDispatcher } from "./command_dispatcher.ts";
import { DeviceStateStore } from "./device_state_store.ts";
import { EventSender } from "./event_sender.ts";
import { computeDeviceFingerprint } from "./fingerprint.ts";
import { startHeartbeatLoop, startPollerLoop } from "./loops.ts";
import { startIpcServer } from "./ipc_server.ts";
import { RetryQueue } from "./retry_queue.ts";
import { SessionRegistry } from "./registry.ts";

export class BridgeRuntime {
  private deviceState: DeviceState | null = null;
  private eventSender?: EventSender;
  private stopHeartbeat?: () => void;
  private stopPoller?: () => void;
  private ipcClose?: () => void;
  private shutdownTimer?: NodeJS.Timeout;

  private readonly config = loadBridgeConfig();
  private readonly logger = new Logger(this.config.bridgeLogLevel);
  private readonly stateStore = new DeviceStateStore(this.config.bridgeDataDir);
  private readonly registry = new SessionRegistry();
  private readonly retryQueue = new RetryQueue(this.config.bridgeDataDir);
  private readonly backend = new BackendClient(this.config, this.logger);

  async start(): Promise<void> {
    await this.initOnStart();

    const eventSender = new EventSender(
      this.backend,
      this.retryQueue,
      this.logger,
      () => this.deviceState,
    );
    this.eventSender = eventSender;

    const dispatcher = new CommandDispatcher(
      this.registry,
      this.backend,
      this.logger,
      () => this.deviceState?.deviceToken,
    );

    const ipc = startIpcServer({
      registry: this.registry,
      backend: this.backend,
      eventSender,
      logger: this.logger,
      ipcPort: this.config.ipcPort,
      getDeviceState: () => this.deviceState,
      ensureHubDeviceRegistered: () => this.ensureHubDeviceRegistered(),
      syncPendingSessions: () => this.syncPendingSessions(),
      onEmptyRegistry: () => this.scheduleShutdownIfIdle(),
      onSessionRegistered: () => this.cancelScheduledShutdown(),
      scheduleShutdownIfIdle: () => this.scheduleShutdownIfIdle(),
      markTelegramBindPending: () => this.markTelegramBindPending(),
      onShutdown: () => {
        setImmediate(() => {
          this.logger.info("Shutdown requested");
          this.stop();
          process.exit(0);
        });
      },
    });
    this.ipcClose = ipc.close;

    const hasActiveSessions = () => this.registry.size() > 0;
    const shouldProbeTelegram = (state: DeviceState) => shouldProbeTelegramLink(state);
    const onAuthFailure = () => this.handleInvalidDeviceToken();

    this.stopHeartbeat = startHeartbeatLoop(
      this.config,
      this.backend,
      this.logger,
      () => this.deviceState,
      (state) => {
        this.deviceState = state;
        this.stateStore.save(state);
      },
      hasActiveSessions,
      shouldProbeTelegram,
      onAuthFailure,
    );

    this.stopPoller = startPollerLoop(
      this.config,
      this.backend,
      dispatcher,
      eventSender,
      this.logger,
      () => this.deviceState,
      hasActiveSessions,
      shouldProbeTelegram,
      async () => {
        this.markTelegramLinked(true);
        await this.ensureHubDeviceRegistered();
        await this.syncPendingSessions();
      },
      onAuthFailure,
    );

    this.logger.info("Bridge runtime started", {
      deviceId: this.deviceState?.deviceId,
      ipcPort: this.config.ipcPort,
    });
  }

  private async initOnStart(): Promise<void> {
    const saved = this.stateStore.load();
    if (!saved?.deviceToken) {
      this.deviceState = null;
      this.logger.info("Bridge started idle: hub registration deferred until Telegram is linked");
      return;
    }

    const fingerprint = computeDeviceFingerprint();
    this.deviceState = {
      ...saved,
      fingerprint,
      hubUrl: this.config.hubUrl,
    };

    if (!shouldProbeTelegramLink(saved)) {
      this.logger.info("Telegram not linked — deferring hub probes until connect-telegram");
      return;
    }

    try {
      const linked = await this.backend.isTelegramLinked(saved.deviceToken);
      if (linked) {
        this.markTelegramLinked(true);
        await this.ensureHubDeviceRegistered();
        await this.syncPendingSessions();
        return;
      }
      if (saved.telegramBindPending) {
        this.logger.info("Telegram bind pending — waiting for user to complete /start in bot");
        return;
      }
      this.logger.info("Telegram not linked — deferring hub device/session sync");
    } catch (error) {
      if (error instanceof BackendAuthError) {
        this.handleInvalidDeviceToken();
        return;
      }
      throw error;
    }
  }

  private markTelegramLinked(linked: boolean, bindPending = false): void {
    if (!this.deviceState) return;
    this.deviceState = {
      ...this.deviceState,
      telegramLinked: linked,
      telegramBindPending: bindPending,
    };
    this.stateStore.save(this.deviceState);
  }

  markTelegramBindPending(): void {
    if (!this.deviceState) return;
    this.markTelegramLinked(this.deviceState.telegramLinked === true, true);
  }

  private handleInvalidDeviceToken(): void {
    this.logger.warn("Device token rejected by hub — clearing stored credentials");
    this.backend.invalidateTelegramLinkedCache();
    const saved = this.stateStore.load();
    if (saved) {
      this.stateStore.save(clearDeviceCredentials(saved));
    }
    this.deviceState = null;
  }

  async ensureHubDeviceRegistered(): Promise<DeviceState> {
    const fingerprint = computeDeviceFingerprint();
    const saved = this.stateStore.load();
    const existingToken = this.deviceState?.deviceToken ?? saved?.deviceToken;

    let result;
    if (existingToken) {
      try {
        result = await this.backend.registerDevice(fingerprint, existingToken);
      } catch {
        result = await this.backend.registerDevice(fingerprint);
      }
    } else {
      result = await this.backend.registerDevice(fingerprint);
    }

    this.deviceState = this.backend.toDeviceState(result, fingerprint, this.deviceState ?? saved ?? undefined);
    this.stateStore.save(this.deviceState);
    this.backend.invalidateTelegramLinkedCache();
    this.logger.info("Device registered on hub", { deviceId: this.deviceState.deviceId });
    return this.deviceState;
  }

  async syncPendingSessions(): Promise<void> {
    const state = this.deviceState;
    if (!state) return;

    if (!state.telegramLinked && !shouldProbeTelegramLink(state)) return;

    let linked = state.telegramLinked === true;
    if (!linked) {
      try {
        linked = await this.backend.isTelegramLinked(state.deviceToken);
      } catch (error) {
        if (error instanceof BackendAuthError) {
          this.handleInvalidDeviceToken();
          return;
        }
        return;
      }
      if (!linked) return;
      this.markTelegramLinked(true);
    }

    for (const session of this.registry.listPendingHubSync()) {
      try {
        const result = await this.backend.registerSession(state.deviceToken, {
          external_session_id: session.externalSessionId,
          title: session.title,
          project_path: session.projectPath,
          cwd: session.cwd,
          status: session.status ?? "running",
        });
        this.registry.markHubSynced(session.localId, result.sessionId);
        this.logger.info("Pending session synced to hub", {
          localId: session.localId,
          hubSessionId: result.sessionId,
          status: session.status ?? "running",
        });
      } catch (error) {
        this.logger.warn("Pending session sync failed", {
          localId: session.localId,
          error: String(error),
        });
      }
    }

    await this.eventSender?.flushRetryQueue();
  }

  scheduleShutdownIfIdle(): boolean {
    if (this.registry.size() > 0) return false;
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
    this.shutdownTimer = setTimeout(() => {
      if (this.registry.size() === 0) {
        this.logger.info("No active sessions, shutting down bridge");
        this.stop();
        process.exit(0);
      }
    }, 30_000);
    return true;
  }

  cancelScheduledShutdown(): void {
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
    this.shutdownTimer = undefined;
  }

  stop(): void {
    this.stopHeartbeat?.();
    this.stopPoller?.();
    this.ipcClose?.();
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
  }
}

async function stopBridge(): Promise<void> {
  const config = loadBridgeConfig();
  try {
    const response = await fetch(`${ipcBaseUrl(config.ipcPort)}/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      console.error(`Bridge shutdown failed: HTTP ${response.status}`);
      process.exit(1);
    }
    console.log("Bridge stopped");
  } catch {
    console.log("Bridge is not running");
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "start";
  if (command === "stop") {
    await stopBridge();
    return;
  }
  if (command !== "start") {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  const runtime = new BridgeRuntime();
  process.on("SIGINT", () => {
    runtime.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    runtime.stop();
    process.exit(0);
  });

  await runtime.start();
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "ERROR", message: "Bridge failed to start", error: String(error) }));
  process.exit(1);
});
