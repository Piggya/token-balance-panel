import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSession } from "../functions/session.ts";

test("accepts a bare session value", () => {
  assert.equal(normalizeSession("  abcdefghij1234567890  "), "abcdefghij1234567890");
});

test("accepts the tr_session= prefix", () => {
  assert.equal(
    normalizeSession("tr_session=abcdefghij1234567890"),
    "abcdefghij1234567890",
  );
});

test("finds tr_session anywhere in a full cookie header", () => {
  assert.equal(
    normalizeSession("_ga=abc; tr_ref_device=device; tr_session=abcdefghij1234567890; other=1"),
    "abcdefghij1234567890",
  );
});

test("rejects a cookie header without tr_session", () => {
  assert.equal(
    normalizeSession("tr_ref_device=9wHBHO8yj6FH0u30X-m5tgmFfoUrtlcv"),
    null,
  );
  assert.equal(normalizeSession("_ga=abc; other=1"), null);
});

test("rejects values that are too short, too long, or malformed", () => {
  assert.equal(normalizeSession("short"), null);
  assert.equal(normalizeSession("x".repeat(4097)), null);
  assert.equal(normalizeSession("bad value with spaces"), null);
  assert.equal(normalizeSession("bad\nvalue12345"), null);
  assert.equal(normalizeSession(""), null);
});

test("keeps allowed cookie characters and trailing padding", () => {
  assert.equal(
    normalizeSession("abc%2Fdef.ghi_jkl-mno+pqr/stuvw=="),
    "abc%2Fdef.ghi_jkl-mno+pqr/stuvw==",
  );
});
