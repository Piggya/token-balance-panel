import { useState } from "react";
import { CircleAlert, Gauge, Loader2, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteFooter } from "@/components/site-footer";
import { login } from "@/lib/auth";
import { ApiError } from "@/lib/request";
import type { Theme } from "@/lib/theme";

interface Props {
  onSignedIn: (username: string | null) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function LoginView({ onSignedIn, theme, onToggleTheme }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!username.trim() || !password) {
      setError("请输入用户名和密码。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const name = await login(username.trim(), password);
      onSignedIn(name);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "登录失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-1/2 top-[-320px] h-[620px] w-[1200px] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 72%)",
            WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 72%)",
          }}
        />
      </div>

      <Button
        variant="outline"
        size="icon"
        className="absolute right-5 top-6"
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      >
        {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
      </Button>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card px-7 py-8 shadow-lg shadow-black/[0.03]">
        <div className="flex flex-col items-center text-center">
          <span className="relative flex size-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <Gauge className="size-6" aria-hidden />
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary shadow-[0_0_12px_2px_var(--glow)]"
            />
          </span>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.32em] text-primary/80">
            Balance Console
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">多平台 Token 余量面板</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            登录后查看各平台的 Token 消耗与余量。
          </p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="login-username">用户名</Label>
            <Input
              id="login-username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="login-password">密码</Label>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs leading-relaxed text-danger"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            {submitting ? "正在登录…" : "登录"}
          </Button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground/80">
          凭据只保存在服务端，页面不会接触平台 API Key。
        </p>
      </div>

      <SiteFooter className="absolute inset-x-0 bottom-5 px-5" />
    </main>
  );
}
