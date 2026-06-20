import { describe, expect, it } from "vitest";

import {
  formatConnectTelegramMessage,
  formatExpiryLine,
} from "../../extension/messages.ts";
import { getSystemLocale, pluralMinutes } from "../../shared/locale.ts";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("pluralMinutes", () => {
  it("declines Russian minute forms", () => {
    expect(pluralMinutes(1, "ru")).toBe("минуту");
    expect(pluralMinutes(2, "ru")).toBe("минуты");
    expect(pluralMinutes(5, "ru")).toBe("минут");
    expect(pluralMinutes(21, "ru")).toBe("минуту");
  });

  it("declines English minute forms", () => {
    expect(pluralMinutes(1, "en")).toBe("minute");
    expect(pluralMinutes(5, "en")).toBe("minutes");
  });
});

describe("formatExpiryLine", () => {
  it("formats Russian expiry with seconds and duration", () => {
    const line = formatExpiryLine(
      "2026-06-21T14:13:08.036557+00:00",
      "ru",
      new Date("2026-06-21T14:08:08.000Z"),
    );

    expect(line).toMatch(/^Действует 5 минут, до /);
    expect(line).not.toContain("036557");
    expect(line).toMatch(/:\d{2}$/);
  });

  it("formats English expiry with seconds and duration", () => {
    const line = formatExpiryLine(
      "2026-06-21T14:13:08.036557+00:00",
      "en",
      new Date("2026-06-21T14:08:08.000Z"),
    );

    expect(line).toMatch(/^Valid for 5 minutes, until /);
    expect(line).not.toContain("036557");
    expect(line).toMatch(/:\d{2}$/);
  });
});

describe("formatConnectTelegramMessage", () => {
  it("uses Russian copy and colors when locale is ru", () => {
    const message = formatConnectTelegramMessage(
      {
        token: "abc",
        expiresAt: "2026-06-21T14:13:08.036557+00:00",
        botLink: "https://t.me/pi_codeontime_ru_bot?start=abc",
      },
      { locale: "ru", now: new Date("2026-06-21T14:08:08.000Z") },
    );

    const plain = stripAnsi(message);
    expect(plain).toContain("Подключение Telegram");
    expect(plain).toContain("Откройте ссылку в Telegram:");
    expect(plain).toContain("https://t.me/pi_codeontime_ru_bot?start=abc");
    expect(plain).toMatch(/Действует 5 минут, до /);
    expect(message).toContain("\x1b[1;96m");
    expect(message).toContain("\x1b[94;4m");
    expect(message).toContain("\x1b[93m");
  });

  it("uses English copy when locale is en", () => {
    const message = formatConnectTelegramMessage(
      {
        token: "abc",
        expiresAt: "2026-06-21T14:13:08.036557+00:00",
        botLink: "https://t.me/pi_codeontime_ru_bot?start=abc",
      },
      { locale: "en", now: new Date("2026-06-21T14:08:08.000Z") },
    );

    const plain = stripAnsi(message);
    expect(plain).toContain("Connect Telegram");
    expect(plain).toContain("Open this link in Telegram:");
    expect(plain).toMatch(/Valid for 5 minutes, until /);
  });
});

describe("getSystemLocale", () => {
  it("detects Russian locale from LANG", () => {
    const previous = process.env.LANG;
    process.env.LANG = "ru_RU.UTF-8";
    try {
      expect(getSystemLocale()).toBe("ru");
    } finally {
      if (previous === undefined) delete process.env.LANG;
      else process.env.LANG = previous;
    }
  });

  it("falls back to English for non-Russian locale", () => {
    const previous = process.env.LANG;
    process.env.LANG = "en_US.UTF-8";
    try {
      expect(getSystemLocale()).toBe("en");
    } finally {
      if (previous === undefined) delete process.env.LANG;
      else process.env.LANG = previous;
    }
  });
});
