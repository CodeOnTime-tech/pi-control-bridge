import { describe, expect, it } from "vitest";

import {
  sessionStatusAfterAgentEnd,
  sessionStatusFromContext,
} from "../../extension/session_status.ts";

describe("sessionStatusFromContext", () => {
  it("returns waiting_user when idle", () => {
    expect(sessionStatusFromContext({ isIdle: () => true })).toBe("waiting_user");
  });

  it("returns running when busy", () => {
    expect(sessionStatusFromContext({ isIdle: () => false })).toBe("running");
  });
});

describe("sessionStatusAfterAgentEnd", () => {
  it("returns waiting_user when no follow-up messages are queued", () => {
    expect(sessionStatusAfterAgentEnd({ hasPendingMessages: () => false })).toBe("waiting_user");
  });

  it("returns running when steer or follow-up messages are queued", () => {
    expect(sessionStatusAfterAgentEnd({ hasPendingMessages: () => true })).toBe("running");
  });
});
