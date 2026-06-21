const pendingBySession = new Map<string, string>();

export function setPendingUserPrompt(sessionId: string, prompt: string): void {
  const text = prompt.trim();
  if (!text) return;
  pendingBySession.set(sessionId, text);
}

export function takePendingUserPrompt(sessionId: string): string | undefined {
  const prompt = pendingBySession.get(sessionId);
  pendingBySession.delete(sessionId);
  return prompt;
}

export function clearPendingUserPrompt(sessionId: string): void {
  pendingBySession.delete(sessionId);
}
