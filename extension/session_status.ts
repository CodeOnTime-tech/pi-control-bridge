import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SessionStatus = "waiting_user" | "running";

export function sessionStatusFromContext(ctx: Pick<ExtensionContext, "isIdle">): SessionStatus {
  return ctx.isIdle() ? "waiting_user" : "running";
}
