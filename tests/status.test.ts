import test from "node:test";
import assert from "node:assert/strict";
import { levelOf, quotaPercent } from "../lib/status.ts";
import type { PlatformBalance, QuotaWindow } from "../lib/balance.ts";

function window(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    label: "套餐额度",
    used: null,
    total: null,
    remaining: null,
    remainingPercent: null,
    unit: "Credits",
    resetAt: null,
    ...overrides,
  };
}

function platform(overrides: Partial<PlatformBalance> = {}): PlatformBalance {
  return {
    id: "qoder",
    accountId: "22222222-2222-4222-8222-222222222222",
    label: "",
    status: "ok",
    kind: "quota",
    balance: null,
    currency: "CNY",
    details: [],
    usage: null,
    quota: [],
    note: null,
    expiresAt: null,
    error: null,
    httpStatus: 200,
    cached: false,
    ...overrides,
  };
}

test("aggregates the plan and add-on pack behind the headline balance", () => {
  const qoder = platform({
    balance: 367,
    quota: [
      window({ used: 133, total: 300, remaining: 167, remainingPercent: 55.7 }),
      window({ label: "资源包", used: 0, total: 200, remaining: 200, remainingPercent: 100 }),
    ],
  });
  assert.equal(Math.round(quotaPercent(qoder)! * 10) / 10, 73.4);
  assert.equal(levelOf(qoder, 0), "ok");
});

test("is not empty while add-on credits remain", () => {
  const spentPlan = platform({
    balance: 200,
    quota: [
      window({ used: 300, total: 300, remaining: 0, remainingPercent: 0 }),
      window({ label: "资源包", used: 0, total: 200, remaining: 200, remainingPercent: 100 }),
    ],
  });
  assert.equal(quotaPercent(spentPlan), 40);
  assert.equal(levelOf(spentPlan, 0), "ok");

  const drained = platform({
    balance: 0,
    quota: [
      window({ used: 300, total: 300, remaining: 0, remainingPercent: 0 }),
      window({ label: "资源包", used: 200, total: 200, remaining: 0, remainingPercent: 0 }),
    ],
  });
  assert.equal(quotaPercent(drained), 0);
  assert.equal(levelOf(drained, 0), "empty");
});

test("keeps the primary window when it is the headline number", () => {
  const minimax = platform({
    id: "minimax",
    balance: 0,
    quota: [
      window({ label: "5 小时窗口", used: 500, total: 500, remaining: 0, unit: "次" }),
      window({ label: "本周", used: 1000, total: 5000, remaining: 4000, unit: "次" }),
    ],
  });
  assert.equal(quotaPercent(minimax), 0);
  assert.equal(levelOf(minimax, 0), "empty");
});

test("falls back to a percent-only window", () => {
  const percentOnly = platform({
    balance: 55.7,
    quota: [window({ remainingPercent: 55.7 })],
  });
  assert.equal(quotaPercent(percentOnly), 55.7);
  assert.equal(levelOf(percentOnly, 0), "ok");
});