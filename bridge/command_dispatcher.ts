import type { Logger } from "../shared/logger.ts";
import type { PendingCommand } from "../shared/types.ts";
import type { BackendClient, HubCommand } from "./backend_client.ts";
import type { SessionRegistry } from "./registry.ts";

export class CommandDispatcher {
  /** Commands already enqueued locally — ack hub without re-enqueue on redelivery. */
  private readonly enqueuedCommandIds = new Set<string>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly backend: BackendClient,
    private readonly logger: Logger,
    private getDeviceToken: () => string | undefined,
  ) {}

  async dispatch(command: HubCommand): Promise<void> {
    if (this.enqueuedCommandIds.has(command.command_id)) {
      await this.ack(command.command_id);
      return;
    }

    const localId = this.registry.getLocalIdByHubSessionId(command.session_id);
    const pending: PendingCommand = {
      commandId: command.command_id,
      hubSessionId: command.session_id,
      kind: command.kind,
      payload: command.payload,
      queuedAt: new Date().toISOString(),
    };

    if (!localId) {
      this.logger.warn("Command session not found locally, will retry on next poll", {
        commandId: command.command_id,
        hubSessionId: command.session_id,
      });
      return;
    }

    const accepted = this.registry.enqueueCommand(localId, pending);
    if (!accepted) {
      this.logger.warn("Failed to enqueue command", {
        commandId: command.command_id,
        localId,
      });
      return;
    }

    this.enqueuedCommandIds.add(command.command_id);
    await this.ack(command.command_id);
  }

  retryHeldCommands(): void {
    // Hub redelivers undelivered / unacked commands on the next poll.
  }

  private async ack(commandId: string): Promise<void> {
    const token = this.getDeviceToken();
    if (!token) return;
    try {
      await this.backend.ackCommand(commandId, token);
      this.logger.info("Command acked", {
        commandId,
        correlationId: this.backend.getLastCorrelationId(),
      });
    } catch (error) {
      this.logger.warn("Command ack failed", { commandId, error: String(error) });
    }
  }
}
