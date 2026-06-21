import { basename } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { stripAnsi } from "../shared/ansi.ts";

const DESCRIPTION_MAX_LEN = 240;

function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) parts.push(trimmed);
      continue;
    }
    if (item && typeof item === "object") {
      const block = item as { type?: string; text?: string };
      if (block.type === "text" && typeof block.text === "string") {
        const trimmed = block.text.trim();
        if (trimmed) parts.push(trimmed);
      }
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

function extractUserMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { role?: string; content?: unknown };
  if (candidate.role !== "user") return undefined;
  return extractTextContent(candidate.content);
}

function extractAssistantMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { role?: string; content?: unknown };
  if (candidate.role !== "assistant") return undefined;
  return extractTextContent(candidate.content);
}

export function extractFirstUserPrompt(ctx: ExtensionContext): string | undefined {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message") continue;
    const text = extractUserMessageText(entry.message);
    if (text) return truncate(text, DESCRIPTION_MAX_LEN);
  }
  return undefined;
}

export function extractLatestUserPromptFromSession(ctx: ExtensionContext): string | undefined {
  const entries = ctx.sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "message") continue;
    const text = extractUserMessageText(entry.message);
    if (text) return text.trim();
  }
  return undefined;
}

export function extractLatestUserPromptFromMessages(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractUserMessageText(messages[index]);
    if (text) return truncate(text, DESCRIPTION_MAX_LEN);
  }
  return undefined;
}

export function extractLatestAssistantResponseFromMessages(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractAssistantMessageText(messages[index]);
    if (!text) continue;
    const cleaned = stripAnsi(text).trim();
    if (cleaned) return cleaned;
  }
  return undefined;
}

export function buildSessionMetadata(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options?: { messages?: unknown[] },
): Record<string, string> {
  const metadata: Record<string, string> = {};

  const title = pi.getSessionName()?.trim();
  if (title) metadata.title = title;

  const description =
    (options?.messages ? extractLatestUserPromptFromMessages(options.messages) : undefined) ??
    extractFirstUserPrompt(ctx);
  if (description) metadata.description = description;

  const projectBasename = basename(ctx.cwd);
  if (projectBasename) metadata.projectBasename = projectBasename;

  metadata.mode = ctx.mode;

  return metadata;
}
