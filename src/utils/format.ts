import type { Language } from "../i18n";

export function initials(email: string) {
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

export function remainingTone(value: number) {
  if (value <= 15) return "danger";
  if (value <= 35) return "warning";
  return "good";
}

export type UsageResetWindow = "fiveHours" | "oneWeek";

function padTimePart(value: number) {
  return String(value).padStart(2, "0");
}

export function resetClockTime(timestamp: number | null | undefined) {
  if (!timestamp) return null;
  const value = new Date(timestamp * 1000);
  if (Number.isNaN(value.getTime())) return null;
  const hour = padTimePart(value.getHours());
  const minute = padTimePart(value.getMinutes());
  const second = padTimePart(value.getSeconds());
  return `${hour}:${minute}:${second}`;
}

export function resetCountdownTime(timestamp: number | null | undefined, now = Date.now()) {
  if (!timestamp) return null;
  const distance = Math.max(0, timestamp * 1000 - now);
  const totalSeconds = Math.ceil(distance / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${padTimePart(minutes)}:${padTimePart(seconds)}`;
}

export function resetClockLabel(timestamp: number | null | undefined, language: Language) {
  const clock = resetClockTime(timestamp);
  if (!clock) return language === "zh" ? "重置时间未知" : "Reset time unknown";
  return language === "zh" ? `${clock}后重置` : `Resets at ${clock}`;
}

function resetDateTimeLabel(timestamp: number, language: Language) {
  const value = new Date(timestamp * 1000);
  if (Number.isNaN(value.getTime())) return language === "zh" ? "重置时间未知" : "Reset time unknown";
  const year = value.getFullYear();
  const month = value.getMonth() + 1;
  const day = value.getDate();
  const hour = padTimePart(value.getHours());
  const minute = padTimePart(value.getMinutes());
  const second = padTimePart(value.getSeconds());
  return language === "zh"
    ? `${year}-${padTimePart(month)}-${padTimePart(day)} ${hour}:${minute}:${second}后重置`
    : `Resets on ${year}-${padTimePart(month)}-${padTimePart(day)} ${hour}:${minute}:${second}`;
}

export function resetLabel(
  timestamp: number | null | undefined,
  language: Language,
  windowType?: UsageResetWindow,
) {
  if (!timestamp) return language === "zh" ? "重置时间未知" : "Reset time unknown";
  if (windowType === "fiveHours") return resetClockLabel(timestamp, language);
  if (windowType === "oneWeek") return resetDateTimeLabel(timestamp, language);
  const distance = Math.max(0, timestamp * 1000 - Date.now());
  const minutes = Math.ceil(distance / 60_000);
  if (minutes < 60) return language === "zh" ? `${minutes} 分钟后重置` : `Resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) {
    return language === "zh"
      ? `${hours} 时${rest ? ` ${rest} 分` : ""}后重置`
      : `Resets in ${hours} hr${rest ? ` ${rest} min` : ""}`;
  }
  const days = Math.floor(hours / 24);
  const dayHours = hours % 24;
  return language === "zh" ? `${days} 天 ${dayHours} 时后重置` : `Resets in ${days} d ${dayHours} hr`;
}

export function formatUpdated(timestamp: string | null | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "尚未刷新" : "Not refreshed";
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return language === "zh" ? "时间未知" : "Unknown time";
  return value.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRefreshTime(timestamp: string | null | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "暂无" : "None";
  return new Date(timestamp).toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatSystemTime(timestamp: string | null | undefined, language: Language) {
  if (!timestamp) return language === "zh" ? "时间未知" : "Unknown time";
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return language === "zh" ? "时间未知" : "Unknown time";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}
