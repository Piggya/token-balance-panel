import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Gauge,
  Moon,
  Plus,
  RefreshCw,
  Settings2,
  Sun,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountDialog } from "@/components/account-dialog";
import { BalanceCard } from "@/components/balance-card";
import { LoginView } from "@/components/login-view";
import { SummaryBar } from "@/components/summary-bar";
import { SettingsSheet } from "@/components/settings-sheet";
import { SiteFooter } from "@/components/site-footer";
import { SortableGrid } from "@/components/sortable-grid";
import { useNow } from "@/hooks/use-now";
import { deleteAccount } from "@/lib/accounts";
import { fetchAuthStatus, isSessionExpired, logout } from "@/lib/auth";
import { fetchBalances, type BalancesPayload, type PlatformBalance } from "@/lib/balance";
import { clearDashboardCache, loadDashboardCache, saveDashboardCache } from "@/lib/browser-cache";
import { ApiError } from "@/lib/request";
import { platformMeta } from "@/lib/platforms";
import { relativeTime } from "@/lib/format";
import { levelOf } from "@/lib/status";
import {
  cacheSettings,
  clearCachedSettings,
  fetchSettings,
  loadCachedSettings,
  saveSettings,
  type Settings,
  type SettingsSyncStatus,
} from "@/lib/settings";
import { applyTheme, loadTheme, saveTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type AccountDialogState =
  | { mode: "create"; account: null }
  | { mode: "edit"; account: PlatformBalance };

type DataSource = "server" | "browser";
type AuthStatus = "checking" | "out" | "in";

function sameSettings(a: Settings, b: Settings): boolean {
  if (a.intervalSec !== b.intervalSec) return false;
  if (a.order.length !== b.order.length) return false;
  if (!a.order.every((id, index) => id === b.order[index])) return false;
  const keys = Object.keys(a.thresholds);
  return keys.length === Object.keys(b.thresholds).length &&
    keys.every((id) => a.thresholds[id] === b.thresholds[id]);
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [username, setUsername] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadCachedSettings);
  const [settingsStatus, setSettingsStatus] = useState<SettingsSyncStatus>("loading");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [initialCache] = useState(loadDashboardCache);
  const [data, setData] = useState<BalancesPayload | null>(initialCache);
  const [dataSource, setDataSource] = useState<DataSource>(initialCache ? "browser" : "server");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dialog, setDialog] = useState<AccountDialogState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<PlatformBalance | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const fetchSeq = useRef(0);
  const inflight = useRef(0);
  const settingsTouched = useRef(false);
  const settingsTimer = useRef<number | null>(null);
  const settingsSaving = useRef(false);
  const settingsQueued = useRef<Settings | null>(null);
  const now = useNow(1000);

  const refresh = useCallback(async (fresh = false) => {
    if (!fresh && inflight.current > 0) return;
    const seq = ++fetchSeq.current;
    inflight.current += 1;
    setRefreshing(true);
    try {
      const next = await fetchBalances({ fresh });
      if (seq === fetchSeq.current) {
        setData(next);
        setDataSource("server");
        setLoadError(null);
        saveDashboardCache(next);
      }
    } catch (error) {
      if (seq === fetchSeq.current) {
        if (isSessionExpired(error)) {
          setAuthStatus("out");
          return;
        }
        setLoadError(
          error instanceof ApiError ? error.message : "看板服务暂时不可用，请稍后重试。",
        );
      }
    } finally {
      inflight.current -= 1;
      if (seq === fetchSeq.current) setRefreshing(false);
    }
  }, []);

  const signedIn = authStatus === "in";

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await fetchAuthStatus();
        if (!active) return;
        setUsername(status.username);
        setAuthStatus(status.authenticated ? "in" : "out");
      } catch (error) {
        if (!active) return;
        // A failing status endpoint (for example the managed-site build that
        // has no /api/auth routes) should not lock the dashboard away.
        setAuthStatus(error instanceof ApiError && error.status === 401 ? "out" : "in");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void refresh();
  }, [refresh, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void (async () => {
      try {
        const next = await fetchSettings();
        if (!active || settingsTouched.current) return;
        setSettings(next);
        cacheSettings(next);
        setSettingsError(null);
        setSettingsStatus("synced");
      } catch (error) {
        if (!active || settingsTouched.current) return;
        if (isSessionExpired(error)) {
          setAuthStatus("out");
          return;
        }
        setSettingsStatus("error");
        setSettingsError(
          error instanceof ApiError ? error.message : "读取服务端设置失败，正在使用本机副本。",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [signedIn]);

  useEffect(() => {
    return () => {
      if (settingsTimer.current !== null) window.clearTimeout(settingsTimer.current);
    };
  }, []);

  const persistSettings = useCallback(async (next: Settings) => {
    if (settingsSaving.current) {
      settingsQueued.current = next;
      return;
    }
    settingsSaving.current = true;
    let target: Settings | null = next;
    try {
      while (target) {
        setSettingsStatus("saving");
        setSettingsError(null);
        const saved = await saveSettings(target);
        const pending = settingsQueued.current;
        if (pending && !sameSettings(pending, target)) {
          settingsQueued.current = null;
          target = pending;
          continue;
        }
        settingsQueued.current = null;
        setSettings(saved);
        cacheSettings(saved);
        setSettingsStatus("synced");
        target = null;
      }
    } catch (error) {
      settingsQueued.current = null;
      if (isSessionExpired(error)) {
        setAuthStatus("out");
        return;
      }
      setSettingsStatus("error");
      setSettingsError(
        error instanceof ApiError ? error.message : "设置保存失败，请稍后重试。",
      );
    } finally {
      settingsSaving.current = false;
    }
  }, []);

  const changeSettings = useCallback((next: Settings) => {
    settingsTouched.current = true;
    setSettings(next);
    setSettingsStatus("saving");
    setSettingsError(null);
    if (settingsTimer.current !== null) window.clearTimeout(settingsTimer.current);
    settingsTimer.current = window.setTimeout(() => {
      settingsTimer.current = null;
      void persistSettings(next);
    }, 500);
  }, [persistSettings]);

  const retrySettings = useCallback(() => {
    if (settingsTimer.current !== null) {
      window.clearTimeout(settingsTimer.current);
      settingsTimer.current = null;
    }
    void persistSettings(settings);
  }, [persistSettings, settings]);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!signedIn || settings.intervalSec <= 0) return;
    const id = window.setInterval(() => {
      void refresh(false);
    }, settings.intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [settings.intervalSec, refresh, signedIn]);

  const handleSignedIn = useCallback((name: string | null) => {
    setUsername(name);
    setSettingsStatus("loading");
    setAuthStatus("in");
  }, []);

  const handleLogout = useCallback(() => {
    void (async () => {
      try {
        await logout();
      } catch {
        // Clear the local view regardless; the cookie may already be gone.
      }
      clearDashboardCache();
      clearCachedSettings();
      setSettings(loadCachedSettings());
      setSettingsStatus("loading");
      setSettingsError(null);
      setLoadError(null);
      setUsername(null);
      setAuthStatus("out");
    })();
  }, []);

  const platforms = data?.platforms ?? [];
  const orderedPlatforms = useMemo(() => {
    if (settings.order.length === 0) return platforms;
    const rank = new Map(settings.order.map((id, index) => [id, index]));
    return platforms
      .map((platform, index) => ({ platform, index }))
      .sort((a, b) => {
        const left = rank.get(a.platform.accountId) ?? Number.MAX_SAFE_INTEGER;
        const right = rank.get(b.platform.accountId) ?? Number.MAX_SAFE_INTEGER;
        return left - right || a.index - b.index;
      })
      .map((entry) => entry.platform);
  }, [platforms, settings.order]);
  const thresholdFor = (id: string) => settings.thresholds[id] ?? platformMeta(id).defaultThreshold;

  const moveAccount = useCallback((dragId: string, targetId: string) => {
    const ids = orderedPlatforms.map((platform) => platform.accountId);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    changeSettings({ ...settings, order: ids });
  }, [orderedPlatforms, changeSettings, settings]);

  const moveAccountBy = useCallback((id: string, delta: number) => {
    const ids = orderedPlatforms.map((platform) => platform.accountId);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = Math.min(ids.length - 1, Math.max(0, from + delta));
    if (to === from) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    changeSettings({ ...settings, order: ids });
  }, [orderedPlatforms, changeSettings, settings]);

  const totals = platforms.reduce(
    (acc, platform) => {
      if (platform.kind === "balance" && platform.status === "ok" && platform.balance !== null) {
        acc[platform.currency] += platform.balance;
      }
      return acc;
    },
    { CNY: 0, USD: 0 },
  );
  const platformCount = new Set(platforms.map((platform) => platform.id)).size;
  const okPlatforms = platforms.filter(
    (platform) =>
      platform.kind === "balance" && platform.status === "ok" && platform.balance !== null,
  );
  const cnyCount = okPlatforms.filter((platform) => platform.currency === "CNY").length;
  const usdCount = okPlatforms.filter((platform) => platform.currency === "USD").length;
  const alerts = platforms.filter((platform) => {
    const level = levelOf(platform, thresholdFor(platform.id));
    return level === "low" || level === "empty" || level === "error";
  }).length;
  const initialLoading = !data && !loadError;

  const openCreate = () => {
    setSettingsOpen(false);
    setDialog({ mode: "create", account: null });
  };

  const openEdit = (platform: PlatformBalance) => {
    setSettingsOpen(false);
    setDialog({ mode: "edit", account: platform });
  };

  const requestRemove = (platform: PlatformBalance) => {
    setSettingsOpen(false);
    setRemoveError(null);
    setPendingRemove(platform);
  };

  const confirmRemove = async () => {
    const target = pendingRemove;
    if (!target || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteAccount(target.accountId);
      setData((current) =>
        current
          ? {
            ...current,
            platforms: current.platforms.filter((item) => item.accountId !== target.accountId),
          }
          : current
      );
      setPendingRemove(null);
      void refresh(true);
    } catch (error) {
      if (isSessionExpired(error)) {
        setAuthStatus("out");
        return;
      }
      setRemoveError(
        error instanceof ApiError ? error.message : "移除失败，请稍后重试。",
      );
    } finally {
      setRemoving(false);
    }
  };

  if (authStatus === "out") {
    return (
      <LoginView
        onSignedIn={handleSignedIn}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
    );
  }

  if (authStatus === "checking") {
    return (
      <main className="relative flex min-h-dvh items-center justify-center">
        <Backdrop />
        <p role="status" className="font-mono text-xs text-muted-foreground">
          正在检查登录状态…
        </p>
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh">
      <Backdrop />

      <div className="mx-auto flex w-full max-w-6xl flex-col px-5 pb-10 pt-7 sm:px-8 sm:pt-9">
        <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-card/80 text-foreground">
              <Gauge className="size-5" aria-hidden />
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-brand shadow-[0_0_12px_2px_var(--glow)]"
              />
            </span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-brand">
                Balance Console
              </p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
                多平台 Token 余量面板
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  settings.intervalSec > 0 ? "animate-pulse bg-success" : "bg-muted-foreground/50",
                )}
              />
              {settings.intervalSec > 0 ? "实时更新" : "手动刷新"}
              {data && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="font-mono text-muted-foreground/80">
                    {relativeTime(data.fetchedAt, now)}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span
                    className={cn(dataSource === "browser" && "text-info")}
                    title={dataSource === "browser"
                      ? "当前显示本标签页上次同步的余额快照，正在向服务端同步"
                      : "当前显示服务端返回的余额"}
                  >
                    {dataSource === "browser" ? "浏览器快照" : "服务端"}
                  </span>
                </>
              )}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            >
              {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh(true)}
              disabled={refreshing}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
              {refreshing ? "同步中" : "刷新"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 aria-hidden />
              设置
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus aria-hidden />
              添加账号
            </Button>
          </div>
        </header>

        {loadError && data && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="flex-1">
              刷新失败：{loadError}{" "}
              当前显示{dataSource === "browser" ? "本标签页上次同步的浏览器快照" : "服务端上次同步的数据"}。
            </p>
            <button
              type="button"
              onClick={() => void refresh(true)}
              className="shrink-0 rounded text-xs underline-offset-4 transition-colors hover:underline"
            >
              重试
            </button>
          </div>
        )}

        {initialLoading ? (
          <LoadingBlock />
        ) : !data ? (
          <ErrorPanel
            message={loadError ?? "看板服务暂时不可用，请稍后重试。"}
            onRetry={() => void refresh(true)}
          />
        ) : platforms.length === 0 ? (
          <EmptyState onAdd={openCreate} />
        ) : (
          <>
            <div className="mt-6">
              <SummaryBar
                cnyTotal={totals.CNY}
                usdTotal={totals.USD}
                cnyCount={cnyCount}
                usdCount={usdCount}
                connected={platforms.length}
                platformCount={platformCount}
                alerts={alerts}
                fetchedAt={data.fetchedAt}
                now={now}
              />
            </div>

            <section aria-label="平台余额" className="mt-4">
              <SortableGrid onMove={moveAccount}>
                {orderedPlatforms.map((platform, index) => (
                  <div
                    key={platform.accountId}
                    data-sort-id={platform.accountId}
                    className="h-full min-w-0 rounded-2xl transition-opacity data-[dragging=true]:opacity-50"
                  >
                    <BalanceCard
                      platform={platform}
                      meta={platformMeta(platform.id)}
                      threshold={thresholdFor(platform.id)}
                      fetchedAt={data.fetchedAt}
                      now={now}
                      sortable={platforms.length > 1}
                      canMoveUp={index > 0}
                      canMoveDown={index < orderedPlatforms.length - 1}
                      onRetry={() => void refresh(true)}
                      onEdit={() => openEdit(platform)}
                      onRemove={() => requestRemove(platform)}
                      onMoveUp={() => moveAccountBy(platform.accountId, -1)}
                      onMoveDown={() => moveAccountBy(platform.accountId, 1)}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={openCreate}
                  className="group flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary">
                    <Plus className="size-5" aria-hidden />
                  </span>
                  <span className="text-sm font-medium">添加账号</span>
                  <span className="max-w-[16rem] text-pretty text-[11px] leading-relaxed text-muted-foreground">
                    同一平台可以重复添加，分别显示不同账号的余量
                  </span>
                </button>
              </SortableGrid>
            </section>
          </>
        )}

        <footer className="mt-8 border-t border-border pt-5 text-[11px] leading-relaxed text-muted-foreground/80">
          <p>凭据与看板设置仅保存在服务端，余额由服务端代查；浏览器只保留不含凭据的显示快照。</p>
          <p className="mt-1">
            查询结果缓存 30 秒，手动刷新跳过缓存；卡片标注查询渠道，拖动手柄可调整顺序并同步到服务端。实际额度以各平台控制台为准。
          </p>
          <SiteFooter className="mt-4" />
        </footer>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        settingsStatus={settingsStatus}
        settingsError={settingsError}
        onChange={changeSettings}
        onRetrySettings={retrySettings}
        platforms={platforms}
        username={username}
        onLogout={handleLogout}
        onAdd={openCreate}
        onEdit={openEdit}
        onRemove={requestRemove}
      />

      <AccountDialog
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        mode={dialog?.mode ?? "create"}
        account={dialog?.account ?? null}
        onSaved={() => void refresh(true)}
      />

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(next) => {
          if (!next && !removing) {
            setPendingRemove(null);
            setRemoveError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除这个账号？</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {pendingRemove
                ? `${
                  platformMeta(pendingRemove.id).name
                }${pendingRemove.label ? ` · ${pendingRemove.label}` : ""} 将从看板移除，保存在服务端的凭据也会一并删除。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {removeError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void confirmRemove();
              }}
            >
              {removing ? "移除中…" : "移除账号"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="aurora-blob absolute -top-[18%] left-[6%] size-[560px] rounded-full blur-[110px]"
        style={{
          background: "radial-gradient(closest-side, var(--aurora-1), transparent)",
          animation: "aurora-drift-a 52s ease-in-out infinite",
        }}
      />
      <div
        className="aurora-blob absolute right-[-12%] top-[28%] size-[640px] rounded-full blur-[130px]"
        style={{
          background: "radial-gradient(closest-side, var(--aurora-2), transparent)",
          animation: "aurora-drift-b 64s ease-in-out infinite",
        }}
      />
      <div
        className="aurora-blob absolute bottom-[-28%] left-[32%] size-[560px] rounded-full blur-[120px]"
        style={{
          background: "radial-gradient(closest-side, var(--aurora-3), transparent)",
          animation: "aurora-drift-c 74s ease-in-out infinite",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 68%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 68%)",
        }}
      />
    </div>
  );
}

function LoadingBlock() {
  return (
    <div aria-label="正在同步余额" role="status">
      <div className="mt-6 flex flex-wrap gap-x-12 gap-y-6 px-1 py-2">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index}>
            <Skeleton className="h-2.5 w-16 bg-muted" />
            <Skeleton className="mt-3 h-7 w-24 bg-muted" />
            <Skeleton className="mt-2.5 h-2.5 w-20 bg-muted/70" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-xl bg-muted" />
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-24 bg-muted" />
                <Skeleton className="h-2.5 w-16 bg-muted/70" />
              </div>
            </div>
            <Skeleton className="mt-6 h-2.5 w-16 bg-muted/70" />
            <Skeleton className="mt-3 h-9 w-36 bg-muted" />
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Skeleton className="h-10 bg-muted/70" />
              <Skeleton className="h-10 bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center font-mono text-xs text-muted-foreground">
        正在同步各平台余额…
      </p>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <section
      aria-label="开始使用"
      className="mt-8 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-16 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
        <Gauge className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-medium">还没有添加账号</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        添加一个账号，看板才会出现一张卡片。同一平台可以重复添加，用来分别查看不同账户的余量。
      </p>
      <Button className="mt-5" onClick={onAdd}>
        <Plus aria-hidden />
        添加第一个账号
      </Button>
      <p className="mt-4 max-w-sm text-[11px] leading-relaxed text-muted-foreground/80">
        凭据只保存在站点后端，请求由服务端发起，页面不会接触凭据内容。
      </p>
    </section>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-14 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10 text-danger">
        <CircleAlert className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-medium">无法加载余额</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
      <Button size="sm" className="mt-5" onClick={onRetry}>
        重新加载
      </Button>
    </div>
  );
}

