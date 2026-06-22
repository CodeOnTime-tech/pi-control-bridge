import { DEFAULT_BOT_USERNAME } from "./constants.ts";

export interface TelegramLinkResponse {
  token: string;
  expiresAt: string;
  botUsername?: string;
  botLink?: string;
  alreadyLinked?: boolean;
  telegramUsername?: string;
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

export function resolveBotInfo(bot: HubBotInfo = {}): HubBotInfo {
  const username =
    typeof bot.username === "string" && bot.username.length > 0
      ? bot.username
      : DEFAULT_BOT_USERNAME;
  const link =
    typeof bot.link === "string" && bot.link.length > 0
      ? bot.link
      : buildTelegramBotLink(username);
  return { username, link };
}

export function buildAlreadyLinkedTelegramResponse(connection: HubConnectionInfo): TelegramLinkResponse {
  const bot = resolveBotInfo(connection.bot);
  return {
    token: "",
    expiresAt: "",
    alreadyLinked: true,
    botUsername: bot.username,
    botLink: bot.link,
    telegramUsername: connection.telegram.username,
  };
}

export function parseTelegramLinkResponse(raw: Record<string, unknown>): TelegramLinkResponse {
  const alreadyLinked = raw.already_linked === true || raw.alreadyLinked === true;
  const token = String(raw.token ?? "");
  const expiresAt = String(raw.expires_at ?? raw.expiresAt ?? "");
  const telegramUsernameRaw = raw.telegram_username ?? raw.telegramUsername;
  const telegramUsername =
    typeof telegramUsernameRaw === "string" && telegramUsernameRaw.length > 0
      ? telegramUsernameRaw
      : undefined;
  const botUsernameRaw = raw.bot_username ?? raw.botUsername;
  const botUsername =
    typeof botUsernameRaw === "string" && botUsernameRaw.length > 0
      ? botUsernameRaw
      : DEFAULT_BOT_USERNAME;
  const botLinkRaw = raw.bot_link ?? raw.botLink;
  const botLink =
    typeof botLinkRaw === "string" && botLinkRaw.length > 0
      ? botLinkRaw
      : buildTelegramBotLink(botUsername, token);

  return { token, expiresAt, botUsername, botLink, alreadyLinked, telegramUsername };
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
    bot: resolveBotInfo({
      username: botUsername,
      link: botLink,
    }),
  };
}
