import type { BackendClient } from "./backend_client.ts";
import type { RetryQueue, QueuedEvent } from "./retry_queue.ts";
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

  async send(externalSessionId: string, event: SessionEventPayload): Promise<void> {
    const state = this.getDeviceState();
    if (!state) {
      this.logger.warn("Cannot send event without device state", { eventId: event.eventId });
      return;
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
      this.pendingCount += 1;
      this.retryQueue.enqueue({
        externalSessionId,
        event,
        attempts: 0,
      });
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
