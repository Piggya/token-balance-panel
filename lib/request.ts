// Copy of the Sites request helper; messages are application-owned Chinese copy.
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export async function requestJson(
  url: string,
  init: RequestInit = {},
  messages: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError("网络连接失败，请稍后重试。", "network_error");
  }
  if (response.status === 401 || response.status === 403) {
    // Prefer the API's own error code (for example login_required or
    // invalid_credentials) over the generic access-denied copy.
    let code = "access_denied";
    try {
      const data: unknown = await response.json();
      const candidate = data && typeof data === "object"
        ? (data as Record<string, unknown>).error
        : null;
      if (typeof candidate === "string" && candidate) code = candidate;
    } catch {
      // Body was not JSON; keep the generic code.
    }
    const message = Object.prototype.hasOwnProperty.call(messages, code)
      ? messages[code]
      : "没有访问看板服务的权限，请检查站点访问设置。";
    throw new ApiError(message, code, response.status);
  }
  if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError("看板服务返回了异常响应，请稍后重试。", "invalid_response", response.status);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("看板服务返回了异常响应，请稍后重试。", "invalid_response", response.status);
  }
  const body = data && typeof data === "object" ? data as Record<string, unknown> : null;
  const code = typeof body?.error === "string"
    ? body.error
    : (!response.ok || body?.ok === false) && typeof body?.code === "string"
    ? body.code
    : response.ok
    ? null
    : "request_failed";
  if (!response.ok || body?.ok === false || code) {
    const resolved = code ?? "request_failed";
    const message = Object.prototype.hasOwnProperty.call(messages, resolved)
      ? messages[resolved]
      : "看板服务暂时不可用，请稍后重试。";
    throw new ApiError(message, resolved, response.status);
  }
  return data;
}
