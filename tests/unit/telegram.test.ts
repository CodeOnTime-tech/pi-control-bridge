import { describe, expect, it } from "vitest";

import {
  buildTelegramBotLink,
  parseHubConnectionInfo,
  parseTelegramLinkResponse,
} from "../../shared/telegram.ts";
import { formatConnectTelegramMessage, formatControlStatusMessage } from "../../extension/messages.ts";

describe("telegram helpers", () => {
  it("builds deep link with start token", () => {
    expect(buildTelegramBotLink("@MyBot", "abc 123")).toBe(
      "https://t.me/MyBot?start=abc%20123",
    );
  });

  it("parses link token response and builds bot link", () => {
    const parsed = parseTelegramLinkResponse({
      token: "tok",
      expires_at: "2026-06-20T12:00:00Z",
      bot_username: "PiControlBot",
    });
    expect(parsed.botLink).toBe("https://t.me/PiControlBot?start=tok");
    expect(parsed.expiresAt).toBe("2026-06-20T12:00:00Z");
  });

  it("parses hub connection info from /me", () => {
    const parsed = parseHubConnectionInfo({
      device_id: "dev-1",
      telegram: { linked: true, username: "@alice", chat_id: 42 },
      bot: { username: "PiControlBot" },
    });
    expect(parsed.deviceId).toBe("dev-1");
    expect(parsed.telegram.linked).toBe(true);
    expect(parsed.telegram.username).toBe("@alice");
    expect(parsed.bot.link).toBe("https://t.me/PiControlBot");
  });
});

describe("extension messages", () => {
  it("formats connect telegram message with direct link", () => {
    const message = formatConnectTelegramMessage(
      {
        token: "tok",
        expiresAt: "2026-06-20T12:00:00Z",
        botUsername: "PiControlBot",
        botLink: "https://t.me/PiControlBot?start=tok",
      },
      { locale: "en", now: new Date("2026-06-20T11:55:00Z") },
    );
    expect(message).toContain("https://t.me/PiControlBot?start=tok");
    expect(message).toMatch(/Valid for 5 minutes, until /);
    expect(message).not.toContain("2026-06-20T12:00:00Z");
  });

  it("formats control status with telegram and bot info", () => {
    const message = formatControlStatusMessage({
      ok: true,
      deviceId: "dev-1",
      backendConnected: true,
      degraded: false,
      activeSessions: 1,
      pendingEvents: 0,
      ipcPort: 9473,
      telegram: { linked: true, username: "@alice" },
      bot: { username: "PiControlBot", link: "https://t.me/PiControlBot" },
    });
    expect(message).toContain("telegram: linked (@alice)");
    expect(message).toContain("https://t.me/PiControlBot");
  });
});
