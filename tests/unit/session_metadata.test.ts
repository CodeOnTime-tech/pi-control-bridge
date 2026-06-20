import { describe, expect, it } from "vitest";

import {
  buildSessionMetadata,
  extractFirstUserPrompt,
  extractLatestUserPromptFromMessages,
} from "../../extension/session_metadata.ts";

describe("session_metadata", () => {
  it("returns latest user prompt from agent messages", () => {
    const text = extractLatestUserPromptFromMessages([
      { role: "user", content: "first prompt" },
      { role: "assistant", content: "working" },
      { role: "user", content: "second prompt" },
    ]);
    expect(text).toBe("second prompt");
  });

  it("builds metadata with title, description and mode", () => {
    const pi = { getSessionName: () => "Fix auth bug" };
    const ctx = {
      cwd: "/home/user/pi-control-bridge",
      mode: "tui",
      sessionManager: {
        getEntries: () => [{ type: "message", message: { role: "user", content: "sync sessions" } }],
      },
    };

    expect(buildSessionMetadata(pi as never, ctx as never)).toEqual({
      title: "Fix auth bug",
      description: "sync sessions",
      projectBasename: "pi-control-bridge",
      mode: "tui",
    });
  });

  it("extractFirstUserPrompt reads session entries", () => {
    const ctx = {
      sessionManager: {
        getEntries: () => [
          { type: "model_change" },
          { type: "message", message: { role: "assistant", content: "hi" } },
          { type: "message", message: { role: "user", content: "first user ask" } },
        ],
      },
    };

    expect(extractFirstUserPrompt(ctx as never)).toBe("first user ask");
  });
});
