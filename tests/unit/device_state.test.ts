import { describe, expect, it } from "vitest";

import {
  clearDeviceCredentials,
  isDeviceRegisteredOnHub,
  shouldProbeTelegramLink,
} from "../../shared/device_state.ts";
import type { DeviceState } from "../../shared/types.ts";

const baseState: DeviceState = {
  deviceId: "device-1",
  deviceToken: "token-1",
  fingerprint: "fp-1",
  hubUrl: "http://127.0.0.1:8000",
};

describe("shouldProbeTelegramLink", () => {
  it("returns false without device token", () => {
    expect(shouldProbeTelegramLink(null)).toBe(false);
    expect(shouldProbeTelegramLink({ ...baseState, deviceToken: "" })).toBe(false);
  });

  it("returns false when bind is not pending and telegram is not linked", () => {
    expect(shouldProbeTelegramLink(baseState)).toBe(false);
  });

  it("returns true while bind is pending or telegram is linked", () => {
    expect(shouldProbeTelegramLink({ ...baseState, telegramBindPending: true })).toBe(true);
    expect(shouldProbeTelegramLink({ ...baseState, telegramLinked: true })).toBe(true);
  });
});

describe("clearDeviceCredentials", () => {
  it("clears hub credentials and telegram flags", () => {
    const cleared = clearDeviceCredentials({
      ...baseState,
      telegramBindPending: true,
      telegramLinked: true,
    });
    expect(cleared.deviceToken).toBe("");
    expect(cleared.deviceId).toBe("");
    expect(cleared.telegramBindPending).toBe(false);
    expect(cleared.telegramLinked).toBe(false);
  });
});

describe("isDeviceRegisteredOnHub", () => {
  it("returns true when credentials match current fingerprint and hub", () => {
    expect(isDeviceRegisteredOnHub(baseState, "fp-1", "http://127.0.0.1:8000")).toBe(true);
  });

  it("returns false when fingerprint or hub differs", () => {
    expect(isDeviceRegisteredOnHub(baseState, "fp-2", "http://127.0.0.1:8000")).toBe(false);
    expect(isDeviceRegisteredOnHub(baseState, "fp-1", "http://example.com")).toBe(false);
    expect(isDeviceRegisteredOnHub(null, "fp-1", "http://127.0.0.1:8000")).toBe(false);
  });
});
