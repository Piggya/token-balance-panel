import {
  PLATFORM_DEFS,
  type Credential,
  type Currency,
  type PlatformId,
  type PlatformKind,
  type StoredAccount,
} from "./accounts.ts";
import { normalizeSession } from "./session.ts";

export type ErrorCode =
  | "invalid_key"
  | "invalid_session"
  | "rate_limited"
  | "network"
  | "timeout"
  | "upstream"
  | "bad_response"
  | "unavailable"
  | "unknown";

export interface Detail {
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
  // Verb for the reset timestamp; defaults to 刷新 (MiniMax windows).
  resetWord?: string;
}

export interface PlatformBalance {
  id: PlatformId;
  accountId: string;
  label: string;
  status: "ok" | "error";
  kind: PlatformKind;
  balance: number | null;
  currency: Currency;
  details: Detail[];
  usage: { used: number; total: number } | null;
  quota: QuotaWindow[];
  note: string | null;
  expiresAt: string | null;
  error: ErrorCode | null;
  httpStatus: number | null;
  checkedAt: string;
  cached: boolean;
}

interface LoadedBalance {
  balance: number | null;
  currency: Currency;
  details: Detail[];
  usage?: { used: number; total: number } | null;
  quota?: QuotaWindow[];
  note?: string | null;
  expiresAt?: string | null;
  // Zhipu resolves balance vs quota from the credential type, so the loader
  // can override the default kind recorded in PLATFORM_DEFS.
  kind?: PlatformKind;
}

const TIMEOUT_MS = 9000;

// Console-backed loaders (WorkBuddy, SiliconFlow) must look like a browser;
// their gateways reject non-browser user agents.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

class UpstreamError extends Error {
  code: ErrorCode;
  httpStatus: number | null;

  constructor(code: ErrorCode, httpStatus: number | null = null) {
    super(code);
    this.name = "UpstreamError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is Record<string, unknown> => item !== null)
    : [];
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  options: {
    method?: string;
    body?: string;
    unauthorized?: ErrorCode;
  } = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      body: options.body,
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new UpstreamError(name === "TimeoutError" ? "timeout" : "network");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new UpstreamError(options.unauthorized ?? "invalid_key", response.status);
    }
    if (response.status === 429) {
      throw new UpstreamError("rate_limited", response.status);
    }
    throw new UpstreamError("upstream", response.status);
  }
  try {
    const body: unknown = await response.json();
    const parsed = record(body);
    if (!parsed) throw new Error("unexpected payload");
    return parsed;
  } catch {
    throw new UpstreamError("bad_response", response.status);
  }
}

function bearer(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function details(entries: Detail[]): Detail[] {
  return entries.filter((entry) => entry.amount !== null);
}

async function loadDeepSeek(credential: Credential): Promise<LoadedBalance> {
  const body = await fetchJson("https://api.deepseek.com/user/balance", bearer(credential.key!));
  const infos = list(body.balance_infos);
  const info = infos.find((item) => item.currency === "CNY") ?? infos[0];
  if (!info) throw new UpstreamError("bad_response");
  const total = num(info.total_balance);
  if (total === null) throw new UpstreamError("bad_response");
  const currency: Currency = info.currency === "USD" ? "USD" : "CNY";
  return {
    balance: total,
    currency,
    details: details([
      { label: "赠送余额", amount: num(info.granted_balance), currency },
      { label: "充值余额", amount: num(info.topped_up_balance), currency },
    ]),
    usage: null,
  };
}

async function loadMoonshot(credential: Credential): Promise<LoadedBalance> {
  const body = await fetchJson(
    "https://api.moonshot.cn/v1/users/me/balance",
    bearer(credential.key!),
  );
  const data = record(body.data);
  if (!data || body.status === false) throw new UpstreamError("bad_response");
  const available = num(data.available_balance);
  if (available === null) throw new UpstreamError("bad_response");
  return {
    balance: available,
    currency: "CNY",
    details: details([
      { label: "代金券", amount: num(data.voucher_balance), currency: "CNY" },
      { label: "现金余额", amount: num(data.cash_balance), currency: "CNY" },
    ]),
    usage: null,
  };
}

// The public /v1/user/info endpoint was retired on 2026-08-14 (410 code
// 20092) and no API-key replacement exists yet, so the console session cookie
// is used instead: one call resolves the subject id, the next reads the wallet.
const SILICONFLOW_SCALE = 1e12;

function scaledMoney(value: unknown): number | null {
  const raw = num(value);
  return raw === null ? null : raw / SILICONFLOW_SCALE;
}

async function loadSiliconFlow(credential: Credential): Promise<LoadedBalance> {
  const session = credential.session;
  if (!session) throw new UpstreamError("invalid_session");
  const headers = {
    Cookie: session,
    "User-Agent": BROWSER_UA,
    Accept: "application/json",
    "Accept-Language": "zh-CN",
  };
  const subjects = await fetchJson(
    "https://cloud.siliconflow.cn/iam-server/api/v1/my/subjects",
    headers,
    { unauthorized: "invalid_session" },
  );
  if (num(subjects.code) !== 20000) throw new UpstreamError("invalid_session");
  const subject = record(list(record(subjects.data)?.subjects)[0]);
  const subjectId = typeof subject?.subjectId === "string" ? subject.subjectId.trim() : "";
  if (!subjectId) throw new UpstreamError("invalid_session");
  const body = await fetchJson(
    "https://cloud.siliconflow.cn/walletd-server/api/v1/subject/profile/peek",
    { ...headers, "X-Subject-Id": subjectId },
    { unauthorized: "invalid_session" },
  );
  if (num(body.code) !== 20000) throw new UpstreamError("invalid_session");
  const info = record(record(body.data)?.financialInfo);
  const balance = scaledMoney(info?.balance);
  if (balance === null) throw new UpstreamError("bad_response");
  const recharged = scaledMoney(info?.recharged);
  const used = scaledMoney(info?.used);
  return {
    balance,
    currency: "CNY",
    details: details([
      { label: "累计充值", amount: recharged, currency: "CNY" },
      { label: "累计已用", amount: used, currency: "CNY" },
    ]),
    usage: recharged !== null && used !== null && recharged > 0
      ? { used: Math.min(used, recharged), total: recharged }
      : null,
    note: "控制台余额",
  };
}

async function loadOpenRouter(credential: Credential): Promise<LoadedBalance> {
  const body = await fetchJson(
    "https://openrouter.ai/api/v1/credits",
    bearer(credential.key!),
  );
  const data = record(body.data);
  if (!data) throw new UpstreamError("bad_response");
  const purchased = num(data.total_credits);
  const used = num(data.total_usage);
  if (purchased === null || used === null) throw new UpstreamError("bad_response");
  return {
    balance: Math.round((purchased - used) * 10000) / 10000,
    currency: "USD",
    details: details([
      { label: "累计充值", amount: purchased, currency: "USD" },
      { label: "累计消耗", amount: used, currency: "USD" },
    ]),
    usage: { used, total: purchased },
  };
}

function isoFromEpoch(value: unknown): string | null {
  const raw = num(value);
  if (raw === null || raw <= 0) return null;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoFromTime(value: unknown): string | null {
  if (typeof value === "number") return isoFromEpoch(value);
  if (typeof value === "string" && value.trim() !== "") {
    const stamp = Date.parse(value);
    if (!Number.isNaN(stamp)) return new Date(stamp).toISOString();
    return isoFromEpoch(value);
  }
  return null;
}

function percent(value: unknown): number | null {
  const raw = num(value);
  if (raw === null) return null;
  const normalized = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, normalized));
}

// MiniMax returns an explicit remaining percentage; count fields have had
// inconsistent semantics across API revisions, so percentages take priority.
function quotaWindow(
  entry: Record<string, unknown>,
  options: {
    label: string;
    totalKey: string;
    countKey: string;
    percentKey: string;
    resetKey: string;
    unit: string;
  },
): QuotaWindow {
  const total = num(entry[options.totalKey]);
  const totalCount = total !== null && total > 0 ? total : null;
  const pct = percent(entry[options.percentKey]);
  const count = num(entry[options.countKey]);
  let remaining: number | null = null;
  if (pct !== null && totalCount !== null) {
    remaining = Math.round((totalCount * pct) / 100);
  } else if (pct === null && count !== null) {
    remaining = count;
  }
  let used: number | null = null;
  if (totalCount !== null && remaining !== null) {
    used = Math.max(0, totalCount - remaining);
  }
  return {
    label: options.label,
    used,
    total: totalCount,
    remaining,
    remainingPercent: pct,
    unit: options.unit,
    resetAt: isoFromEpoch(entry[options.resetKey]),
  };
}

async function loadMiniMax(credential: Credential): Promise<LoadedBalance> {
  let body: Record<string, unknown>;
  try {
    body = await fetchJson(
      "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
      bearer(credential.key!),
    );
  } catch (error) {
    const retryable = error instanceof UpstreamError &&
      (error.code === "network" || (error.code === "upstream" && error.httpStatus === 404));
    if (!retryable) throw error;
    body = await fetchJson(
      "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
      bearer(credential.key!),
    );
  }
  const base = record(body.base_resp);
  if (base && num(base.status_code) !== null && num(base.status_code) !== 0) {
    throw new UpstreamError("invalid_key", 401);
  }
  const data = record(body.data) ?? body;
  const entries = list(data.model_remains);
  if (entries.length === 0) throw new UpstreamError("bad_response");
  const entry = entries.find((item) => {
    const total = num(item.current_interval_total_count) ?? 0;
    const pct = percent(item.current_interval_remaining_percent);
    return total > 0 || pct !== null;
  }) ?? entries[0];
  const quota = [
    quotaWindow(entry, {
      label: "5 小时窗口",
      totalKey: "current_interval_total_count",
      countKey: "current_interval_usage_count",
      percentKey: "current_interval_remaining_percent",
      resetKey: "end_time",
      unit: "次",
    }),
    quotaWindow(entry, {
      label: "本周",
      totalKey: "current_weekly_total_count",
      countKey: "current_weekly_usage_count",
      percentKey: "current_weekly_remaining_percent",
      resetKey: "weekly_end_time",
      unit: "次",
    }),
  ];
  const primary = quota[0];
  if (
    primary.remaining === null &&
    primary.remainingPercent === null &&
    primary.total === null
  ) {
    throw new UpstreamError("bad_response");
  }
  const modelName = typeof entry.model_name === "string" ? entry.model_name : null;
  const planTitle = typeof data.current_subscribe_title === "string"
    ? data.current_subscribe_title
    : null;
  const points = num(data.points_balance);
  return {
    balance: primary.remaining ?? primary.remainingPercent,
    currency: "CNY",
    details: details([
      { label: "点数余额", amount: points, currency: "CNY", unit: "点" },
    ]),
    quota,
    note: planTitle ?? (modelName ? `模型 ${modelName}` : "Coding Plan"),
    usage: null,
  };
}

async function loadTokenRhythm(credential: Credential): Promise<LoadedBalance> {
  const session = normalizeSession(credential.session ?? "");
  if (!session) throw new UpstreamError("invalid_session", 401);
  const body = await fetchJson(
    "https://tokenrhythm.studio/api/usage-summary",
    { Cookie: `tr_session=${session}` },
    { unauthorized: "invalid_session" },
  );
  if (num(body.code) !== 0) throw new UpstreamError("upstream", 200);
  const data = record(body.data);
  if (!data) throw new UpstreamError("bad_response");
  const balance = num(data.balanceCny) ?? num(data.availableBalanceCny);
  if (balance === null) throw new UpstreamError("bad_response");
  const expiresAt = isoFromTime(data.nextExpiryAt);
  const expiring = num(data.expiringBalanceCny);
  const calls = num(data.calls);
  return {
    balance,
    currency: "CNY",
    details: details([
      { label: "冻结额度", amount: num(data.frozenBalanceCny), currency: "CNY" },
      { label: "限时额度", amount: expiring, currency: "CNY" },
      { label: "累计成本", amount: num(data.costCny), currency: "CNY" },
      { label: "累计调用", amount: calls, currency: "CNY", unit: "次" },
    ]),
    usage: null,
    note: expiring !== null && expiring > 0 ? "限时额度到期后自动扣除" : "账户余额",
    expiresAt,
  };
}

// WorkBuddy console requests are authorised by the login cookie header
// (`session` + `session_2`); the edge gateway answers 401 to non-browser user
// agents, so a browser UA is sent explicitly. Credentials stored in the older
// bearer-token form keep using the v2 route.
function workBuddyCookie(value: string): string {
  return value.includes("=") ? value : `session=${value}`;
}

async function loadWorkBuddy(credential: Credential): Promise<LoadedBalance> {
  const origin = credential.region === "intl"
    ? "https://www.workbuddy.ai"
    : "https://www.workbuddy.cn";
  const session = credential.session;
  const headers: Record<string, string> = session
    ? {
      Cookie: workBuddyCookie(session),
      "x-client-platform": "web",
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/json",
    }
    : {
      Authorization: `Bearer ${credential.token}`,
      "X-User-Id": credential.uid ?? "",
      "Content-Type": "application/json",
    };
  const body = await fetchJson(
    `${origin}${session ? "/billing" : "/v2/billing"}/meter/get-user-resource`,
    headers,
    {
      method: "POST",
      body: JSON.stringify({
        PageNumber: 1,
        PageSize: 100,
        Status: [0, 3],
        OnlyValidPeriod: true,
      }),
      unauthorized: "invalid_session",
    },
  );
  if (num(body.code) !== null && num(body.code) !== 0) {
    throw new UpstreamError("invalid_session", 200);
  }
  const accounts = list(
    record(record(record(body.data)?.Response)?.Data)?.Accounts,
  );
  if (accounts.length === 0) throw new UpstreamError("bad_response");
  let total = 0;
  let left = 0;
  let packs = 0;
  let planName = "";
  let planTotal = 0;
  for (const pack of accounts) {
    const packTotal = num(pack.CycleCapacitySizePrecise) ?? 0;
    const packLeft = num(pack.CycleCapacityRemainPrecise) ?? 0;
    if (packTotal <= 0) continue;
    packs += 1;
    total += packTotal;
    left += Math.min(Math.max(packLeft, 0), packTotal);
    const name = typeof pack.PackageName === "string" ? pack.PackageName.trim() : "";
    if (name && packTotal > planTotal) {
      planName = name;
      planTotal = packTotal;
    }
  }
  if (total <= 0) throw new UpstreamError("bad_response");
  const used = Math.max(0, total - left);
  return {
    balance: left,
    currency: "CNY",
    details: details([
      { label: "累计获得", amount: total, currency: "CNY", unit: "积分" },
      { label: "累计已用", amount: used, currency: "CNY", unit: "积分" },
    ]),
    usage: { used, total },
    note: packs > 1 ? `共 ${packs} 个积分包` : planName || "WorkBuddy 积分",
    expiresAt: null,
  };
}

// Qoder publishes no web-session quota API; the officially documented
// credential is a Personal Access Token (pt-…) minted under
// /account/integrations. It is exchanged for a short-lived job token before
// the quota call. Raw device tokens (dt-…) / job tokens pasted directly are
// sent as-is, which keeps already-issued credentials usable.
const QODER_HOSTS = {
  cn: "https://openapi.qoder.com.cn",
  intl: "https://openapi.qoder.sh",
} as const;

async function qoderJobToken(origin: string, pat: string): Promise<string> {
  let body: Record<string, unknown>;
  try {
    body = await fetchJson(
      `${origin}/api/v1/jobToken/exchange`,
      {
        "Content-Type": "application/json",
        "User-Agent": "qodercli/1.0.0",
        "Cosy-Version": "1.0.0",
        "Cosy-ClientType": "5",
      },
      { method: "POST", body: JSON.stringify({ personal_token: pat }) },
    );
  } catch (error) {
    // A rejected personal token comes back as 400 BadRequest rather than 401.
    if (
      error instanceof UpstreamError &&
      (error.code === "upstream" || error.code === "bad_response")
    ) {
      throw new UpstreamError("invalid_key", error.httpStatus);
    }
    throw error;
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) throw new UpstreamError("invalid_key", 200);
  return token;
}

function creditPercent(remaining: number | null, total: number | null): number | null {
  if (remaining === null || total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((remaining / total) * 1000) / 10));
}

// Add-on packs live in `addOnQuota`; older/intl revisions used
// `orgResourcePackage` with a `cap` alias. Both carry plain credit counts.
function qoderPack(
  entry: Record<string, unknown> | null,
): { total: number; remaining: number; used: number } | null {
  if (!entry || entry.available === false) return null;
  const total = num(entry.total) ?? num(entry.cap);
  const left = num(entry.remaining);
  if (total === null || total <= 0 || left === null) return null;
  const remaining = Math.min(Math.max(left, 0), total);
  return { total, remaining, used: num(entry.used) ?? Math.max(0, total - remaining) };
}

async function loadQoder(credential: Credential): Promise<LoadedBalance> {
  const key = credential.key?.trim();
  if (!key) throw new UpstreamError("invalid_key", 401);
  const origin = credential.region === "intl" ? QODER_HOSTS.intl : QODER_HOSTS.cn;
  const token = key.startsWith("pt-") ? await qoderJobToken(origin, key) : key;
  const body = await fetchJson(
    `${origin}/api/v2/quota/usage`,
    {
      ...bearer(token),
      "User-Agent": "Qoder",
      "Cosy-ClientType": "10",
      "Cosy-Version": "0.3.3",
      "Cosy-MachineOS": "windows",
    },
    { unauthorized: "invalid_key" },
  );
  const plan = record(body.userQuota);
  const remaining = num(plan?.remaining);
  if (remaining === null) throw new UpstreamError("bad_response");
  const total = num(plan?.total);
  const planUsed = num(plan?.used) ?? (total !== null ? Math.max(0, total - remaining) : null);
  // `percentage` is the plan's used share; `totalUsagePercentage` covers plan +
  // add-on and is only a last resort for plans that omit the total.
  const usedPct = percent(num(plan?.percentage) ?? body.totalUsagePercentage);
  const resetAt = isoFromEpoch(body.expiresAt);
  const quota: QuotaWindow[] = [
    {
      label: "套餐额度",
      used: planUsed,
      total,
      remaining,
      remainingPercent: creditPercent(remaining, total) ?? (usedPct === null ? null : 100 - usedPct),
      unit: "Credits",
      resetAt,
      resetWord: "重置",
    },
  ];
  const pack = qoderPack(record(body.addOnQuota) ?? record(body.orgResourcePackage));
  if (pack) {
    quota.push({
      label: "资源包",
      used: pack.used,
      total: pack.total,
      remaining: pack.remaining,
      remainingPercent: creditPercent(pack.remaining, pack.total),
      unit: "Credits",
      resetAt: null,
      resetWord: "重置",
    });
  }
  // The headline number is all usable credits: plan remainder plus add-on packs.
  const available = remaining + (pack?.remaining ?? 0);
  return {
    balance: available,
    currency: "CNY",
    details: details([
      { label: "套餐总量", amount: total, currency: "CNY", unit: "Credits" },
      { label: "套餐已用", amount: planUsed, currency: "CNY", unit: "Credits" },
      { label: "资源包剩余", amount: pack?.remaining ?? null, currency: "CNY", unit: "Credits" },
    ]),
    quota,
    note: pack ? "套餐 + 资源包 Credits" : "套餐 Credits",
    usage: null,
    expiresAt: resetAt,
  };
}

// Zhipu (BigModel) has no documented balance API for model API keys. Two
// console endpoints cover the common cases: the monitor quota endpoint accepts
// the API key (GLM Coding Plan windows) and the account report accepts the
// console login token (`bigmodel_token_production` cookie). Both reject bad
// credentials with HTTP 200 and `{ code: 401, success: false }`, so the
// business code decides success rather than the HTTP status.
const ZHIPU_ORIGIN = "https://open.bigmodel.cn";

interface ZhipuLimit {
  type: string;
  percentage: number | null;
  resetAt: string | null;
  unit: number | null;
}

function zhipuLimit(entry: Record<string, unknown>): ZhipuLimit | null {
  const type = typeof entry.type === "string" ? entry.type.toUpperCase() : "";
  if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") return null;
  return {
    type,
    percentage: percent(entry.percentage),
    resetAt: isoFromTime(entry.nextResetTime),
    unit: num(entry.unit),
  };
}

function zhipuWindow(entry: ZhipuLimit, label: string): QuotaWindow {
  // The endpoint reports only the used share; counts are not exposed.
  const used = entry.percentage;
  return {
    label,
    used: null,
    total: null,
    remaining: null,
    remainingPercent: used === null ? null : Math.min(100, Math.max(0, 100 - used)),
    unit: "%",
    resetAt: entry.resetAt,
    resetWord: "刷新",
  };
}

function zhipuQuota(limits: Record<string, unknown>[]): QuotaWindow[] {
  const entries = limits
    .map(zhipuLimit)
    .filter((item): item is ZhipuLimit => item !== null);
  if (entries.length === 0) return [];
  // Some plans report both TOKENS_LIMIT and CREDIT_LIMIT windows; prefer the
  // token windows and only fall back to credit windows when no token window
  // exists, so the two metrics never compete for the same slot.
  const tokenEntries = entries.filter((item) => item.type === "TOKENS_LIMIT");
  const pool = tokenEntries.length > 0 ? tokenEntries : entries;
  let fiveHour: ZhipuLimit | null = null;
  let weekly: ZhipuLimit | null = null;
  const rest: ZhipuLimit[] = [];
  for (const item of pool) {
    // unit 3 = 5-hour window, 6 = weekly window.
    if (item.unit === 3 && !fiveHour) fiveHour = item;
    else if (item.unit === 6 && !weekly) weekly = item;
    else rest.push(item);
  }
  // Entries without a unit fall back to reset order: no reset first, then
  // earliest reset. Weekly can reset before the rolling window near a period
  // boundary, so reset time is only a fallback for classification.
  rest.sort((left, right) => {
    if ((left.resetAt === null) !== (right.resetAt === null)) {
      return left.resetAt === null ? -1 : 1;
    }
    const leftStamp = left.resetAt ? Date.parse(left.resetAt) : 0;
    const rightStamp = right.resetAt ? Date.parse(right.resetAt) : 0;
    return leftStamp - rightStamp;
  });
  for (const item of rest) {
    if (!fiveHour) fiveHour = item;
    else if (!weekly) weekly = item;
  }
  const windows: QuotaWindow[] = [];
  if (fiveHour) windows.push(zhipuWindow(fiveHour, "5 小时窗口"));
  if (weekly) windows.push(zhipuWindow(weekly, "本周"));
  return windows;
}

async function loadZhipuQuota(apiKey: string): Promise<LoadedBalance> {
  const body = await fetchJson(
    `${ZHIPU_ORIGIN}/api/monitor/usage/quota/limit`,
    { Authorization: apiKey },
    { unauthorized: "invalid_key" },
  );
  const code = num(body.code);
  if (body.success === false || (code !== null && code !== 0 && code !== 200)) {
    throw new UpstreamError("invalid_key", code === 401 ? 401 : 200);
  }
  const data = record(body.data);
  const quota = zhipuQuota(list(data?.limits));
  if (quota.length === 0) throw new UpstreamError("bad_response");
  const level = typeof data?.level === "string" ? data.level.trim().toUpperCase() : "";
  return {
    balance: quota[0].remainingPercent,
    currency: "CNY",
    details: [],
    quota,
    note: level ? `GLM Coding Plan · ${level}` : "GLM Coding Plan",
    kind: "quota",
  };
}

// The console token may be pasted raw or as the whole cookie header.
function zhipuConsoleToken(raw: string): string {
  let token = raw.trim();
  if (token.includes("=")) {
    const match = /(?:^|;\s*)bigmodel_token_production=([^;]*)/.exec(token);
    token = match ? match[1].trim() : "";
  }
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, "").trim();
  return token;
}

async function loadZhipuBalance(raw: string): Promise<LoadedBalance> {
  const token = zhipuConsoleToken(raw);
  if (!token) throw new UpstreamError("invalid_session", 401);
  const body = await fetchJson(
    `${ZHIPU_ORIGIN}/api/biz/account/query-customer-account-report`,
    { Authorization: token, "User-Agent": BROWSER_UA },
    { unauthorized: "invalid_session" },
  );
  const code = num(body.code);
  if (body.success === false || (code !== null && code !== 0 && code !== 200)) {
    throw new UpstreamError("invalid_session", code === 401 ? 401 : 200);
  }
  const balance = num(record(body.data)?.balance);
  if (balance === null) throw new UpstreamError("bad_response");
  return {
    balance,
    currency: "CNY",
    details: [],
    usage: null,
    note: "控制台账户余额",
    kind: "balance",
  };
}

async function loadZhipu(credential: Credential): Promise<LoadedBalance> {
  const key = credential.key?.trim();
  if (key) return loadZhipuQuota(key);
  const session = credential.session?.trim();
  if (session) return loadZhipuBalance(session);
  throw new UpstreamError("invalid_key", 401);
}

const LOADERS: Record<PlatformId, (credential: Credential) => Promise<LoadedBalance>> = {  deepseek: loadDeepSeek,
  moonshot: loadMoonshot,
  siliconflow: loadSiliconFlow,
  openrouter: loadOpenRouter,
  minimax: loadMiniMax,
  tokenrhythm: loadTokenRhythm,
  qoder: loadQoder,
  workbuddy: loadWorkBuddy,
  zhipu: loadZhipu,
};

function errorBalance(
  account: StoredAccount,
  error: ErrorCode,
  httpStatus: number | null,
): PlatformBalance {
  const def = PLATFORM_DEFS[account.platform];
  return {
    id: account.platform,
    accountId: account.id,
    label: account.label,
    status: "error",
    kind: def.kind,
    balance: null,
    currency: def.currency,
    details: [],
    usage: null,
    quota: [],
    note: null,
    expiresAt: null,
    error,
    httpStatus,
    checkedAt: new Date().toISOString(),
    cached: false,
  };
}

export async function loadAccount(account: StoredAccount): Promise<PlatformBalance> {
  const def = PLATFORM_DEFS[account.platform];
  try {
    const loaded = await LOADERS[account.platform](account.credential);
    return {
      id: account.platform,
      accountId: account.id,
      label: account.label,
      status: "ok",
      kind: loaded.kind ?? def.kind,
      balance: loaded.balance,
      currency: loaded.currency,
      details: loaded.details,
      usage: loaded.usage ?? null,
      quota: loaded.quota ?? [],
      note: loaded.note ?? null,
      expiresAt: loaded.expiresAt ?? null,
      error: null,
      httpStatus: 200,
      checkedAt: new Date().toISOString(),
      cached: false,
    };
  } catch (error) {
    const code = error instanceof UpstreamError ? error.code : "unknown";
    const httpStatus = error instanceof UpstreamError ? error.httpStatus : null;
    return errorBalance(account, code, httpStatus);
  }
}
