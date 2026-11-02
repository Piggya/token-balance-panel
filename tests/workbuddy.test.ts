import test from "node:test";
import assert from "node:assert/strict";
import { application } from "../functions/routes.ts";
import type { AccountStore, StoredAccount } from "../functions/accounts.ts";
import { defaultSettings, type SettingsStore } from "../functions/settings.ts";

const API = "/functions/v1/app/api";
const COOKIE = "session=abc123def456; session_2=ghi789jkl012";

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

function resourcePayload(accounts: Record<string, unknown>[]) {
  return { code: 0, data: { Response: { Data: { Accounts: accounts } } } };
}

function account(credential: StoredAccount["credential"]): StoredAccount {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    platform: "workbuddy",
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

test("queries WorkBuddy credits with the session cookie header", async () => {
  const calls = stubFetch([
    {
      payload: resourcePayload([
        {
          PackageName: "Pro 套餐",
          CycleCapacitySizePrecise: 80,
          CycleCapacityRemainPrecise: 61.11,
          CycleEndTime: 1790000000000,
        },
        {
          PackageName: "加量包",
          CycleCapacitySizePrecise: 30,
          CycleCapacityRemainPrecise: 0,
        },
      ]),
    },
  ]);
  try {
    const result = await dashboard(makeApp([account({ session: COOKIE, region: "cn" })]));
    assert.equal(result.status, 200);
    const platform = result.data.platforms[0];
    assert.equal(platform.status, "ok");
    assert.equal(platform.balance, 61.11);
    assert.ok(Math.abs(platform.usage.used - 48.89) < 1e-9);
    assert.equal(platform.usage.total, 110);
    assert.equal(platform.note, "共 2 个积分包");
    assert.equal(platform.expiresAt, null);
    assert.deepEqual(
      platform.details.map((detail: { label: string }) => detail.label),
      ["累计获得", "累计已用"],
    );

    assert.equal(calls.length, 1);
    const [request] = calls;
    assert.equal(request.url, "https://www.workbuddy.cn/billing/meter/get-user-resource");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.cookie, COOKIE);
    assert.equal(request.headers["x-client-platform"], "web");
    assert.match(request.headers["user-agent"] ?? "", /Mozilla\/5\.0/);
    assert.deepEqual(request.body, {
      PageNumber: 1,
      PageSize: 100,
      Status: [0, 3],
      OnlyValidPeriod: true,
    });
  } finally {
    calls.restore();
  }
});

test("treats a bare cookie value as the session cookie", async () => {
  const calls = stubFetch([
    {
      payload: resourcePayload([
        { CycleCapacitySizePrecise: 10, CycleCapacityRemainPrecise: 4 },
      ]),
    },
  ]);
  try {
    const result = await dashboard(makeApp([account({ session: "plainSessionValue" })]));
    assert.equal(result.data.platforms[0].status, "ok");
    assert.equal(calls[0].headers.cookie, "session=plainSessionValue");
  } finally {
    calls.restore();
  }
});

test("reports an expired session as invalid_session", async () => {
  const calls = stubFetch([{ status: 401, payload: { message: "unauthorized" } }]);
  try {
    const result = await dashboard(makeApp([account({ session: COOKIE })]));
    const platform = result.data.platforms[0];
    assert.equal(platform.status, "error");
    assert.equal(platform.error, "invalid_session");
    assert.equal(platform.httpStatus, 401);
  } finally {
    calls.restore();
  }
});

test("still supports accounts stored with the legacy bearer token", async () => {
  const calls = stubFetch([
    {
      payload: resourcePayload([
        { CycleCapacitySizePrecise: 100, CycleCapacityRemainPrecise: 25 },
      ]),
    },
  ]);
  try {
    const result = await dashboard(
      makeApp([account({ token: "eyJhbGciOi.test.token", uid: "u-1", region: "intl" })]),
    );
    assert.equal(result.data.platforms[0].balance, 25);
    assert.equal(calls[0].url, "https://www.workbuddy.ai/v2/billing/meter/get-user-resource");
    assert.equal(calls[0].headers.authorization, "Bearer eyJhbGciOi.test.token");
    assert.equal(calls[0].headers["x-user-id"], "u-1");
    assert.equal(calls[0].headers.cookie, undefined);
  } finally {
    calls.restore();
  }
});

test("accepts a pasted WorkBuddy cookie header when creating an account", async () => {
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
      kind: "credits",
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
      body: JSON.stringify({ platform: "workbuddy", label: "", credential }),
    }));

  const ok = await create({ session: COOKIE, region: "intl" });
  assert.equal(ok.status, 201);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].credential, { session: COOKIE, region: "intl" });

  const control = await create({ session: "session=abc\r\nInjected: 1" });
  assert.equal(control.status, 400);
  assert.equal(stored.length, 1);
});
