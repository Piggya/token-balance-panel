import { parseBalancesPayload, type BalancesPayload } from "./balance";

const CACHE_KEY = "token-panel:dashboard-cache:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Display-only snapshot for the current tab. It holds balance numbers, never
// credentials, and is cleared when the tab closes.
export function loadDashboardCache(): BalancesPayload | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.savedAt !== "string" || Number.isNaN(Date.parse(record.savedAt))) {
      return null;
    }
    if (Date.now() - Date.parse(record.savedAt) > MAX_AGE_MS) return null;
    return parseBalancesPayload(record.payload);
  } catch {
    return null;
  }
}

export function clearDashboardCache(): void {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function saveDashboardCache(payload: BalancesPayload): void {
  try {
    window.sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), payload }),
    );
  } catch {
    // Storage can be full or blocked; the live response is still rendered.
  }
}
