import test from "node:test";
import assert from "node:assert/strict";
import { application } from "../functions/routes.ts";
import type { AccountStore, StoredAccount } from "../functions/accounts.ts";
import { defaultSettings, type SettingsStore } from "../functions/settings.ts";

const API = "/functions/v1/app/api";
const PAT = "pt-1a2b3c4d5e6f7a8b9c0d";
const RESET_AT = 1790000000000;

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(
  replies: Array<{ status?: number; payload: unknown }>,
): Captured[] & { restore: () => void } {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return new Response(JSON.stringify(reply.payload), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return Object.assign(calls, {
    restore() {
      globalThis.fetch = original;
    },
  });
}

function quotaPayload(overrides: Record<string, unknown> = {}) {
  return {
    userId: "01a17bea-0000-7000-8000-000000000000",
    userType: "personal_professional_trial",
    usageType: "credits",
    totalUsagePercentage: 0.27,
    isQuotaExceeded: false,
    expiresAt: RESET_AT,
    userQuota: { total: 300, used: 133, remaining: 167, percentage: 0.44, unit: "credits" },
    addOnQuota: {
      total: 200,
      used: 0,
      remaining: 200,
      percentage: 0,
      unit: "credits",
      detailUrl: "https://qoder.com.cn/account/usage",
    },
    ...overrides,
  };
}

function account(credential: StoredAccount["credential"]): StoredAccount {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    platform: "qoder",
    label: "主号",
    credential,
    createdAt: new Date(0).toISOString(),
  };
}

function makeApp(stored: StoredAccount[]) {
  const store: AccountStore = {
    async read() {
      return stored.slice();
    },
    async write() {},
  };
  const settings: SettingsStore = {
    async read() {
      return defaultSettings();
    },
    async write() {},
  };
  return application({
    createStore: () => store,
    createSettingsStore: () => settings,
    requireUser: () => ({ user_id: "u1" }),
  });
}

async function dashboard(handle: (request: Request) => Promise<Response>) {
  const response = await handle(
    new Request(`http://local${API}/dashboard?refresh=1`),
  );
  return {
    status: response.status,
    data: (await response.json()) as Record<string, any>,
  };
}

test("exchanges a CN personal token and maps the quota response", async () => {
  const calls = stubFetch([
    { payload: { token: "jt-session-token", expires_at: 1790000000 } },
    { payload: quotaPayload() },
  ]);
  try {
    const result = await dashboard(makeApp([account({ key: PAT, region: "cn" })]));
    assert.equal(result.status, 200);
    const platform = result.data.platforms[0];
    assert.equal(platform.status, "ok");
    assert.equal(platform.kind, "quota");
    assert.equal(platform.balance, 367);
    assert.equal(platform.currency, "CNY");
    assert.equal(platform.note, "套餐 + 资源包 Credits");
    assert.equal(platform.expiresAt, new Date(RESET_AT).toISOString());
    assert.deepEqual(
      platform.details.map((detail: { label: string }) => detail.label),
      ["套餐总量", "套餐已用", "资源包剩余"],
    );
    assert.deepEqual(
      platform.details.map((detail: { amount: number }) => detail.amount),
      [300, 133, 200],
    );

    assert.equal(platform.quota.length, 2);
    const [plan, pack] = platform.quota;
    assert.equal(plan.label, "套餐额度");
    assert.equal(plan.remaining, 167);
    assert.equal(plan.total, 300);
    assert.equal(plan.used, 133);
    assert.equal(plan.remainingPercent, 55.7);
    assert.equal(plan.unit, "Credits");
    assert.equal(plan.resetWord, "重置");
    assert.equal(plan.resetAt, new Date(RESET_AT).toISOString());
    assert.equal(pack.label, "资源包");
    assert.equal(pack.remaining, 200);
    assert.equal(pack.total, 200);
    assert.equal(pack.used, 0);
    assert.equal(pack.remainingPercent, 100);
    assert.equal(pack.resetAt, null);

    assert.equal(calls.length, 2);
    const [exchange, usage] = calls;
    assert.equal(exchange.url, "https://openapi.qoder.com.cn/api/v1/jobToken/exchange");
    assert.equal(exchange.method, "POST");
    assert.equal(exchange.headers["content-type"], "application/json");
    assert.equal(exchange.headers["user-agent"], "qodercli/1.0.0");
    assert.equal(exchange.headers["cosy-clienttype"], "5");
    assert.deepEqual(exchange.body, { personal_token: PAT });

    assert.equal(usage.url, "https://openapi.qoder.com.cn/api/v2/quota/usage");
    assert.equal(usage.method, "GET");
    assert.equal(usage.headers.authorization, "Bearer jt-session-token");
    assert.equal(usage.headers["user-agent"], "Qoder");
    assert.equal(usage.headers["cosy-clienttype"], "10");
    assert.equal(usage.headers["cosy-version"], "0.3.3");
    assert.equal(usage.headers["cosy-machineos"], "windows");
  } finally {
    calls.restore();
  }
});

test("sends an already-issued token straight to the international host", async () => {
  const calls = stubFetch([{ payload: quotaPayload() }]);
  try {
    const result = await dashboard(
      makeApp([account({ key: "dt-device-token", region: "intl" })]),
    );
    assert.equal(result.data.platforms[0].status, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openapi.qoder.sh/api/v2/quota/usage");
    assert.equal(calls[0].headers.authorization, "Bearer dt-device-token");
  } finally {
    calls.restore();
  }
});

test("treats a rejected personal token exchange as invalid_key", async () => {
  const calls = stubFetch([
    { status: 400, payload: { errorCode: "BadRequest", message: "invalid token" } },
  ]);
  try {
    const result = await dashboard(makeApp([account({ key: PAT })]));
    const platform = result.data.platforms[0];
    assert.equal(platform.status, "error");
    assert.equal(platform.error, "invalid_key");
    assert.equal(platform.httpStatus, 400);
    assert.equal(calls.length, 1);
  } finally {
    calls.restore();
  }
});

test("reports a rejected quota request as invalid_key", async () => {
  const calls = stubFetch([
    { payload: { token: "jt-session-token", expires_at: 1790000000 } },
    { status: 401, payload: { code: "TOKEN_INVALID", message: "expired" } },
  ]);
  try {
    const result = await dashboard(makeApp([account({ key: PAT })]));
    const platform = result.data.platforms[0];
    assert.equal(platform.status, "error");
    assert.equal(platform.error, "invalid_key");
    assert.equal(calls[1].url, "https://openapi.qoder.com.cn/api/v2/quota/usage");
  } finally {
    calls.restore();
  }
});

test("rejects a quota payload without a remaining figure", async () => {
  const calls = stubFetch([
    { payload: { token: "jt-session-token", expires_at: 1790000000 } },
    { payload: quotaPayload({ userQuota: { total: 100, used: 10 } }) },
  ]);
  try {
    const result = await dashboard(makeApp([account({ key: PAT })]));
    const platform = result.data.platforms[0];
    assert.equal(platform.status, "error");
    assert.equal(platform.error, "bad_response");
  } finally {
    calls.restore();
  }
});

test("keeps add-on credits in the headline when the plan is spent", async () => {
  const calls = stubFetch([
    { payload: { token: "jt-session-token", expires_at: 1790000000 } },
    {
      payload: quotaPayload({
        userQuota: { total: 300, used: 300, remaining: 0, percentage: 1 },
      }),
    },
  ]);
  try {
    const result = await dashboard(makeApp([account({ key: PAT })]));
    const platform = result.data.platforms[0];
    assert.equal(platform.balance, 200);
    assert.equal(platform.quota[0].remaining, 0);
    assert.equal(platform.quota[1].remaining, 200);
  } finally {
    calls.restore();
  }
});

test("still reads the legacy orgResourcePackage field", async () => {
  const calls = stubFetch([
    {
      payload: quotaPayload({
        addOnQuota: undefined,
        orgResourcePackage: { available: true, used: 100, remaining: 900, cap: 1000 },
      }),
    },
  ]);
  try {
    const result = await dashboard(
      makeApp([account({ key: "dt-device-token", region: "intl" })]),
    );
    const platform = result.data.platforms[0];
    assert.equal(platform.balance, 1067);
    assert.equal(platform.quota.length, 2);
    assert.equal(platform.quota[1].label, "资源包");
    assert.equal(platform.quota[1].remaining, 900);
    assert.equal(platform.quota[1].total, 1000);
  } finally {
    calls.restore();
  }
});

test("hides the resource package when it is absent or unavailable", async () => {
  const empty = stubFetch([
    { payload: { token: "jt-session-token", expires_at: 1790000000 } },
    {
      payload: quotaPayload({
        addOnQuota: { total: 0, used: 0, remaining: 0 },
        orgResourcePackage: { available: false, used: 0, remaining: 0, cap: 0 },
      }),
    },
  ]);
  try {
    const result = await dashboard(makeApp([account({ key: PAT })]));
    const platform = result.data.platforms[0];
    assert.equal(platform.balance, 167);
    assert.equal(platform.quota.length, 1);
    assert.equal(platform.note, "套餐 Credits");
    assert.equal(
      platform.details.some((detail: { label: string }) => detail.label === "资源包剩余"),
      false,
    );
  } finally {
    empty.restore();
  }
});

test("stores a Qoder personal token with its site when creating an account", async () => {
  const stored: StoredAccount[] = [];
  const store: AccountStore = {
    async read() {
      return stored.slice();
    },
    async write(next) {
      stored.splice(0, stored.length, ...next);
    },
  };
  const settings: SettingsStore = {
    async read() {
      return defaultSettings();
    },
    async write() {},
  };
  const handle = application({
    createStore: () => store,
    createSettingsStore: () => settings,
    requireUser: () => ({ user_id: "u1" }),
    load: async (entry) => ({
      id: entry.platform,
      accountId: entry.id,
      label: entry.label,
      status: "ok",
      kind: "quota",
      balance: 1,
      currency: "CNY",
      details: [],
      usage: null,
      quota: [],
      note: null,
      expiresAt: null,
      error: null,
      httpStatus: 200,
      checkedAt: new Date(0).toISOString(),
      cached: false,
    }),
  });
  const create = (credential: Record<string, unknown>) =>
    handle(new Request(`http://local${API}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "qoder", label: "", credential }),
    }));

  const intl = await create({ key: PAT, region: "intl" });
  assert.equal(intl.status, 201);
  assert.deepEqual(stored[0].credential, { key: PAT, region: "intl" });

  const fallback = await create({ key: PAT });
  assert.equal(fallback.status, 201);
  assert.deepEqual(stored[1].credential, { key: PAT, region: "cn" });

  const empty = await create({ key: "   " });
  assert.equal(empty.status, 400);
  assert.equal(stored.length, 2);
});
