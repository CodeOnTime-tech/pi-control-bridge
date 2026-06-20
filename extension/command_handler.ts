import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PendingCommand } from "../shared/types.ts";

export function executeCommand(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  command: PendingCommand,
): void {
  switch (command.kind) {
    case "prompt": {
      const text = String(command.payload?.text ?? "");
      if (!text) return;
      if (ctx.isIdle()) {
        pi.sendUserMessage(text);
      } else {
        pi.sendUserMessage(text, { deliverAs: "steer" });
      }
      break;
    }
    case "interrupt":
      ctx.abort();
      break;
    case "stop":
      ctx.shutdown();
      break;
    case "ping":
      break;
    default:
      console.error(
        JSON.stringify({
          level: "WARN",
          message: "Unknown bridge command kind",
          kind: command.kind,
          commandId: command.commandId,
        }),
      );
  }
}
