import { ansi } from "../shared/ansi.ts";
import { getSystemLocale, pluralMinutes, type AppLocale } from "../shared/locale.ts";
import type { ControlStatus } from "../shared/types.ts";
import type { TelegramLinkResponse } from "../shared/telegram.ts";

const connectTelegramCopy = {
  ru: {
    title: "Подключение Telegram",
    openLink: "Откройте ссылку в Telegram:",
    openBot: "Откройте бота в Telegram:",
    sendCommand: (token: string) => `Отправьте команду: /start ${token}`,
    token: (token: string) => `Токен: ${token}`,
    sendInBot: "Отправьте в боте: /start <token>",
    validFor: (minutes: number, until: string) =>
      `Действует ${minutes} ${pluralMinutes(minutes, "ru")}, до ${until}`,
  },
  en: {
    title: "Connect Telegram",
    openLink: "Open this link in Telegram:",
    openBot: "Open the bot in Telegram:",
    sendCommand: (token: string) => `Send the command: /start ${token}`,
    token: (token: string) => `Token: ${token}`,
    sendInBot: "Send in the bot: /start <token>",
    validFor: (minutes: number, until: string) =>
      `Valid for ${minutes} ${pluralMinutes(minutes, "en")}, until ${until}`,
  },
} as const;

export interface FormatConnectTelegramOptions {
  locale?: AppLocale;
  now?: Date;
}

export function formatExpiryLine(
  expiresAt: string,
  locale: AppLocale,
  now: Date = new Date(),
): string | undefined {
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return undefined;

  const diffMs = Math.max(0, expires.getTime() - now.getTime());
  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  const until = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(expires);

  return connectTelegramCopy[locale].validFor(minutes, until);
}

export function formatControlStatusMessage(status: ControlStatus): string {
  const lines = [
    "pi-control-bridge",
    "",
    `device: ${status.deviceId ?? "n/a"}`,
    `sessions: ${status.activeSessions}`,
    `backend: ${status.backendConnected ? "ok" : "degraded"}`,
    `telegram: ${
      status.telegram.linked
        ? `linked${status.telegram.username ? ` (${status.telegram.username})` : ""}`
        : "not linked"
    }`,
  ];

  if (status.bot.username || status.bot.link) {
    const botLabel = status.bot.username ? `@${status.bot.username.replace(/^@/, "")}` : "bot";
    lines.push(`bot: ${status.bot.link ? `${botLabel} — ${status.bot.link}` : botLabel}`);
  }

  lines.push(`pending events: ${status.pendingEvents}`);
  return lines.join("\n");
}

export function formatConnectTelegramMessage(
  link: TelegramLinkResponse,
  options: FormatConnectTelegramOptions = {},
): string {
  const locale = options.locale ?? getSystemLocale();
  const copy = connectTelegramCopy[locale];
  const lines = [ansi.title(copy.title), ""];

  if (link.botLink) {
    lines.push(ansi.label(copy.openLink), ansi.link(link.botLink), "");
  } else if (link.botUsername) {
    const botUrl = `https://t.me/${link.botUsername.replace(/^@/, "")}`;
    lines.push(
      ansi.label(copy.openBot),
      ansi.link(botUrl),
      "",
      ansi.label(copy.sendCommand(link.token)),
      "",
    );
  } else {
    lines.push(ansi.label(copy.token(link.token)), "", ansi.label(copy.sendInBot), "");
  }

  if (link.expiresAt) {
    const expiryLine = formatExpiryLine(link.expiresAt, locale, options.now);
    if (expiryLine) {
      lines.push(ansi.accent(expiryLine));
    }
  }

  return lines.join("\n");
}
