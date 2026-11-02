import test from "node:test";
import assert from "node:assert/strict";
import { application } from "../functions/routes.ts";
import type { AccountStore, StoredAccount } from "../functions/accounts.ts";
import type { PlatformBalance } from "../functions/balances.ts";
import {
  defaultSettings,
  type Settings,
  type SettingsStore,
} from "../functions/settings.ts";

const API = "/functions/v1/app/api";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function memoryAccounts(initial: StoredAccount[] = []) {
  let value = initial.slice();
  const store: AccountStore = {
    async read() {
      return value.slice();
    },
    async write(next) {
      value = next.slice();
    },
  };
  return { store, current: () => value };
}

function memorySettings(initial: Settings = defaultSettings()) {
  let value = initial;
  const store: SettingsStore = {
    async read() {
      return value;
    },
    async write(next) {
      value = next;
    },
  };
  return { store, current: () => value };
}

function balanceFor(account: StoredAccount): PlatformBalance {
  return {
    id: account.platform,
    accountId: account.id,
    label: account.label,
    status: "ok",
    kind: "balance",
    balance: 88,
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
  };
}

function makeApp(options: {
  accounts?: StoredAccount[];
  settings?: Settings;
  limits?: { dashboardPerMinute: number; writesPerMinute: number };
  requireUser?: () => unknown;
} = {}) {
  const accounts = memoryAccounts(options.accounts);
  const settings = memorySettings(options.settings);
  const calls: string[] = [];
  let clock = 0;
  const handle = application({
    createStore: () => accounts.store,
    createSettingsStore: () => settings.store,
    requireUser: options.requireUser ?? (() => ({ user_id: "u1" })),
    load: async (account) => {
      calls.push(account.id);
      return balanceFor(account);
    },
    now: () => clock,
    ...(options.limits ? { limits: options.limits } : {}),
  });
  return {
    handle,
    accounts,
    settings,
    calls,
    advance(ms: number) {
      clock += ms;
    },
  };
}

function call(handle: (request: Request) => Promise<Response>, path: string, init?: RequestInit) {
  return handle(new Request(`http://local${API}${path}`, init));
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function body(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

test("requires a user context", async () => {
  const app = makeApp({
    requireUser: () => {
      throw Object.assign(new Error("login"), { code: "login_required", status: 401 });
    },
  });
  const response = await call(app.handle, "/dashboard");
  assert.equal(response.status, 401);
  assert.equal((await body(response)).error, "login_required");
});

test("rejects an invalid user context", async () => {
  const app = makeApp({ requireUser: () => ({}) });
  const response = await call(app.handle, "/dashboard");
  assert.equal(response.status, 403);
  assert.equal((await body(response)).error, "invalid_user_context");
});

test("starts with an empty dashboard", async () => {
  const app = makeApp();
  const response = await call(app.handle, "/dashboard");
  const data = await body(response);
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.deepEqual(data.platforms, []);
  assert.equal(data.fetchedAt, new Date(0).toISOString());
});

test("creates accounts without returning credentials and allows duplicates", async () => {
  const app = makeApp();
  const first = await call(
    app.handle,
    "/accounts",
    jsonRequest("POST", {
      platform: "deepseek",
      label: "主账号",
      credential: { key: "sk-live-123456" },
    }),
  );
  const firstBody = await body(first);
  assert.equal(first.status, 201);
  assert.match(firstBody.account.id, UUID);
  assert.equal(firstBody.account.label, "主账号");
  assert.equal("credential" in firstBody.account, false);
  assert.equal(JSON.stringify(firstBody).includes("sk-live"), false);

  const second = await call(
    app.handle,
    "/accounts",
    jsonRequest("POST", {
      platform: "deepseek",
      label: "",
      credential: { key: "sk-live-abcdef" },
    }),
  );
  const secondBody = await body(second);
  assert.equal(secondBody.account.label, "账号 2");
  assert.equal(app.accounts.current().length, 2);
  assert.equal(app.accounts.current()[0].credential.key, "sk-live-123456");

  const dashboard = await body(await call(app.handle, "/dashboard"));
  assert.equal(dashboard.platforms.length, 2);
  assert.equal(dashboard.platforms[0].id, "deepseek");
  assert.equal(JSON.stringify(dashboard).includes("sk-live"), false);
});

test("serves from the server cache until the TTL or a forced refresh", async () => {
  const app = makeApp();
  await call(
    app.handle,
    "/accounts",
    jsonRequest("POST", {
      platform: "moonshot",
      label: "",
      credential: { key: "sk-moon-123456" },
    }),
  );

  const first = await body(await call(app.handle, "/dashboard"));
  assert.equal(first.platforms[0].cached, false);
  assert.equal(app.calls.length, 1);

  const second = await body(await call(app.handle, "/dashboard"));
  assert.equal(second.platforms[0].cached, true);
  assert.equal(app.calls.length, 1);

  app.advance(30_000);
  const expired = await body(await call(app.handle, "/dashboard"));
  assert.equal(expired.platforms[0].cached, false);
  assert.equal(app.calls.length, 2);

  const forced = await body(await call(app.handle, "/dashboard?refresh=1"));
  assert.equal(forced.platforms[0].cached, false);
  assert.equal(app.calls.length, 3);
});

test("updating or removing an account invalidates its cached balance", async () => {
  const app = makeApp();
  const created = await body(await call(
    app.handle,
    "/accounts",
    jsonRequest("POST", {
      platform: "siliconflow",
      label: "",
      credential: { session: "__SF_auth.session-token=test-session" },
    }),
  ));
  const id = created.account.id as string;

  await call(app.handle, "/dashboard");
  assert.equal(app.calls.length, 1);

  const patched = await call(
    app.handle,
    `/accounts/${id}`,
    jsonRequest("PATCH", { label: "备用" }),
  );
  assert.equal(patched.status, 200);
  const afterPatch = await body(await call(app.handle, "/dashboard"));
  assert.equal(afterPatch.platforms[0].label, "备用");
  assert.equal(afterPatch.platforms[0].cached, false);
  assert.equal(app.calls.length, 2);

  await call(app.handle, "/dashboard");
  assert.equal(app.calls.length, 2);

  const removed = await call(app.handle, `/accounts/${id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  const afterDelete = await body(await call(app.handle, "/dashboard"));
  assert.deepEqual(afterDelete.platforms, []);
  assert.equal(app.calls.length, 2);
});

test("validates account input before touching the store", async () => {
  const app = makeApp();
  const badKey = await call(
    app.handle,
    "/accounts",
    jsonRequest("POST", {
      platform: "deepseek",
      label: "",
      credential: { key: "has space" },
    }),
  );
  assert.equal(badKey.status, 400);
  assert.equal((await body(badKey)).error, "invalid_input");
  assert.equal(app.accounts.current().length, 0);

  const badType = await call(app.handle, "/accounts", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(badType.status, 400);

  const malformed = await call(app.handle, "/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});

test("stores settings on the server and validates updates", async () => {
  const app = makeApp();
  const initial = await body(await call(app.handle, "/settings"));
  assert.equal(initial.settings.intervalSec, 60);
  assert.equal(initial.settings.thresholds.deepseek, 10);

  const updated = await call(
    app.handle,
    "/settings",
    jsonRequest("PUT", {
      intervalSec: 30,
      thresholds: { deepseek: 5, openrouter: 1.5 },
    }),
  );
  const updatedBody = await body(updated);
  assert.equal(updated.status, 200);
  assert.equal(updatedBody.settings.intervalSec, 30);
  assert.equal(updatedBody.settings.thresholds.deepseek, 5);
  assert.equal(updatedBody.settings.thresholds.moonshot, 10);

  const readBack = await body(await call(app.handle, "/settings"));
  assert.deepEqual(readBack.settings, updatedBody.settings);
  assert.equal(app.settings.current().intervalSec, 30);

  const invalid = await call(
    app.handle,
    "/settings",
    jsonRequest("PUT", { intervalSec: 15, thresholds: {} }),
  );
  assert.equal(invalid.status, 400);
  assert.equal((await body(invalid)).error, "invalid_settings");
  assert.equal(app.settings.current().intervalSec, 30);
});

test("persists the custom card order in settings", async () => {
  const app = makeApp();
  const saved = await call(
    app.handle,
    "/settings",
    jsonRequest("PUT", {
      intervalSec: 60,
      thresholds: {},
      order: ["account-b", "account-a"],
    }),
  );
  assert.equal(saved.status, 200);
  assert.deepEqual((await body(saved)).settings.order, ["account-b", "account-a"]);

  const readBack = await body(await call(app.handle, "/settings"));
  assert.deepEqual(readBack.settings.order, ["account-b", "account-a"]);

  const invalid = await call(
    app.handle,
    "/settings",
    jsonRequest("PUT", { intervalSec: 60, thresholds: {}, order: "account-b" }),
  );
  assert.equal(invalid.status, 400);
  assert.equal((await body(invalid)).error, "invalid_settings");
  assert.deepEqual(app.settings.current().order, ["account-b", "account-a"]);
});

test("rate limits reads per user", async () => {
  const app = makeApp({ limits: { dashboardPerMinute: 2, writesPerMinute: 10 } });
  assert.equal((await call(app.handle, "/dashboard")).status, 200);
  assert.equal((await call(app.handle, "/dashboard")).status, 200);
  const limited = await call(app.handle, "/dashboard");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal((await body(limited)).error, "rate_limited");
  app.advance(60_000);
  assert.equal((await call(app.handle, "/dashboard")).status, 200);
});

test("rate limits writes per user", async () => {
  const app = makeApp({ limits: { dashboardPerMinute: 10, writesPerMinute: 1 } });
  const create = () =>
    call(
      app.handle,
      "/accounts",
      jsonRequest("POST", {
        platform: "openrouter",
        label: "",
        credential: { key: "sk-or-123456" },
      }),
    );
  assert.equal((await create()).status, 201);
  const limited = await create();
  assert.equal(limited.status, 429);
  assert.equal(app.accounts.current().length, 1);
});

test("returns 405 and 404 for unsupported routes", async () => {
  const app = makeApp();
  const wrongMethod = await call(app.handle, "/dashboard", { method: "POST" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");

  const unknown = await call(app.handle, "/unknown");
  assert.equal(unknown.status, 404);
});
