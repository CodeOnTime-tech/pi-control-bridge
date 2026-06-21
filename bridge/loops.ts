import { BackendAuthError, type BackendClient } from "./backend_client.ts";
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
  shouldProbeTelegram: (state: DeviceState) => boolean,
  onAuthFailure?: () => void,
): () => void {
  let stopped = false;
  let tickInFlight = false;

  const tick = async (): Promise<void> => {
    if (stopped || tickInFlight) return;
    tickInFlight = true;
    try {
      if (!hasActiveSessions()) return;
      const state = getDeviceState();
      if (!state) return;

      let telegramLinked = state.telegramLinked === true;
      if (!telegramLinked) {
        if (!shouldProbeTelegram(state)) return;
        try {
          telegramLinked = await backend.isTelegramLinked(state.deviceToken);
        } catch (error) {
          if (error instanceof BackendAuthError) {
            onAuthFailure?.();
            return;
          }
          return;
        }
        if (!telegramLinked) return;
      }

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
    } finally {
      tickInFlight = false;
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
  shouldProbeTelegram: (state: DeviceState) => boolean,
  onTelegramLinked?: () => Promise<void>,
  onAuthFailure?: () => void,
): () => void {
  let stopped = false;
  let previousLinked = false;
  let tickInFlight = false;

  const tick = async (): Promise<void> => {
    if (stopped || tickInFlight) return;
    tickInFlight = true;
    try {
      const state = getDeviceState();
      if (!state) return;

      let telegramLinked = state.telegramLinked === true;
      if (!telegramLinked) {
        if (!shouldProbeTelegram(state)) {
          previousLinked = false;
          return;
        }
        try {
          telegramLinked = await backend.isTelegramLinked(
            state.deviceToken,
            previousLinked ? undefined : 0,
          );
        } catch (error) {
          if (error instanceof BackendAuthError) {
            onAuthFailure?.();
            previousLinked = false;
            return;
          }
          return;
        }
      }

      if (telegramLinked && !previousLinked) {
        previousLinked = true;
        try {
          await onTelegramLinked?.();
        } catch {
          previousLinked = false;
        }
      }
      if (!telegramLinked) {
        previousLinked = false;
        return;
      }

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
    } finally {
      tickInFlight = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), config.pollIntervalSec * 1000);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
