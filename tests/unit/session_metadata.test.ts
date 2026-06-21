import { describe, expect, it } from "vitest";

import {
  buildSessionMetadata,
  extractFirstUserPrompt,
  extractLatestAssistantResponseFromMessages,
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

  it("returns latest assistant response from agent messages", () => {
    const text = extractLatestAssistantResponseFromMessages([
      { role: "user", content: "fix auth" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "also add tests" },
      { role: "assistant", content: "Done. Added tests for middleware." },
    ]);
    expect(text).toBe("Done. Added tests for middleware.");
  });

  it("ignores user messages when extracting assistant response", () => {
    const text = extractLatestAssistantResponseFromMessages([{ role: "user", content: "only prompt" }]);
    expect(text).toBeUndefined();
  });

  it("extracts text blocks from assistant content arrays", () => {
    const text = extractLatestAssistantResponseFromMessages([
      {
        role: "assistant",
        content: [{ type: "text", text: "Refactoring complete." }],
      },
    ]);
    expect(text).toBe("Refactoring complete.");
  });

  it("strips ANSI codes from assistant response", () => {
    const text = extractLatestAssistantResponseFromMessages([
      { role: "assistant", content: "\x1b[1;96mRefactoring complete.\x1b[0m" },
    ]);
    expect(text).toBe("Refactoring complete.");
  });

  it("returns full assistant response without truncating", () => {
    const longText = "a".repeat(5000);
    const text = extractLatestAssistantResponseFromMessages([{ role: "assistant", content: longText }]);
    expect(text).toBe(longText);
  });
});
