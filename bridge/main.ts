import { loadBridgeConfig } from "../shared/config.ts";
import { Logger } from "../shared/logger.ts";
import type { DeviceState } from "../shared/types.ts";
import { BackendClient } from "./backend_client.ts";
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
    await this.ensureDeviceRegistered();

    const eventSender = new EventSender(
      this.backend,
      this.retryQueue,
      this.logger,
      () => this.deviceState,
    );

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
      onEmptyRegistry: () => this.scheduleShutdownIfIdle(),
    });
    this.ipcClose = ipc.close;

    this.stopHeartbeat = startHeartbeatLoop(
      this.config,
      this.backend,
      this.logger,
      () => this.deviceState,
      (state) => {
        this.deviceState = state;
        this.stateStore.save(state);
      },
    );

    this.stopPoller = startPollerLoop(
      this.config,
      this.backend,
      dispatcher,
      eventSender,
      this.logger,
      () => this.deviceState,
    );

    this.logger.info("Bridge runtime started", {
      deviceId: this.deviceState?.deviceId,
      ipcPort: this.config.ipcPort,
    });
  }

  private async ensureDeviceRegistered(): Promise<void> {
    const fingerprint = computeDeviceFingerprint();
    const saved = this.stateStore.load();
    let result;

    if (saved?.deviceToken) {
      try {
        await this.backend.validateToken(saved.deviceToken);
        result = await this.backend.registerDevice(fingerprint, saved.deviceToken);
      } catch {
        result = await this.backend.registerDevice(fingerprint);
      }
    } else {
      result = await this.backend.registerDevice(fingerprint);
    }

    this.deviceState = this.backend.toDeviceState(result, fingerprint, saved ?? undefined);
    this.stateStore.save(this.deviceState);
    this.logger.info("Device registered", { deviceId: this.deviceState.deviceId });
  }

  private scheduleShutdownIfIdle(): void {
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
    this.shutdownTimer = setTimeout(() => {
      if (this.registry.size() === 0) {
        this.logger.info("No active sessions, shutting down bridge");
        this.stop();
        process.exit(0);
      }
    }, 30_000);
  }

  stop(): void {
    this.stopHeartbeat?.();
    this.stopPoller?.();
    this.ipcClose?.();
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "start";
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
