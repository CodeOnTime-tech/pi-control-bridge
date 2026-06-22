import { describe, expect, it } from "vitest";

import {
  clearPendingUserPrompt,
  peekPendingUserPrompt,
  setPendingUserPrompt,
  takePendingUserPrompt,
} from "../../extension/pending_user_prompt.ts";

describe("pending_user_prompt", () => {
  it("stores and returns the prompt once", () => {
    setPendingUserPrompt("sess-1", "current prompt");

    expect(peekPendingUserPrompt("sess-1")).toEqual({
      text: "current prompt",
      origin: "local",
    });
    expect(takePendingUserPrompt("sess-1")).toEqual({
      text: "current prompt",
      origin: "local",
    });
    expect(takePendingUserPrompt("sess-1")).toBeUndefined();
  });

  it("tracks telegram origin separately", () => {
    setPendingUserPrompt("sess-2", "from telegram", "telegram");

    expect(peekPendingUserPrompt("sess-2")).toEqual({
      text: "from telegram",
      origin: "telegram",
    });
  });

  it("ignores empty prompts", () => {
    setPendingUserPrompt("sess-3", "   ");

    expect(peekPendingUserPrompt("sess-3")).toBeUndefined();
  });

  it("clears pending prompt for a session", () => {
    setPendingUserPrompt("sess-4", "hello");
    clearPendingUserPrompt("sess-4");

    expect(takePendingUserPrompt("sess-4")).toBeUndefined();
  });
});
