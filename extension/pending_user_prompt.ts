export type PromptOrigin = "local" | "telegram";

interface PendingPrompt {
  text: string;
  origin: PromptOrigin;
}

const pendingBySession = new Map<string, PendingPrompt[]>();

function getQueue(sessionId: string): PendingPrompt[] {
  let queue = pendingBySession.get(sessionId);
  if (!queue) {
    queue = [];
    pendingBySession.set(sessionId, queue);
  }
  return queue;
}

export function setPendingUserPrompt(
  sessionId: string,
  prompt: string,
  origin: PromptOrigin = "local",
): void {
  const text = prompt.trim();
  if (!text) return;
  getQueue(sessionId).push({ text, origin });
}

export function peekPendingUserPrompt(sessionId: string): PendingPrompt | undefined {
  return pendingBySession.get(sessionId)?.[0];
}

export function takePendingUserPrompt(sessionId: string): PendingPrompt | undefined {
  const queue = pendingBySession.get(sessionId);
  if (!queue?.length) return undefined;
  const prompt = queue.shift();
  if (queue.length === 0) {
    pendingBySession.delete(sessionId);
  }
  return prompt;
}

export function clearPendingUserPrompt(sessionId: string): void {
  pendingBySession.delete(sessionId);
}
