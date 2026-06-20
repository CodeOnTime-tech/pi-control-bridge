export interface BridgeConfig {
  hubUrl: string;
  pollIntervalSec: number;
  heartbeatIntervalSec: number;
  commandBatchSize: number;
  bridgeLogLevel: string;
  bridgeDataDir: string;
  ipcPort: number;
  autoStartBridge: boolean;
}

/** On-disk JSON config (snake_case keys). */
export interface BridgeConfigFile {
  hub_url?: string;
  poll_interval_sec?: number;
  heartbeat_interval_sec?: number;
  command_batch_size?: number;
  bridge_log_level?: string;
  bridge_data_dir?: string;
  ipc_port?: number;
  auto_start_bridge?: boolean;
}

export interface DeviceState {
  deviceId: string;
  deviceToken: string;
  fingerprint: string;
  hubUrl: string;
  lastRegisterAt?: string;
  lastHeartbeatAt?: string;
}

export interface LocalSessionRecord {
  localId: string;
  externalSessionId: string;
  hubSessionId: string;
  cwd: string;
  projectPath?: string;
  title?: string;
  pid: number;
  mode: string;
  registeredAt: string;
}

export interface PendingCommand {
  commandId: string;
  hubSessionId: string;
  kind: string;
  payload: Record<string, unknown> | null;
  queuedAt: string;
}

export interface SessionEventPayload {
  eventType: string;
  status?: string;
  payload?: Record<string, unknown>;
  eventId: string;
}

export interface BridgeStatus {
  ok: boolean;
  deviceId?: string;
  backendConnected: boolean;
  degraded: boolean;
  activeSessions: number;
  pendingEvents: number;
  ipcPort: number;
}

export interface RegisterSessionRequest {
  localId: string;
  externalSessionId: string;
  cwd: string;
  projectPath?: string;
  title?: string;
  pid: number;
  mode: string;
  status?: string;
}

export interface RegisterSessionResponse {
  hubSessionId: string;
  status: string;
}

export interface HealthResponse extends BridgeStatus {
  version: string;
}

export interface ControlStatus extends BridgeStatus {
  version?: string;
  telegram: {
    linked: boolean;
    username?: string;
    chatId?: number;
  };
  bot: {
    username?: string;
    link?: string;
  };
}
