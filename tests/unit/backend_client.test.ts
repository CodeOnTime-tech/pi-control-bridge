import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackendAuthError, BackendClient } from "../../bridge/backend_client.ts";
import type { Logger } from "../../shared/logger.ts";
import type { BridgeConfig } from "../../shared/types.ts";

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

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

describe("BackendClient.isTelegramLinked cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          device_id: "device-1",
          telegram: { linked: false },
        }),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses short TTL while unlinked and long TTL while linked", async () => {
    const client = new BackendClient(config, logger);

    await expect(client.isTelegramLinked("token-1")).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        device_id: "device-1",
        telegram: { linked: true },
      }),
    } as Response);

    vi.advanceTimersByTime(2_500);
    await expect(client.isTelegramLinked("token-1")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.mocked(fetch).mockClear();
    vi.advanceTimersByTime(5_000);
    await expect(client.isTelegramLinked("token-1")).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        device_id: "device-1",
        telegram: { linked: true },
      }),
    } as Response);
    await expect(client.isTelegramLinked("token-1")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("force refresh bypasses cache", async () => {
    const client = new BackendClient(config, logger);

    await client.isTelegramLinked("token-1");
    expect(fetch).toHaveBeenCalledTimes(1);

    await client.isTelegramLinked("token-1", 0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws BackendAuthError on 401", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => "Invalid device token",
    } as Response);

    const client = new BackendClient(config, logger);
    await expect(client.isTelegramLinked("token-1")).rejects.toBeInstanceOf(BackendAuthError);
  });
});

describe("BackendClient.activateSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to sessions activate with telegram chat id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ session_id: "sess-1", status: "running" }),
      }),
    );

    const client = new BackendClient(config, logger);
    await client.activateSession("sess-1", 4242);

    expect(fetch).toHaveBeenCalledOnce();
    const call = vi.mocked(fetch).mock.calls[0];
    expect(String(call[0])).toContain("/sessions/sess-1/activate?telegram_chat_id=4242");
    expect((call[1] as RequestInit).method).toBe("POST");
  });
});
