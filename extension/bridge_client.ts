import { getBridgeConfig, getIpcBaseUrl } from "./ensure_bridge.ts";
import type {
  BridgeStatus,
  PendingCommand,
  RegisterSessionRequest,
  RegisterSessionResponse,
  SessionEventPayload,
} from "../shared/types.ts";

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

export async function createTelegramLinkToken(): Promise<{ token: string; expires_at: string }> {
  const config = await getBridgeStatus();
  if (!config.deviceId) {
    throw new Error("Bridge device not registered");
  }
  const hubUrl = getBridgeConfig().hubUrl;
  const response = await fetch(`${hubUrl}/telegram/link-token`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Link token request failed: ${response.status}`);
  }
  return (await response.json()) as { token: string; expires_at: string };
}
