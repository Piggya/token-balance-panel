import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../functions/rate-limit.ts";

test("allows the limit then rejects until the window resets", () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

  assert.equal(limiter.check("u").allowed, true);
  assert.equal(limiter.check("u").allowed, true);
  assert.equal(limiter.check("u").allowed, true);
  const denied = limiter.check("u");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSec, 60);

  now = 30_000;
  const stillDenied = limiter.check("u");
  assert.equal(stillDenied.allowed, false);
  assert.equal(stillDenied.retryAfterSec, 30);

  now = 60_000;
  assert.equal(limiter.check("u").allowed, true);
});

test("keys are isolated", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, false);
  assert.equal(limiter.check("b").allowed, true);
});

test("trims old keys when the registry is full", () => {
  let now = 0;
  const limiter = createRateLimiter({
    limit: 10,
    windowMs: 1_000,
    maxKeys: 2,
    now: () => now,
  });

  limiter.check("a");
  limiter.check("b");
  now = 2_000;
  limiter.check("c");
  assert.equal(limiter.check("d").allowed, true);
  assert.equal(limiter.check("c").allowed, true);
});
