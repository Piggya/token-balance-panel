import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INTERVAL_SEC,
  INTERVAL_SECS,
  MAX_THRESHOLD,
  SettingsDraftError,
  SettingsStoreError,
  defaultSettings,
  parseSettings,
  parseStoredSettings,
} from "../functions/settings.ts";

test("defaults cover every known platform", () => {
  const settings = defaultSettings();
  assert.equal(settings.intervalSec, DEFAULT_INTERVAL_SEC);
  assert.deepEqual(settings.order, []);
  assert.deepEqual(Object.keys(settings.thresholds).sort(), [
    "deepseek",
    "minimax",
    "moonshot",
    "openrouter",
    "qoder",
    "siliconflow",
    "tokenrhythm",
    "workbuddy",
    "zhipu",
  ]);
});

test("accepts each supported interval", () => {
  for (const intervalSec of INTERVAL_SECS) {
    const settings = parseSettings({ intervalSec, thresholds: {} });
    assert.equal(settings.intervalSec, intervalSec);
  }
});

test("rejects unsupported intervals", () => {
  for (const intervalSec of [15, 90, -1, "60", null]) {
    assert.throws(
      () => parseSettings({ intervalSec, thresholds: {} }),
      SettingsDraftError,
      String(intervalSec),
    );
  }
});

test("fills defaults and ignores unknown platforms", () => {
  const settings = parseSettings({
    intervalSec: 30,
    thresholds: { deepseek: 3.5, unknown: 99 },
  });
  assert.equal(settings.thresholds.deepseek, 3.5);
  assert.equal(settings.thresholds.openrouter, 2);
  assert.equal("unknown" in settings.thresholds, false);
});

test("rejects invalid thresholds", () => {
  for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY, MAX_THRESHOLD + 1, "5"]) {
    assert.throws(
      () => parseSettings({ intervalSec: 60, thresholds: { deepseek: amount } }),
      SettingsDraftError,
      String(amount),
    );
  }
});

test("rejects malformed settings bodies", () => {
  for (const body of [null, [], "settings", 42]) {
    assert.throws(() => parseSettings(body), SettingsDraftError);
  }
  assert.throws(
    () => parseSettings({ intervalSec: 60, thresholds: [] }),
    SettingsDraftError,
  );
});

test("accepts a custom card order and drops duplicates", () => {
  const settings = parseSettings({
    intervalSec: 60,
    thresholds: {},
    order: ["account-b", "account-a", "account-b"],
  });
  assert.deepEqual(settings.order, ["account-b", "account-a"]);
  assert.deepEqual(parseSettings({ intervalSec: 60, thresholds: {} }).order, []);
});

test("rejects malformed card orders", () => {
  const cases: unknown[] = [
    "account-a",
    [1],
    [""],
    [null],
    ["x".repeat(65)],
    Array.from({ length: 501 }, (_, index) => `id-${index}`),
  ];
  for (const order of cases) {
    assert.throws(
      () => parseSettings({ intervalSec: 60, thresholds: {}, order }),
      SettingsDraftError,
      JSON.stringify(order).slice(0, 40),
    );
  }
});

test("stored settings require the versioned wrapper", () => {
  const settings = parseStoredSettings({
    version: 1,
    settings: { intervalSec: 300, thresholds: { moonshot: 12 } },
  });
  assert.equal(settings.intervalSec, 300);
  assert.equal(settings.thresholds.moonshot, 12);

  for (const stored of [null, {}, { settings: { intervalSec: 15 } }, []]) {
    assert.throws(() => parseStoredSettings(stored), SettingsStoreError);
  }
});
