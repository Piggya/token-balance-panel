import { PLATFORM_DEFS } from "./accounts.ts";

export interface Settings {
  intervalSec: number;
  thresholds: Record<string, number>;
  order: string[];
}

export interface SettingsStore {
  read(): Promise<Settings>;
  write(settings: Settings): Promise<void>;
}

export const INTERVAL_SECS = [0, 30, 60, 300] as const;
export const DEFAULT_INTERVAL_SEC = 60;
export const MAX_THRESHOLD = 1_000_000_000;
export const MAX_ORDER = 500;
const MAX_ACCOUNT_ID_LENGTH = 64;

// Keep in sync with the client defaults in lib/platforms.ts. The server owns
// the persisted values; this only seeds a user's settings before they edit them.
const DEFAULT_THRESHOLDS: Record<string, number> = {
  deepseek: 10,
  moonshot: 10,
  siliconflow: 10,
  openrouter: 2,
  minimax: 0,
  tokenrhythm: 10,
  workbuddy: 500,
  zhipu: 10,
};

export class SettingsDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsDraftError";
  }
}

export class SettingsStoreError extends Error {
  constructor() {
    super("settings_store_unavailable");
    this.name = "SettingsStoreError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function defaultSettings(): Settings {
  const thresholds: Record<string, number> = {};
  for (const id of Object.keys(PLATFORM_DEFS)) {
    thresholds[id] = DEFAULT_THRESHOLDS[id] ?? 0;
  }
  return { intervalSec: DEFAULT_INTERVAL_SEC, thresholds, order: [] };
}

function parseOrder(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ORDER) {
    throw new SettingsDraftError("invalid_order");
  }
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > MAX_ACCOUNT_ID_LENGTH
    ) {
      throw new SettingsDraftError("invalid_order");
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    order.push(entry);
  }
  return order;
}

export function parseSettings(value: unknown): Settings {
  const body = record(value);
  if (!body) throw new SettingsDraftError("invalid_settings");
  if (!INTERVAL_SECS.includes(body.intervalSec as (typeof INTERVAL_SECS)[number])) {
    throw new SettingsDraftError("invalid_interval");
  }
  const settings: Settings = {
    intervalSec: body.intervalSec as number,
    thresholds: defaultSettings().thresholds,
    order: parseOrder(body.order),
  };
  if (body.thresholds !== undefined) {
    const thresholds = record(body.thresholds);
    if (!thresholds) throw new SettingsDraftError("invalid_thresholds");
    for (const [id, amount] of Object.entries(thresholds)) {
      // Ignore unknown platforms so an older client cannot corrupt the store.
      if (!(id in PLATFORM_DEFS)) continue;
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > MAX_THRESHOLD
      ) {
        throw new SettingsDraftError("invalid_threshold");
      }
      settings.thresholds[id] = amount;
    }
  }
  return settings;
}

export function parseStoredSettings(value: unknown): Settings {
  const body = record(value);
  if (!body) throw new SettingsStoreError();
  try {
    return parseSettings(body.settings);
  } catch {
    throw new SettingsStoreError();
  }
}
