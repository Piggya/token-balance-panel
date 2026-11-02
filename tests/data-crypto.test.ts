import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createDataCipher,
  DataKeyError,
  loadDataKey,
} from "../server/data-crypto.ts";
import { createAccountStore, createSettingsStore } from "../server/file-store.ts";
import type { StoredAccount } from "../functions/accounts.ts";
import { defaultSettings } from "../functions/settings.ts";

const POSIX = process.platform !== "win32";

async function assertMode(file: string, mode: number): Promise<void> {
  if (!POSIX) return;
  assert.equal((await stat(file)).mode & 0o777, mode);
}

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "panel-crypto-"));
}

function account(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    platform: "deepseek",
    label: "主账号",
    credential: { key: "sk-plaintext-secret-value" },
    createdAt: "2026-10-28T00:00:00.000Z",
    ...overrides,
  };
}

test("cipher round-trips values without leaking plaintext", () => {
  const cipher = createDataCipher(randomBytes(32));
  const payload = cipher.encrypt({ key: "sk-hidden" });
  assert.match(payload, /^v1\./);
  assert.ok(!payload.includes("sk-hidden"));
  assert.deepEqual(cipher.decrypt(payload), { key: "sk-hidden" });
  assert.notEqual(payload, cipher.encrypt({ key: "sk-hidden" }));
});

test("cipher rejects tampered payloads and foreign keys", () => {
  const cipher = createDataCipher(randomBytes(32));
  const payload = cipher.encrypt({ key: "sk-hidden" });
  const tampered = `${payload.slice(0, -4)}AAAA`;
  assert.throws(() => cipher.decrypt(tampered), DataKeyError);
  assert.throws(() => cipher.decrypt("v1.bad"), DataKeyError);
  assert.throws(() => createDataCipher(randomBytes(32)).decrypt(payload), DataKeyError);
});

test("loadDataKey persists a 0600 key and reuses it", async () => {
  const dataDir = await tempDir();
  try {
    const first = await loadDataKey(dataDir);
    const second = await loadDataKey(dataDir);
    assert.deepEqual(first, second);
    await assertMode(join(dataDir, "data-key"), 0o600);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("loadDataKey prefers PANEL_DATA_KEY over the file", async () => {
  const dataDir = await tempDir();
  const override = randomBytes(32).toString("hex");
  const previous = process.env.PANEL_DATA_KEY;
  process.env.PANEL_DATA_KEY = override;
  try {
    const key = await loadDataKey(dataDir);
    assert.equal(key.toString("hex"), override);
  } finally {
    if (previous === undefined) delete process.env.PANEL_DATA_KEY;
    else process.env.PANEL_DATA_KEY = previous;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("account store writes ciphertext with mode 600 and reads it back", async () => {
  const dataDir = await tempDir();
  try {
    const store = createAccountStore(dataDir, createDataCipher(randomBytes(32)));
    await store.write([account()]);
    const raw = await readFile(join(dataDir, "accounts.json"), "utf8");
    assert.ok(!raw.includes("sk-plaintext-secret-value"));
    assert.equal(JSON.parse(raw).version, 2);
    await assertMode(join(dataDir, "accounts.json"), 0o600);
    const read = await store.read();
    assert.equal(read.length, 1);
    assert.equal(read[0].credential.key, "sk-plaintext-secret-value");
    assert.equal(read[0].label, "主账号");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("account store migrates legacy plaintext entries on read", async () => {
  const dataDir = await tempDir();
  try {
    const legacy = { version: 1, accounts: [account()] };
    await writeFile(join(dataDir, "accounts.json"), JSON.stringify(legacy));
    await chmod(join(dataDir, "accounts.json"), 0o644);
    const store = createAccountStore(dataDir, createDataCipher(randomBytes(32)));
    const read = await store.read();
    assert.equal(read[0].credential.key, "sk-plaintext-secret-value");
    const raw = await readFile(join(dataDir, "accounts.json"), "utf8");
    assert.ok(!raw.includes("sk-plaintext-secret-value"));
    assert.equal(JSON.parse(raw).version, 2);
    await assertMode(join(dataDir, "accounts.json"), 0o600);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("account store reports an error when the key cannot decrypt", async () => {
  const dataDir = await tempDir();
  try {
    await createAccountStore(dataDir, createDataCipher(randomBytes(32))).write([account()]);
    const store = createAccountStore(dataDir, createDataCipher(randomBytes(32)));
    await assert.rejects(store.read(), { name: "AccountStoreError" });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("settings store persists with mode 600", async () => {
  const dataDir = await tempDir();
  try {
    const store = createSettingsStore(dataDir);
    assert.deepEqual(await store.read(), defaultSettings());
    const settings = { ...defaultSettings(), intervalSec: 30 };
    await store.write(settings);
    assert.deepEqual(await store.read(), settings);
    await assertMode(join(dataDir, "settings.json"), 0o600);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
