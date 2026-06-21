import { describe, expect, it, vi } from "vitest";

import { CommandDispatcher } from "../../bridge/command_dispatcher.ts";
import { SessionRegistry } from "../../bridge/registry.ts";
import type { BackendClient } from "../../bridge/backend_client.ts";
import { Logger } from "../../shared/logger.ts";

function makeDispatcher(registry: SessionRegistry) {
  const ackCommand = vi.fn().mockResolvedValue(undefined);
  const backend = {
    ackCommand,
    getLastCorrelationId: () => "corr-1",
  } as unknown as BackendClient;
  const dispatcher = new CommandDispatcher(
    registry,
    backend,
    new Logger("ERROR"),
    () => "device-token",
  );
  return { dispatcher, ackCommand };
}

describe("CommandDispatcher", () => {
  it("does not ack when hub session is unknown locally", async () => {
    const registry = new SessionRegistry();
    const { dispatcher, ackCommand } = makeDispatcher(registry);

    await dispatcher.dispatch({
      command_id: "cmd-1",
      session_id: "missing-hub-session",
      kind: "prompt",
      payload: { text: "hello" },
    });

    expect(ackCommand).not.toHaveBeenCalled();
    expect(dispatcher.heldCommandsCount()).toBe(1);
  });

  it("retries held commands after hub session sync", async () => {
    const registry = new SessionRegistry();
    registry.register({
      localId: "local-1",
      externalSessionId: "ext-1",
      hubSessionId: "local-1",
      cwd: "/tmp",
      pid: 1,
      mode: "tui",
      registeredAt: new Date().toISOString(),
      hubPending: true,
    });
    const { dispatcher, ackCommand } = makeDispatcher(registry);

    await dispatcher.dispatch({
      command_id: "cmd-held",
      session_id: "hub-real",
      kind: "prompt",
      payload: { text: "retry me" },
    });
    expect(ackCommand).not.toHaveBeenCalled();
    expect(dispatcher.heldCommandsCount()).toBe(1);

    registry.markHubSynced("local-1", "hub-real");
    await dispatcher.retryHeldCommands();

    expect(ackCommand).toHaveBeenCalledOnce();
    expect(dispatcher.heldCommandsCount()).toBe(0);
    const pending = await registry.waitForCommand("local-1", 50);
    expect(pending?.commandId).toBe("cmd-held");
  });

  it("acks after enqueue and deduplicates redelivery", async () => {
    const registry = new SessionRegistry();
    registry.register({
      localId: "local-1",
      externalSessionId: "ext-1",
      hubSessionId: "hub-1",
      cwd: "/tmp",
      pid: 1,
      mode: "tui",
      registeredAt: new Date().toISOString(),
    });
    const { dispatcher, ackCommand } = makeDispatcher(registry);

    const command = {
      command_id: "cmd-2",
      session_id: "hub-1",
      kind: "prompt",
      payload: { text: "hello" },
    };

    await dispatcher.dispatch(command);
    await dispatcher.dispatch(command);

    expect(ackCommand).toHaveBeenCalledTimes(2);
    const pending = await registry.waitForCommand("local-1", 50);
    expect(pending?.commandId).toBe("cmd-2");
  });

  it("preserves hub mapping when re-registering a synced session", () => {
    const registry = new SessionRegistry();
    registry.register({
      localId: "local-1",
      externalSessionId: "ext-1",
      hubSessionId: "hub-1",
      cwd: "/tmp",
      pid: 1,
      mode: "tui",
      registeredAt: new Date().toISOString(),
    });

    registry.register({
      localId: "local-1",
      externalSessionId: "ext-1",
      hubSessionId: "local-1",
      cwd: "/tmp",
      pid: 1,
      mode: "tui",
      registeredAt: new Date().toISOString(),
      hubPending: true,
    });

    expect(registry.getLocalIdByHubSessionId("hub-1")).toBe("local-1");
  });
});
