import { describe, expect, it, vi } from "vitest";

import { EventSender } from "../../bridge/event_sender.ts";
import type { BackendClient } from "../../bridge/backend_client.ts";
import { RetryQueue } from "../../bridge/retry_queue.ts";
import type { Logger } from "../../shared/logger.ts";
import type { BridgeConfig, DeviceState } from "../../shared/types.ts";

const config: BridgeConfig = {
  hubUrl: "http://127.0.0.1:8000",
  pollIntervalSec: 2,
  heartbeatIntervalSec: 15,
  commandBatchSize: 10,
  ipcPort: 9473,
  bridgeDataDir: "/tmp/pi-bridge",
  bridgeLogLevel: "ERROR",
  autoStartBridge: true,
};

const deviceState: DeviceState = {
  deviceId: "device-1",
  deviceToken: "token-1",
  fingerprint: "fp-1",
  hubUrl: "http://127.0.0.1:8000",
};

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

describe("EventSender", () => {
  it("queues events when telegram is not linked", async () => {
    const backend = {
      isTelegramLinked: vi.fn().mockResolvedValue(false),
      postSessionEvent: vi.fn(),
    } as unknown as BackendClient;
    const retryQueue = {
      enqueue: vi.fn(),
      load: vi.fn().mockReturnValue([]),
      persist: vi.fn(),
    } as unknown as RetryQueue;

    const sender = new EventSender(backend, retryQueue, logger, () => deviceState);
    await sender.send("ext-1", {
      eventType: "session_start",
      status: "waiting_user",
      eventId: "evt-1",
    });

    expect(backend.postSessionEvent).not.toHaveBeenCalled();
    expect(retryQueue.enqueue).toHaveBeenCalledOnce();
    expect(sender.pendingEventsCount()).toBe(1);
  });
});
