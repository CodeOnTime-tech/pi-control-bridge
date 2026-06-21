import { hostname, platform } from "node:os";

import type { Logger } from "../shared/logger.ts";
import {
  parseHubConnectionInfo,
  parseTelegramLinkResponse,
  type HubConnectionInfo,
  type TelegramLinkResponse,
} from "../shared/telegram.ts";
import type { BridgeConfig, DeviceState } from "../shared/types.ts";

/** Cache TTL when Telegram is already linked (stable state). */
const TELEGRAM_LINKED_CACHE_TTL_MS = 30_000;
/** Short TTL while unlinked so bind is detected within a few seconds. */
const TELEGRAM_UNLINKED_CACHE_TTL_MS = 2_000;

export class BackendAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendAuthError";
  }
}

export interface DeviceRegisterResult {
  deviceId: string;
  deviceToken: string;
  status: string;
}

export interface SessionRegisterResult {
  sessionId: string;
  status: string;
}

export interface HubCommand {
  command_id: string;
  session_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
}

function mapDeviceRegister(raw: Record<string, unknown>): DeviceRegisterResult {
  return {
    deviceId: String(raw.device_id ?? raw.deviceId),
    deviceToken: String(raw.device_token ?? raw.deviceToken),
    status: String(raw.status ?? "pending"),
  };
}

function mapSessionRegister(raw: Record<string, unknown>): SessionRegisterResult {
  return {
    sessionId: String(raw.session_id ?? raw.sessionId),
    status: String(raw.status ?? "running"),
  };
}

export class BackendClient {
  private degraded = false;
  private lastCorrelationId?: string;
  private telegramLinkedCache: { value: boolean; checkedAt: number } | null = null;

  constructor(
    private readonly config: BridgeConfig,
    private readonly logger: Logger,
  ) {}

  isDegraded(): boolean {
    return this.degraded;
  }

  getLastCorrelationId(): string | undefined {
    return this.lastCorrelationId;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: { query?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    const url = new URL(path, this.config.hubUrl);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
      this.degraded = false;
    } catch (error) {
      this.degraded = true;
      throw error;
    }

    const correlationId = response.headers.get("x-correlation-id") ?? undefined;
    this.lastCorrelationId = correlationId;

    if (!response.ok) {
      const text = await response.text();
      this.logger.warn("Backend request failed", {
        correlationId,
        status: response.status,
        path,
      });
      if (response.status === 401) {
        throw new BackendAuthError(`Backend ${method} ${path} failed: ${response.status} ${text}`);
      }
      throw new Error(`Backend ${method} ${path} failed: ${response.status} ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async registerDevice(
    fingerprint: string,
    deviceToken?: string,
  ): Promise<DeviceRegisterResult> {
    const raw = await this.request<Record<string, unknown>>("POST", "/devices/register", {
      body: {
        fingerprint,
        name: hostname(),
        platform: platform(),
        hostname: hostname(),
        device_token: deviceToken,
      },
    });
    return mapDeviceRegister(raw);
  }

  async validateToken(deviceToken: string): Promise<{ device_id: string }> {
    const info = await this.getConnectionInfo(deviceToken);
    return { device_id: info.deviceId ?? "" };
  }

  async getConnectionInfo(deviceToken: string): Promise<HubConnectionInfo> {
    const raw = await this.request<Record<string, unknown>>("GET", "/me", {
      query: { device_token: deviceToken },
    });
    return parseHubConnectionInfo(raw);
  }

  invalidateTelegramLinkedCache(): void {
    this.telegramLinkedCache = null;
  }

  private telegramLinkedCacheTtlMs(maxAgeMs?: number): number {
    if (maxAgeMs !== undefined) return maxAgeMs;
    if (!this.telegramLinkedCache) return 0;
    return this.telegramLinkedCache.value
      ? TELEGRAM_LINKED_CACHE_TTL_MS
      : TELEGRAM_UNLINKED_CACHE_TTL_MS;
  }

  async isTelegramLinked(deviceToken: string | undefined, maxAgeMs?: number): Promise<boolean> {
    if (!deviceToken) {
      return false;
    }

    const now = Date.now();
    const cacheTtl = this.telegramLinkedCacheTtlMs(maxAgeMs);
    if (
      this.telegramLinkedCache &&
      cacheTtl > 0 &&
      now - this.telegramLinkedCache.checkedAt < cacheTtl
    ) {
      return this.telegramLinkedCache.value;
    }

    try {
      const info = await this.getConnectionInfo(deviceToken);
      const linked = info.telegram.linked === true;
      this.telegramLinkedCache = { value: linked, checkedAt: now };
      return linked;
    } catch (error) {
      if (error instanceof BackendAuthError) {
        this.telegramLinkedCache = { value: false, checkedAt: now };
        throw error;
      }
      this.telegramLinkedCache = { value: false, checkedAt: now };
      return false;
    }
  }

  async heartbeat(deviceToken: string): Promise<void> {
    await this.request("POST", "/devices/heartbeat", {
      body: { device_token: deviceToken },
    });
  }

  async registerSession(
    deviceToken: string,
    payload: {
      external_session_id: string;
      title?: string;
      project_path?: string;
      cwd?: string;
      status?: string;
    },
  ): Promise<SessionRegisterResult> {
    const raw = await this.request<Record<string, unknown>>("POST", "/sessions/register", {
      body: {
        device_token: deviceToken,
        external_session_id: payload.external_session_id,
        title: payload.title,
        project_path: payload.project_path,
        cwd: payload.cwd,
        status: payload.status ?? "running",
      },
    });
    return mapSessionRegister(raw);
  }

  async getNextCommands(deviceId: string, deviceToken: string): Promise<HubCommand[]> {
    const result = await this.request<{ items: HubCommand[] }>(
      "GET",
      `/commands/devices/${deviceId}/next`,
      { query: { device_token: deviceToken } },
    );
    return result.items ?? [];
  }

  async ackCommand(commandId: string, deviceToken: string): Promise<void> {
    await this.request("POST", `/commands/${commandId}/ack`, {
      body: { device_token: deviceToken },
    });
  }

  async activateSession(sessionId: string, telegramChatId: number): Promise<void> {
    await this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/activate`, {
      query: { telegram_chat_id: String(telegramChatId) },
    });
  }

  async postSessionEvent(
    deviceToken: string,
    payload: {
      external_session_id: string;
      event_type: string;
      status?: string;
      payload?: Record<string, unknown>;
      event_id: string;
    },
  ): Promise<void> {
    await this.request("POST", "/session-events", {
      body: {
        device_token: deviceToken,
        external_session_id: payload.external_session_id,
        event_type: payload.event_type,
        status: payload.status,
        payload: payload.payload,
        event_id: payload.event_id,
      },
    });
  }

  async createLinkToken(deviceToken: string): Promise<TelegramLinkResponse> {
    const raw = await this.request<Record<string, unknown>>("POST", "/telegram/link-token", {
      body: { device_token: deviceToken },
    });
    return parseTelegramLinkResponse(raw);
  }

  toDeviceState(result: DeviceRegisterResult, fingerprint: string, previous?: DeviceState): DeviceState {
    return {
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      fingerprint,
      hubUrl: this.config.hubUrl,
      lastRegisterAt: new Date().toISOString(),
      lastHeartbeatAt: previous?.lastHeartbeatAt,
      telegramBindPending: previous?.telegramBindPending,
      telegramLinked: previous?.telegramLinked,
    };
  }
}
