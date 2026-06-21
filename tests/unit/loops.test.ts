import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startHeartbeatLoop, startPollerLoop } from "../../bridge/loops.ts";
import type { BackendClient } from "../../bridge/backend_client.ts";
import type { CommandDispatcher } from "../../bridge/command_dispatcher.ts";
import type { EventSender } from "../../bridge/event_sender.ts";
import type { Logger } from "../../shared/logger.ts";
import type { BridgeConfig, DeviceState } from "../../shared/types.ts";

const deviceState: DeviceState = {
  deviceId: "device-1",
  deviceToken: "token-1",
  fingerprint: "fp-1",
  hubUrl: "http://127.0.0.1:8000",
  lastHeartbeatAt: undefined,
};

const config: BridgeConfig = {
  hubUrl: "http://127.0.0.1:8000",
  pollIntervalSec: 2,
  heartbeatIntervalSec: 15,
  commandBatchSize: 10,
  ipcPort: 3847,
  bridgeDataDir: "/tmp/pi-bridge",
  bridgeLogLevel: "ERROR",
  autoStartBridge: true,
};

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

describe("bridge loops", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips heartbeat when there are no active sessions", async () => {
    const backend = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient;

    const stop = startHeartbeatLoop(
      config,
      backend,
      logger,
      () => deviceState,
      vi.fn(),
      () => false,
      () => true,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(backend.heartbeat).not.toHaveBeenCalled();

    stop();
  });

  it("sends heartbeat when sessions are active", async () => {
    const backend = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient;

    const stop = startHeartbeatLoop(
      config,
      backend,
      logger,
      () => deviceState,
      vi.fn(),
      () => true,
      () => true,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(backend.heartbeat).toHaveBeenCalledWith("token-1");

    stop();
  });

  it("skips heartbeat when telegram is not linked", async () => {
    const backend = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
      isTelegramLinked: vi.fn().mockResolvedValue(false),
    } as unknown as BackendClient;

    const stop = startHeartbeatLoop(
      config,
      backend,
      logger,
      () => deviceState,
      vi.fn(),
      () => true,
      () => true,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(backend.heartbeat).not.toHaveBeenCalled();

    stop();
  });

  it("skips command polling when there are no sessions and no pending events", async () => {
    const backend = {
      getNextCommands: vi.fn().mockResolvedValue([]),
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient;
    const eventSender = {
      pendingEventsCount: vi.fn().mockReturnValue(0),
      flushRetryQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventSender;
    const dispatcher = {
      dispatch: vi.fn(),
      retryHeldCommands: vi.fn(),
    } as unknown as CommandDispatcher;

    const stop = startPollerLoop(
      config,
      backend,
      dispatcher,
      eventSender,
      logger,
      () => deviceState,
      () => false,
      () => true,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(eventSender.flushRetryQueue).not.toHaveBeenCalled();
    expect(backend.getNextCommands).not.toHaveBeenCalled();

    stop();
  });

  it("flushes pending events even without active sessions", async () => {
    const backend = {
      getNextCommands: vi.fn().mockResolvedValue([]),
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient;
    const eventSender = {
      pendingEventsCount: vi.fn().mockReturnValue(2),
      flushRetryQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventSender;
    const dispatcher = {
      dispatch: vi.fn(),
      retryHeldCommands: vi.fn(),
    } as unknown as CommandDispatcher;

    const stop = startPollerLoop(
      config,
      backend,
      dispatcher,
      eventSender,
      logger,
      () => deviceState,
      () => false,
      () => true,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(eventSender.flushRetryQueue).toHaveBeenCalled();
    expect(backend.getNextCommands).not.toHaveBeenCalled();

    stop();
  });

  it("polls commands when sessions are active", async () => {
    const backend = {
      getNextCommands: vi.fn().mockResolvedValue([]),
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient;
    const eventSender = {
      pendingEventsCount: vi.fn().mockReturnValue(0),
      flushRetryQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventSender;
    const dispatcher = {
      dispatch: vi.fn(),
      retryHeldCommands: vi.fn(),
    } as unknown as CommandDispatcher;

    const stop = startPollerLoop(
      config,
      backend,
      dispatcher,
      eventSender,
      logger,
      () => deviceState,
      () => true,
      () => true,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(backend.getNextCommands).toHaveBeenCalledWith("device-1", "token-1");
    expect(dispatcher.retryHeldCommands).toHaveBeenCalled();

    stop();
  });

  it("skips poller when telegram is not linked", async () => {
    const backend = {
      getNextCommands: vi.fn().mockResolvedValue([]),
      isTelegramLinked: vi.fn().mockResolvedValue(false),
    } as unknown as BackendClient;
    const eventSender = {
      pendingEventsCount: vi.fn().mockReturnValue(1),
      flushRetryQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventSender;
    const dispatcher = {
      dispatch: vi.fn(),
      retryHeldCommands: vi.fn(),
    } as unknown as CommandDispatcher;

    const stop = startPollerLoop(
      config,
      backend,
      dispatcher,
      eventSender,
      logger,
      () => deviceState,
      () => true,
      () => true,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(eventSender.flushRetryQueue).not.toHaveBeenCalled();
    expect(backend.getNextCommands).not.toHaveBeenCalled();
    expect(dispatcher.retryHeldCommands).not.toHaveBeenCalled();

    stop();
  });

  it("skips heartbeat when telegram probe is disabled", async () => {
    const backend = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient;

    const stop = startHeartbeatLoop(
      config,
      backend,
      logger,
      () => deviceState,
      vi.fn(),
      () => true,
      () => false,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(backend.isTelegramLinked).not.toHaveBeenCalled();
    expect(backend.heartbeat).not.toHaveBeenCalled();

    stop();
  });

  it("skips poller probes when telegram probe is disabled", async () => {
    const backend = {
      getNextCommands: vi.fn().mockResolvedValue([]),
      isTelegramLinked: vi.fn().mockResolvedValue(true),
    } as unknown as BackendClient;
    const eventSender = {
      pendingEventsCount: vi.fn().mockReturnValue(2),
      flushRetryQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventSender;
    const dispatcher = {
      dispatch: vi.fn(),
      retryHeldCommands: vi.fn(),
    } as unknown as CommandDispatcher;

    const stop = startPollerLoop(
      config,
      backend,
      dispatcher,
      eventSender,
      logger,
      () => deviceState,
      () => true,
      () => false,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(backend.isTelegramLinked).not.toHaveBeenCalled();
    expect(eventSender.flushRetryQueue).not.toHaveBeenCalled();

    stop();
  });

  it("calls onTelegramLinked only once when link is detected concurrently", async () => {
    let resolveLinked!: () => void;
    const linkedPromise = new Promise<boolean>((resolve) => {
      resolveLinked = () => resolve(true);
    });

    const backend = {
      getNextCommands: vi.fn().mockResolvedValue([]),
      isTelegramLinked: vi.fn().mockImplementation(() => linkedPromise),
    } as unknown as BackendClient;
    const eventSender = {
      pendingEventsCount: vi.fn().mockReturnValue(0),
      flushRetryQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventSender;
    const dispatcher = {
      dispatch: vi.fn(),
      retryHeldCommands: vi.fn(),
    } as unknown as CommandDispatcher;
    const onTelegramLinked = vi.fn().mockResolvedValue(undefined);

    const unlinkedState: DeviceState = {
      ...deviceState,
      telegramLinked: false,
      telegramBindPending: true,
    };

    const stop = startPollerLoop(
      config,
      backend,
      dispatcher,
      eventSender,
      logger,
      () => unlinkedState,
      () => true,
      () => true,
      onTelegramLinked,
    );

    await vi.runOnlyPendingTimersAsync();
    resolveLinked();
    await vi.advanceTimersByTimeAsync(config.pollIntervalSec * 1000);
    await vi.runOnlyPendingTimersAsync();

    expect(onTelegramLinked).toHaveBeenCalledTimes(1);

    stop();
  });
});
