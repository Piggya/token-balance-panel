export type Currency = "CNY" | "USD";
export type PlatformId =
  | "deepseek"
  | "moonshot"
  | "siliconflow"
  | "openrouter"
  | "minimax"
  | "tokenrhythm"
  | "qoder"
  | "workbuddy"
  | "zhipu";
export type PlatformKind = "balance" | "quota" | "credits";
export type Region = "cn" | "intl";

export interface Credential {
  key?: string;
  session?: string;
  token?: string;
  uid?: string;
  region?: Region;
}

export interface StoredAccount {
  id: string;
  platform: PlatformId;
  label: string;
  credential: Credential;
  createdAt: string;
}

export interface AccountSummary {
  id: string;
  platform: PlatformId;
  label: string;
  createdAt: string;
}

export interface AccountDraft {
  platform: PlatformId;
  label: string;
  credential: Credential;
}

export interface AccountPatch {
  label?: string;
  credential?: Credential;
}

export interface AccountStore {
  read(): Promise<StoredAccount[]>;
  write(accounts: StoredAccount[]): Promise<void>;
}

export interface PlatformDef {
  kind: PlatformKind;
  currency: Currency;
  auth: "key" | "session" | "workbuddy" | "qoder" | "zhipu";
}

export const MAX_ACCOUNTS = 40;
export const MAX_BODY_BYTES = 32 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export const PLATFORM_DEFS: Record<PlatformId, PlatformDef> = {
  deepseek: { kind: "balance", currency: "CNY", auth: "key" },
  moonshot: { kind: "balance", currency: "CNY", auth: "key" },
  siliconflow: { kind: "balance", currency: "CNY", auth: "session" },
  openrouter: { kind: "balance", currency: "USD", auth: "key" },
  minimax: { kind: "quota", currency: "CNY", auth: "key" },
  tokenrhythm: { kind: "balance", currency: "CNY", auth: "session" },
  qoder: { kind: "quota", currency: "CNY", auth: "qoder" },
  workbuddy: { kind: "credits", currency: "CNY", auth: "workbuddy" },
  // Zhipu has two query modes: an API key for GLM Coding Plan quota (kind
  // quota) and a console login token for the CNY account balance (kind
  // balance). The loader reports the kind that matches the supplied credential.
  zhipu: { kind: "balance", currency: "CNY", auth: "zhipu" },
};

export const PLATFORM_IDS = Object.keys(PLATFORM_DEFS) as PlatformId[];

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export class StoreFormatError extends Error {
  constructor() {
    super("invalid_store");
    this.name = "StoreFormatError";
  }
}

export class AccountStoreError extends Error {
  constructor() {
    super("account_store_unavailable");
    this.name = "AccountStoreError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isPlatform(value: unknown): value is PlatformId {
  return typeof value === "string" && value in PLATFORM_DEFS;
}

function usefulText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > max) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

// Cookie values may be pasted as a full header (`tr_session=...; path=/`),
// so only control characters are rejected here; the loader trims the rest.
function cookieText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 8192) return null;
  if (CONTROL.test(text)) return null;
  return text;
}

// WorkBuddy needs two rotated cookies (`session` and `session_2`), so the
// pasted header is much longer than a single session cookie.
function cookieHeaderText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 10 || text.length > 8192) return null;
  if (CONTROL.test(text)) return null;
  return text;
}

export function labelText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new DraftError("invalid_label");
  const text = value.trim();
  if (text.length > 24 || CONTROL.test(text)) throw new DraftError("invalid_label");
  return text;
}

export function normalizeCredential(
  platform: PlatformId,
  value: unknown,
): Credential {
  const entry = record(value);
  if (!entry) throw new DraftError("invalid_credential");
  const def = PLATFORM_DEFS[platform];
  if (def.auth === "key") {
    const key = usefulText(entry.key, 4096);
    if (!key) throw new DraftError("invalid_key");
    return { key };
  }
  if (def.auth === "session") {
    const session = cookieText(entry.session);
    if (!session) throw new DraftError("invalid_session");
    return { session };
  }
  // Qoder authenticates with a Personal Access Token (pt-…) for the selected
  // site; the loader exchanges it for a short-lived job token.
  if (def.auth === "qoder") {
    const key = usefulText(entry.key, 4096);
    if (!key) throw new DraftError("invalid_key");
    const region: Region = entry.region === "intl" ? "intl" : "cn";
    return { key, region };
  }
  // Zhipu accepts either an API key (Coding Plan quota) or the console login
  // token (account balance); the field that is filled selects the query mode.
  if (def.auth === "zhipu") {
    const key = usefulText(entry.key, 4096);
    if (key) return { key };
    const session = cookieText(entry.session);
    if (session) return { session };
    throw new DraftError("invalid_credential");
  }
  const region: Region = entry.region === "intl" ? "intl" : "cn";
  // WorkBuddy console requests authenticate with the login cookie header;
  // the older bearer-token form stays readable so stored accounts keep working.
  const session = cookieHeaderText(entry.session);
  if (session) return { session, region };
  const token = usefulText(entry.token, 4096);
  const uid = usefulText(entry.uid, 128);
  if (!token) throw new DraftError("invalid_token");
  if (!uid) throw new DraftError("invalid_uid");
  return { token, uid, region };
}

export function validateCreate(value: unknown): AccountDraft {
  const body = record(value);
  if (!body) throw new DraftError("invalid_body");
  if (!isPlatform(body.platform)) throw new DraftError("invalid_platform");
  return {
    platform: body.platform,
    label: labelText(body.label),
    credential: normalizeCredential(body.platform, body.credential),
  };
}

export function validatePatch(value: unknown, current: StoredAccount): AccountPatch {
  const body = record(value);
  if (!body) throw new DraftError("invalid_body");
  if (body.platform !== undefined && body.platform !== current.platform) {
    throw new DraftError("invalid_platform");
  }
  const patch: AccountPatch = {};
  if (body.label !== undefined) patch.label = labelText(body.label);
  if (body.credential !== undefined) {
    patch.credential = normalizeCredential(current.platform, body.credential);
  }
  if (patch.label === undefined && patch.credential === undefined) {
    throw new DraftError("empty_update");
  }
  return patch;
}

export function toSummary(account: StoredAccount): AccountSummary {
  return {
    id: account.id,
    platform: account.platform,
    label: account.label,
    createdAt: account.createdAt,
  };
}

// Stored accounts can predate a platform's auth change (for example the
// SiliconFlow switch from API key to login cookie). Keep those entries
// readable so one stale credential cannot take down the whole dashboard; the
// loader reports it as an invalid credential instead.
function legacyCredential(value: unknown): Credential {
  const entry = record(value);
  if (!entry) throw new StoreFormatError();
  const credential: Credential = {};
  const key = usefulText(entry.key, 4096);
  if (key) credential.key = key;
  const session = cookieText(entry.session);
  if (session) credential.session = session;
  const token = usefulText(entry.token, 4096);
  if (token) credential.token = token;
  const uid = usefulText(entry.uid, 128);
  if (uid) credential.uid = uid;
  if (entry.region === "intl" || entry.region === "cn") credential.region = entry.region;
  if (!credential.key && !credential.session && !credential.token) throw new StoreFormatError();
  return credential;
}

function parseStoredAccount(value: unknown): StoredAccount {
  const entry = record(value);
  if (!entry) throw new StoreFormatError();
  if (typeof entry.id !== "string" || !UUID.test(entry.id)) throw new StoreFormatError();
  if (!isPlatform(entry.platform)) throw new StoreFormatError();
  if (typeof entry.label !== "string" || entry.label.length > 24 || CONTROL.test(entry.label)) {
    throw new StoreFormatError();
  }
  if (typeof entry.createdAt !== "string" || Number.isNaN(Date.parse(entry.createdAt))) {
    throw new StoreFormatError();
  }
  let credential: Credential;
  try {
    credential = normalizeCredential(entry.platform, entry.credential);
  } catch {
    credential = legacyCredential(entry.credential);
  }
  return {
    id: entry.id,
    platform: entry.platform,
    label: entry.label,
    credential,
    createdAt: entry.createdAt,
  };
}

export function parseStored(value: unknown): StoredAccount[] {
  const body = record(value);
  const items = Array.isArray(value) ? value : body?.accounts;
  if (!Array.isArray(items)) throw new StoreFormatError();
  if (items.length > MAX_ACCOUNTS * 4) throw new StoreFormatError();
  return items.map(parseStoredAccount);
}

export function nextLabel(platform: PlatformId, accounts: StoredAccount[]): string {
  const count = accounts.filter((account) => account.platform === platform).length;
  return count === 0 ? "" : `账号 ${count + 1}`;
}
