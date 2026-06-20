import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { stateFilePath } from "../shared/config.ts";
import type { DeviceState } from "../shared/types.ts";

export class DeviceStateStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.filePath = stateFilePath(dataDir);
  }

  load(): DeviceState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as DeviceState;
    } catch {
      return null;
    }
  }

  save(state: DeviceState): void {
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    chmodSync(this.filePath, 0o600);
  }
}
