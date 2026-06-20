import type { ControlStatus } from "../shared/types.ts";
import type { TelegramLinkResponse } from "../shared/telegram.ts";

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

export function formatConnectTelegramMessage(link: TelegramLinkResponse): string {
  const lines = ["Подключение Telegram", ""];

  if (link.botLink) {
    lines.push("Откройте ссылку в Telegram:", link.botLink, "");
  } else if (link.botUsername) {
    lines.push(
      "Откройте бота в Telegram:",
      `https://t.me/${link.botUsername.replace(/^@/, "")}`,
      "",
      `Отправьте команду: /start ${link.token}`,
      "",
    );
  } else {
    lines.push(`Токен: ${link.token}`, "", "Отправьте в боте: /start <token>", "");
  }

  if (link.expiresAt) {
    lines.push(`Действует до: ${link.expiresAt}`);
  }

  return lines.join("\n");
}
