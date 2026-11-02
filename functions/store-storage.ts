import {
  AccountStoreError,
  parseStored,
  type AccountStore,
  type StoredAccount,
} from "./accounts.ts";
import {
  defaultSettings,
  parseStoredSettings,
  SettingsStoreError,
  type Settings,
  type SettingsStore,
} from "./settings.ts";
import type { StorageCipher } from "./storage-crypto.ts";

const MAX_BYTES = 512 * 1024;
const MAX_SETTINGS_BYTES = 64 * 1024;

interface StorageLike {
  download(path: string): Promise<Response>;
  upload(
    path: string,
    bytes: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): Promise<unknown>;
}

async function objectPath(userId: string, file: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `accounts/${hex}/${file}`;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  if (code.includes("not_found") || code.includes("notfound")) return true;
  if (candidate?.status === 404) return true;
  const message = typeof candidate?.message === "string"
    ? candidate.message.toLowerCase()
    : "";
  return message.includes("not found") || message.includes("does not exist");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Storage version 2 keeps id/platform/label readable but stores the credential
// as `{ enc: "v1.<iv>.<tag>.<ciphertext>" }`. Version 1 entries (plaintext) are
// decrypted transparently and rewritten encrypted on the next read.
async function decodeAccounts(
  text: string,
  cipher: StorageCipher,
): Promise<{ accounts: StoredAccount[]; legacy: boolean }> {
  const body: unknown = JSON.parse(text);
  const container = record(body);
  const items = Array.isArray(body) ? body : container?.accounts;
  if (!Array.isArray(items)) throw new AccountStoreError();
  let legacy = false;
  const plain = await Promise.all(items.map(async (item) => {
    const entry = record(item);
    const credential = entry ? record(entry.credential) : null;
    if (credential && typeof credential.enc === "string") {
      return { ...entry, credential: await cipher.decrypt(credential.enc) };
    }
    legacy = true;
    return entry;
  }));
  return { accounts: parseStored({ accounts: plain }), legacy };
}

export function createStorageAccountStore(
  storage: StorageLike,
  userId: string,
  cipher: StorageCipher,
): AccountStore {
  const path = objectPath(userId, "config.v1.json");
  const store: AccountStore = {
    async read(): Promise<StoredAccount[]> {
      let response: Response;
      try {
        response = await storage.download(await path);
      } catch (error) {
        if (isNotFound(error)) return [];
        throw new AccountStoreError();
      }
      if (response.status === 404) return [];
      if (!response.ok) throw new AccountStoreError();
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new AccountStoreError();
      }
      if (text.length > MAX_BYTES) throw new AccountStoreError();
      if (text.trim() === "") return [];
      let decoded: { accounts: StoredAccount[]; legacy: boolean };
      try {
        decoded = await decodeAccounts(text, cipher);
      } catch {
        throw new AccountStoreError();
      }
      if (decoded.legacy) await store.write(decoded.accounts);
      return decoded.accounts;
    },

    async write(accounts: StoredAccount[]): Promise<void> {
      let sealed: unknown[];
      try {
        sealed = await Promise.all(accounts.map(async (account) => ({
          ...account,
          credential: { enc: await cipher.encrypt(account.credential) },
        })));
      } catch {
        throw new AccountStoreError();
      }
      const payload = JSON.stringify({ version: 2, accounts: sealed });
      if (payload.length > MAX_BYTES) throw new AccountStoreError();
      try {
        await storage.upload(await path, new TextEncoder().encode(payload), {
          contentType: "application/json; charset=utf-8",
          upsert: true,
        });
      } catch {
        throw new AccountStoreError();
      }
    },
  };
  return store;
}

export function createStorageSettingsStore(
  storage: StorageLike,
  userId: string,
): SettingsStore {
  const path = objectPath(userId, "settings.v1.json");
  return {
    async read(): Promise<Settings> {
      let response: Response;
      try {
        response = await storage.download(await path);
      } catch (error) {
        if (isNotFound(error)) return defaultSettings();
        throw new SettingsStoreError();
      }
      if (response.status === 404) return defaultSettings();
      if (!response.ok) throw new SettingsStoreError();
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new SettingsStoreError();
      }
      if (text.length > MAX_SETTINGS_BYTES) throw new SettingsStoreError();
      if (text.trim() === "") return defaultSettings();
      try {
        return parseStoredSettings(JSON.parse(text));
      } catch {
        throw new SettingsStoreError();
      }
    },

    async write(settings: Settings): Promise<void> {
      const payload = JSON.stringify({ version: 1, settings });
      if (payload.length > MAX_SETTINGS_BYTES) throw new SettingsStoreError();
      try {
        await storage.upload(await path, new TextEncoder().encode(payload), {
          contentType: "application/json; charset=utf-8",
          upsert: true,
        });
      } catch {
        throw new SettingsStoreError();
      }
    },
  };
}
