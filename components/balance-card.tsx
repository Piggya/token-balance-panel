import type { CSSProperties } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Clock,
  Cookie,
  GripVertical,
  MoreHorizontal,
  Pencil,
  PlugZap,
  Trash2,
} from "lucide-react";
import type { PlatformBalance, QuotaWindow } from "@/lib/balance";
import type { PlatformMeta } from "@/lib/platforms";
import {
  currencySymbol,
  formatAmount,
  formatCount,
  formatCountdown,
  formatDate,
  formatMeasure,
  formatReset,
} from "@/lib/format";
import { errorCopy, levelOf, quotaPercent } from "@/lib/status";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  platform: PlatformBalance;
  meta: PlatformMeta;
  threshold: number;
  fetchedAt: string;
  now: number;
  sortable?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function usedPercentOf(window: QuotaWindow): number | null {
  if (window.remainingPercent !== null) return 100 - window.remainingPercent;
  if (window.used !== null && window.total !== null && window.total > 0) {
    return Math.min(100, Math.max(0, (window.used / window.total) * 100));
  }
  return null;
}

function remainingLabel(window: QuotaWindow): string {
  if (window.remaining !== null && window.total !== null) {
    return `剩余 ${formatCount(window.remaining)} / ${formatCount(window.total)} ${window.unit}`;
  }
  if (window.remaining !== null) {
    return `剩余 ${formatCount(window.remaining)} ${window.unit}`;
  }
  if (window.remainingPercent !== null) {
    return `剩余 ${Math.round(window.remainingPercent)}%`;
  }
  return "剩余额度未知";
}

export function BalanceCard({
  platform,
  meta,
  threshold,
  fetchedAt,
  now,
  sortable = false,
  canMoveUp = false,
  canMoveDown = false,
  onRetry,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: Props) {
  const level = levelOf(platform, threshold);
  const isQuota = platform.kind === "quota";
  const isCredits = platform.kind === "credits";
  const primaryQuota = isQuota ? platform.quota[0] ?? null : null;
  const isOk = platform.status === "ok" &&
    (isQuota ? primaryQuota !== null : platform.balance !== null);
  const usedPercent = platform.usage && platform.usage.total > 0
    ? Math.min(100, Math.max(0, (platform.usage.used / platform.usage.total) * 100))
    : null;
  const accentInk = `color-mix(in oklab, ${meta.accent} 78%, var(--foreground))`;
  const monogramStyle = {
    color: accentInk,
    borderColor: `color-mix(in oklab, ${meta.accent} 30%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${meta.accent} 12%, transparent)`,
  } as CSSProperties;
  const expiryPast = platform.expiresAt ? Date.parse(platform.expiresAt) <= now : false;
  const quotaResetWord = primaryQuota?.resetWord ?? "刷新";
  const combinedQuota = isQuota && primaryQuota !== null && primaryQuota.remaining !== null &&
    platform.balance !== null && platform.balance !== primaryQuota.remaining;

  const describe = () => {
    if (platform.status === "error") return errorCopy(platform.error, platform.httpStatus);
    if (isQuota) {
      const scope = combinedQuota ? "可用额度" : primaryQuota?.label ?? "当前窗口";
      if (level === "empty") return `${scope}已用尽，等待自动${quotaResetWord}`;
      if (level === "low") return `${scope}接近上限`;
      const percent = quotaPercent(platform);
      const plan = platform.note ?? "订阅额度";
      return percent !== null
        ? `${plan} · 官方剩余 ${Math.round(percent)}%`
        : plan;
    }
    if (level === "empty") {
      return isCredits ? "积分已用尽，请续订或等待发放" : "余额已耗尽，请及时充值";
    }
    if (platform.expiresAt) {
      const date = formatDate(platform.expiresAt);
      return expiryPast ? `限时额度已于 ${date} 到期` : `限时额度 ${date} 到期`;
    }
    if (isCredits) {
      return platform.note
        ? `${platform.note} · 累计剩余积分`
        : "累计剩余积分 · 平台实时返回";
    }
    return platform.note ??
      (platform.currency === "CNY" ? "人民币额度 · 平台实时返回" : "美元额度 · 平台实时返回");
  };

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-xl">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px opacity-80"
        style={{ background: `linear-gradient(90deg, transparent, ${accentInk}, transparent)` }}
      />

      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl border font-mono text-xs font-semibold"
            style={monogramStyle}
          >
            {meta.monogram}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-tight tracking-tight text-foreground">
              {meta.name}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {platform.label ? `${meta.vendor} · ${platform.label}` : meta.vendor}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {sortable && (
            <button
              type="button"
              data-drag-handle
              aria-label={`拖动调整 ${meta.name}${platform.label ? ` ${platform.label}` : ""} 的排序`}
              title="按住拖动调整顺序"
              className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
          )}
          <StatusPill level={level} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mr-1.5 text-muted-foreground hover:text-foreground"
                aria-label={`${meta.name}${platform.label ? ` ${platform.label}` : ""} 账号操作`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {sortable && (
                <>
                  <DropdownMenuItem disabled={!canMoveUp} onSelect={onMoveUp}>
                    <ArrowUp aria-hidden />
                    前移
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!canMoveDown} onSelect={onMoveDown}>
                    <ArrowDown aria-hidden />
                    后移
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden />
                更新凭据
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2 aria-hidden />
                移除账号
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="mt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">
          {isQuota ? meta.quotaHeadline ?? "剩余额度" : isCredits ? "累计剩余积分" : "可用余额"}
        </p>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          {!isOk ? (
            <span className="font-mono text-[38px] font-semibold leading-none tracking-tight text-muted-foreground/40">
              —
            </span>
          ) : isQuota && primaryQuota ? (
            platform.balance !== null && primaryQuota.remaining !== null ? (
              <>
                <span className="font-mono text-[38px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
                  {formatCount(platform.balance)}
                </span>
                <span className="text-base leading-none text-muted-foreground">
                  {primaryQuota.unit}
                </span>
              </>
            ) : primaryQuota.remainingPercent !== null ? (
              <>
                <span className="font-mono text-[38px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
                  {Math.round(primaryQuota.remainingPercent)}
                </span>
                <span className="text-base leading-none text-muted-foreground">%</span>
              </>
            ) : (
              <span className="font-mono text-[38px] font-semibold leading-none tracking-tight text-muted-foreground/40">
                —
              </span>
            )
          ) : isCredits ? (
            <>
              <span className="font-mono text-[38px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
                {formatCount(platform.balance)}
              </span>
              <span className="text-base leading-none text-muted-foreground">积分</span>
            </>
          ) : (
            <>
              <span className="text-lg leading-none text-muted-foreground">
                {currencySymbol(platform.currency)}
              </span>
              <span className="font-mono text-[38px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
                {formatAmount(platform.balance)}
              </span>
            </>
          )}
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{describe()}</p>
        <p
          className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-[10px] leading-none text-muted-foreground"
          title={meta.channel.detail}
          aria-label={`查询渠道：${meta.channel.label}。${meta.channel.detail}`}
        >
          {meta.channel.kind === "api" ? (
            <PlugZap className="size-3 shrink-0" style={{ color: accentInk }} aria-hidden />
          ) : (
            <Cookie className="size-3 shrink-0" style={{ color: accentInk }} aria-hidden />
          )}
          <span className="truncate">{meta.channel.label}</span>
        </p>
      </div>

      {platform.status === "ok" && platform.details.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4">
          {platform.details.map((detail) => (
            <div key={detail.label} className="min-w-0">
              <dt className="truncate text-[11px] text-muted-foreground">{detail.label}</dt>
              <dd className="mt-0.5 truncate font-mono text-[13px] text-foreground/80 tabular-nums">
                {formatMeasure(detail.amount, detail.currency, detail.unit)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {usedPercent !== null && platform.usage && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{isCredits ? "积分使用" : "额度使用"}</span>
            <span className="font-mono tabular-nums">{usedPercent.toFixed(1)}%</span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-label={`${meta.name} 额度使用比例`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usedPercent)}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${usedPercent}%`, backgroundColor: accentInk }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
            {isCredits
              ? `已用 ${formatCount(platform.usage.used)} / 累计获得 ${formatCount(platform.usage.total)} 积分`
              : `已用 ${formatMeasure(platform.usage.used, platform.currency)} / 总额 ${
                formatMeasure(platform.usage.total, platform.currency)
              }`}
          </p>
        </div>
      )}

      {isOk && platform.quota.length > 0 && (
        <div className="mt-4 space-y-3">
          {platform.quota.map((window) => {
            const ratio = usedPercentOf(window);
            const countdown = window.resetAt ? formatCountdown(window.resetAt, now) : null;
            const resetWord = window.resetWord ?? "刷新";
            return (
              <div key={window.label}>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{window.label}</span>
                  <span className="font-mono tabular-nums">
                    {window.remainingPercent !== null
                      ? `剩 ${Math.round(window.remainingPercent)}%`
                      : "—"}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10"
                  role="progressbar"
                  aria-label={`${meta.name} ${window.label}已用比例`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={ratio === null ? undefined : Math.round(ratio)}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${ratio ?? 0}%`, backgroundColor: accentInk }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums">
                  <span className="truncate text-muted-foreground/80">{remainingLabel(window)}</span>
                  <span
                    className={cn(
                      "shrink-0",
                      window.remainingPercent !== null && window.remainingPercent <= 20
                        ? "text-warning"
                        : "text-muted-foreground",
                    )}
                  >
                    {countdown === null
                      ? "—"
                      : countdown === "已刷新"
                      ? `额度已${resetWord}`
                      : `${countdown}${resetWord}`}
                  </span>
                </div>
                {window.resetAt && (
                  <p className="mt-1 text-[10px] text-muted-foreground/60">
                    {resetWord}时间 {formatReset(window.resetAt, now)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-[11px] text-muted-foreground/80">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Clock className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {platform.status === "error"
              ? "凭据失效时可更新后重试"
              : `更新于 ${
                new Date(fetchedAt).toLocaleTimeString("zh-CN", { hour12: false })
              }${platform.cached ? " · 服务端缓存" : ""}`}
          </span>
        </span>
        {platform.status === "error" ? (
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={onEdit}
              className="rounded text-foreground/70 underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              更新凭据
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="rounded text-foreground/70 underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              重试
            </button>
          </div>
        ) : meta.consoleUrl ? (
          <a
            href={meta.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-0.5 rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            控制台
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        ) : null}
      </footer>
    </article>
  );
}
