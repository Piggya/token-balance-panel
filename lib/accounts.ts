import { ApiError, requestJson } from "./request";

export type Region = "cn" | "intl";

export interface CredentialValues {
  key?: string;
  session?: string;
  token?: string;
  uid?: string;
  region?: Region;
}

export interface AccountInput {
  platform: string;
  label: string;
  credential?: CredentialValues;
}

export interface AccountSummary {
  id: string;
  platform: string;
  label: string;
  createdAt: string;
}

const MESSAGES: Record<string, string> = {
  access_denied: "没有访问看板服务的权限，请检查站点访问设置。",
  network_error: "网络连接失败，请稍后重试。",
  invalid_response: "看板服务返回了异常响应，请稍后重试。",
  request_failed: "看板服务暂时不可用，请稍后重试。",
  invalid_input: "请检查填写的账号信息后重试。",
  too_many_accounts: "账号数量已达上限（40 个）。",
  not_found: "这个账号已经不存在，请刷新后重试。",
  accounts_unavailable: "账号存储暂时不可用，请稍后重试。",
  login_required: "请先登录站点，再管理账号。",
  invalid_user_context: "登录状态异常，请重新登录。",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseSummary(value: unknown): AccountSummary | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !/^[a-z0-9-]{8,48}$/.test(value.id)) return null;
  if (typeof value.platform !== "string") return null;
  if (typeof value.label !== "string") return null;
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    return null;
  }
  return {
    id: value.id,
    platform: value.platform,
    label: value.label,
    createdAt: value.createdAt,
  };
}

async function sendAccount(
  method: "POST" | "PATCH",
  url: string,
  input: AccountInput,
): Promise<AccountSummary> {
  const raw = await requestJson(url, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, MESSAGES);
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  const account = parseSummary(raw.account);
  if (!account) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
  return account;
}

export function createAccount(input: AccountInput): Promise<AccountSummary> {
  return sendAccount("POST", "/functions/v1/app/api/accounts", input);
}

export function updateAccount(id: string, input: AccountInput): Promise<AccountSummary> {
  return sendAccount(
    "PATCH",
    `/functions/v1/app/api/accounts/${encodeURIComponent(id)}`,
    input,
  );
}

export async function deleteAccount(id: string): Promise<void> {
  const raw = await requestJson(
    `/functions/v1/app/api/accounts/${encodeURIComponent(id)}`,
    { method: "DELETE", cache: "no-store" },
    MESSAGES,
  );
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("看板服务返回的数据格式不正确。", "invalid_payload");
  }
}
