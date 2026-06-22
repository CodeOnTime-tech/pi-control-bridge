export type PromptOrigin = "local" | "telegram";

interface PendingPrompt {
  text: string;
  origin: PromptOrigin;
}

const pendingBySession = new Map<string, PendingPrompt>();

export function setPendingUserPrompt(
  sessionId: string,
  prompt: string,
  origin: PromptOrigin = "local",
): void {
  const text = prompt.trim();
  if (!text) return;
  pendingBySession.set(sessionId, { text, origin });
}

export function peekPendingUserPrompt(sessionId: string): PendingPrompt | undefined {
  return pendingBySession.get(sessionId);
}

export function takePendingUserPrompt(sessionId: string): PendingPrompt | undefined {
  const prompt = pendingBySession.get(sessionId);
  pendingBySession.delete(sessionId);
  return prompt;
}

export function clearPendingUserPrompt(sessionId: string): void {
  pendingBySession.delete(sessionId);
}
