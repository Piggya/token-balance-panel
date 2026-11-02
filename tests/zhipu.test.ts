import test from "node:test";
import assert from "node:assert/strict";
import { loadAccount } from "../functions/balances.ts";
import type { StoredAccount } from "../functions/accounts.ts";

const RESET_AT = 1790000000000;

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

function account(credential: StoredAccount["credential"]): StoredAccount {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    platform: "zhipu",
    label: "主号",
    credential,
    createdAt: new Date(0).toISOString(),
  };
}

test("maps GLM Coding Plan windows from the quota endpoint", async () => {
  const calls = stubFetch([{
    payload: {
      code: 200,
      success: true,
      data: {
        level: "pro",
        limits: [
          { type: "TOKENS_LIMIT", unit: 6, percentage: 12.5, nextResetTime: RESET_AT },
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            percentage: 40,
            nextResetTime: RESET_AT + 3_600_000,
          },
        ],
      },
    },
  }]);
  try {
    const platform = await loadAccount(account({ key: "abc.def" }));
    assert.equal(platform.status, "ok");
    assert.equal(platform.kind, "quota");
    assert.equal(platform.balance, 60);
    assert.equal(platform.note, "GLM Coding Plan · PRO");
    assert.equal(platform.quota.length, 2);
    assert.equal(platform.quota[0].label, "5 小时窗口");
    assert.equal(platform.quota[0].remainingPercent, 60);
    assert.equal(platform.quota[1].label, "本周");
    assert.equal(platform.quota[1].remainingPercent, 87.5);
    assert.equal(calls[0].url, "https://open.bigmodel.cn/api/monitor/usage/quota/limit");
    // API keys are sent raw; the endpoint rejects a Bearer prefix.
    assert.equal(calls[0].headers.authorization, "abc.def");
  } finally {
    calls.restore();
  }
});

test("falls back to CREDIT_LIMIT windows when no TOKENS_LIMIT is reported", async () => {
  const calls = stubFetch([{
    payload: {
      success: true,
      data: {
        limits: [
          { type: "CREDIT_LIMIT", unit: 3, percentage: 0 },
          { type: "CREDIT_LIMIT", unit: 6, percentage: 25 },
        ],
      },
    },
  }]);
  try {
    const platform = await loadAccount(account({ key: "abc.def" }));
    assert.equal(platform.status, "ok");
    assert.equal(platform.quota.length, 2);
    assert.equal(platform.quota[0].remainingPercent, 100);
    assert.equal(platform.quota[1].remainingPercent, 75);
    assert.equal(platform.note, "GLM Coding Plan");
  } finally {
    calls.restore();
  }
});

test("classifies entries without a unit by reset order", async () => {
  const calls = stubFetch([{
    payload: {
      success: true,
      data: {
        limits: [
          { type: "TOKENS_LIMIT", percentage: 10, nextResetTime: RESET_AT + 7_200_000 },
          { type: "TOKENS_LIMIT", percentage: 30, nextResetTime: RESET_AT + 3_600_000 },
        ],
      },
    },
  }]);
  try {
    const platform = await loadAccount(account({ key: "abc.def" }));
    assert.equal(platform.quota[0].label, "5 小时窗口");
    assert.equal(platform.quota[0].remainingPercent, 70);
    assert.equal(platform.quota[1].label, "本周");
    assert.equal(platform.quota[1].remainingPercent, 90);
  } finally {
    calls.restore();
  }
});

test("reads the CNY account balance from a console token", async () => {
  const calls = stubFetch([{
    payload: { code: 200, success: true, data: { balance: "42.75" } },
  }]);
  try {
    const platform = await loadAccount(
      account({ session: "bigmodel_token_production=jwt-token; other=1" }),
    );
    assert.equal(platform.status, "ok");
    assert.equal(platform.kind, "balance");
    assert.equal(platform.balance, 42.75);
    assert.equal(platform.currency, "CNY");
    assert.equal(platform.note, "控制台账户余额");
    assert.equal(platform.quota.length, 0);
    assert.equal(
      calls[0].url,
      "https://open.bigmodel.cn/api/biz/account/query-customer-account-report",
    );
    // The cookie value is unwrapped and sent without a Bearer prefix.
    assert.equal(calls[0].headers.authorization, "jwt-token");
  } finally {
    calls.restore();
  }
});

test("rejected credentials surface as card errors", async () => {
  const calls = stubFetch([{
    payload: { code: 401, msg: "令牌已过期或验证不正确", success: false },
  }]);
  try {
    const quota = await loadAccount(account({ key: "abc.def" }));
    assert.equal(quota.status, "error");
    assert.equal(quota.error, "invalid_key");
    const balance = await loadAccount(account({ session: "expired-token" }));
    assert.equal(balance.status, "error");
    assert.equal(balance.error, "invalid_session");
  } finally {
    calls.restore();
  }
});
