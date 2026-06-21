import { describe, expect, it } from "vitest";

import {
  clearPendingUserPrompt,
  setPendingUserPrompt,
  takePendingUserPrompt,
} from "../../extension/pending_user_prompt.ts";

describe("pending_user_prompt", () => {
  it("stores and returns the prompt once", () => {
    setPendingUserPrompt("sess-1", "current prompt");

    expect(takePendingUserPrompt("sess-1")).toBe("current prompt");
    expect(takePendingUserPrompt("sess-1")).toBeUndefined();
  });

  it("ignores empty prompts", () => {
    setPendingUserPrompt("sess-2", "   ");

    expect(takePendingUserPrompt("sess-2")).toBeUndefined();
  });

  it("clears pending prompt for a session", () => {
    setPendingUserPrompt("sess-3", "hello");
    clearPendingUserPrompt("sess-3");

    expect(takePendingUserPrompt("sess-3")).toBeUndefined();
  });
});
