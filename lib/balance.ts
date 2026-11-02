import { ApiError, requestJson } from "./request";
import type { Currency, PlatformKind } from "./platforms";

export type PlatformStatus = "ok" | "error";
export type { PlatformKind };

export interface BalanceDetail {
  label: string;
  amount: number | null;
  currency: Currency;
  unit?: string;
}

export interface QuotaWindow {
  label: string;
  used: number | null;
  total: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  unit: string;
  resetAt: string | null;
  resetWord?: string;
}

export interface PlatformBalance {
  id: string;
  accountId: string;
  label: string;
  status: PlatformStatus;
  kind: PlatformKind;
  balance: number | null;
  currency: Currency;
  details: BalanceDetail[];
  usage: { used: number; total: number } | null;
  quota: QuotaWindow[];
  note: string | null;
  expiresAt: string | null;
  error: string | null;
  httpStatus: number | null;
  cached: boolean;
}

export interface BalancesPayload {
  fetchedAt: string;
  platforms: PlatformBalance[];
}

const MESSAGES: Record<string, string> = {
  access_denied: "没有访问看板服务的权限，请检查站点访问设置。",
  network_error: "网络连接失败，请稍后重试。",
  invalid_response: "看板服务返回了异常响应，请稍后重试。",
  request_failed: "看板服务暂时不可用，请稍后重试。",
  not_found: "余额接口不可用，请稍后重试。",
  method_not_allowed: "余额接口不可用，请稍后重试。",
  login_required: "请先登录站点，再查看余额。",
  invalid_user_context: "登录状态异常，请重新登录。",
  accounts_unavailable: "账号存储暂时不可用，请稍后重试。",
  settings_unavailable: "设置存储暂时不可用，请稍后重试。",
  rate_limited: "刷新过于频繁，请稍后重试。",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCurrency(value: unknown): value is Currency {
  return value === "CNY" || value === "USD";
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function parseDetail(value: unknown): BalanceDetail | null {
  if (!isRecord(value)) return null;
  const amount = numberOrNull(value.amount);
  if (amount === undefined) return null;
  if (typeof value.label !== "string" || !isCurrency(value.currency)) return null;
  const unit = typeof value.unit === "string" && value.unit ? value.unit : undefined;
  return { label: value.label, amount, currency: value.currency, unit };
}

function parseQuota(value: unknown): QuotaWindow | null {
  if (!isRecord(value) || typeof value.label !== "string") return null;
  const used = numberOrNull(value.used);
  const total = numberOrNull(value.total);
  const remaining = numberOrNull(value.remaining);
  const remainingPercent = numberOrNull(value.remainingPercent);
  if (used === undefined || total === undefined || remaining === undefined) return null;
  if (remainingPercent === undefined) return null;
  return {
    label: value.label,
    used,
    total,
    remaining,
    remainingPercent,
    unit: typeof value.unit === "string" && value.unit ? value.unit : "次",
    resetAt: typeof value.resetAt === "string" && !Number.isNaN(Date.parse(value.resetAt))
      ? value.resetAt
      : null,
    resetWord: typeof value.resetWord === "string" && value.resetWord
      ? value.resetWord
      : undefined,
  };
}

function parsePlatform(value: unknown): PlatformBalance | null {
  if (!isRecord(value)) return null;
  const { id, accountId, status, currency } = value;
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,32}$/.test(id)) return null;
  if (typeof accountId !== "string" || !/^[a-z0-9_-]{1,48}$/.test(accountId)) return null;
  if (status !== "ok" && status !== "error") return null;
  if (!isCurrency(currency)) return null;
  const balance = numberOrNull(value.balance);
  if (balance === undefined) return null;
  const details = Array.isArray(value.details)
    ? value.details.map(parseDetail).filter((item): item is BalanceDetail => item !== null)
    : [];
  let usage: PlatformBalance["usage"] = null;
  if (isRecord(value.usage)) {
    const used = numberOrNull(value.usage.used);
    const total = numberOrNull(value.usage.total);
    if (typeof used === "number" && typeof total === "number") usage = { used, total };
  }
  const quota = Array.isArray(value.quota)
    ? value.quota.map(parseQuota).filter((item): item is QuotaWindow => item !== null)
    : [];
  const error = typeof value.error === "string" ? value.error : null;
  const httpStatus = typeof value.httpStatus === "number" ? value.httpStatus : null;
  const note = typeof value.note === "string" ? value.note : null;
  const expiresAt = typeof value.expiresAt === "string" &&
      !Number.isNaN(Date.parse(value.expiresAt))
    ? value.expiresAt
    : null;
  return {
    id,
    accountId,
    label: typeof value.label === "string" ? value.label : "",
    status,
    kind: value.kind === "quota"
      ? "quota"
      : value.kind === "credits"
      ? "credits"
      : "balance",
    balance,
    currency,
    details,
    usage,
    quota,
    note,
    expiresAt,
    error,
    httpStatus,
    cached: value.cached === true,
  };
}

export function parseBalancesPayload(value: unknown): BalancesPayload {
  if (!isRecord(value)) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  if (typeof value.fetchedAt !== "string" || Number.isNaN(Date.parse(value.fetchedAt))) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  if (!Array.isArray(value.platforms)) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  const platforms = value.platforms.map(parsePlatform);
  if (platforms.some((item) => item === null)) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  return {
    fetchedAt: value.fetchedAt,
    platforms: platforms as PlatformBalance[],
  };
}

export async function fetchBalances({ fresh = false }: { fresh?: boolean } = {}): Promise<
  BalancesPayload
> {
  const url = fresh
    ? "/functions/v1/app/api/dashboard?refresh=1"
    : "/functions/v1/app/api/dashboard";
  const raw = await requestJson(url, { cache: "no-store" }, MESSAGES);
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  return parseBalancesPayload(raw);
}
