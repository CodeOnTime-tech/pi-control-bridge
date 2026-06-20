import type { LocalSessionRecord, PendingCommand } from "../shared/types.ts";

export class SessionRegistry {
  private readonly sessions = new Map<string, LocalSessionRecord>();
  private readonly hubToLocal = new Map<string, string>();
  private readonly commandQueues = new Map<string, PendingCommand[]>();
  private readonly commandWaiters = new Map<
    string,
    Array<(command: PendingCommand | null) => void>
  >();

  register(session: LocalSessionRecord): void {
    this.sessions.set(session.localId, session);
    if (!session.hubPending) {
      this.hubToLocal.set(session.hubSessionId, session.localId);
    }
    if (!this.commandQueues.has(session.localId)) {
      this.commandQueues.set(session.localId, []);
    }
  }

  markHubSynced(localId: string, hubSessionId: string): void {
    const session = this.sessions.get(localId);
    if (!session) return;
    if (!session.hubPending) {
      this.hubToLocal.delete(session.hubSessionId);
    }
    session.hubSessionId = hubSessionId;
    session.hubPending = false;
    this.hubToLocal.set(hubSessionId, localId);
  }

  listPendingHubSync(): LocalSessionRecord[] {
    return this.list().filter((session) => session.hubPending);
  }

  unregister(localId: string): void {
    const session = this.sessions.get(localId);
    if (session) {
      this.hubToLocal.delete(session.hubSessionId);
    }
    this.sessions.delete(localId);
    this.commandQueues.delete(localId);
    this.resolveWaiters(localId, null);
  }

  getByLocalId(localId: string): LocalSessionRecord | undefined {
    return this.sessions.get(localId);
  }

  getLocalIdByHubSessionId(hubSessionId: string): string | undefined {
    return this.hubToLocal.get(hubSessionId);
  }

  list(): LocalSessionRecord[] {
    return [...this.sessions.values()];
  }

  size(): number {
    return this.sessions.size;
  }

  enqueueCommand(localId: string, command: PendingCommand): boolean {
    const queue = this.commandQueues.get(localId);
    if (!queue) return false;
    queue.push(command);
    this.resolveWaiters(localId, command);
    return true;
  }

  async waitForCommand(localId: string, timeoutMs: number): Promise<PendingCommand | null> {
    const queue = this.commandQueues.get(localId);
    if (!queue) return null;
    const existing = queue.shift();
    if (existing) return existing;

    return new Promise((resolve) => {
      const waiters = this.commandWaiters.get(localId) ?? [];
      waiters.push(resolve);
      this.commandWaiters.set(localId, waiters);

      setTimeout(() => {
        const current = this.commandWaiters.get(localId);
        if (!current) return;
        const index = current.indexOf(resolve);
        if (index >= 0) {
          current.splice(index, 1);
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  private resolveWaiters(localId: string, command: PendingCommand | null): void {
    const waiters = this.commandWaiters.get(localId);
    if (!waiters?.length) return;
    this.commandWaiters.set(localId, []);
    for (const resolve of waiters) {
      resolve(command);
    }
  }
}
