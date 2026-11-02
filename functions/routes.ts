import {
  AccountStoreError,
  DraftError,
  MAX_ACCOUNTS,
  MAX_BODY_BYTES,
  nextLabel,
  toSummary,
  validateCreate,
  validatePatch,
  type AccountStore,
  type StoredAccount,
} from "./accounts.ts";
import { loadAccount, type PlatformBalance } from "./balances.ts";
import { createBalanceCache, type BalanceCache } from "./balance-cache.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import {
  parseSettings,
  SettingsDraftError,
  SettingsStoreError,
  type Settings,
  type SettingsStore,
} from "./settings.ts";

const ROUTE_PREFIX = /^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/;
const ACCOUNT_PATH = /^\/api\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 2_000;
const LOAD_CONCURRENCY = 8;
const RATE_WINDOW_MS = 60_000;

class HttpError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function fail(code: string, status: number): Response {
  return json({ ok: false, error: code }, status);
}

function rateLimited(retryAfterSec: number): Response {
  return Response.json(
    { ok: false, error: "rate_limited" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}

function methodNotAllowed(allow: string): Response {
  return Response.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: allow } },
  );
}

// Serializes read-modify-write cycles per user, and drops the lock once idle so
// the registry cannot grow with every user seen during a scale test.
function createLockRegistry() {
  interface Entry {
    pending: number;
    tail: Promise<unknown>;
  }
  const entries = new Map<string, Entry>();

  return function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    let entry = entries.get(key);
    if (!entry) {
      entry = { pending: 0, tail: Promise.resolve() };
      entries.set(key, entry);
    }
    const current = entry;
    current.pending += 1;
    const run = current.tail.then(work, work);
    current.tail = run.then(() => undefined, () => undefined);
    return run.finally(() => {
      current.pending -= 1;
      if (current.pending === 0 && entries.get(key) === current) {
        entries.delete(key);
      }
    });
  };
}

export interface ApplicationUser {
  user_id: string;
}

function authenticate(
  request: Request,
  requireUser: (request: Request) => unknown,
): ApplicationUser | Response {
  let user: unknown;
  try {
    user = requireUser(request);
  } catch (error) {
    const candidate = error as { code?: unknown; status?: unknown };
    const code = typeof candidate?.code === "string" ? candidate.code : "login_required";
    const status = typeof candidate?.status === "number" ? candidate.status : 401;
    return fail(code, status);
  }
  const candidate = user as { user_id?: unknown };
  if (!user || typeof user !== "object" || typeof candidate?.user_id !== "string") {
    return fail("invalid_user_context", 403);
  }
  return { user_id: candidate.user_id };
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) throw new DraftError("invalid_content_type");
  const reader = request.body?.getReader();
  if (!reader) throw new DraftError("invalid_body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new DraftError("payload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be closed after cancellation.
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DraftError("invalid_json");
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function dashboard(
  request: Request,
  store: AccountStore,
  user: ApplicationUser,
  cache: BalanceCache,
  load: (account: StoredAccount) => Promise<PlatformBalance>,
  now: () => number,
): Promise<Response> {
  const fresh = new URL(request.url).searchParams.get("refresh") === "1";
  const accounts = await store.read();
  // Bounded concurrency keeps one large account list from opening dozens of
  // upstream connections at once during scale tests.
  const platforms = await mapLimit(accounts, LOAD_CONCURRENCY, async (account) => {
    const result = await cache.load(user.user_id, account.id, () => load(account), fresh);
    return { ...result.value, cached: result.cached };
  });
  return json({
    ok: true,
    fetchedAt: new Date(now()).toISOString(),
    platforms,
  });
}

async function readSettings(store: SettingsStore): Promise<Response> {
  const settings: Settings = await store.read();
  return json({ ok: true, settings });
}

async function updateSettings(
  request: Request,
  store: SettingsStore,
  exclusive: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<Response> {
  const draft = parseSettings(await readJson(request));
  return exclusive(async () => {
    await store.write(draft);
    return json({ ok: true, settings: draft });
  });
}

async function createAccount(
  request: Request,
  store: AccountStore,
  exclusive: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<Response> {
  const draft = validateCreate(await readJson(request));
  return exclusive(async () => {
    const accounts = await store.read();
    if (accounts.length >= MAX_ACCOUNTS) {
      throw new HttpError("too_many_accounts", 409);
    }
    const account: StoredAccount = {
      id: crypto.randomUUID(),
      platform: draft.platform,
      label: draft.label || nextLabel(draft.platform, accounts),
      credential: draft.credential,
      createdAt: new Date().toISOString(),
    };
    await store.write([...accounts, account]);
    return json({ ok: true, account: toSummary(account) }, 201);
  });
}

async function updateAccount(
  id: string,
  request: Request,
  store: AccountStore,
  exclusive: <T>(work: () => Promise<T>) => Promise<T>,
  cache: BalanceCache,
  user: ApplicationUser,
): Promise<Response> {
  const body = await readJson(request);
  return exclusive(async () => {
    const accounts = await store.read();
    const index = accounts.findIndex((account) => account.id === id);
    if (index < 0) throw new HttpError("not_found", 404);
    const current = accounts[index];
    const patch = validatePatch(body, current);
    const next: StoredAccount = {
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.credential !== undefined ? { credential: patch.credential } : {}),
    };
    const updated = accounts.slice();
    updated[index] = next;
    await store.write(updated);
    cache.invalidate(user.user_id, id);
    return json({ ok: true, account: toSummary(next) });
  });
}

async function removeAccount(
  id: string,
  store: AccountStore,
  exclusive: <T>(work: () => Promise<T>) => Promise<T>,
  cache: BalanceCache,
  user: ApplicationUser,
): Promise<Response> {
  return exclusive(async () => {
    const accounts = await store.read();
    const next = accounts.filter((account) => account.id !== id);
    if (next.length === accounts.length) throw new HttpError("not_found", 404);
    await store.write(next);
    cache.invalidate(user.user_id, id);
    return json({ ok: true });
  });
}

export function application({
  createStore,
  createSettingsStore,
  requireUser,
  load = loadAccount,
  now = Date.now,
  limits = { dashboardPerMinute: 120, writesPerMinute: 30 },
}: {
  createStore: (user: ApplicationUser) => AccountStore;
  createSettingsStore: (user: ApplicationUser) => SettingsStore;
  requireUser: (request: Request) => unknown;
  load?: (account: StoredAccount) => Promise<PlatformBalance>;
  now?: () => number;
  limits?: { dashboardPerMinute: number; writesPerMinute: number };
}): (request: Request) => Promise<Response> {
  const lockRegistry = createLockRegistry();
  const cache = createBalanceCache({
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
    now,
  });
  const readLimiter: RateLimiter = createRateLimiter({
    limit: limits.dashboardPerMinute,
    windowMs: RATE_WINDOW_MS,
    now,
  });
  const writeLimiter: RateLimiter = createRateLimiter({
    limit: limits.writesPerMinute,
    windowMs: RATE_WINDOW_MS,
    now,
  });

  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const match = pathname.match(ROUTE_PREFIX);
    const path = match
      ? match[1] || "/"
      : pathname.startsWith("/api/")
      ? pathname
      : null;
    if (!path) return fail("not_found", 404);

    if (path === "/api/health" && request.method === "GET") {
      return json({ ok: true });
    }

    const user = authenticate(request, requireUser);
    if (user instanceof Response) return user;

    const writing = request.method !== "GET";
    const limited = (writing ? writeLimiter : readLimiter).check(
      `${writing ? "write" : "read"}:${user.user_id}`,
    );
    if (!limited.allowed) return rateLimited(limited.retryAfterSec);

    const store = createStore(user);
    const settingsStore = createSettingsStore(user);
    const exclusive = <T>(work: () => Promise<T>) => lockRegistry(user.user_id, work);

    try {
      if (path === "/api/dashboard" && request.method === "GET") {
        return await dashboard(request, store, user, cache, load, now);
      }
      if (path === "/api/settings" && request.method === "GET") {
        return await readSettings(settingsStore);
      }
      if (path === "/api/settings" && request.method === "PUT") {
        return await updateSettings(request, settingsStore, exclusive);
      }
      if (path === "/api/accounts" && request.method === "POST") {
        return await createAccount(request, store, exclusive);
      }
      const account = path.match(ACCOUNT_PATH);
      if (account && request.method === "PATCH") {
        return await updateAccount(account[1], request, store, exclusive, cache, user);
      }
      if (account && request.method === "DELETE") {
        return await removeAccount(account[1], store, exclusive, cache, user);
      }
      if (path === "/api/dashboard") return methodNotAllowed("GET");
      if (path === "/api/settings") return methodNotAllowed("GET, PUT");
      if (path === "/api/accounts") return methodNotAllowed("POST");
      if (account) return methodNotAllowed("PATCH, DELETE");
      return fail("not_found", 404);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.code, error.status);
      if (error instanceof DraftError) return fail("invalid_input", 400);
      if (error instanceof SettingsDraftError) return fail("invalid_settings", 400);
      if (error instanceof SettingsStoreError) return fail("settings_unavailable", 503);
      if (error instanceof AccountStoreError) return fail("accounts_unavailable", 503);
      return fail("request_failed", 500);
    }
  };
}
