import { useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changePassword } from "@/lib/auth";
import { ApiError } from "@/lib/request";
import type { PlatformBalance } from "@/lib/balance";
import { PLATFORM_META, platformMeta } from "@/lib/platforms";
import { currencySymbol } from "@/lib/format";
import { INTERVAL_OPTIONS, type Settings, type SettingsSyncStatus } from "@/lib/settings";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  settingsStatus: SettingsSyncStatus;
  settingsError: string | null;
  onChange: (next: Settings) => void;
  onRetrySettings: () => void;
  platforms: PlatformBalance[];
  username: string | null;
  onLogout: () => void;
  onAdd: () => void;
  onEdit: (platform: PlatformBalance) => void;
  onRemove: (platform: PlatformBalance) => void;
}

const THRESHOLD_PLATFORMS = Object.values(PLATFORM_META).filter((meta) => meta.kind !== "quota");

const SYNC_COPY: Record<SettingsSyncStatus, string> = {
  loading: "正在读取服务端设置…",
  saving: "正在保存到服务端…",
  synced: "设置与服务端一致",
  error: "设置未能同步到服务端",
};

export function SettingsSheet({
  open,
  onOpenChange,
  settings,
  settingsStatus,
  settingsError,
  onChange,
  onRetrySettings,
  platforms,
  username,
  onLogout,
  onAdd,
  onEdit,
  onRemove,
}: Props) {
  const setThreshold = (id: string, value: number) => {
    onChange({ ...settings, thresholds: { ...settings.thresholds, [id]: value } });
  };

  const SyncIcon = settingsStatus === "synced"
    ? CircleCheck
    : settingsStatus === "error"
    ? CircleAlert
    : Loader2;
  const syncTone = settingsStatus === "synced"
    ? "text-success"
    : settingsStatus === "error"
    ? "text-danger"
    : "text-muted-foreground";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-6 py-5 text-left">
          <SheetTitle>看板设置</SheetTitle>
          <SheetDescription className="leading-relaxed">
            账号、刷新频率和提醒线保存在站点后端；浏览器只保留显示缓存。
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-8 px-6 py-6">
          <section aria-labelledby="settings-accounts">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" aria-hidden />
                <h3 id="settings-accounts" className="text-sm font-medium">
                  已添加账号
                </h3>
              </div>
              <Button variant="outline" size="sm" onClick={onAdd}>
                <Plus aria-hidden />
                添加账号
              </Button>
            </div>

            {platforms.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-border px-3.5 py-6 text-center">
                <p className="text-xs text-muted-foreground">
                  还没有账号。添加一个账号后，看板才会显示对应的卡片。
                </p>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                {platforms.map((platform) => {
                  const meta = platformMeta(platform.id);
                  const ok = platform.status === "ok";
                  return (
                    <li
                      key={platform.accountId}
                      className="flex items-center gap-2.5 px-3.5 py-3"
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-semibold"
                        style={{
                          color: `color-mix(in oklab, ${meta.accent} 72%, var(--foreground))`,
                          borderColor: `color-mix(in oklab, ${meta.accent} 32%, transparent)`,
                          backgroundColor: `color-mix(in oklab, ${meta.accent} 13%, transparent)`,
                        }}
                      >
                        {meta.monogram}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {meta.name}
                          {platform.label && (
                            <span className="text-muted-foreground"> · {platform.label}</span>
                          )}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span
                            aria-hidden
                            className={`size-1.5 rounded-full ${
                              ok ? "bg-success" : "bg-danger"
                            }`}
                          />
                          {ok ? "查询正常" : "查询失败"}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`更新 ${meta.name}${platform.label ? ` ${platform.label}` : ""} 凭据`}
                        onClick={() => onEdit(platform)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`移除 ${meta.name}${platform.label ? ` ${platform.label}` : ""}`}
                        onClick={() => onRemove(platform)}
                        className="text-muted-foreground hover:text-danger"
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              同一平台可以添加多个账号，各自生成一张卡片，便于同时查看不同账户。
            </p>
          </section>

          <section aria-labelledby="settings-interval">
            <h3 id="settings-interval" className="text-sm font-medium">
              自动刷新
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              页面打开时按间隔拉取余额；服务端对同一账号的查询结果缓存 30 秒，自动刷新通常命中缓存。
            </p>
            <Select
              value={String(settings.intervalSec)}
              onValueChange={(value) =>
                onChange({ ...settings, intervalSec: Number(value) })}
            >
              <SelectTrigger className="mt-3 w-full">
                <SelectValue placeholder="选择刷新频率" />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section aria-labelledby="settings-cache">
            <h3 id="settings-cache" className="text-sm font-medium">
              数据与缓存
            </h3>
            <div className="mt-3 divide-y divide-border rounded-xl border border-border text-[11px] leading-relaxed">
              <div className="px-3.5 py-3">
                <p className="text-sm text-foreground">服务端</p>
                <p className="mt-1 text-muted-foreground">
                  账号凭据、账号列表、刷新频率与提醒线。余额查询结果缓存 30 秒，同一账号的所有标签页共享，手动刷新会跳过缓存。
                </p>
              </div>
              <div className="px-3.5 py-3">
                <p className="text-sm text-foreground">浏览器</p>
                <p className="mt-1 text-muted-foreground">
                  主题偏好、设置的本机副本，以及当前标签页的余额快照。副本用于打开时快速显示、以服务端为准；快照不含凭据，关闭标签页后自动清除。
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-[11px] leading-relaxed">
              <SyncIcon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  (settingsStatus === "loading" || settingsStatus === "saving") && "animate-spin",
                  syncTone,
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={settingsStatus === "error" ? "text-danger" : "text-muted-foreground"}>
                  {SYNC_COPY[settingsStatus]}
                </p>
                {settingsStatus === "error" && settingsError && (
                  <p className="mt-0.5 text-muted-foreground">{settingsError}</p>
                )}
              </div>
              {settingsStatus === "error" && (
                <Button variant="outline" size="sm" onClick={onRetrySettings}>
                  重试
                </Button>
              )}
            </div>
          </section>

          <section aria-labelledby="settings-thresholds">
            <h3 id="settings-thresholds" className="text-sm font-medium">
              低余量提醒线
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              余额或积分低于提醒线时卡片标记为「余量偏低」，仅在页面内提示。
            </p>
            <div className="mt-3 divide-y divide-border rounded-xl border border-border">
              {THRESHOLD_PLATFORMS.map((meta) => {
                const threshold = settings.thresholds[meta.id] ?? meta.defaultThreshold;
                const isCredits = meta.kind === "credits";
                return (
                  <div key={meta.id} className="flex items-center justify-between gap-4 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{meta.name}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {isCredits
                          ? "积分 · credits"
                          : `${currencySymbol(meta.currency)} · ${meta.currency}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!isCredits && (
                        <span className="text-sm text-muted-foreground">
                          {currencySymbol(meta.currency)}
                        </span>
                      )}
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="decimal"
                        aria-label={`${meta.name} 低余量提醒线`}
                        value={threshold}
                        onChange={(event) => {
                          const next = event.target.value === "" ? 0 : Number(event.target.value);
                          if (!Number.isFinite(next) || next < 0) return;
                          setThreshold(meta.id, next);
                        }}
                        className="h-8 w-24 text-right font-mono tabular-nums"
                      />
                      {isCredits && <span className="text-sm text-muted-foreground">积分</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <SecuritySection username={username} onLogout={onLogout} />

          <section aria-labelledby="settings-help">
            <h3 id="settings-help" className="text-sm font-medium">
              凭据填写方式
            </h3>
            <div className="mt-3 divide-y divide-border rounded-xl border border-border text-[11px] leading-relaxed">
              <div className="px-3.5 py-3">
                <p className="text-muted-foreground">DeepSeek · Kimi · 硅基流动 · OpenRouter · MiniMax</p>
                <p className="mt-1 text-foreground/80">平台控制台创建的 API Key。</p>
              </div>
              <div className="px-3.5 py-3">
                <p className="text-muted-foreground">基元律动</p>
                <p className="mt-1 text-foreground/80">
                  登录后打开 DevTools → Application → Cookies 复制 tr_session；列表里没有时，从
                  Network 中任意请求的 Cookie 复制含 tr_session 的完整内容。
                </p>
              </div>
              <div className="px-3.5 py-3">
                <p className="text-muted-foreground">WorkBuddy</p>
                <p className="mt-1 text-foreground/80">
                  登录后在 DevTools → Network 中复制任意 billing 请求头里的 session 与 session_2
                  两个 Cookie，保持 session=…; session_2=… 的写法。
                </p>
              </div>
              <div className="px-3.5 py-3">
                <p className="text-muted-foreground">Qoder</p>
                <p className="mt-1 text-foreground/80">
                  在 qoder.cn/account/integrations（国际版 qoder.com）创建个人访问令牌，复制 pt-
                  开头的令牌；面板会用它与官方 OpenAPI 兑换临时令牌后查询额度。
                </p>
              </div>
            </div>
          </section>

          <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info/10 px-3.5 py-3 text-[11px] leading-relaxed">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
            会话 Cookie 与登录令牌等同于账号登录态，都会过期；失效后在对应卡片上更新凭据即可。
          </p>

          <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            凭据只保存在站点后端的私有存储中，请求由服务端发起；页面和接口响应都不会返回凭据内容。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SecuritySection({
  username,
  onLogout,
}: {
  username: string | null;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setResult(null);
    if (next.length < 8 || next.length > 128) {
      setResult({ tone: "error", text: "新密码长度需要 8 到 128 个字符。" });
      return;
    }
    if (next !== confirm) {
      setResult({ tone: "error", text: "两次输入的新密码不一致。" });
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setResult({ tone: "ok", text: "密码已更新，下次登录使用新密码。" });
    } catch (error) {
      setResult({
        tone: "error",
        text: error instanceof ApiError ? error.message : "修改失败，请稍后重试。",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="settings-security">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" aria-hidden />
        <h3 id="settings-security" className="text-sm font-medium">
          安全
        </h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {username ? (
          <>
            当前用户 <span className="font-mono text-foreground/80">{username}</span>
            ，登录状态 7 天有效。
          </>
        ) : (
          "登录状态 7 天有效。"
        )}
      </p>

      <form className="mt-3 space-y-3 rounded-xl border border-border px-3.5 py-3.5" onSubmit={submit}>
        <p className="text-xs font-medium">修改面板密码</p>
        <div className="space-y-1">
          <Label htmlFor="security-current" className="text-[11px] text-muted-foreground">
            当前密码
          </Label>
          <Input
            id="security-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            disabled={submitting}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="security-next" className="text-[11px] text-muted-foreground">
            新密码（至少 8 位）
          </Label>
          <Input
            id="security-next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            disabled={submitting}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="security-confirm" className="text-[11px] text-muted-foreground">
            确认新密码
          </Label>
          <Input
            id="security-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={submitting}
            className="h-8"
          />
        </div>

        {result && (
          <p
            role={result.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-1.5 text-[11px] leading-relaxed",
              result.tone === "ok" ? "text-success" : "text-danger",
            )}
          >
            {result.tone === "ok"
              ? <CircleCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              : <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
            {result.text}
          </p>
        )}

        <Button type="submit" size="sm" disabled={submitting || !current || !next || !confirm}>
          {submitting && <Loader2 className="animate-spin" aria-hidden />}
          {submitting ? "正在更新…" : "更新密码"}
        </Button>
      </form>

      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={onLogout}
      >
        <LogOut aria-hidden />
        退出登录
      </Button>
    </section>
  );
}
