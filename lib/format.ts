import type { Currency } from "./platforms";

const SYMBOLS: Record<Currency, string> = { CNY: "¥", USD: "$" };

export function currencySymbol(currency: Currency): string {
  return SYMBOLS[currency] ?? "";
}

export function formatAmount(amount: number | null): string {
  if (amount === null) return "—";
  const abs = Math.abs(amount);
  if (abs > 0 && abs < 0.01) return "<0.01";
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCount(amount: number | null): string {
  if (amount === null) return "—";
  return Math.round(amount).toLocaleString("zh-CN");
}

export function formatMoney(amount: number | null, currency: Currency): string {
  return `${currencySymbol(currency)}${formatAmount(amount)}`;
}

export function formatMeasure(
  amount: number | null,
  currency: Currency,
  unit?: string,
): string {
  return unit ? `${formatCount(amount)} ${unit}` : formatMoney(amount, currency);
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

export function formatReset(iso: string, now: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const current = new Date(now);
  const sameDay = date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  if (sameDay) return time;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function formatCountdown(iso: string, now: number): string {
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return "—";
  const diff = stamp - now;
  if (diff <= 0) return "已刷新";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} 小时 ${rest} 分后` : `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} 天 ${restHours} 小时后` : `${days} 天后`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function relativeTime(iso: string, now: number): string {
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return "未知";
  const diff = now - stamp;
  if (diff < 5000) return "刚刚";
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}
