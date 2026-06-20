import { describe, expect, it } from "vitest";

import { sessionStatusFromContext } from "../../extension/session_status.ts";

describe("sessionStatusFromContext", () => {
  it("returns waiting_user when idle", () => {
    expect(sessionStatusFromContext({ isIdle: () => true })).toBe("waiting_user");
  });

  it("returns running when busy", () => {
    expect(sessionStatusFromContext({ isIdle: () => false })).toBe("running");
  });
});
