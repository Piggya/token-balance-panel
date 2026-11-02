import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AccountStoreError,
  parseStored,
  type AccountStore,
  type StoredAccount,
} from "../functions/accounts.ts";
import {
  defaultSettings,
  parseStoredSettings,
  SettingsStoreError,
  type Settings,
  type SettingsStore,
} from "../functions/settings.ts";
import type { DataCipher } from "./data-crypto.ts";

const FILE_MODE = 0o600;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Storage version 2 keeps id/platform/label readable but stores the credential
// as `{ enc: "v1.<iv>.<tag>.<ciphertext>" }`. Version 1 entries (plaintext) are
// decrypted transparently and rewritten encrypted on the next read.
function decodeAccounts(text: string, cipher: DataCipher): { accounts: StoredAccount[]; legacy: boolean } {
  const body: unknown = JSON.parse(text);
  const container = record(body);
  const items = Array.isArray(body) ? body : container?.accounts;
  if (!Array.isArray(items)) throw new AccountStoreError();
  let legacy = false;
  const plain = items.map((item) => {
    const entry = record(item);
    const credential = entry ? record(entry.credential) : null;
    if (credential && typeof credential.enc === "string") {
      return { ...entry, credential: cipher.decrypt(credential.enc) };
    }
    legacy = true;
    return entry;
  });
  return { accounts: parseStored({ accounts: plain }), legacy };
}

async function writeAtomic(file: string, payload: string): Promise<void> {
  const temp = `${file}.tmp`;
  await writeFile(temp, payload, { mode: FILE_MODE });
  await rename(temp, file);
  await chmod(file, FILE_MODE);
}

export function createAccountStore(dataDir: string, cipher: DataCipher): AccountStore {
  const file = join(dataDir, "accounts.json");
  const store: AccountStore = {
    async read(): Promise<StoredAccount[]> {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new AccountStoreError();
      }
      let decoded: { accounts: StoredAccount[]; legacy: boolean };
      try {
        decoded = decodeAccounts(text, cipher);
      } catch {
        throw new AccountStoreError();
      }
      if (decoded.legacy) await store.write(decoded.accounts);
      return decoded.accounts;
    },
    async write(accounts: StoredAccount[]): Promise<void> {
      await mkdir(dataDir, { recursive: true });
      const body = {
        version: 2,
        accounts: accounts.map((account) => ({
          ...account,
          credential: { enc: cipher.encrypt(account.credential) },
        })),
      };
      try {
        await writeAtomic(file, JSON.stringify(body));
      } catch {
        throw new AccountStoreError();
      }
    },
  };
  return store;
}

export function createSettingsStore(dataDir: string): SettingsStore {
  const file = join(dataDir, "settings.json");
  return {
    async read(): Promise<Settings> {
      try {
        return parseStoredSettings(JSON.parse(await readFile(file, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultSettings();
        if (error instanceof SettingsStoreError) throw error;
        throw new SettingsStoreError();
      }
    },
    async write(settings: Settings): Promise<void> {
      await mkdir(dataDir, { recursive: true });
      try {
        await writeAtomic(file, JSON.stringify({ version: 1, settings }));
      } catch {
        throw new SettingsStoreError();
      }
    },
  };
}
