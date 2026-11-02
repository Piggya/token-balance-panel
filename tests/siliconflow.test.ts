import test from "node:test";
import assert from "node:assert/strict";
import { application } from "../functions/routes.ts";
import type { AccountStore, StoredAccount } from "../functions/accounts.ts";
import { defaultSettings, type SettingsStore } from "../functions/settings.ts";

const API = "/functions/v1/app/api";
const COOKIE = "__SF_auth.session-token=eyJhbGciOiJkaXIi.test.token";

interface Captured {
  url: string;
  headers: Record<string, string>;
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
    calls.push({ url: String(input), headers });
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

function makeApp(credential: StoredAccount["credential"]) {
  const account: StoredAccount = {
    id: "22222222-2222-4222-8222-222222222222",
    platform: "siliconflow",
    label: "主号",
    credential,
    createdAt: new Date(0).toISOString(),
  };
  const store: AccountStore = {
    async read() {
      return [account];
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
  return (await response.json()) as Record<string, any>;
}

test("reads SiliconFlow balance through the console session", async () => {
  const calls = stubFetch([
    {
      payload: {
        code: 20000,
        data: { subjects: [{ subjectId: "sub-1", name: "个人" }] },
      },
    },
    {
      payload: {
        code: 20000,
        data: {
          financialInfo: {
            balance: "2802770400000",
            available: "2802770400000",
            recharged: "7000000000000",
            used: "4197229600000",
            lineOfCredit: "0",
            remainingCreditLine: "0",
          },
        },
      },
    },
  ]);
  try {
    const data = await dashboard(makeApp({ session: COOKIE }));
    const platform = data.platforms[0];
    assert.equal(platform.status, "ok");
    assert.ok(Math.abs(platform.balance - 2.8027704) < 1e-9);
    assert.ok(Math.abs(platform.usage.used - 4.1972296) < 1e-9);
    assert.equal(platform.usage.total, 7);
    assert.equal(platform.note, "控制台余额");
    assert.deepEqual(
      platform.details.map((detail: { label: string }) => detail.label),
      ["累计充值", "累计已用"],
    );

    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].url,
      "https://cloud.siliconflow.cn/iam-server/api/v1/my/subjects",
    );
    assert.equal(calls[0].headers.cookie, COOKIE);
    assert.match(calls[0].headers["user-agent"] ?? "", /Mozilla\/5\.0/);
    assert.equal(
      calls[1].url,
      "https://cloud.siliconflow.cn/walletd-server/api/v1/subject/profile/peek",
    );
    assert.equal(calls[1].headers["x-subject-id"], "sub-1");
    assert.equal(calls[1].headers.cookie, COOKIE);
  } finally {
    calls.restore();
  }
});

test("reports an expired SiliconFlow session as invalid_session", async () => {
  const calls = stubFetch([{ status: 401, payload: { code: 30001 } }]);
  try {
    const data = await dashboard(makeApp({ session: COOKIE }));
    assert.equal(data.platforms[0].status, "error");
    assert.equal(data.platforms[0].error, "invalid_session");
    assert.equal(data.platforms[0].httpStatus, 401);
  } finally {
    calls.restore();
  }
});

test("rejects a SiliconFlow response without a subject id", async () => {
  const calls = stubFetch([
    { payload: { code: 40003, message: "Forbidden" } },
  ]);
  try {
    const data = await dashboard(makeApp({ session: COOKIE }));
    assert.equal(data.platforms[0].status, "error");
    assert.equal(data.platforms[0].error, "invalid_session");
  } finally {
    calls.restore();
  }
});
