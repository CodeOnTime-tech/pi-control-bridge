import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { eventsQueuePath } from "../shared/config.ts";
import type { SessionEventPayload } from "../shared/types.ts";

export interface QueuedEvent {
  externalSessionId: string;
  event: SessionEventPayload;
  attempts: number;
}

export class RetryQueue {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = eventsQueuePath(dataDir);
  }

  load(): QueuedEvent[] {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, "utf-8").split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as QueuedEvent);
  }

  persist(events: QueuedEvent[]): void {
    if (events.length === 0) {
      writeFileSync(this.filePath, "", "utf-8");
      return;
    }
    writeFileSync(
      this.filePath,
      events.map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf-8",
    );
  }

  enqueue(event: QueuedEvent): void {
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf-8");
  }
}
