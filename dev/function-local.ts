import { application } from "../functions/routes.ts";
import type { AccountStore, StoredAccount } from "../functions/accounts.ts";
import { defaultSettings, type SettingsStore } from "../functions/settings.ts";

const accounts: StoredAccount[] = [];
const store: AccountStore = {
  async read() {
    return accounts;
  },
  async write(next) {
    accounts.splice(0, accounts.length, ...next);
  },
};

let settings = defaultSettings();
const settingsStore: SettingsStore = {
  async read() {
    return settings;
  },
  async write(next) {
    settings = next;
  },
};

const handle = application({
  createStore: () => store,
  createSettingsStore: () => settingsStore,
  requireUser: () => ({ user_id: "local" }),
});

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, handle);
