import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerHooks } from "./hooks.ts";

export default function piControlBridgeExtension(pi: ExtensionAPI): void {
  registerHooks(pi);
}
