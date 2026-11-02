import test from "node:test";
import assert from "node:assert/strict";
import { parseStored, validateCreate, DraftError, StoreFormatError } from "../functions/accounts.ts";

const base = {
  id: "e346a90b-4b6c-4de9-a161-ccfc40709b47",
  label: "旧账号",
  createdAt: "2026-10-01T00:00:00.000Z",
};

test("keeps stored credentials that predate a platform auth change", () => {
  const [account] = parseStored({
    accounts: [{ ...base, platform: "siliconflow", credential: { key: "sk-legacy" } }],
  });
  assert.deepEqual(account.credential, { key: "sk-legacy" });
});

test("still normalizes credentials that match the current schema", () => {
  const [account] = parseStored({
    accounts: [{
      ...base,
      platform: "siliconflow",
      credential: { session: "__SF_auth.session-token=abc" },
    }],
  });
  assert.deepEqual(account.credential, { session: "__SF_auth.session-token=abc" });
});

test("rejects stored entries without any usable credential", () => {
  for (const credential of [{}, { key: "" }, { key: "   " }, null]) {
    assert.throws(
      () => parseStored({ accounts: [{ ...base, platform: "deepseek", credential }] }),
      StoreFormatError,
    );
  }
});

test("zhipu accepts an API key or a console token", () => {
  assert.deepEqual(
    validateCreate({ platform: "zhipu", credential: { key: "abc.def" } }).credential,
    { key: "abc.def" },
  );
  assert.deepEqual(
    validateCreate({
      platform: "zhipu",
      credential: { session: "bigmodel_token_production=jwt-token" },
    }).credential,
    { session: "bigmodel_token_production=jwt-token" },
  );
  assert.throws(
    () => validateCreate({ platform: "zhipu", credential: {} }),
    DraftError,
  );
});
