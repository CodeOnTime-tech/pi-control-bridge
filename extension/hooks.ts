import { randomUUID } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  createTelegramLinkToken,
  getBridgeStatus,
  getControlStatus,
  listBridgeSessions,
  postSessionEvent,
  registerSession,
  requestBridgeShutdownIfIdle,
  unregisterSession,
  waitForCommand,
} from "./bridge_client.ts";
import { executeCommand } from "./command_handler.ts";
import { ensureBridge, setBridgeConfigCwd } from "./ensure_bridge.ts";
import { stripAnsi } from "../shared/ansi.ts";
import { formatConnectTelegramMessage, formatControlStatusMessage } from "./messages.ts";
import {
  clearPendingUserPrompt,
  peekPendingUserPrompt,
  setPendingUserPrompt,
  takePendingUserPrompt,
} from "./pending_user_prompt.ts";
import {
  buildSessionMetadata,
  extractAssistantMessageText,
  extractUserMessageText,
  isFinalAssistantTurn,
} from "./session_metadata.ts";
import type { PromptOrigin } from "./pending_user_prompt.ts";
import { sessionStatusAfterAgentEnd, sessionStatusFromContext } from "./session_status.ts";

interface SessionBinding {
  localId: string;
  consumerAbort: AbortController;
}

const sessions = new Map<string, SessionBinding>();
const lastPostedUserPromptBySession = new Map<string, string>();
let degradedNotified = false;

function isEphemeral(ctx: ExtensionContext): boolean {
  return ctx.sessionManager.getSessionFile() === undefined;
}

function isSessionMissingError(error: unknown): boolean {
  const text = String(error);
  return text.includes("404") || text.includes("Session not found");
}

async function postEvent(
  localId: string,
  eventType: string,
  status?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  if (!sessions.has(localId)) return;
  try {
    await postSessionEvent(localId, {
      eventType,
      status,
      payload,
      eventId: randomUUID(),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "WARN",
        message: "Failed to post bridge event",
        eventType,
        error: String(error),
      }),
    );
  }
}

async function postSessionMetadata(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  localId: string,
  options?: { messages?: unknown[] },
): Promise<void> {
  const payload = buildSessionMetadata(pi, ctx, options);
  if (Object.keys(payload).length === 0) return;
  await postEvent(localId, "session_metadata", undefined, payload);
}

async function registerWithBridge(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const localId = ctx.sessionManager.getSessionId();
  const status = sessionStatusFromContext(ctx);
  await registerSession({
    localId,
    externalSessionId: localId,
    cwd: ctx.cwd,
    projectPath: ctx.cwd,
    title: pi.getSessionName(),
    pid: process.pid,
    mode: ctx.mode,
    status,
  });
}

async function isRegisteredInBridge(localId: string): Promise<boolean> {
  const items = await listBridgeSessions();
  return items.some((session) => session.localId === localId);
}

async function ensureBridgeBinding(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
  if (isEphemeral(ctx)) return false;

  setBridgeConfigCwd(ctx.cwd);
  if (!(await ensureBridge())) return false;

  const localId = ctx.sessionManager.getSessionId();

  try {
    if (!(await isRegisteredInBridge(localId))) {
      await registerWithBridge(pi, ctx);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "ERROR",
        message: "Session bridge registration failed",
        error: String(error),
      }),
    );
    return false;
  }

  return true;
}

function startCommandConsumer(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  localId: string,
  signal: AbortSignal,
): void {
  void (async () => {
    while (!signal.aborted) {
      try {
        if (!(await ensureBridgeBinding(pi, ctx))) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        const command = await waitForCommand(localId);
        if (signal.aborted) break;
        if (command) {
          executeCommand(pi, ctx, command);
        }
      } catch (error) {
        if (signal.aborted) break;
        if (isSessionMissingError(error)) {
          sessions.delete(localId);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        console.error(
          JSON.stringify({
            level: "WARN",
            message: "Command consumer error",
            error: String(error),
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  })();
}

async function handleSessionStart(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (isEphemeral(ctx)) return;

  const ready = await ensureBridge();
  if (!ready) {
    if (ctx.hasUI && !degradedNotified) {
      ctx.ui.notify("Telegram/backend integration unavailable (bridge not running)", "warning");
      degradedNotified = true;
    }
    return;
  }

  try {
    const status = await getBridgeStatus();
    if (status.degraded && ctx.hasUI && !degradedNotified) {
      ctx.ui.notify("Backend connection degraded; events will be queued locally", "warning");
      degradedNotified = true;
    }
  } catch {
    if (ctx.hasUI && !degradedNotified) {
      ctx.ui.notify("Bridge unreachable", "warning");
      degradedNotified = true;
    }
  }

  const localId = ctx.sessionManager.getSessionId();
  const existing = sessions.get(localId);
  if (existing) {
    existing.consumerAbort.abort();
    sessions.delete(localId);
  }

  if (!(await ensureBridgeBinding(pi, ctx))) {
    return;
  }

  const consumerAbort = new AbortController();
  const status = sessionStatusFromContext(ctx);
  sessions.set(localId, { localId, consumerAbort });
  startCommandConsumer(pi, ctx, localId, consumerAbort.signal);
  await postEvent(localId, "session_start", status);
  await postSessionMetadata(pi, ctx, localId);
}

async function handleSessionShutdown(ctx: ExtensionContext): Promise<void> {
  const localId = ctx.sessionManager.getSessionId();
  const binding = sessions.get(localId);

  if (binding) {
    binding.consumerAbort.abort();
    sessions.delete(localId);

    try {
      await unregisterSession(localId);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "WARN",
          message: "Session bridge unregister failed",
          error: String(error),
        }),
      );
    }
    clearPendingUserPrompt(localId);
    lastPostedUserPromptBySession.delete(localId);
  }

  if (sessions.size > 0) return;

  setBridgeConfigCwd(undefined);
  try {
    await requestBridgeShutdownIfIdle();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "WARN",
        message: "Bridge idle shutdown request failed",
        error: String(error),
      }),
    );
  }
}

export function registerHooks(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) =>
    handleSessionStart(pi, ctx).catch((error) => {
      console.error(
        JSON.stringify({
          level: "ERROR",
          message: "session_start bridge handler failed",
          error: String(error),
        }),
      );
    }),
  );

  pi.on("session_shutdown", (_event, ctx) =>
    handleSessionShutdown(ctx).catch((error) => {
      console.error(
        JSON.stringify({
          level: "ERROR",
          message: "session_shutdown bridge handler failed",
          error: String(error),
        }),
      );
    }),
  );

  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "user") return;

    const text = extractUserMessageText(event.message);
    if (!text) return;

    const localId = ctx.sessionManager.getSessionId();
    const head = peekPendingUserPrompt(localId);
    let promptOrigin: PromptOrigin = "local";
    if (head?.origin === "telegram" && head.text === text) {
      promptOrigin = "telegram";
    } else {
      setPendingUserPrompt(localId, text, "local");
    }

    if (lastPostedUserPromptBySession.get(localId) === text) return;
    lastPostedUserPromptBySession.set(localId, text);

    void postEvent(localId, "agent_start", "running", {
      userPrompt: text,
      promptOrigin,
    });
  });

  pi.on("turn_end", (event, ctx) => {
    if (!isFinalAssistantTurn(event.message)) return;

    const lastResult = extractAssistantMessageText(event.message);
    if (!lastResult) return;
    const cleanedResult = stripAnsi(lastResult).trim();
    if (!cleanedResult) return;

    const localId = ctx.sessionManager.getSessionId();
    const pending = takePendingUserPrompt(localId);
    const status = sessionStatusAfterAgentEnd(ctx);
    const payload: Record<string, unknown> = { lastResult: cleanedResult };
    if (pending) {
      payload.userPrompt = pending.text;
      payload.promptOrigin = pending.origin;
    }

    lastPostedUserPromptBySession.delete(localId);
    void postEvent(localId, "agent_end", status, payload);
    void postSessionMetadata(pi, ctx, localId, { messages: [event.message] });
  });

  pi.on("tool_execution_start", (event, ctx) => {
    void postEvent(ctx.sessionManager.getSessionId(), "tool_execution_start", "running", {
      toolName: event.toolName,
    });
  });

  pi.on("tool_execution_end", (event, ctx) => {
    void postEvent(ctx.sessionManager.getSessionId(), "tool_execution_end", "running", {
      toolName: event.toolName,
    });
  });

  pi.on("agent_end", (event, ctx) => {
    const localId = ctx.sessionManager.getSessionId();
    void postSessionMetadata(pi, ctx, localId, { messages: event.messages });
  });

  pi.registerCommand("control-status", {
    description: "Show pi-control-bridge and Telegram connection status",
    handler: async (_args, ctx) => {
      try {
        const ready = await ensureBridge();
        if (!ready) {
          const message = "Bridge is not running. Start a Pi session or run pi-bridge start.";
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.error(message);
          return;
        }

        const status = await getControlStatus();
        const message = formatControlStatusMessage(status);
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.error(message);
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`Control status error: ${String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("connect-telegram", {
    description: "Initialize Telegram control for this device",
    handler: async (_args, ctx) => {
      try {
        const ready = await ensureBridge();
        if (!ready) {
          const message = "Bridge is not running. Start a Pi session or run pi-bridge start.";
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.error(message);
          return;
        }

        const link = await createTelegramLinkToken();
        const message = formatConnectTelegramMessage(link);
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.error(message);
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`Telegram connect error: ${String(error)}`, "error");
      }
    },
  });
}
