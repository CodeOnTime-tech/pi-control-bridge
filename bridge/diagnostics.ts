/** Runtime diagnostics for bridge polling and command delivery. */
export class BridgeDiagnostics {
  lastPollAt?: string;
  lastCommandReceivedAt?: string;
  lastPollError?: string;

  markPollStarted(): void {
    this.lastPollAt = new Date().toISOString();
    this.lastPollError = undefined;
  }

  markCommandReceived(): void {
    this.lastCommandReceivedAt = new Date().toISOString();
  }

  markPollFailed(error: string): void {
    this.lastPollError = error;
  }
}
