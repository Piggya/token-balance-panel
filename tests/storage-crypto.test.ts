import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createDataCipher } from "../server/data-crypto.ts";
import { createStorageCipher, StorageKeyError } from "../functions/storage-crypto.ts";

const keyHex = randomBytes(32).toString("hex");

test("storage cipher round-trips values without leaking plaintext", async () => {
  const cipher = createStorageCipher(keyHex);
  const payload = await cipher.encrypt({ session: "tr_session=secret-value" });
  assert.match(payload, /^v1\./);
  assert.ok(!payload.includes("secret-value"));
  assert.deepEqual(await cipher.decrypt(payload), { session: "tr_session=secret-value" });
  assert.notEqual(payload, await cipher.encrypt({ session: "tr_session=secret-value" }));
});

test("storage cipher rejects tampered payloads and foreign keys", async () => {
  const cipher = createStorageCipher(keyHex);
  const payload = await cipher.encrypt({ key: "sk-hidden" });
  const tampered = `${payload.slice(0, -4)}AAAA`;
  await assert.rejects(cipher.decrypt(tampered), StorageKeyError);
  await assert.rejects(cipher.decrypt("v1.bad"), StorageKeyError);
  await assert.rejects(
    createStorageCipher(randomBytes(32).toString("hex")).decrypt(payload),
    StorageKeyError,
  );
});

test("storage cipher fails closed when the key is missing or malformed", async () => {
  for (const bad of [undefined, null, "", "not-hex", keyHex.slice(0, 62)]) {
    const cipher = createStorageCipher(bad);
    await assert.rejects(cipher.encrypt({ key: "x" }), { message: "data_key_unavailable" });
    await assert.rejects(cipher.decrypt("v1.a.b.c"), { message: "data_key_unavailable" });
  }
});

test("storage and self-host ciphers read each other's payloads", async () => {
  const key = randomBytes(32);
  const nodeCipher = createDataCipher(key);
  const webCipher = createStorageCipher(key.toString("hex"));
  const value = { key: "sk-portable", region: "cn" };
  assert.deepEqual(await webCipher.decrypt(nodeCipher.encrypt(value)), value);
  assert.deepEqual(nodeCipher.decrypt(await webCipher.encrypt(value)), value);
});
