import { getIpcBaseUrl } from "./ensure_bridge.ts";
import type {
  BridgeStatus,
  ControlStatus,
  PendingCommand,
  RegisterSessionRequest,
  RegisterSessionResponse,
  SessionEventPayload,
} from "../shared/types.ts";
import type { TelegramLinkResponse } from "../shared/telegram.ts";

async function ipcRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const response = await fetch(`${getIpcBaseUrl()}${path}`, init);
  if (response.status === 204) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`IPC ${path} failed: ${response.status} ${text}`);
  }
  return (await response.json()) as T;
}

export async function listBridgeSessions(): Promise<Array<{ localId: string }>> {
  const result = await ipcRequest<{ items: Array<{ localId: string }> }>("/sessions");
  return result?.items ?? [];
}

export async function registerSession(
  payload: RegisterSessionRequest,
): Promise<RegisterSessionResponse> {
  return ipcRequest<RegisterSessionResponse>("/sessions/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }) as Promise<RegisterSessionResponse>;
}

export async function unregisterSession(localId: string): Promise<void> {
  await ipcRequest(`/sessions/${encodeURIComponent(localId)}`, {
    method: "DELETE",
  });
}

export async function requestBridgeShutdownIfIdle(): Promise<void> {
  await ipcRequest("/shutdown-if-idle", { method: "POST" });
}

export async function postSessionEvent(
  localId: string,
  event: SessionEventPayload,
): Promise<void> {
  await ipcRequest(`/sessions/${encodeURIComponent(localId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}

export async function waitForCommand(localId: string): Promise<PendingCommand | null> {
  return ipcRequest<PendingCommand>(
    `/sessions/${encodeURIComponent(localId)}/commands/wait`,
  );
}

export async function getBridgeStatus(): Promise<BridgeStatus & { version?: string }> {
  return ipcRequest<BridgeStatus & { version?: string }>("/health") as Promise<
    BridgeStatus & { version?: string }
  >;
}

export async function getControlStatus(): Promise<ControlStatus> {
  return ipcRequest<ControlStatus>("/connection-status") as Promise<ControlStatus>;
}

export async function createTelegramLinkToken(): Promise<TelegramLinkResponse> {
  return ipcRequest<TelegramLinkResponse>("/telegram/link-token", {
    method: "POST",
  }) as Promise<TelegramLinkResponse>;
}
