import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CircleHelp,
  ExternalLink,
  KeyRound,
  Loader2,
  LockKeyhole,
  Pencil,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { createAccount, updateAccount, type CredentialValues, type Region } from "@/lib/accounts";
import type { PlatformBalance } from "@/lib/balance";
import { platformMeta, SUPPORTED_PLATFORMS } from "@/lib/platforms";
import { ApiError } from "@/lib/request";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  account: PlatformBalance | null;
  onSaved: () => void | Promise<void>;
}

function monogramStyle(accent: string): CSSProperties {
  return {
    color: `color-mix(in oklab, ${accent} 72%, var(--foreground))`,
    borderColor: `color-mix(in oklab, ${accent} 32%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${accent} 13%, transparent)`,
  };
}

export function AccountDialog({ open, onOpenChange, mode, account, onSaved }: Props) {
  const editingId = account?.accountId ?? null;
  const [platform, setPlatform] = useState("deepseek");
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [region, setRegion] = useState<Region>("cn");
  const [reveal, setReveal] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlatform(account?.id ?? "deepseek");
    setLabel(account?.label ?? "");
    setValues({});
    setRegion("cn");
    setReveal(false);
    setGuideOpen(false);
    setError(null);
    setSubmitting(false);
  }, [open, editingId]);

  const meta = useMemo(() => platformMeta(platform), [platform]);
  const isEdit = mode === "edit" && account !== null;
  const hasCredentialInput = meta.fields.some((field) => (values[field.key] ?? "").trim() !== "");
  const regionOptions = meta.auth === "qoder"
    ? [
      { value: "cn", label: "国内版 · qoder.cn" },
      { value: "intl", label: "国际版 · qoder.com" },
    ]
    : meta.auth === "workbuddy"
    ? [
      { value: "cn", label: "国内版 · workbuddy.cn" },
      { value: "intl", label: "国际版 · workbuddy.ai" },
    ]
    : null;

  const setValue = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    if (submitting) return;
    const needsCredential = !isEdit || hasCredentialInput;
    if (needsCredential) {
      // Zhipu offers two mutually exclusive query modes: an API key for the
      // Coding Plan quota or a console token for the account balance.
      if (meta.auth === "zhipu") {
        const key = (values.key ?? "").trim();
        const session = (values.session ?? "").trim();
        if (!key && !session) {
          setError("请填写 API Key 或登录令牌");
          return;
        }
        if (key && session) {
          setError("API Key 与登录令牌请只填写一项");
          return;
        }
        if (key && key.length < 8) {
          setError("API Key 看起来不完整，请重新复制");
          return;
        }
        if (session && session.length < 20) {
          setError("登录令牌看起来不完整，请重新复制");
          return;
        }
      } else {
        const missing = meta.fields.find((field) => (values[field.key] ?? "").trim() === "");
        if (missing) {
          setError(`请填写 ${missing.label}`);
          return;
        }
        if (meta.auth === "session" && (values.session ?? "").trim().length < 10) {
          setError(
            `${platform === "tokenrhythm" ? "tr_session" : "登录 Cookie"} 看起来不完整，请重新复制`,
          );
          return;
        }
        if (meta.auth === "workbuddy" && (values.session ?? "").trim().length < 20) {
          setError("登录 Cookie 看起来不完整，请确认同时复制了 session 与 session_2");
          return;
        }
        if (meta.auth === "qoder" && (values.key ?? "").trim().length < 20) {
          setError("个人访问令牌看起来不完整，请重新复制 pt- 开头的完整令牌");
          return;
        }
      }
    }
    let credential: CredentialValues | undefined;
    if (needsCredential) {
      if (meta.auth === "workbuddy") {
        credential = { session: (values.session ?? "").trim(), region };
      } else if (meta.auth === "qoder") {
        credential = { key: (values.key ?? "").trim(), region };
      } else if (meta.auth === "zhipu") {
        const key = (values.key ?? "").trim();
        credential = key
          ? { key }
          : { session: (values.session ?? "").trim() };
      } else if (meta.auth === "session") {
        credential = { session: (values.session ?? "").trim() };
      } else {
        credential = { key: (values.key ?? "").trim() };
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const input = {
        platform,
        label: label.trim(),
        ...(credential ? { credential } : {}),
      };
      if (isEdit && account) {
        await updateAccount(account.accountId, input);
      } else {
        await createAccount(input);
      }
      onOpenChange(false);
      void onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "保存失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto border-border bg-popover text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-left text-base">
            <span className="flex size-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              {isEdit ? <Pencil className="size-4" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
            </span>
            {isEdit ? "更新账号凭据" : "添加账号"}
          </DialogTitle>
          <DialogDescription className="text-left leading-relaxed">
            {isEdit
              ? "凭据不会回传浏览器，留空只修改名称；填写凭据则整体替换。"
              : "每个账号会生成一张卡片。同一平台可以添加多个账号，分别查看不同账户。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {isEdit ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl border font-mono text-xs font-semibold"
                style={monogramStyle(meta.accent)}
              >
                {meta.monogram}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{meta.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {meta.vendor}
                  {account?.label ? ` · ${account.label}` : ""}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium text-foreground">选择平台</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {SUPPORTED_PLATFORMS.map((option) => {
                  const selected = option.id === platform;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setPlatform(option.id);
                        setValues({});
                        setError(null);
                      }}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-muted/30 hover:border-foreground/20",
                      )}
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-semibold"
                        style={monogramStyle(option.accent)}
                      >
                        {option.monogram}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {option.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {option.vendor}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="account-label" className="text-xs">
              账号名称
            </Label>
            <Input
              id="account-label"
              value={label}
              maxLength={24}
              autoComplete="off"
              placeholder="例如：主号 / 工作账号"
              onChange={(event) => setLabel(event.target.value)}
              className="border-border bg-muted/40"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              可留空；同一平台添加多个账号时建议填写，便于区分。
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-foreground">
                {meta.auth === "session"
                  ? "会话凭据"
                  : meta.auth === "workbuddy"
                  ? "登录凭据"
                  : meta.auth === "qoder"
                  ? "访问令牌"
                  : meta.auth === "zhipu"
                  ? "访问凭据（二选一）"
                  : "API 凭据"}
              </p>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="inline-flex items-center gap-1 rounded text-[11px] text-info transition-colors hover:text-info/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
                >
                  <CircleHelp className="size-3" aria-hidden />
                  如何获取？
                </button>
                {meta.fields.some((field) => field.secret) && (
                  <button
                    type="button"
                    onClick={() => setReveal((current) => !current)}
                    className="inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <LockKeyhole className="size-3" aria-hidden />
                    {reveal ? "隐藏内容" : "显示内容"}
                  </button>
                )}
              </div>
            </div>

            {meta.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`account-${field.key}`} className="text-[11px] text-muted-foreground">
                  {field.label}
                </Label>
                <Input
                  id={`account-${field.key}`}
                  type={field.secret && !reveal ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={isEdit ? "留空则保持不变" : field.placeholder}
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className="border-border bg-muted/40 font-mono text-xs"
                />
              </div>
            ))}

            {regionOptions && (
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">版本</Label>
                <Select
                  value={region}
                  onValueChange={(next) => setRegion(next === "intl" ? "intl" : "cn")}
                >
                  <SelectTrigger className="w-full border-border bg-muted/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {regionOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info/10 px-3 py-2.5 text-[11px] leading-relaxed text-foreground/75">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
              <span>
                {meta.help}
                {meta.consoleUrl && (
                  <>
                    {" "}
                    <a
                      href={meta.consoleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-info underline-offset-2 hover:underline"
                    >
                      打开控制台
                    </a>
                  </>
                )}
              </span>
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
              {error}
            </p>
          )}

          <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            凭据仅保存在站点后端，仅用于查询余额。浏览器请求与页面数据不会包含凭据内容。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            {submitting ? "保存中" : isEdit ? "保存更改" : "添加并查询"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-h-[88dvh] gap-4 overflow-y-auto border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-left text-base">
              <span className="flex size-8 items-center justify-center rounded-lg border border-info/30 bg-info/10 text-info">
                <CircleHelp className="size-4" aria-hidden />
              </span>
              {meta.name} · 如何获取凭据
            </DialogTitle>
            <DialogDescription className="text-left leading-relaxed">
              按下面的步骤复制凭据，回到添加窗口粘贴即可；凭据只提交给站点后端。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <section className="rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">查询渠道</p>
              <p className="mt-1 text-xs font-medium text-foreground">{meta.channel.label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {meta.channel.detail}
              </p>
            </section>

            <section className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">格式说明</p>
              <dl className="space-y-2">
                {meta.guide.formats.map((format) => (
                  <div
                    key={format.label}
                    className="rounded-xl border border-border bg-muted/40 px-3 py-2.5"
                  >
                    <dt className="text-xs font-medium text-foreground">{format.label}</dt>
                    <dd className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {format.pattern}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">获取步骤</p>
              <ol className="space-y-2.5">
                {meta.guide.steps.map((step, index) => (
                  <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-foreground/85">
                    <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-[10px] text-primary">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="space-y-1.5 rounded-xl border border-info/25 bg-info/10 px-3 py-2.5">
              {meta.guide.notes.map((note) => (
                <p key={note} className="flex gap-2 text-[11px] leading-relaxed text-foreground/75">
                  <span className="text-info" aria-hidden>
                    ·
                  </span>
                  <span>{note}</span>
                </p>
              ))}
            </section>

            {meta.consoleUrl && (
              <a
                href={meta.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-info underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                打开 {meta.name} 控制台
              </a>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setGuideOpen(false)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
