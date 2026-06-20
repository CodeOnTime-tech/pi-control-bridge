import { hostname, platform } from "node:os";

import type { Logger } from "../shared/logger.ts";
import type { BridgeConfig, DeviceState } from "../shared/types.ts";

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
    return this.request("GET", "/me", {
      query: { device_token: deviceToken },
    });
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

  async createLinkToken(): Promise<{ token: string; expires_at: string }> {
    return this.request("POST", "/telegram/link-token");
  }

  toDeviceState(result: DeviceRegisterResult, fingerprint: string, previous?: DeviceState): DeviceState {
    return {
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      fingerprint,
      hubUrl: this.config.hubUrl,
      lastRegisterAt: new Date().toISOString(),
      lastHeartbeatAt: previous?.lastHeartbeatAt,
    };
  }
}
