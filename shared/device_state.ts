import type { DeviceState } from "./types.ts";

/** Whether the bridge should call GET /me to probe Telegram link state. */
export function shouldProbeTelegramLink(state: DeviceState | null | undefined): boolean {
  if (!state?.deviceToken) return false;
  return state.telegramBindPending === true || state.telegramLinked === true;
}

export function hasDeviceCredentials(state: DeviceState | null | undefined): boolean {
  return Boolean(state?.deviceToken);
}

export function isDeviceRegisteredOnHub(
  state: DeviceState | null | undefined,
  fingerprint: string,
  hubUrl: string,
): boolean {
  return Boolean(
    state?.deviceId &&
      state.deviceToken &&
      state.fingerprint === fingerprint &&
      state.hubUrl === hubUrl,
  );
}

export function clearDeviceCredentials(state: DeviceState): DeviceState {
  return {
    ...state,
    deviceId: "",
    deviceToken: "",
    telegramLinked: false,
    telegramBindPending: false,
  };
}
