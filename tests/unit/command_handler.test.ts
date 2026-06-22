import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { executeCommand } from "../../extension/command_handler.ts";
import { takePendingUserPrompt } from "../../extension/pending_user_prompt.ts";
import type { PendingCommand } from "../../shared/types.ts";

function makeContext(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    isIdle: () => true,
    abort: vi.fn(),
    shutdown: vi.fn(),
    sessionManager: {
      getSessionId: () => "local-1",
    },
    ...overrides,
  } as ExtensionContext;
}

describe("executeCommand", () => {
  it("sends prompt when idle", () => {
    const sendUserMessage = vi.fn();
    const pi = { sendUserMessage } as unknown as ExtensionAPI;
    const ctx = makeContext({ isIdle: () => true });

    const command: PendingCommand = {
      commandId: "1",
      hubSessionId: "hub",
      kind: "prompt",
      payload: { text: "hello" },
      queuedAt: new Date().toISOString(),
    };

    executeCommand(pi, ctx, command);
    expect(sendUserMessage).toHaveBeenCalledWith("hello");
    expect(takePendingUserPrompt("local-1")).toEqual({
      text: "hello",
      origin: "telegram",
    });
  });

  it("steers prompt when busy", () => {
    const sendUserMessage = vi.fn();
    const pi = { sendUserMessage } as unknown as ExtensionAPI;
    const ctx = makeContext({ isIdle: () => false });

    executeCommand(pi, ctx, {
      commandId: "2",
      hubSessionId: "hub",
      kind: "prompt",
      payload: { text: "stop and do this" },
      queuedAt: new Date().toISOString(),
    });

    expect(sendUserMessage).toHaveBeenCalledWith("stop and do this", { deliverAs: "steer" });
  });

  it("aborts on interrupt", () => {
    const abort = vi.fn();
    const ctx = makeContext({ abort });
    executeCommand({ sendUserMessage: vi.fn() } as unknown as ExtensionAPI, ctx, {
      commandId: "3",
      hubSessionId: "hub",
      kind: "interrupt",
      payload: null,
      queuedAt: new Date().toISOString(),
    });
    expect(abort).toHaveBeenCalled();
  });
});
