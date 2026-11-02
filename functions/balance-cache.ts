import type { PlatformBalance } from "./balances.ts";

export interface CacheLoadResult {
  value: PlatformBalance;
  cached: boolean;
}

interface Entry {
  value: PlatformBalance;
  expiresAt: number;
}

export interface BalanceCache {
  load(
    userId: string,
    accountId: string,
    loader: () => Promise<PlatformBalance>,
    fresh: boolean,
  ): Promise<CacheLoadResult>;
  invalidate(userId: string, accountId: string): void;
}

// Per-instance cache: entries only live inside one Function isolate. It is a
// server-side cache, deliberately separate from the browser's display cache.
export function createBalanceCache(options: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}): BalanceCache {
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<PlatformBalance>>();
  const now = options.now ?? Date.now;
  const max = Math.max(1, options.maxEntries);

  const keyOf = (userId: string, accountId: string) => `${userId}\u0000${accountId}`;

  function prune(time: number) {
    if (entries.size <= max) return;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(key);
    }
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function get(key: string, time: number): PlatformBalance | null {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= time) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key: string, value: PlatformBalance, time: number) {
    entries.delete(key);
    entries.set(key, { value, expiresAt: time + options.ttlMs });
    prune(time);
  }

  return {
    async load(userId, accountId, loader, fresh) {
      const key = keyOf(userId, accountId);
      if (!fresh) {
        const hit = get(key, now());
        if (hit) return { value: hit, cached: true };
      }
      const running = inflight.get(key);
      if (running) return { value: await running, cached: false };
      let promise: Promise<PlatformBalance>;
      promise = (async () => {
        const value = await loader();
        set(key, value, now());
        return value;
      })().finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
      inflight.set(key, promise);
      return { value: await promise, cached: false };
    },
    invalidate(userId, accountId) {
      entries.delete(keyOf(userId, accountId));
    },
  };
}
