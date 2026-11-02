import { ApiError, requestJson } from "./request";
import { PLATFORM_META } from "./platforms";

export interface Settings {
  intervalSec: number;
  thresholds: Record<string, number>;
  order: string[];
}

export type SettingsSyncStatus = "loading" | "saving" | "synced" | "error";

const CACHE_KEY = "token-panel:settings-cache:v1";
const MAX_THRESHOLD = 1_000_000_000;
const MAX_ORDER = 500;
const MAX_ACCOUNT_ID_LENGTH = 64;

export const INTERVAL_OPTIONS = [
  { value: 30, label: "30 秒" },
  { value: 60, label: "1 分钟" },
  { value: 300, label: "5 分钟" },
  { value: 0, label: "关闭自动刷新" },
];

const MESSAGES: Record<string, string> = {
  access_denied: "没有访问看板服务的权限，请检查站点访问设置。",
  network_error: "网络连接失败，请稍后重试。",
  invalid_response: "看板服务返回了异常响应，请稍后重试。",
  request_failed: "看板服务暂时不可用，请稍后重试。",
  invalid_settings: "设置内容不被接受，请刷新页面后重试。",
  settings_unavailable: "设置存储暂时不可用，请稍后重试。",
  rate_limited: "操作过于频繁，请稍后再试。",
  login_required: "请先登录站点，再修改设置。",
  invalid_user_context: "登录状态异常，请重新登录。",
};

function defaultThresholds(): Record<string, number> {
  return Object.fromEntries(
    Object.values(PLATFORM_META).map((meta) => [meta.id, meta.defaultThreshold]),
  );
}

export function defaultSettings(): Settings {
  return { intervalSec: 60, thresholds: defaultThresholds(), order: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseOrder(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ORDER) return null;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > MAX_ACCOUNT_ID_LENGTH
    ) {
      return null;
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    order.push(entry);
  }
  return order;
}

export function parseSettings(value: unknown): Settings | null {
  if (!isRecord(value)) return null;
  if (!INTERVAL_OPTIONS.some((option) => option.value === value.intervalSec)) return null;
  const thresholds = defaultThresholds();
  if (value.thresholds !== undefined) {
    if (!isRecord(value.thresholds)) return null;
    for (const [id, amount] of Object.entries(value.thresholds)) {
      if (!(id in PLATFORM_META)) continue;
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > MAX_THRESHOLD
      ) {
        return null;
      }
      thresholds[id] = amount;
    }
  }
  const order = parseOrder(value.order);
  if (!order) return null;
  return { intervalSec: value.intervalSec as number, thresholds, order };
}

// The browser only keeps a read-through copy; the server store stays authoritative.
export function loadCachedSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return defaultSettings();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return defaultSettings();
    return parseSettings(parsed.settings) ?? defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function clearCachedSettings(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function cacheSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), settings }),
    );
  } catch {
    // Private contexts can reject storage; the page still works with server data.
  }
}

export async function fetchSettings(): Promise<Settings> {
  const raw = await requestJson(
    "/functions/v1/app/api/settings",
    { cache: "no-store" },
    MESSAGES,
  );
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  const settings = parseSettings(raw.settings);
  if (!settings) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const raw = await requestJson(
    "/functions/v1/app/api/settings",
    {
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    },
    MESSAGES,
  );
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  const saved = parseSettings(raw.settings);
  if (!saved) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  return saved;
}
