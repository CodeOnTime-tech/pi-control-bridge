import { BackendAuthError, type BackendClient } from "./backend_client.ts";
import type { RetryQueue, QueuedEvent } from "./retry_queue.ts";
import { shouldProbeTelegramLink } from "../shared/device_state.ts";
import type { Logger } from "../shared/logger.ts";
import type { DeviceState, SessionEventPayload } from "../shared/types.ts";

export class EventSender {
  private pendingCount = 0;

  constructor(
    private readonly backend: BackendClient,
    private readonly retryQueue: RetryQueue,
    private readonly logger: Logger,
    private getDeviceState: () => DeviceState | null,
  ) {}

  pendingEventsCount(): number {
    return this.pendingCount;
  }

  async enqueue(externalSessionId: string, event: SessionEventPayload): Promise<void> {
    this.pendingCount += 1;
    this.retryQueue.enqueue({
      externalSessionId,
      event,
      attempts: 0,
    });
    this.logger.debug("Session event queued", {
      externalSessionId,
      eventId: event.eventId,
      eventType: event.eventType,
    });
  }

  async send(externalSessionId: string, event: SessionEventPayload): Promise<void> {
    const state = this.getDeviceState();
    if (!state) {
      this.logger.warn("Cannot send event without device state", { eventId: event.eventId });
      return;
    }

    let telegramLinked = state.telegramLinked === true;
    if (!telegramLinked) {
      if (!shouldProbeTelegramLink(state)) {
        await this.enqueue(externalSessionId, event);
        return;
      }
      try {
        telegramLinked = await this.backend.isTelegramLinked(state.deviceToken);
      } catch (error) {
        if (error instanceof BackendAuthError) {
          await this.enqueue(externalSessionId, event);
          return;
        }
        throw error;
      }
      if (!telegramLinked) {
        await this.enqueue(externalSessionId, event);
        return;
      }
    }

    try {
      await this.backend.postSessionEvent(state.deviceToken, {
        external_session_id: externalSessionId,
        event_type: event.eventType,
        status: event.status,
        payload: event.payload,
        event_id: event.eventId,
      });
      this.logger.info("Session event sent", {
        deviceId: state.deviceId,
        externalSessionId,
        eventId: event.eventId,
        correlationId: this.backend.getLastCorrelationId(),
      });
    } catch (error) {
      await this.enqueue(externalSessionId, event);
      this.logger.warn("Session event queued for retry", {
        externalSessionId,
        eventId: event.eventId,
        error: String(error),
      });
    }
  }

  async flushRetryQueue(): Promise<void> {
    const state = this.getDeviceState();
    if (!state) return;

    let telegramLinked = state.telegramLinked === true;
    if (!telegramLinked) {
      if (!shouldProbeTelegramLink(state)) return;
      try {
        telegramLinked = await this.backend.isTelegramLinked(state.deviceToken);
      } catch (error) {
        if (error instanceof BackendAuthError) return;
        throw error;
      }
      if (!telegramLinked) return;
    }

    const queued = this.retryQueue.load();
    if (queued.length === 0) return;

    const remaining: QueuedEvent[] = [];
    for (const item of queued) {
      try {
        await this.backend.postSessionEvent(state.deviceToken, {
          external_session_id: item.externalSessionId,
          event_type: item.event.eventType,
          status: item.event.status,
          payload: item.event.payload,
          event_id: item.event.eventId,
        });
        this.pendingCount = Math.max(0, this.pendingCount - 1);
      } catch {
        item.attempts += 1;
        if (item.attempts < 5) {
          remaining.push(item);
        }
      }
    }
    this.retryQueue.persist(remaining);
  }
}
