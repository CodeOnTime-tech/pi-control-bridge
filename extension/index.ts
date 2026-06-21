import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerHooks } from "./hooks.ts";

const INSTALLED = Symbol.for("pi-control-bridge.installed");

export default function piControlBridgeExtension(pi: ExtensionAPI): void {
  const globalState = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (globalState[INSTALLED]) return;
  globalState[INSTALLED] = true;
  registerHooks(pi);
}
