export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  const limit = Math.max(1, options.limit);
  const maxKeys = Math.max(1, options.maxKeys ?? 5000);

  function trim(time: number) {
    if (buckets.size <= maxKeys) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= time) buckets.delete(key);
    }
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  return {
    check(key) {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        bucket = { count: 0, resetAt: time + options.windowMs };
        buckets.set(key, bucket);
        trim(time);
      }
      bucket.count += 1;
      if (bucket.count <= limit) return { allowed: true, retryAfterSec: 0 };
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)),
      };
    },
  };
}
