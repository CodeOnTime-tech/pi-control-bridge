import {
  COMMAND_RETRY_ATTEMPTS,
  COMMAND_RETRY_DELAY_MS,
} from "../shared/constants.ts";
import type { Logger } from "../shared/logger.ts";
import type { PendingCommand } from "../shared/types.ts";
import type { BackendClient, HubCommand } from "./backend_client.ts";
import type { SessionRegistry } from "./registry.ts";

interface HeldCommand {
  command: HubCommand;
  attempts: number;
}

export class CommandDispatcher {
  private readonly held = new Map<string, HeldCommand>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly backend: BackendClient,
    private readonly logger: Logger,
    private getDeviceToken: () => string | undefined,
  ) {}

  async dispatch(command: HubCommand): Promise<void> {
    const localId = this.registry.getLocalIdByHubSessionId(command.session_id);
    const pending: PendingCommand = {
      commandId: command.command_id,
      hubSessionId: command.session_id,
      kind: command.kind,
      payload: command.payload,
      queuedAt: new Date().toISOString(),
    };

    if (!localId) {
      const held = this.held.get(command.command_id) ?? {
        command,
        attempts: 0,
      };
      held.attempts += 1;
      this.held.set(command.command_id, held);
      this.logger.warn("Command session not found locally, holding", {
        commandId: command.command_id,
        hubSessionId: command.session_id,
        attempts: held.attempts,
      });
      if (held.attempts >= COMMAND_RETRY_ATTEMPTS) {
        this.logger.error("Command dropped after retries", {
          commandId: command.command_id,
        });
        this.held.delete(command.command_id);
        await this.ack(command.command_id);
      }
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

    await this.ack(command.command_id);
    this.held.delete(command.command_id);
  }

  retryHeldCommands(): void {
    for (const [commandId, held] of [...this.held.entries()]) {
      const localId = this.registry.getLocalIdByHubSessionId(held.command.session_id);
      if (!localId) continue;
      void this.dispatch(held.command).finally(() => {
        if (this.held.has(commandId)) {
          setTimeout(() => this.retryHeldCommands(), COMMAND_RETRY_DELAY_MS);
        }
      });
    }
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
