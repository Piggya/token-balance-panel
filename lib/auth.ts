import { ApiError, requestJson } from "./request";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "用户名或密码不正确。",
  rate_limited: "尝试过于频繁，请一分钟后再试。",
  wrong_password: "当前密码不正确。",
  weak_password: "新密码长度需要 8 到 128 个字符。",
  login_required: "登录状态已过期，请重新登录。",
  method_not_allowed: "请求方式不被支持。",
};

export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const data = await requestJson("/functions/v1/app/api/auth/status", {}, MESSAGES) as {
    authenticated?: unknown;
    username?: unknown;
  };
  return {
    authenticated: data?.authenticated === true,
    username: typeof data?.username === "string" ? data.username : null,
  };
}

export async function login(username: string, password: string): Promise<string | null> {
  const data = await requestJson(
    "/functions/v1/app/api/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
    MESSAGES,
  ) as { username?: unknown };
  return typeof data?.username === "string" ? data.username : null;
}

export async function logout(): Promise<void> {
  await requestJson("/functions/v1/app/api/auth/logout", { method: "POST" }, MESSAGES);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await requestJson(
    "/functions/v1/app/api/auth/password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    },
    MESSAGES,
  );
}

// 401 from any dashboard API means the session expired; callers show the login
// view again.
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === "login_required";
}
