import { storage } from "./_qoder/storage.mjs";
import { requireUser } from "./auth.mjs";
import { application } from "./routes.ts";
import { createStorageCipher } from "./storage-crypto.ts";
import { createStorageAccountStore, createStorageSettingsStore } from "./store-storage.ts";

// Credentials are encrypted at rest with the PANEL_DATA_KEY site secret
// (64 hex chars, entered via Site Settings). Account routes fail closed with
// accounts_unavailable until it is configured.
const cipher = createStorageCipher(Deno.env.get("PANEL_DATA_KEY"));

const handle = application({
  createStore: (user) => createStorageAccountStore(storage, user.user_id, cipher),
  createSettingsStore: (user) => createStorageSettingsStore(storage, user.user_id),
  requireUser,
});

Deno.serve((request: Request) => handle(request));
