import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SessionStatus = "waiting_user" | "running";

/** Session start and other idle/busy boundaries where isIdle() reflects UI state. */
export function sessionStatusFromContext(ctx: Pick<ExtensionContext, "isIdle">): SessionStatus {
  return ctx.isIdle() ? "waiting_user" : "running";
}

/**
 * Status after a user prompt completes (agent_end).
 * Pi may still report isStreaming=true inside agent_end handlers, so use the
 * pending message queue instead: no queued steer/follow-up means waiting for user.
 */
export function sessionStatusAfterAgentEnd(
  ctx: Pick<ExtensionContext, "hasPendingMessages">,
): SessionStatus {
  return ctx.hasPendingMessages() ? "running" : "waiting_user";
}
