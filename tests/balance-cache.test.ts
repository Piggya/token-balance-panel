import test from "node:test";
import assert from "node:assert/strict";
import { createBalanceCache } from "../functions/balance-cache.ts";
import type { PlatformBalance } from "../functions/balances.ts";

function balance(accountId: string, value: number): PlatformBalance {
  return {
    id: "deepseek",
    accountId,
    label: "",
    status: "ok",
    kind: "balance",
    balance: value,
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

function counter() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    loader(value: number) {
      return async () => {
        calls += 1;
        return balance("a", value);
      };
    },
  };
}

test("serves within the TTL and reloads after expiry", async () => {
  let now = 1_000;
  const cache = createBalanceCache({ ttlMs: 30_000, maxEntries: 10, now: () => now });
  const track = counter();

  const first = await cache.load("u", "a", track.loader(1), false);
  assert.equal(first.cached, false);
  assert.equal(first.value.balance, 1);

  now += 29_999;
  const hit = await cache.load("u", "a", track.loader(2), false);
  assert.equal(hit.cached, true);
  assert.equal(hit.value.balance, 1);
  assert.equal(track.calls, 1);

  now += 1;
  const expired = await cache.load("u", "a", track.loader(3), false);
  assert.equal(expired.cached, false);
  assert.equal(expired.value.balance, 3);
  assert.equal(track.calls, 2);
});

test("refresh bypasses a fresh cache entry", async () => {
  const cache = createBalanceCache({ ttlMs: 30_000, maxEntries: 10, now: () => 1_000 });
  const track = counter();

  await cache.load("u", "a", track.loader(1), false);
  const refreshed = await cache.load("u", "a", track.loader(2), true);
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.value.balance, 2);
  assert.equal(track.calls, 2);
});

test("concurrent callers share one upstream load", async () => {
  const cache = createBalanceCache({ ttlMs: 30_000, maxEntries: 10, now: () => 1_000 });
  let calls = 0;
  let release: (value: PlatformBalance) => void = () => {};
  const loader = () => {
    calls += 1;
    return new Promise<PlatformBalance>((resolve) => {
      release = resolve;
    });
  };

  const a = cache.load("u", "a", loader, false);
  const b = cache.load("u", "a", loader, false);
  await Promise.resolve();
  assert.equal(calls, 1);
  release(balance("a", 7));
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.value.balance, 7);
  assert.equal(second.value.balance, 7);
  assert.equal(calls, 1);
});

test("invalidation drops the entry for that account only", async () => {
  const cache = createBalanceCache({ ttlMs: 30_000, maxEntries: 10, now: () => 1_000 });
  let calls = 0;
  const loader = (value: number) => async () => {
    calls += 1;
    return balance("a", value);
  };

  await cache.load("u", "a", loader(1), false);
  await cache.load("u", "b", loader(2), false);
  cache.invalidate("u", "a");

  const a = await cache.load("u", "a", loader(3), false);
  const b = await cache.load("u", "b", loader(4), false);
  assert.equal(a.cached, false);
  assert.equal(a.value.balance, 3);
  assert.equal(b.cached, true);
  assert.equal(b.value.balance, 2);
  assert.equal(calls, 3);
});

test("evicts the oldest entry beyond maxEntries", async () => {
  const cache = createBalanceCache({ ttlMs: 30_000, maxEntries: 2, now: () => 1_000 });
  let calls = 0;
  const loader = (id: string) => async () => {
    calls += 1;
    return balance(id, 1);
  };

  await cache.load("u", "a", loader("a"), false);
  await cache.load("u", "b", loader("b"), false);
  await cache.load("u", "c", loader("c"), false);
  assert.equal(calls, 3);

  const a = await cache.load("u", "a", loader("a"), false);
  const c = await cache.load("u", "c", loader("c"), false);
  assert.equal(a.cached, false);
  assert.equal(c.cached, true);
  assert.equal(calls, 4);
});
