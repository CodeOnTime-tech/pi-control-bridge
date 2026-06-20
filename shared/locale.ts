export type AppLocale = "ru" | "en";

export function getSystemLocale(): AppLocale {
  const candidates = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const normalized = raw.replace(/\.utf-8$/i, "").replace(/_/g, "-").toLowerCase();
    if (normalized.startsWith("ru")) return "ru";
  }

  return "en";
}

export function pluralMinutes(count: number, locale: AppLocale): string {
  if (locale === "en") {
    return count === 1 ? "minute" : "minutes";
  }

  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "минуту";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "минуты";
  return "минут";
}
