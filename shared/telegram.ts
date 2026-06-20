export interface TelegramLinkResponse {
  token: string;
  expiresAt: string;
  botUsername?: string;
  botLink?: string;
}

export interface HubTelegramConnection {
  linked: boolean;
  username?: string;
  chatId?: number;
}

export interface HubBotInfo {
  username?: string;
  link?: string;
}

export interface HubConnectionInfo {
  deviceId?: string;
  telegram: HubTelegramConnection;
  bot: HubBotInfo;
}

export function buildTelegramBotLink(botUsername: string, token?: string): string {
  const username = botUsername.replace(/^@/, "");
  const base = `https://t.me/${username}`;
  if (!token) return base;
  return `${base}?start=${encodeURIComponent(token)}`;
}

export function parseTelegramLinkResponse(raw: Record<string, unknown>): TelegramLinkResponse {
  const token = String(raw.token ?? "");
  const expiresAt = String(raw.expires_at ?? raw.expiresAt ?? "");
  const botUsernameRaw = raw.bot_username ?? raw.botUsername;
  const botUsername =
    typeof botUsernameRaw === "string" && botUsernameRaw.length > 0
      ? botUsernameRaw
      : undefined;
  const botLinkRaw = raw.bot_link ?? raw.botLink;
  const botLink =
    typeof botLinkRaw === "string" && botLinkRaw.length > 0
      ? botLinkRaw
      : botUsername
        ? buildTelegramBotLink(botUsername, token)
        : undefined;

  return { token, expiresAt, botUsername, botLink };
}

function readTelegramBlock(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const telegram = raw.telegram;
  return telegram && typeof telegram === "object" ? (telegram as Record<string, unknown>) : undefined;
}

function readBotBlock(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const bot = raw.bot;
  return bot && typeof bot === "object" ? (bot as Record<string, unknown>) : undefined;
}

export function parseHubConnectionInfo(raw: Record<string, unknown>): HubConnectionInfo {
  const telegramBlock = readTelegramBlock(raw);
  const botBlock = readBotBlock(raw);

  const linked =
    telegramBlock?.linked === true ||
    raw.telegram_linked === true ||
    raw.telegramLinked === true;

  const telegramUsernameRaw =
    telegramBlock?.username ?? raw.telegram_username ?? raw.telegramUsername;
  const telegramUsername =
    typeof telegramUsernameRaw === "string" && telegramUsernameRaw.length > 0
      ? telegramUsernameRaw
      : undefined;

  const chatIdRaw = telegramBlock?.chat_id ?? telegramBlock?.chatId ?? raw.telegram_chat_id;
  const chatId =
    typeof chatIdRaw === "number"
      ? chatIdRaw
      : typeof chatIdRaw === "string" && chatIdRaw.length > 0
        ? Number(chatIdRaw)
        : undefined;

  const botUsernameRaw =
    botBlock?.username ?? raw.bot_username ?? raw.botUsername;
  const botUsername =
    typeof botUsernameRaw === "string" && botUsernameRaw.length > 0
      ? botUsernameRaw
      : undefined;

  const botLinkRaw = botBlock?.link ?? raw.bot_link ?? raw.botLink;
  const botLink =
    typeof botLinkRaw === "string" && botLinkRaw.length > 0
      ? botLinkRaw
      : botUsername
        ? buildTelegramBotLink(botUsername)
        : undefined;

  return {
    deviceId:
      typeof raw.device_id === "string"
        ? raw.device_id
        : typeof raw.deviceId === "string"
          ? raw.deviceId
          : undefined,
    telegram: {
      linked,
      username: telegramUsername,
      chatId: Number.isFinite(chatId) ? chatId : undefined,
    },
    bot: {
      username: botUsername,
      link: botLink,
    },
  };
}
