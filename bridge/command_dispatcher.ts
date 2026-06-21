import type { Logger } from "../shared/logger.ts";
import type { PendingCommand } from "../shared/types.ts";
import type { BackendClient, HubCommand } from "./backend_client.ts";
import type { SessionRegistry } from "./registry.ts";

export class CommandDispatcher {
  /** Commands already enqueued locally — ack hub without re-enqueue on redelivery. */
  private readonly enqueuedCommandIds = new Set<string>();
  /** Commands waiting for hub session mapping (hubSessionId → localId). */
  private readonly heldCommands = new Map<string, HubCommand>();

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
      this.heldCommands.set(command.command_id, command);
      this.logger.warn("Command session not found locally, holding for retry", {
        commandId: command.command_id,
        hubSessionId: command.session_id,
        kind: command.kind,
        heldCount: this.heldCommands.size,
        knownHubSessions: this.registry.getSessionMappings(),
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

    this.heldCommands.delete(command.command_id);
    this.enqueuedCommandIds.add(command.command_id);
    await this.ack(command.command_id);
  }

  async retryHeldCommands(): Promise<void> {
    if (this.heldCommands.size === 0) return;

    const held = [...this.heldCommands.values()];
    this.logger.info("Retrying held commands after session sync", {
      count: held.length,
      knownHubSessions: this.registry.getSessionMappings(),
    });

    for (const command of held) {
      await this.dispatch(command);
    }
  }

  heldCommandsCount(): number {
    return this.heldCommands.size;
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
