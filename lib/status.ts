import type { PlatformBalance } from "./balance";

export type Level = "ok" | "low" | "empty" | "error";

const QUOTA_LOW_PERCENT = 20;

function windowPercent(window: PlatformBalance["quota"][number]): number | null {
  if (window.remainingPercent !== null) return window.remainingPercent;
  if (window.remaining !== null && window.total !== null && window.total > 0) {
    return (window.remaining / window.total) * 100;
  }
  return null;
}

// Loaders may fold several windows into `balance` (Qoder: plan + add-on packs).
// The percentage has to follow the same scope as the headline number.
export function quotaPercent(platform: PlatformBalance): number | null {
  const primary = platform.quota[0];
  if (!primary) return null;
  const own = windowPercent(primary);
  if (
    platform.balance === null || primary.remaining === null ||
    platform.balance === primary.remaining
  ) {
    return own;
  }
  let remaining = 0;
  let total = 0;
  for (const window of platform.quota) {
    if (window.remaining === null || window.total === null || window.total <= 0) {
      return own;
    }
    remaining += window.remaining;
    total += window.total;
  }
  return total > 0 ? (remaining / total) * 100 : own;
}

export function levelOf(platform: PlatformBalance, threshold: number): Level {
  if (platform.status === "error") return "error";
  if (platform.kind === "quota") {
    const remaining = quotaPercent(platform);
    // Qoder can report credits left without a total (unlimited-style plans),
    // so an unknown percentage alone must not mark a healthy card as broken.
    if (remaining === null) {
      if (platform.balance === null) return "error";
      return platform.balance <= 0 ? "empty" : "ok";
    }
    if (remaining <= 0) return "empty";
    if (remaining <= QUOTA_LOW_PERCENT) return "low";
    return "ok";
  }
  if (platform.balance === null) return "error";
  if (platform.balance <= 0) return "empty";
  if (platform.balance <= threshold) return "low";
  return "ok";
}

export const LEVEL_LABEL: Record<Level, string> = {
  ok: "正常",
  low: "余量偏低",
  empty: "已用尽",
  error: "查询失败",
};

export const LEVEL_STYLE: Record<Level, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  low: "border-warning/30 bg-warning/10 text-warning",
  empty: "border-danger/30 bg-danger/10 text-danger",
  error: "border-danger/30 bg-danger/10 text-danger",
};

export const LEVEL_DOT: Record<Level, string> = {
  ok: "bg-success",
  low: "bg-warning",
  empty: "bg-danger",
  error: "bg-danger",
};

export function errorCopy(code: string | null, httpStatus: number | null): string {
  switch (code) {
    case "invalid_key":
      return "凭据无效或已失效，请更新凭据";
    case "invalid_session":
      return "登录凭据已失效，请更新凭据";
    case "rate_limited":
      return "平台限流，请稍后重试";
    case "network":
      return "无法连接平台接口";
    case "timeout":
      return "平台接口响应超时";
    case "upstream":
      return httpStatus ? `平台返回异常（HTTP ${httpStatus}）` : "平台返回异常";
    case "bad_response":
      return "平台返回数据格式异常";
    case "unavailable":
      return "该平台暂不支持查询";
    default:
      return "查询失败，请稍后重试";
  }
}
