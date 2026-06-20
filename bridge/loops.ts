import type { BackendClient } from "./backend_client.ts";
import type { CommandDispatcher } from "./command_dispatcher.ts";
import type { EventSender } from "./event_sender.ts";
import type { Logger } from "../shared/logger.ts";
import type { BridgeConfig, DeviceState } from "../shared/types.ts";

export function startHeartbeatLoop(
  config: BridgeConfig,
  backend: BackendClient,
  logger: Logger,
  getDeviceState: () => DeviceState | null,
  onHeartbeat: (state: DeviceState) => void,
  hasActiveSessions: () => boolean,
): () => void {
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (!hasActiveSessions()) return;
    const state = getDeviceState();
    if (!state) return;
    const telegramLinked = await backend.isTelegramLinked(state.deviceToken);
    if (!telegramLinked) return;
    try {
      await backend.heartbeat(state.deviceToken);
      onHeartbeat({
        ...state,
        lastHeartbeatAt: new Date().toISOString(),
      });
      logger.debug("Heartbeat ok", { deviceId: state.deviceId });
    } catch (error) {
      logger.warn("Heartbeat failed", { deviceId: state.deviceId, error: String(error) });
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), config.heartbeatIntervalSec * 1000);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function startPollerLoop(
  config: BridgeConfig,
  backend: BackendClient,
  dispatcher: CommandDispatcher,
  eventSender: EventSender,
  logger: Logger,
  getDeviceState: () => DeviceState | null,
  hasActiveSessions: () => boolean,
  onTelegramLinked?: () => Promise<void>,
): () => void {
  let stopped = false;
  let previousLinked = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const state = getDeviceState();
    if (!state) return;
    const telegramLinked = await backend.isTelegramLinked(state.deviceToken);
    if (telegramLinked && !previousLinked) {
      await onTelegramLinked?.();
    }
    previousLinked = telegramLinked;
    if (!telegramLinked) return;

    const active = hasActiveSessions();
    const hasPendingEvents = eventSender.pendingEventsCount() > 0;
    if (!active && !hasPendingEvents) return;

    try {
      if (hasPendingEvents) {
        await eventSender.flushRetryQueue();
      }
      if (!active) return;

      const commands = await backend.getNextCommands(state.deviceId, state.deviceToken);
      for (const command of commands) {
        await dispatcher.dispatch(command);
      }
      dispatcher.retryHeldCommands();
    } catch (error) {
      logger.warn("Command polling failed", {
        deviceId: state.deviceId,
        error: String(error),
      });
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), config.pollIntervalSec * 1000);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
