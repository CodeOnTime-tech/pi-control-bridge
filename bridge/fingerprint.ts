import { createHash } from "node:crypto";
import { hostname, platform } from "node:os";
import { readFileSync } from "node:fs";

export function computeDeviceFingerprint(): string {
  const parts = [hostname(), platform()];
  for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const value = readFileSync(path, "utf-8").trim();
      if (value) {
        parts.push(value);
        break;
      }
    } catch {
      // ignore missing machine-id
    }
  }
  return createHash("sha256").update(parts.join(":")).digest("hex");
}
